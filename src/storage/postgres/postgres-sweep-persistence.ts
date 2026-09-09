import { createHash } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { DatabasePersistenceConfig } from "../../config/env.js";
import { chunksOf } from "../../util/concurrency.js";
import type {
  ClassificationCandidate,
  SearchTermRow,
} from "../../types.js";
import type {
  SweepAccountInputs,
  SweepAccountSummaryRecord,
  SweepPersistence,
  SweepRunFinish,
  SweepRunStart,
} from "../persistence.js";
import { boundedRedactedJson, safeDatabaseMessage, stableStringify } from "./redaction.js";

interface AccountHandle {
  id: string;
  accountId: string;
  batches: Map<string, string>;
}

interface IdRow extends QueryResultRow {
  id: string;
}

export class PostgresSweepPersistence implements SweepPersistence {
  private readonly pool: Pool;
  private readonly organizationId: string;
  private readonly maxPayloadBytes: number;
  private runId: string | null = null;
  private readonly accounts = new Map<string, AccountHandle>();

  constructor(config: Extract<DatabasePersistenceConfig, { enabled: true }>) {
    this.organizationId = config.organizationId;
    this.maxPayloadBytes = config.maxPayloadBytes;
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      application_name: "negative-keyword-sweeper",
    });
  }

  async startRun(input: SweepRunStart): Promise<void> {
    await this.transaction(async (client) => {
      const ruleBundle = {
        ruleVersion: input.rules.version,
        promptVersion: input.rules.promptVersion,
        releaseId: input.rules.releaseId ?? null,
        sourcePath: input.rules.sourcePath,
        markdown: input.rules.markdown,
        phraseProtections: input.rules.phraseProtections ?? [],
      };
      const contentHash = sha256(stableStringify(ruleBundle));
      const insertedSnapshot = await client.query<IdRow>(`
        INSERT INTO negative_keyword_rule_snapshots (
          organization_id, rule_version, prompt_version, release_id, source_path,
          rules_markdown, phrase_protections, content_sha256
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        ON CONFLICT (organization_id, content_sha256) DO NOTHING
        RETURNING id::text AS id
      `, [
        this.organizationId,
        input.rules.version,
        input.rules.promptVersion,
        input.rules.releaseId ?? null,
        input.rules.sourcePath,
        input.rules.markdown,
        JSON.stringify(input.rules.phraseProtections ?? []),
        contentHash,
      ]);
      let ruleSnapshotId = insertedSnapshot.rows[0]?.id;
      if (ruleSnapshotId === undefined) {
        const existing = await queryOne<IdRow>(client, `
          SELECT id::text AS id
          FROM negative_keyword_rule_snapshots
          WHERE organization_id = $1 AND content_sha256 = $2
            AND rule_version = $3 AND prompt_version = $4
            AND source_path = $5 AND rules_markdown = $6
            AND phrase_protections = $7::jsonb
        `, [
          this.organizationId,
          contentHash,
          input.rules.version,
          input.rules.promptVersion,
          input.rules.sourcePath,
          input.rules.markdown,
          JSON.stringify(input.rules.phraseProtections ?? []),
        ], "Rule snapshot identity conflicted with different content");
        ruleSnapshotId = existing.id;
      }

      if (input.executionKey !== null) {
        const existingRun = await client.query<IdRow>(`
          SELECT id::text AS id
          FROM negative_keyword_sweep_runs
          WHERE organization_id = $1 AND execution_key = $2
        `, [this.organizationId, input.executionKey]);
        if (existingRun.rows[0] !== undefined) {
          this.runId = existingRun.rows[0].id;
          return;
        }
      }

      const result = await client.query<IdRow>(`
        INSERT INTO negative_keyword_sweep_runs (
          organization_id, run_key, execution_key, trigger_kind, status,
          requested_date, requested_date_source, processing_time_zone, started_at,
          rule_snapshot_id, llm_provider, llm_model, campaign_name_filter,
          account_selection_mode, account_allowlist_entry_count,
          google_fetch_concurrency, llm_concurrency, llm_batch_size,
          candidate_limit_per_account
        ) VALUES (
          $1, $2, $3, $4, 'running', $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18
        )
        ON CONFLICT (organization_id, run_key) DO NOTHING
        RETURNING id::text AS id
      `, [
        this.organizationId,
        input.runId,
        input.executionKey,
        input.executionKey === null ? "manual" : "scheduled",
        input.requestedDate,
        input.requestedDateSource === "COMMAND_LINE" ? "command_line" : "automatic_48_hours_back",
        input.processingTimeZone,
        input.startedAt,
        ruleSnapshotId,
        input.provider,
        input.model,
        input.campaignNameContains,
        input.accountSelectionMode,
        input.accountAllowlistEntryCount,
        input.googleFetchConcurrency,
        input.llmConcurrency,
        input.llmBatchSize,
        input.candidateLimitPerAccount,
      ]);
      this.runId = result.rows[0]?.id ?? null;
      if (this.runId === null) {
        const existing = await queryOne<IdRow>(client, `
          SELECT id::text AS id
          FROM negative_keyword_sweep_runs
          WHERE organization_id = $1 AND run_key = $2 AND requested_date = $3
            AND rule_snapshot_id = $4 AND llm_provider = $5 AND llm_model = $6
        `, [
          this.organizationId,
          input.runId,
          input.requestedDate,
          ruleSnapshotId,
          input.provider,
          input.model,
        ], "Sweep run identity conflicted with different content");
        this.runId = existing.id;
      }
    });
  }

  async recordDiscovery(discovered: number, eligible: number, selected: number): Promise<void> {
    const runId = this.requiredRunId();
    await this.transaction(async (client) => {
      await client.query(`
        UPDATE negative_keyword_sweep_runs
        SET organizations_discovered = $2,
            organizations_eligible = $3,
            organizations_selected = $4,
            updated_at = now()
        WHERE organization_id = $1 AND id = $5
      `, [this.organizationId, discovered, eligible, selected, runId]);
    });
  }

  async prepareAccount(input: SweepAccountInputs): Promise<void> {
    const runId = this.requiredRunId();
    await this.transaction(async (client) => {
      const account = await queryOne<{
        id: string;
        google_account_name: string;
        account_time_zone: string;
        currency_code: string;
      }>(client, `
        SELECT id::text AS id, google_account_name, account_time_zone, currency_code
        FROM client_accounts
        WHERE organization_id = $1
          AND google_customer_id = $2
          AND onboarding_status <> 'archived'
      `, [this.organizationId, input.organization.customerId],
      "Selected Google Ads customer is not an active Built Ads Manager client account");

      const accountRunResult = await client.query<IdRow>(`
        INSERT INTO negative_keyword_sweep_account_runs (
          organization_id, sweep_run_id, account_id, google_customer_id,
          account_name, account_time_zone, currency_code, start_date, end_date,
          status, started_at, raw_row_count, scoped_row_count,
          available_candidate_count, processed_candidate_count,
          fixed_input_tokens, fixed_input_definition, fixed_input_model,
          fixed_input_counted_at, fixed_input_provider_request_id,
          fixed_input_attempt_count, fixed_input_retry_count
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, 'running', $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
        )
        ON CONFLICT (sweep_run_id, account_id) DO UPDATE
          SET status = 'running', completed_at = NULL, updated_at = now()
        RETURNING id::text AS id
      `, [
        this.organizationId,
        runId,
        account.id,
        input.organization.customerId,
        input.organization.descriptiveName || account.google_account_name,
        input.organization.timeZone || account.account_time_zone,
        input.organization.currencyCode || account.currency_code,
        input.dateRange.startDate,
        input.dateRange.endDate,
        input.startedAt,
        input.rows.length,
        input.scopedRowCount,
        input.availableCandidateCount,
        input.candidates.length,
        input.fixedInput?.totalTokens ?? null,
        input.fixedInput?.definition ?? null,
        input.fixedInput?.model ?? null,
        input.fixedInput?.countedAt ?? null,
        input.fixedInput?.providerRequestId ?? null,
        input.fixedInput?.attemptCount ?? null,
        input.fixedInput?.retryCount ?? null,
      ]);
      const accountRunId = accountRunResult.rows[0]!.id;
      const handle: AccountHandle = { id: accountRunId, accountId: account.id, batches: new Map() };
      this.accounts.set(input.organization.customerId, handle);

      for (const row of input.rows) {
        await this.insertFact(client, runId, handle, row, input.fetchedAt);
      }

      const batches = chunksOf(input.candidates, input.batchSize);
      let ordinal = 0;
      for (let index = 0; index < batches.length; index += 1) {
        const batchKey = String(index + 1).padStart(4, "0");
        const candidates = batches[index]!;
        const requestPayload = boundedRedactedJson({
          account: {
            customerId: input.organization.customerId,
            descriptiveName: input.organization.descriptiveName,
            timeZone: input.organization.timeZone,
          },
          dateRange: input.dateRange,
          rules: input.rules,
          searchTerms: candidates,
        }, this.maxPayloadBytes);
        const batch = await client.query<IdRow>(`
          INSERT INTO negative_keyword_llm_batches (
            organization_id, sweep_run_id, sweep_account_run_id, account_id,
            batch_key, provider, model, rule_version, prompt_version,
            status, candidate_count, request_payload, payload_truncated, payload_sha256
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', $10, $11::jsonb, $12, $13)
          ON CONFLICT (sweep_account_run_id, batch_key) DO NOTHING
          RETURNING id::text AS id
        `, [
          this.organizationId,
          runId,
          handle.id,
          handle.accountId,
          batchKey,
          input.provider,
          input.model,
          input.rules.version,
          input.rules.promptVersion,
          candidates.length,
          JSON.stringify(requestPayload.value),
          requestPayload.truncated,
          requestPayload.sha256,
        ]);
        let batchId = batch.rows[0]?.id;
        if (batchId === undefined) {
          const existing = await queryOne<IdRow>(client, `
            SELECT id::text AS id
            FROM negative_keyword_llm_batches
            WHERE organization_id = $1 AND sweep_account_run_id = $2 AND batch_key = $3
              AND provider = $4 AND model = $5 AND candidate_count = $6
              AND request_payload = $7::jsonb
          `, [
            this.organizationId,
            handle.id,
            batchKey,
            input.provider,
            input.model,
            candidates.length,
            JSON.stringify(requestPayload.value),
          ], "LLM batch identity conflicted with different input");
          batchId = existing.id;
        }
        handle.batches.set(batchKey, batchId);

        for (const candidate of candidates) {
          ordinal += 1;
          await this.insertCandidate(client, runId, handle, batchId, candidate, ordinal);
        }
      }
    });
  }

  async markBatchRunning(customerId: string, batchKey: string, startedAt: string): Promise<void> {
    const handle = this.requiredAccount(customerId);
    const batchId = requiredMapValue(handle.batches, batchKey, "batch");
    await this.transaction(async (client) => {
      await client.query(`
        UPDATE negative_keyword_llm_batches
        SET status = 'running', started_at = COALESCE(started_at, $3)
        WHERE organization_id = $1 AND id = $2
      `, [this.organizationId, batchId, startedAt]);
    });
  }

  async recordBatchSuccess(
    customerId: string,
    batchKey: string,
    result: import("../../llm/classifier.js").ClassificationResult,
    decidedAt: string,
  ): Promise<void> {
    const runId = this.requiredRunId();
    const handle = this.requiredAccount(customerId);
    const batchId = requiredMapValue(handle.batches, batchKey, "batch");
    await this.transaction(async (client) => {
      await this.insertAttempts(client, runId, handle, batchId, result.attempts);
      for (const decision of result.validated.decisions) {
        const candidate = await queryOne<IdRow>(client, `
          SELECT id::text AS id
          FROM negative_keyword_candidates
          WHERE organization_id = $1 AND sweep_account_run_id = $2 AND item_id = $3
        `, [this.organizationId, handle.id, decision.itemId], "Validated decision references an unknown candidate");
        await client.query(`
          INSERT INTO negative_keyword_decisions (
            organization_id, sweep_run_id, sweep_account_run_id, account_id,
            candidate_id, decision, negative_text, reason, confidence, rule_ids,
            classifier_contract_version, decided_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'classification-output-v2', $11)
          ON CONFLICT (candidate_id) DO NOTHING
        `, [
          this.organizationId,
          runId,
          handle.id,
          handle.accountId,
          candidate.id,
          decision.decision.toLowerCase(),
          decision.negativeText,
          decision.reason,
          String(decision.confidence),
          decision.ruleIds,
          decidedAt,
        ]);
        const verified = await client.query(`
          SELECT 1 FROM negative_keyword_decisions
          WHERE candidate_id = $1 AND decision = $2 AND negative_text IS NOT DISTINCT FROM $3
            AND reason = $4 AND confidence = $5 AND rule_ids = $6
        `, [
          candidate.id,
          decision.decision.toLowerCase(),
          decision.negativeText,
          decision.reason,
          String(decision.confidence),
          decision.ruleIds,
        ]);
        if (verified.rowCount !== 1) throw new Error("Decision identity conflicted with different content.");
      }
      const request = boundedRedactedJson(result.request, this.maxPayloadBytes);
      const response = boundedRedactedJson(result.response, this.maxPayloadBytes);
      await client.query(`
        UPDATE negative_keyword_llm_batches
        SET status = 'succeeded', provider_request_id = $3,
            generation_request_count = $4, completed_at = $5,
            provider_request_payload = $6::jsonb, response_payload = $7::jsonb,
            payload_truncated = payload_truncated OR $8 OR $9,
            payload_sha256 = $10,
            input_tokens = $11, output_tokens = $12, total_tokens = $13,
            cached_input_tokens = $14, thought_tokens = $15
        WHERE organization_id = $1 AND id = $2
      `, [
        this.organizationId,
        batchId,
        result.validated.providerRequestId,
        result.attempts.length,
        decidedAt,
        JSON.stringify(request.value),
        JSON.stringify(response.value),
        request.truncated,
        response.truncated,
        response.sha256,
        result.validated.usage.inputTokens,
        result.validated.usage.outputTokens,
        result.validated.usage.totalTokens,
        result.validated.usage.cachedInputTokens,
        result.validated.usage.thoughtTokens,
      ]);
    });
  }

  async recordBatchFailure(
    customerId: string,
    batchKey: string,
    requestValue: Record<string, unknown> | null,
    attempts: import("../../llm/classifier.js").LlmGenerationAttempt[],
    lastResponse: unknown,
    error: import("../../observability/errors.js").SerializedError,
    completedAt: string,
  ): Promise<void> {
    const runId = this.requiredRunId();
    const handle = this.requiredAccount(customerId);
    const batchId = requiredMapValue(handle.batches, batchKey, "batch");
    await this.transaction(async (client) => {
      await this.insertAttempts(client, runId, handle, batchId, attempts);
      const request = boundedRedactedJson(requestValue, this.maxPayloadBytes);
      const response = boundedRedactedJson(lastResponse, this.maxPayloadBytes);
      const usage = attempts.reduce((total, attempt) => ({
        inputTokens: total.inputTokens + attempt.usage.inputTokens,
        outputTokens: total.outputTokens + attempt.usage.outputTokens,
        totalTokens: total.totalTokens + attempt.usage.totalTokens,
        cachedInputTokens: total.cachedInputTokens + attempt.usage.cachedInputTokens,
        thoughtTokens: total.thoughtTokens + attempt.usage.thoughtTokens,
      }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, thoughtTokens: 0 });
      await client.query(`
        UPDATE negative_keyword_llm_batches
        SET status = 'failed', generation_request_count = $3, completed_at = $4,
            provider_request_payload = $5::jsonb, response_payload = $6::jsonb,
            payload_truncated = payload_truncated OR $7 OR $8,
            payload_sha256 = $9, input_tokens = $10, output_tokens = $11,
            total_tokens = $12, cached_input_tokens = $13, thought_tokens = $14,
            failure_code = $15, failure_message = $16
        WHERE organization_id = $1 AND id = $2
      `, [
        this.organizationId,
        batchId,
        attempts.length,
        completedAt,
        JSON.stringify(request.value),
        JSON.stringify(response.value),
        request.truncated,
        response.truncated,
        response.sha256,
        usage.inputTokens,
        usage.outputTokens,
        usage.totalTokens,
        usage.cachedInputTokens,
        usage.thoughtTokens,
        error.code ?? error.name,
        safeDatabaseMessage(error.message),
      ]);
    });
  }

  async finishAccount(summary: SweepAccountSummaryRecord): Promise<void> {
    const handle = this.requiredAccount(summary.customerId);
    await this.transaction(async (client) => {
      await client.query(`
        UPDATE negative_keyword_sweep_account_runs
        SET status = $3, completed_at = $4, raw_row_count = $5,
            processed_candidate_count = $6, decision_count = $7,
            keep_count = $8, negative_exact_count = $9,
            failed_batch_count = $10, error_count = $11,
            input_tokens = $12, output_tokens = $13, total_tokens = $14,
            cached_input_tokens = $15, thought_tokens = $16,
            generation_requests = $17, fixed_input_tokens = $18,
            fixed_input_definition = $19, terminal_error_code = $20,
            terminal_error_message = $21, updated_at = now()
        WHERE organization_id = $1 AND id = $2
      `, [
        this.organizationId,
        handle.id,
        summary.status.toLowerCase(),
        summary.completedAt,
        summary.rawRowCount,
        summary.candidateCount,
        summary.decisionCount,
        summary.keepCount,
        summary.negativeExactCount,
        summary.failedBatchCount,
        summary.errorCount,
        summary.tokenUsage.inputTokens,
        summary.tokenUsage.outputTokens,
        summary.tokenUsage.totalTokens,
        summary.tokenUsage.cachedInputTokens,
        summary.tokenUsage.thoughtTokens,
        summary.tokenUsage.generationRequests,
        summary.tokenUsage.fixedInputTokens,
        summary.tokenUsage.fixedInputDefinition,
        summary.error ? "ORGANIZATION_PIPELINE_FAILED" : null,
        summary.error ? safeDatabaseMessage(summary.error) : null,
      ]);
    });
  }

  async finishRun(input: SweepRunFinish): Promise<void> {
    const runId = this.requiredRunId();
    await this.transaction(async (client) => {
      await this.insertTelemetry(client, runId, input.events, input.errors);
      const succeeded = input.accountSummaries.filter((item) => item.status === "SUCCEEDED").length;
      const partial = input.accountSummaries.filter((item) => item.status === "PARTIAL").length;
      const failed = input.accountSummaries.filter((item) => item.status === "FAILED").length;
      const keepCount = input.accountSummaries.reduce((sum, item) => sum + item.keepCount, 0);
      const negativeCount = input.accountSummaries.reduce((sum, item) => sum + item.negativeExactCount, 0);
      await client.query(`
        UPDATE negative_keyword_sweep_runs
        SET status = $3, completed_at = $4,
            organizations_discovered = $5, organizations_selected = $6,
            organizations_succeeded = $7, organizations_partial = $8,
            organizations_failed = $9, raw_row_count = $10,
            candidate_count = $11, decision_count = $12, keep_count = $13,
            negative_exact_count = $14, input_tokens = $15, output_tokens = $16,
            total_tokens = $17, cached_input_tokens = $18, thought_tokens = $19,
            generation_requests = $20, successful_batches = $21,
            failed_batches = $22, fixed_input_tokens = $23,
            organizations_token_counted = $24, token_usage_reconciled = $25,
            error_count = $26, fatal_error_code = $27, fatal_error_message = $28,
            organizations_eligible = $29,
            updated_at = now()
        WHERE organization_id = $1 AND id = $2
      `, [
        this.organizationId,
        runId,
        input.status.toLowerCase(),
        input.completedAt,
        input.organizationsDiscovered,
        input.organizationsSelected,
        succeeded,
        partial,
        failed,
        input.accountSummaries.reduce((sum, item) => sum + item.rawRowCount, 0),
        input.accountSummaries.reduce((sum, item) => sum + item.candidateCount, 0),
        keepCount + negativeCount,
        keepCount,
        negativeCount,
        input.tokenUsage.inputTokens,
        input.tokenUsage.outputTokens,
        input.tokenUsage.totalTokens,
        input.tokenUsage.cachedInputTokens,
        input.tokenUsage.thoughtTokens,
        input.tokenUsage.generationRequests,
        input.tokenUsage.successfulBatches,
        input.tokenUsage.failedBatches,
        input.tokenUsage.fixedInputTokens,
        input.tokenUsage.organizationsCounted,
        input.tokenUsageReconciled,
        input.errors.length,
        input.fatalError ? "RUN_PIPELINE_FAILED" : null,
        input.fatalError ? safeDatabaseMessage(input.fatalError) : null,
        input.organizationsEligible,
      ]);

      await client.query(`
        INSERT INTO negative_keyword_report_deliveries (
          organization_id, sweep_run_id, status, provider, message_id,
          attempt_count, sent_at, error_code, error_message
        ) VALUES ($1, $2, $3, 'resend', $4, $5, $6, $7, $8)
        ON CONFLICT (sweep_run_id) DO UPDATE SET
          status = EXCLUDED.status, message_id = EXCLUDED.message_id,
          attempt_count = EXCLUDED.attempt_count, sent_at = EXCLUDED.sent_at,
          error_code = EXCLUDED.error_code, error_message = EXCLUDED.error_message,
          updated_at = now()
      `, [
        this.organizationId,
        runId,
        input.reportDelivery.status.toLowerCase(),
        input.reportDelivery.messageId,
        input.reportDelivery.attemptCount,
        input.reportDelivery.sentAt,
        input.reportDelivery.errorCode ?? null,
        input.reportDelivery.errorMessage ? safeDatabaseMessage(input.reportDelivery.errorMessage) : null,
      ]);
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async insertFact(
    client: PoolClient,
    runId: string,
    handle: AccountHandle,
    row: SearchTermRow,
    fetchedAt: string,
  ): Promise<void> {
    const payload = boundedRedactedJson(row, this.maxPayloadBytes);
    const sourceHash = sha256(stableStringify(row));
    await client.query(`
      INSERT INTO negative_keyword_search_term_facts (
        organization_id, sweep_run_id, sweep_account_run_id, account_id,
        source_row_hash, metric_date, channel, campaign_id, campaign_name,
        ad_group_id, ad_group_name, search_term, targeting_status,
        matched_keyword_text, matched_keyword_match_type, impressions, clicks,
        cost_micros, conversions, conversion_value, fetched_at, source_payload
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb
      )
      ON CONFLICT (sweep_account_run_id, source_row_hash) DO NOTHING
    `, [
      this.organizationId,
      runId,
      handle.id,
      handle.accountId,
      sourceHash,
      row.date,
      row.channel.toLowerCase(),
      row.campaignId,
      row.campaignName,
      row.adGroupId,
      row.adGroupName,
      row.searchTerm,
      row.targetingStatus,
      row.matchedKeyword,
      row.matchedKeywordMatchType,
      exactInteger(row, "impressions"),
      exactInteger(row, "clicks"),
      exactInteger(row, "costMicros"),
      exactDecimal(row, "conversions"),
      exactDecimal(row, "conversionValue"),
      fetchedAt,
      JSON.stringify(payload.value),
    ]);
    const verified = await client.query(`
      SELECT 1 FROM negative_keyword_search_term_facts
      WHERE sweep_account_run_id = $1 AND source_row_hash = $2 AND source_payload = $3::jsonb
    `, [handle.id, sourceHash, JSON.stringify(payload.value)]);
    if (verified.rowCount !== 1) throw new Error("Search-term fact identity conflicted with different content.");
  }

  private async insertCandidate(
    client: PoolClient,
    runId: string,
    handle: AccountHandle,
    batchId: string,
    candidate: ClassificationCandidate,
    ordinal: number,
  ): Promise<void> {
    const input = boundedRedactedJson(candidate, this.maxPayloadBytes);
    await client.query(`
      INSERT INTO negative_keyword_candidates (
        organization_id, sweep_run_id, sweep_account_run_id, account_id,
        batch_id, item_id, candidate_ordinal, start_date, end_date, channel,
        campaign_id, campaign_name, ad_group_id, ad_group_name, search_term,
        targeting_status, matched_keyword_text, matched_keyword_match_type,
        impressions, clicks, cost_micros, conversions, conversion_value,
        classifier_input
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24::jsonb
      )
      ON CONFLICT (sweep_account_run_id, item_id) DO NOTHING
    `, [
      this.organizationId,
      runId,
      handle.id,
      handle.accountId,
      batchId,
      candidate.itemId,
      ordinal,
      candidate.startDate,
      candidate.endDate,
      candidate.channel.toLowerCase(),
      candidate.campaignId,
      candidate.campaignName,
      candidate.adGroupId,
      candidate.adGroupName,
      candidate.searchTerm,
      candidate.targetingStatus,
      candidate.matchedKeyword,
      candidate.matchedKeywordMatchType,
      exactInteger(candidate, "impressions"),
      exactInteger(candidate, "clicks"),
      exactInteger(candidate, "costMicros"),
      exactDecimal(candidate, "conversions"),
      exactDecimal(candidate, "conversionValue"),
      JSON.stringify(input.value),
    ]);
    const verified = await client.query(`
      SELECT 1 FROM negative_keyword_candidates
      WHERE sweep_account_run_id = $1 AND item_id = $2 AND classifier_input = $3::jsonb
    `, [handle.id, candidate.itemId, JSON.stringify(input.value)]);
    if (verified.rowCount !== 1) throw new Error("Candidate identity conflicted with different content.");
  }

  private async insertAttempts(
    client: PoolClient,
    runId: string,
    handle: AccountHandle,
    batchId: string,
    attempts: import("../../llm/classifier.js").LlmGenerationAttempt[],
  ): Promise<void> {
    for (const attempt of attempts) {
      const response = boundedRedactedJson(attempt.rawResponse, this.maxPayloadBytes);
      const firstHttp = attempt.httpAttempts[0];
      const lastHttp = attempt.httpAttempts.at(-1);
      await client.query(`
        INSERT INTO negative_keyword_llm_attempts (
          organization_id, sweep_run_id, sweep_account_run_id, account_id,
          batch_id, attempt_number, outcome, provider_request_id,
          input_tokens, output_tokens, total_tokens, cached_input_tokens,
          thought_tokens, validation_error, raw_response, http_attempts,
          started_at, completed_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15::jsonb, $16::jsonb, $17, $18
        )
        ON CONFLICT (batch_id, attempt_number) DO NOTHING
      `, [
        this.organizationId,
        runId,
        handle.id,
        handle.accountId,
        batchId,
        attempt.attempt,
        attempt.outcome.toLowerCase(),
        attempt.providerRequestId,
        attempt.usage.inputTokens,
        attempt.usage.outputTokens,
        attempt.usage.totalTokens,
        attempt.usage.cachedInputTokens,
        attempt.usage.thoughtTokens,
        attempt.validationError ? safeDatabaseMessage(attempt.validationError) : null,
        JSON.stringify(response.value),
        JSON.stringify(boundedRedactedJson(attempt.httpAttempts, this.maxPayloadBytes).value),
        firstHttp?.startedAt ?? null,
        lastHttp?.completedAt ?? null,
      ]);
    }
  }

  private async insertTelemetry(
    client: PoolClient,
    runId: string,
    events: SweepRunFinish["events"],
    errors: SweepRunFinish["errors"],
  ): Promise<void> {
    for (const [index, event] of events.entries()) {
      const handle = event.organizationId ? this.accounts.get(event.organizationId) : undefined;
      const batchId = handle && event.batchId ? handle.batches.get(event.batchId) : undefined;
      const details = boundedRedactedJson(event.details ?? {}, this.maxPayloadBytes);
      const eventKey = sha256(stableStringify({ index, event }));
      await client.query(`
        INSERT INTO negative_keyword_run_events (
          organization_id, sweep_run_id, sweep_account_run_id, account_id,
          batch_id, event_key, stage, status, started_at, completed_at,
          duration_ms, provider, provider_request_id, attempt, status_code, details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
        ON CONFLICT (sweep_run_id, event_key) DO NOTHING
      `, [
        this.organizationId,
        runId,
        handle?.id ?? null,
        handle?.accountId ?? null,
        batchId ?? null,
        eventKey,
        event.stage,
        event.status.toLowerCase(),
        event.startedAt,
        event.completedAt,
        event.durationMs,
        event.provider ?? null,
        event.requestId ?? null,
        event.attempt ?? null,
        event.statusCode ?? null,
        JSON.stringify(details.value),
      ]);
    }
    for (const [index, error] of errors.entries()) {
      const handle = error.organizationId ? this.accounts.get(error.organizationId) : undefined;
      const batchId = handle && error.batchId ? handle.batches.get(error.batchId) : undefined;
      const details = boundedRedactedJson(error.details ?? {}, this.maxPayloadBytes);
      const cause = boundedRedactedJson(safeCause(error.cause), this.maxPayloadBytes);
      const errorKey = sha256(stableStringify({ index, error: { ...error, stack: undefined } }));
      await client.query(`
        INSERT INTO negative_keyword_run_errors (
          organization_id, sweep_run_id, sweep_account_run_id, account_id,
          batch_id, error_key, stage, code, retryable, provider, status_code,
          provider_request_id, occurred_at, error_name, message, cause_metadata, details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb)
        ON CONFLICT (sweep_run_id, error_key) DO NOTHING
      `, [
        this.organizationId,
        runId,
        handle?.id ?? null,
        handle?.accountId ?? null,
        batchId ?? null,
        errorKey,
        error.stage,
        error.code ?? null,
        error.retryable ?? null,
        error.provider ?? null,
        error.statusCode ?? null,
        error.requestId ?? null,
        error.occurredAt,
        error.name,
        safeDatabaseMessage(error.message),
        JSON.stringify(cause.value),
        JSON.stringify(details.value),
      ]);
    }
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.organization_id', $1, true)", [this.organizationId]);
      await client.query("SELECT set_config('app.actor_id', '', true)");
      await client.query("SET LOCAL statement_timeout = '30s'");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private requiredRunId(): string {
    if (this.runId === null) throw new Error("Sweep persistence run has not been started.");
    return this.runId;
  }

  private requiredAccount(customerId: string): AccountHandle {
    const handle = this.accounts.get(customerId);
    if (handle === undefined) throw new Error("Sweep account persistence has not been prepared.");
    return handle;
  }
}

async function queryOne<Row extends QueryResultRow>(
  client: PoolClient,
  query: string,
  values: readonly unknown[],
  message: string,
): Promise<Row> {
  const result = await client.query<Row>(query, [...values]);
  const row = result.rows[0];
  if (row === undefined) throw new Error(message);
  return row;
}

function requiredMapValue(map: Map<string, string>, key: string, label: string): string {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Unknown persisted ${label} '${key}'.`);
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactInteger(row: SearchTermRow | ClassificationCandidate, field: "impressions" | "clicks" | "costMicros"): string {
  const exact = row[`${field}Exact`];
  if (exact !== undefined) return exact;
  return String(Math.max(0, Math.trunc(row[field])));
}

function exactDecimal(row: SearchTermRow | ClassificationCandidate, field: "conversions" | "conversionValue"): string {
  const exact = row[`${field}Exact`];
  if (exact !== undefined) return exact;
  return String(Math.max(0, row[field]));
}

function safeCause(error: import("../../observability/errors.js").SerializedError | undefined): Record<string, unknown> | null {
  if (error === undefined) return null;
  return {
    name: error.name,
    stage: error.stage,
    code: error.code ?? null,
    retryable: error.retryable ?? null,
    provider: error.provider ?? null,
    statusCode: error.statusCode ?? null,
    requestId: error.requestId ?? null,
    message: safeDatabaseMessage(error.message),
    cause: safeCause(error.cause),
  };
}
