import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";
import { PostgresSweepPersistence } from "../src/storage/postgres/postgres-sweep-persistence.js";

const ownerDatabaseUrl = process.env.SWEEPER_TEST_DATABASE_URL;
const enabled = process.env.SWEEPER_DB_TEST_DATABASE === "1" && ownerDatabaseUrl !== undefined;

test("persists a complete sweep with tenant isolation and exact metrics", { skip: !enabled }, async () => {
  const ownerUrl = new URL(ownerDatabaseUrl!);
  assert.match(ownerUrl.pathname, /_test$/u, "integration database name must end in _test");
  const suffix = `${process.pid}_${Date.now()}`;
  const groupRole = `sweeper_test_group_${suffix}`;
  const loginRole = `sweeper_test_login_${suffix}`;
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const customerId = "1234567890";
  const password = randomUUID();
  const owner = new Client({ connectionString: ownerUrl.toString() });
  await owner.connect();
  let persistence: PostgresSweepPersistence | null = null;
  try {
    await owner.query(`CREATE ROLE ${groupRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await owner.query(`CREATE ROLE ${loginRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
    await owner.query(`GRANT ${groupRole} TO ${loginRole}`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${groupRole}`);
    await owner.query(`GRANT SELECT ON TABLE organizations, advertising_data_connections, client_accounts TO ${groupRole}`);
    await owner.query(`GRANT SELECT, INSERT ON TABLE
      negative_keyword_rule_snapshots, negative_keyword_search_term_facts,
      negative_keyword_candidates, negative_keyword_decisions,
      negative_keyword_llm_attempts, negative_keyword_run_events,
      negative_keyword_run_errors TO ${groupRole}`);
    await owner.query(`GRANT SELECT, INSERT ON TABLE
      negative_keyword_sweep_runs, negative_keyword_sweep_account_runs,
      negative_keyword_llm_batches, negative_keyword_report_deliveries TO ${groupRole}`);
    await owner.query(`GRANT UPDATE (status, completed_at, organizations_discovered, organizations_eligible,
      organizations_selected, organizations_succeeded, organizations_partial, organizations_failed,
      raw_row_count, candidate_count, decision_count, keep_count, negative_exact_count, input_tokens,
      output_tokens, total_tokens, cached_input_tokens, thought_tokens, generation_requests,
      successful_batches, failed_batches, fixed_input_tokens, organizations_token_counted,
      token_usage_reconciled, error_count, fatal_error_code, fatal_error_message, updated_at)
      ON negative_keyword_sweep_runs TO ${groupRole}`);
    await owner.query(`GRANT UPDATE (status, completed_at, raw_row_count, processed_candidate_count,
      decision_count, keep_count, negative_exact_count, failed_batch_count, error_count, input_tokens,
      output_tokens, total_tokens, cached_input_tokens, thought_tokens, generation_requests,
      fixed_input_tokens, fixed_input_definition, terminal_error_code, terminal_error_message, updated_at)
      ON negative_keyword_sweep_account_runs TO ${groupRole}`);
    await owner.query(`GRANT UPDATE (status, started_at, completed_at, provider_request_id,
      generation_request_count, provider_request_payload, response_payload, payload_truncated,
      payload_sha256, input_tokens, output_tokens, total_tokens, cached_input_tokens, thought_tokens,
      failure_code, failure_message, updated_at) ON negative_keyword_llm_batches TO ${groupRole}`);
    await owner.query(`GRANT UPDATE (status, message_id, attempt_count, sent_at, error_code,
      error_message, updated_at) ON negative_keyword_report_deliveries TO ${groupRole}`);
    await owner.query("INSERT INTO organizations (id) VALUES ($1)", [organizationId]);
    await owner.query("INSERT INTO organizations (id) VALUES ($1)", [otherOrganizationId]);
    await owner.query(`
      INSERT INTO client_accounts (
        organization_id, google_customer_id, google_account_name,
        business_display_name, client_name, account_time_zone,
        currency_code, onboarding_status
      ) VALUES ($1, $2, 'Test Ads', 'Test Business', 'Test Client', 'UTC', 'USD', 'active')
    `, [organizationId, customerId]);
    await owner.query(`
      INSERT INTO client_accounts (
        organization_id, google_customer_id, google_account_name,
        business_display_name, client_name, account_time_zone,
        currency_code, onboarding_status
      ) VALUES ($1, '9999999999', 'Other Ads', 'Other Business', 'Other Client', 'UTC', 'USD', 'active')
    `, [otherOrganizationId]);

    const runtimeUrl = new URL(ownerUrl.toString());
    runtimeUrl.username = loginRole;
    runtimeUrl.password = password;
    persistence = new PostgresSweepPersistence({
      enabled: true,
      databaseUrl: runtimeUrl.toString(),
      organizationId,
      executionKey: "integration-execution-1",
      poolMax: 2,
      maxPayloadBytes: 262_144,
    });
    const now = new Date().toISOString();
    const rules = {
      version: "integration-v1",
      promptVersion: "prompt-v1",
      sourcePath: "test-rules.md",
      markdown: "### `TEST-RULE`",
      ruleIds: ["TEST-RULE"],
    };
    await persistence.startRun({
      runId: "integration-run-1",
      executionKey: "integration-execution-1",
      startedAt: now,
      requestedDate: "2026-09-07",
      requestedDateSource: "COMMAND_LINE",
      processingTimeZone: "UTC",
      rules,
      provider: "test-provider",
      model: "test-model",
      campaignNameContains: "Built by Shah",
      accountSelectionMode: "customer",
      accountAllowlistEntryCount: 0,
      googleFetchConcurrency: 1,
      llmConcurrency: 1,
      llmBatchSize: 50,
      candidateLimitPerAccount: null,
    });
    await persistence.recordDiscovery(1, 1, 1);
    const row = {
      customerId,
      date: "2026-09-07",
      channel: "SEARCH" as const,
      campaignId: "456",
      campaignName: "Built by Shah Campaign",
      adGroupId: "789",
      adGroupName: "Group",
      searchTerm: "unwanted exact term",
      targetingStatus: "NONE",
      matchedKeyword: "broad term",
      matchedKeywordMatchType: "BROAD",
      impressions: Number("9007199254740993"),
      clicks: 1,
      costMicros: Number("9007199254740995"),
      conversions: 0.25,
      conversionValue: 4.75,
      impressionsExact: "9007199254740993",
      clicksExact: "1",
      costMicrosExact: "9007199254740995",
      conversionsExact: "0.25",
      conversionValueExact: "4.75",
    };
    const candidate = {
      ...row,
      itemId: "0123456789abcdef01234567",
      startDate: row.date,
      endDate: row.date,
    };
    const { date: _date, ...candidateWithoutDate } = candidate;
    await persistence.prepareAccount({
      organization: { customerId, descriptiveName: "Test Ads", timeZone: "UTC", currencyCode: "USD" },
      dateRange: { startDate: row.date, endDate: row.date },
      startedAt: now,
      fetchedAt: now,
      rows: [row],
      scopedRowCount: 1,
      availableCandidateCount: 1,
      candidates: [candidateWithoutDate],
      batchSize: 50,
      rules,
      provider: "test-provider",
      model: "test-model",
      fixedInput: {
        totalTokens: 10, countedAt: now, definition: "fixed test input", model: "test-model",
        providerRequestId: "count-request", attemptCount: 1, retryCount: 0,
      },
    });
    await persistence.markBatchRunning(customerId, "0001", now);
    await persistence.recordBatchSuccess(customerId, "0001", {
      validated: {
        decisions: [{
          itemId: "0123456789abcdef01234567", decision: "NEGATIVE_EXACT", negativeText: "unwanted exact term",
          ruleIds: ["TEST-RULE"], reason: "Does not match the service", confidence: 0.99,
        }],
        model: "test-model",
        providerRequestId: "request-1",
        usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25, cachedInputTokens: 0, thoughtTokens: 0 },
      },
      request: { authorization: "Bearer should-not-persist", prompt: "safe" },
      response: { apiKey: "should-not-persist", decisions: 1 },
      attempts: [{
        attempt: 1, outcome: "VALIDATED", providerRequestId: "request-1",
        usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25, cachedInputTokens: 0, thoughtTokens: 0 },
        validationError: null, httpAttempts: [], rawResponse: { refreshToken: "secret", ok: true },
      }],
    }, now);
    const accountSummary = {
      customerId, status: "PARTIAL" as const, completedAt: now, rawRowCount: 1,
      candidateCount: 1, decisionCount: 1, failedBatchCount: 0, keepCount: 0,
      negativeExactCount: 1, errorCount: 1, error: "Non-fatal test warning",
      tokenUsage: {
        inputTokens: 20, outputTokens: 5, totalTokens: 25, cachedInputTokens: 0,
        thoughtTokens: 0, generationRequests: 1, fixedInputTokens: 10,
        fixedInputDefinition: "fixed test input",
      },
    };
    await persistence.finishAccount(accountSummary);
    await persistence.finishRun({
      status: "PARTIAL",
      completedAt: now,
      organizationsDiscovered: 1,
      organizationsEligible: 1,
      organizationsSelected: 1,
      accountSummaries: [accountSummary],
      tokenUsage: {
        inputTokens: 20, outputTokens: 5, totalTokens: 25, cachedInputTokens: 0,
        thoughtTokens: 0, generationRequests: 1, successfulBatches: 1,
        failedBatches: 0, fixedInputTokens: 10, organizationsCounted: 1,
      },
      tokenUsageReconciled: true,
      events: [{
        stage: "LLM_CLASSIFICATION", status: "SUCCEEDED", startedAt: now,
        completedAt: now, durationMs: 1, organizationId: customerId, batchId: "0001",
      }],
      errors: [{
        name: "PipelineError", message: "Non-fatal test warning", occurredAt: now,
        stage: "LLM_FIXED_TOKEN_COUNT", code: "TEST_WARNING", retryable: false,
        organizationId: customerId, details: { authorization: "must-redact" },
      }],
      fatalError: null,
      reportDelivery: { status: "DISABLED", messageId: null, attemptCount: 0, sentAt: null },
    });
    await persistence.close();
    persistence = null;

    const counts = await owner.query<{ table_name: string; row_count: string }>(`
      SELECT table_name, row_count FROM (
        SELECT 'negative_keyword_rule_snapshots' AS table_name, count(*)::text AS row_count FROM negative_keyword_rule_snapshots WHERE organization_id = $1
        UNION ALL SELECT 'negative_keyword_sweep_runs', count(*)::text FROM negative_keyword_sweep_runs WHERE organization_id = $1
        UNION ALL SELECT 'negative_keyword_sweep_account_runs', count(*)::text FROM negative_keyword_sweep_account_runs WHERE organization_id = $1
        UNION ALL SELECT 'negative_keyword_search_term_facts', count(*)::text FROM negative_keyword_search_term_facts WHERE organization_id = $1
        UNION ALL SELECT 'negative_keyword_candidates', count(*)::text FROM negative_keyword_candidates WHERE organization_id = $1
        UNION ALL SELECT 'negative_keyword_decisions', count(*)::text FROM negative_keyword_decisions WHERE organization_id = $1
        UNION ALL SELECT 'negative_keyword_llm_batches', count(*)::text FROM negative_keyword_llm_batches WHERE organization_id = $1
        UNION ALL SELECT 'negative_keyword_llm_attempts', count(*)::text FROM negative_keyword_llm_attempts WHERE organization_id = $1
        UNION ALL SELECT 'negative_keyword_run_events', count(*)::text FROM negative_keyword_run_events WHERE organization_id = $1
        UNION ALL SELECT 'negative_keyword_run_errors', count(*)::text FROM negative_keyword_run_errors WHERE organization_id = $1
        UNION ALL SELECT 'negative_keyword_report_deliveries', count(*)::text FROM negative_keyword_report_deliveries WHERE organization_id = $1
      ) persisted
    `, [organizationId]);
    assert.ok(counts.rows.every((item) => item.row_count === "1"), JSON.stringify(counts.rows));
    const stored = await owner.query<{
      impressions: string;
      cost_micros: string;
      provider_request_payload: Record<string, unknown>;
      response_payload: Record<string, unknown>;
    }>(`
      SELECT f.impressions::text, f.cost_micros::text,
             b.provider_request_payload, b.response_payload
      FROM negative_keyword_search_term_facts f
      JOIN negative_keyword_llm_batches b ON b.sweep_run_id = f.sweep_run_id
      WHERE f.organization_id = $1
    `, [organizationId]);
    assert.equal(stored.rows[0]?.impressions, "9007199254740993");
    assert.equal(stored.rows[0]?.cost_micros, "9007199254740995");
    assert.equal(stored.rows[0]?.provider_request_payload.authorization, "[REDACTED]");
    assert.equal(stored.rows[0]?.response_payload.apiKey, "[REDACTED]");

    const runtime = new Client({ connectionString: runtimeUrl.toString() });
    await runtime.connect();
    await runtime.query("SELECT set_config('app.organization_id', $1, false)", [organizationId]);
    const hiddenOtherTenant = await runtime.query(
      "SELECT id FROM client_accounts WHERE organization_id = $1",
      [otherOrganizationId],
    );
    assert.equal(hiddenOtherTenant.rowCount, 0);
    await assert.rejects(
      () => runtime.query(
        "UPDATE negative_keyword_sweep_runs SET run_key = 'forged' WHERE organization_id = $1",
        [organizationId],
      ),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "42501",
    );
    await assert.rejects(
      () => runtime.query("DELETE FROM negative_keyword_decisions WHERE organization_id = $1", [organizationId]),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "42501",
    );
    await runtime.end();
    await assert.rejects(
      () => owner.query("UPDATE negative_keyword_decisions SET reason = 'changed' WHERE organization_id = $1", [organizationId]),
      /immutable/u,
    );
  } finally {
    await persistence?.close().catch(() => undefined);
    await owner.query("DELETE FROM organizations WHERE id = $1", [organizationId]).catch(() => undefined);
    await owner.query("DELETE FROM organizations WHERE id = $1", [otherOrganizationId]).catch(() => undefined);
    await owner.query(`DROP OWNED BY ${loginRole}`).catch(() => undefined);
    await owner.query(`DROP ROLE IF EXISTS ${loginRole}`).catch(() => undefined);
    await owner.query(`DROP OWNED BY ${groupRole}`).catch(() => undefined);
    await owner.query(`DROP ROLE IF EXISTS ${groupRole}`).catch(() => undefined);
    await owner.end();
  }
});
