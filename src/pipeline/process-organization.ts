import type { DateRange, FixedInputTokenCount, LlmTokenUsage, Organization, RuleSet, SearchTermRow } from "../types.js";
import type { GoogleAdsClient } from "../google-ads/client.js";
import {
  applyNegativeExactDecisions,
  disabledMutationSummary,
  skippedMutationSummary,
  type NegativeKeywordMutationSummary,
  type NegativeKeywordWriter
} from "../google-ads/negative-keyword-writer.js";
import { aggregateCandidates, fetchSearchTermsForDateRange } from "../google-ads/search-terms.js";
import { ClassificationFailure, type KeywordClassifier, type LlmGenerationAttempt } from "../llm/classifier.js";
import { PipelineError, serializeError } from "../observability/errors.js";
import { addTokenUsage, emptyTokenUsage, type RunTelemetry } from "../observability/run-telemetry.js";
import type { RunArtifacts } from "../storage/run-artifacts.js";
import type { SweepPersistence } from "../storage/persistence.js";
import { createDecisionCsv } from "../storage/decision-csv.js";
import { chunksOf, type Limit } from "../util/concurrency.js";

export interface OrganizationTokenUsage extends LlmTokenUsage {
  generationRequests: number;
  fixedInputTokens: number | null;
  fixedInputDefinition: string | null;
}

export interface BatchTokenUsage extends LlmTokenUsage {
  batchId: string;
  status: "VALIDATED" | "FAILED";
  candidateCount: number;
  generationRequests: number;
}

export interface OrganizationSummary {
  customerId: string;
  descriptiveName: string;
  dateRange: DateRange;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  rawRowCount: number;
  candidateCount: number;
  decisionCount: number;
  failedBatchCount: number;
  decisions: Record<string, number>;
  tokenUsage: OrganizationTokenUsage;
  batchTokenUsage: BatchTokenUsage[];
  mutation: NegativeKeywordMutationSummary;
  errorCount: number;
  error?: string;
}

export interface ProgressLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

interface ProcessOrganizationDependencies {
  googleAds: GoogleAdsClient;
  classifier: KeywordClassifier;
  artifacts: RunArtifacts;
  telemetry: RunTelemetry;
  rules: RuleSet;
  batchSize: number;
  candidateLimit?: number | null;
  campaignNameContains?: string | null;
  llmLimit: Limit;
  logger?: ProgressLogger;
  /** Test seam; production emits a heartbeat once per minute for active LLM batches. */
  batchHeartbeatMs?: number;
  persistence?: SweepPersistence;
  negativeKeywordWriter?: NegativeKeywordWriter;
  mutationChunkSize?: number;
}

const DEFAULT_BATCH_HEARTBEAT_MS = 60_000;

export async function processOrganization(
  organization: Organization,
  requestedDate: string | null,
  dependencies: ProcessOrganizationDependencies
): Promise<OrganizationSummary> {
  const organizationStarted = performance.now();
  const organizationStartedAt = new Date().toISOString();
  const dateRange = requestedDate
    ? singleDateRange(requestedDate)
    : date48HoursBackInTimeZone(organization.timeZone);
  const basePath = `organizations/${organization.customerId}`;
  const errorContext = { organizationId: organization.customerId };
  let rawRowCount = 0;
  let candidateCount = 0;
  let failedBatchCount = 0;
  let organizationUsage = emptyOrganizationUsage();
  const batchTokenUsage: BatchTokenUsage[] = [];
  let fixedInput: FixedInputTokenCount | null = null;
  let fixedInputFailed = false;
  let persistencePrepared = false;
  let mutation = dependencies.negativeKeywordWriter
    ? skippedMutationSummary(dependencies.negativeKeywordWriter, "Classification has not completed successfully.")
    : disabledMutationSummary();

  dependencies.logger?.info({
    progressEvent: "organization_started",
    startDate: dateRange.startDate,
    endDate: dateRange.endDate
  }, "Organization processing started");

  try {
    const fetchStarted = performance.now();
    dependencies.logger?.info({
      progressEvent: "organization_search_terms_fetch_started",
      startDate: dateRange.startDate,
      endDate: dateRange.endDate
    }, "Fetching organization search terms from Google Ads");
    const rows = await dependencies.telemetry.track("GOOGLE_SEARCH_TERM_FETCH", errorContext, () =>
      fetchSearchTermsForDateRange(dependencies.googleAds, organization.customerId, dateRange)
    );
    rawRowCount = rows.length;
    dependencies.logger?.info({
      progressEvent: "organization_search_terms_fetch_completed",
      rawRowCount,
      durationMs: elapsedMs(fetchStarted)
    }, "Organization search-term fetch completed");
    const fetchedAt = new Date().toISOString();
    await dependencies.artifacts.write(`${basePath}/fetch.json`, {
      organization,
      dateRange,
      fetchedAt,
      rows
    });

    const scopedRows = filterRowsByCampaignName(rows, dependencies.campaignNameContains);
    const availableCandidates = aggregateCandidates(scopedRows);
    const candidates = dependencies.candidateLimit === null || dependencies.candidateLimit === undefined
      ? availableCandidates
      : availableCandidates.slice(0, dependencies.candidateLimit);
    candidateCount = candidates.length;
    dependencies.logger?.info({
      progressEvent: "organization_candidates_prepared",
      rawRowCount: rows.length,
      scopedRowCount: scopedRows.length,
      availableCandidateCount: availableCandidates.length,
      candidateCount,
      candidateLimit: dependencies.candidateLimit ?? null
    }, "Organization candidates prepared");
    await dependencies.artifacts.write(`${basePath}/candidates.json`, {
      organization,
      dateRange,
      candidateSelection: {
        campaignNameContains: dependencies.campaignNameContains ?? null,
        rawRowCount: rows.length,
        scopedRowCount: scopedRows.length,
        availableCount: availableCandidates.length,
        processedCount: candidates.length,
        limitApplied: dependencies.candidateLimit ?? null
      },
      candidates
    });

    try {
      const fixedInputStarted = performance.now();
      dependencies.logger?.info({
        progressEvent: "organization_fixed_input_count_started",
        provider: dependencies.classifier.provider,
        model: dependencies.classifier.model
      }, "Counting fixed LLM input tokens for organization");
      fixedInput = await dependencies.telemetry.track("LLM_FIXED_TOKEN_COUNT", {
        ...errorContext,
        provider: dependencies.classifier.provider
      }, () => dependencies.classifier.countFixedInputTokens({
        account: organizationContext(organization),
        dateRange,
        rules: dependencies.rules
      }));
      organizationUsage.fixedInputTokens = fixedInput.totalTokens;
      organizationUsage.fixedInputDefinition = fixedInput.definition;
      dependencies.telemetry.recordFixedInput(fixedInput.totalTokens);
      dependencies.logger?.info({
        progressEvent: "organization_fixed_input_count_completed",
        fixedInputTokens: fixedInput.totalTokens,
        attemptCount: fixedInput.attemptCount,
        retryCount: fixedInput.retryCount,
        durationMs: elapsedMs(fixedInputStarted)
      }, "Fixed LLM input token count completed");
    } catch (error) {
      fixedInputFailed = true;
      dependencies.logger?.warn({
        progressEvent: "organization_fixed_input_count_failed",
        errorCode: safeErrorCode(error)
      }, "Fixed LLM input token count failed; organization will continue as partial");
    }
    await dependencies.artifacts.write(`${basePath}/fixed-input-tokens.json`, {
      status: fixedInput ? "COUNTED" : "FAILED",
      provider: dependencies.classifier.provider,
      model: dependencies.classifier.model,
      ruleVersion: dependencies.rules.version,
      promptVersion: dependencies.rules.promptVersion,
      fixedInput
    });

    await dependencies.persistence?.prepareAccount({
      organization,
      dateRange,
      startedAt: organizationStartedAt,
      fetchedAt,
      rows,
      scopedRowCount: scopedRows.length,
      availableCandidateCount: availableCandidates.length,
      candidates,
      batchSize: dependencies.batchSize,
      rules: dependencies.rules,
      provider: dependencies.classifier.provider,
      model: dependencies.classifier.model,
      fixedInput
    });
    persistencePrepared = true;

    if (candidates.length === 0) {
      const summary = createSummary(
        organization,
        dateRange,
        rawRowCount,
        0,
        [],
        0,
        organizationUsage,
        batchTokenUsage,
        false,
        dependencies.telemetry.errorsForOrganization(organization.customerId).length
      );
      mutation = await runMutationStage(dependencies, organization, candidates, [], summary);
      summary.mutation = mutation;
      await dependencies.persistence?.finishAccount(summaryRecord(summary));
      await writeOrganizationResults(dependencies, basePath, organization, dateRange, candidates, [], summary);
      logOrganizationCompleted(dependencies.logger, summary, organizationStarted);
      return summary;
    }

    const batches = chunksOf(candidates, dependencies.batchSize);
    let batchesCompleted = 0;
    let batchesFailed = 0;
    let decisionsCompleted = 0;
    dependencies.logger?.info({
      progressEvent: "organization_batches_prepared",
      batchTotal: batches.length,
      candidateCount,
      batchSize: dependencies.batchSize
    }, "Organization LLM batches prepared");
    const settled = await Promise.allSettled(batches.map((batch, index) => {
      const batchId = String(index + 1).padStart(4, "0");
      dependencies.logger?.info({
        progressEvent: "organization_batch_queued",
        batchId,
        batchPosition: index + 1,
        batchTotal: batches.length,
        candidateCount: batch.length,
        provider: dependencies.classifier.provider,
        model: dependencies.classifier.model
      }, "Organization LLM batch queued");
      return dependencies.llmLimit(async () => {
      const batchStarted = performance.now();
      const batchContext = {
        batchId,
        batchPosition: index + 1,
        batchTotal: batches.length,
        candidateCount: batch.length,
        provider: dependencies.classifier.provider,
        model: dependencies.classifier.model
      };
      dependencies.logger?.info({
        progressEvent: "organization_batch_started",
        ...batchContext,
        batchesCompleted,
        batchesRemaining: batches.length - batchesCompleted
      }, "Organization LLM batch started");
      const stopHeartbeat = startBatchHeartbeat(
        dependencies.logger,
        batchContext,
        batchStarted,
        dependencies.batchHeartbeatMs ?? DEFAULT_BATCH_HEARTBEAT_MS
      );
      const context = {
        account: organizationContext(organization),
        dateRange,
        rules: dependencies.rules,
        searchTerms: batch
      };
      try {
        await dependencies.persistence?.markBatchRunning(
          organization.customerId,
          batchId,
          new Date().toISOString()
        );
        await dependencies.artifacts.write(`${basePath}/llm/batch-${batchId}-input.json`, {
          provider: dependencies.classifier.provider,
          model: dependencies.classifier.model,
          ruleVersion: dependencies.rules.version,
          promptVersion: dependencies.rules.promptVersion,
          fixedInputTokens: fixedInput?.totalTokens ?? null,
          ...context
        });
        const result = await dependencies.telemetry.track("LLM_CLASSIFICATION", {
          ...errorContext,
          batchId,
          provider: dependencies.classifier.provider,
          details: { candidateCount: batch.length }
        }, () => dependencies.classifier.classify(context));
        recordAttempts(
          dependencies.telemetry,
          result.attempts,
          organization.customerId,
          batchId,
          dependencies.classifier.provider
        );
        dependencies.telemetry.recordBatch(true);
        organizationUsage = addOrganizationUsage(organizationUsage, result.validated.usage, result.attempts.length);
        batchTokenUsage.push(createBatchTokenUsage(
          batchId,
          "VALIDATED",
          batch.length,
          result.attempts.length,
          result.validated.usage
        ));
        await dependencies.persistence?.recordBatchSuccess(
          organization.customerId,
          batchId,
          result,
          new Date().toISOString()
        );
        await dependencies.artifacts.write(`${basePath}/llm/batch-${batchId}-output.json`, {
          status: "VALIDATED",
          provider: dependencies.classifier.provider,
          model: dependencies.classifier.model,
          ruleVersion: dependencies.rules.version,
          promptVersion: dependencies.rules.promptVersion,
          providerRequestId: result.validated.providerRequestId,
          tokenUsage: result.validated.usage,
          attempts: result.attempts,
          providerRequest: result.request,
          rawResponse: result.response,
          decisions: result.validated.decisions
        });
        batchesCompleted += 1;
        decisionsCompleted += result.validated.decisions.length;
        dependencies.logger?.info({
          progressEvent: "organization_batch_completed",
          ...batchContext,
          batchStatus: "VALIDATED",
          durationMs: elapsedMs(batchStarted),
          generationAttempts: result.attempts.length,
          httpAttempts: result.attempts.reduce((total, attempt) => total + attempt.httpAttempts.length, 0),
          decisions: result.validated.decisions.length,
          inputTokens: result.validated.usage.inputTokens,
          outputTokens: result.validated.usage.outputTokens,
          totalTokens: result.validated.usage.totalTokens,
          batchesCompleted,
          batchesFailed,
          batchesRemaining: batches.length - batchesCompleted,
          decisionsCompleted
        }, "Organization LLM batch completed");
        return result.validated.decisions;
      } catch (error) {
        failedBatchCount += 1;
        const failure = error instanceof ClassificationFailure ? error : null;
        const attempts = failure?.attempts ?? [];
        const failedUsage = attempts.reduce(
          (total, attempt) => addTokenUsage(total, attempt.usage),
          emptyTokenUsage()
        );
        if (!batchTokenUsage.some((item) => item.batchId === batchId)) {
          dependencies.telemetry.recordBatch(false);
          recordAttempts(
            dependencies.telemetry,
            attempts,
            organization.customerId,
            batchId,
            dependencies.classifier.provider
          );
          organizationUsage = addOrganizationUsage(organizationUsage, failedUsage, attempts.length);
          batchTokenUsage.push(createBatchTokenUsage(
            batchId,
            "FAILED",
            batch.length,
            attempts.length,
            failedUsage
          ));
        }
        const serialized = serializeError(error, {
          stage: "LLM_CLASSIFICATION",
          organizationId: organization.customerId,
          batchId,
          provider: dependencies.classifier.provider
        });
        await dependencies.persistence?.recordBatchFailure(
          organization.customerId,
          batchId,
          failure?.request ?? null,
          attempts,
          failure?.lastResponse ?? null,
          serialized,
          new Date().toISOString()
        );
        await dependencies.artifacts.write(`${basePath}/llm/batch-${batchId}-error.json`, {
          status: "FAILED",
          failedAt: new Date().toISOString(),
          error: serialized,
          attempts,
          tokenUsage: failedUsage,
          providerRequest: failure?.request ?? null,
          lastRawResponse: failure?.lastResponse ?? null
        });
        batchesCompleted += 1;
        batchesFailed += 1;
        dependencies.logger?.warn({
          progressEvent: "organization_batch_failed",
          ...batchContext,
          batchStatus: "FAILED",
          durationMs: elapsedMs(batchStarted),
          errorCode: safeErrorCode(error),
          generationAttempts: attempts.length,
          httpAttempts: attempts.reduce((total, attempt) => total + attempt.httpAttempts.length, 0),
          batchesCompleted,
          batchesFailed,
          batchesRemaining: batches.length - batchesCompleted,
          decisionsCompleted
        }, "Organization LLM batch failed; remaining batches will continue");
        throw error;
      } finally {
        stopHeartbeat();
      }
      });
    }));

    const decisions = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    // Reconcile from settled state in case a failure occurred before entering the classifier catch.
    failedBatchCount = settled.filter((result) => result.status === "rejected").length;
    const summary = createSummary(
      organization,
      dateRange,
      rawRowCount,
      candidateCount,
      decisions,
      failedBatchCount,
      organizationUsage,
      batchTokenUsage,
      fixedInputFailed,
      dependencies.telemetry.errorsForOrganization(organization.customerId).length
    );
    mutation = await runMutationStage(dependencies, organization, candidates, decisions, summary);
    summary.mutation = mutation;
    summary.errorCount = dependencies.telemetry.errorsForOrganization(organization.customerId).length;
    if (mutation.status === "FAILED" || mutation.status === "PARTIAL") summary.status = "PARTIAL";
    await dependencies.persistence?.finishAccount(summaryRecord(summary));
    await writeOrganizationResults(dependencies, basePath, organization, dateRange, candidates, decisions, summary);
    logOrganizationCompleted(dependencies.logger, summary, organizationStarted);
    return summary;
  } catch (error) {
    const alreadyTracked = dependencies.telemetry.errorsForOrganization(organization.customerId)
      .some((item) => item.message === errorMessage(error));
    if (!alreadyTracked) dependencies.telemetry.error(error, { stage: "ORGANIZATION_PIPELINE", ...errorContext });
    const summary: OrganizationSummary = {
      customerId: organization.customerId,
      descriptiveName: organization.descriptiveName,
      dateRange,
      status: "FAILED",
      rawRowCount,
      candidateCount,
      decisionCount: 0,
      failedBatchCount,
      decisions: { KEEP: 0, NEGATIVE_EXACT: 0 },
      tokenUsage: organizationUsage,
      batchTokenUsage: [...batchTokenUsage].sort(compareBatchUsage),
      mutation,
      errorCount: dependencies.telemetry.errorsForOrganization(organization.customerId).length,
      error: errorMessage(error)
    };
    if (persistencePrepared) {
      await dependencies.persistence?.finishAccount(summaryRecord(summary));
    }
    await dependencies.artifacts.write(`${basePath}/errors.json`, {
      errors: dependencies.telemetry.errorsForOrganization(organization.customerId)
    });
    await dependencies.artifacts.write(`${basePath}/token-usage.json`, createOrganizationTokenUsageReport(
      dependencies.classifier.provider,
      dependencies.classifier.model,
      summary
    ));
    await dependencies.artifacts.write(`${basePath}/mutations/summary.json`, summary.mutation);
    await dependencies.artifacts.write(`${basePath}/summary.json`, summary);
    dependencies.logger?.warn({
      progressEvent: "organization_failed",
      organizationStatus: summary.status,
      durationMs: elapsedMs(organizationStarted),
      rawRowCount: summary.rawRowCount,
      candidateCount: summary.candidateCount,
      failedBatchCount: summary.failedBatchCount,
      errorCount: summary.errorCount,
      errorCode: safeErrorCode(error)
    }, "Organization processing failed");
    return summary;
  }
}

function summaryRecord(summary: OrganizationSummary): import("../storage/persistence.js").SweepAccountSummaryRecord {
  return {
    customerId: summary.customerId,
    status: summary.status,
    completedAt: new Date().toISOString(),
    rawRowCount: summary.rawRowCount,
    candidateCount: summary.candidateCount,
    decisionCount: summary.decisionCount,
    failedBatchCount: summary.failedBatchCount,
    keepCount: summary.decisions.KEEP ?? 0,
    negativeExactCount: summary.decisions.NEGATIVE_EXACT ?? 0,
    errorCount: summary.errorCount,
    ...(summary.error === undefined ? {} : { error: summary.error }),
    tokenUsage: summary.tokenUsage
  };
}

function startBatchHeartbeat(
  logger: Pick<ProgressLogger, "info"> | undefined,
  context: Record<string, unknown>,
  started: number,
  intervalMs: number
): () => void {
  if (!logger || !Number.isFinite(intervalMs) || intervalMs <= 0) return () => {};
  const timer = setInterval(() => {
    logger.info({
      progressEvent: "organization_batch_heartbeat",
      ...context,
      elapsedMs: elapsedMs(started)
    }, "Organization LLM batch is still running");
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

function logOrganizationCompleted(
  logger: Pick<ProgressLogger, "info"> | undefined,
  summary: OrganizationSummary,
  started: number
): void {
  logger?.info({
    progressEvent: "organization_completed",
    organizationStatus: summary.status,
    durationMs: elapsedMs(started),
    rawRowCount: summary.rawRowCount,
    candidateCount: summary.candidateCount,
    decisionCount: summary.decisionCount,
    keepCount: summary.decisions.KEEP ?? 0,
    negativeExactCount: summary.decisions.NEGATIVE_EXACT ?? 0,
    batchCount: summary.batchTokenUsage.length,
    failedBatchCount: summary.failedBatchCount,
    errorCount: summary.errorCount,
    mutationMode: summary.mutation.mode,
    mutationStatus: summary.mutation.status,
    mockedNegativeCount: summary.mutation.mockedCount,
    validatedNegativeCount: summary.mutation.validatedCount,
    appliedNegativeCount: summary.mutation.appliedCount,
    failedMutationCount: summary.mutation.failedCount,
    unknownMutationCount: summary.mutation.unknownCount
  }, "Organization processing completed");
}

function elapsedMs(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}

function safeErrorCode(error: unknown): string {
  return error instanceof PipelineError
    ? error.context.code ?? error.name
    : error instanceof Error
      ? error.name
      : "UNKNOWN_ERROR";
}

async function writeOrganizationResults(
  dependencies: ProcessOrganizationDependencies,
  basePath: string,
  organization: Organization,
  dateRange: DateRange,
  candidates: Parameters<typeof createDecisionCsv>[2],
  decisions: Parameters<typeof createDecisionCsv>[3],
  summary: OrganizationSummary
): Promise<void> {
  await dependencies.artifacts.write(`${basePath}/decisions.json`, {
    contractVersion: "classification-output-v2",
    releaseId: dependencies.rules.releaseId ?? null,
    readOnly: !summary.mutation.googleAdsMutationPerformed,
    googleAdsMutationPerformed: summary.mutation.googleAdsMutationPerformed,
    ruleVersion: dependencies.rules.version,
    promptVersion: dependencies.rules.promptVersion,
    provider: dependencies.classifier.provider,
    model: dependencies.classifier.model,
    tokenUsage: summary.tokenUsage,
    decisions
  });
  await dependencies.artifacts.write(`${basePath}/mutations/summary.json`, summary.mutation);
  await dependencies.artifacts.writeText(
    `${basePath}/llm-decisions.csv`,
    createDecisionCsv(
      organization,
      formatDateRange(dateRange),
      candidates,
      decisions,
      dependencies.classifier.model,
      dependencies.rules.version
    )
  );
  await dependencies.artifacts.write(`${basePath}/errors.json`, {
    errors: dependencies.telemetry.errorsForOrganization(organization.customerId)
  });
  await dependencies.artifacts.write(`${basePath}/token-usage.json`, createOrganizationTokenUsageReport(
    dependencies.classifier.provider,
    dependencies.classifier.model,
    summary
  ));
  await dependencies.artifacts.write(`${basePath}/summary.json`, summary);
}

function createSummary(
  organization: Organization,
  dateRange: DateRange,
  rawRowCount: number,
  candidateCount: number,
  decisions: Array<{ decision: string }>,
  failedBatchCount: number,
  tokenUsage: OrganizationTokenUsage,
  batchTokenUsage: BatchTokenUsage[],
  fixedInputFailed: boolean,
  errorCount: number
): OrganizationSummary {
  const counts: Record<string, number> = { KEEP: 0, NEGATIVE_EXACT: 0 };
  for (const decision of decisions) counts[decision.decision] = (counts[decision.decision] || 0) + 1;
  return {
    customerId: organization.customerId,
    descriptiveName: organization.descriptiveName,
    dateRange,
    status: candidateCount > 0 && decisions.length === 0
      ? "FAILED"
      : failedBatchCount > 0 || fixedInputFailed
        ? "PARTIAL"
        : "SUCCEEDED",
    rawRowCount,
    candidateCount,
    decisionCount: decisions.length,
    failedBatchCount,
    decisions: counts,
    tokenUsage,
    batchTokenUsage: [...batchTokenUsage].sort(compareBatchUsage),
    mutation: disabledMutationSummary(),
    errorCount
  };
}

async function runMutationStage(
  dependencies: ProcessOrganizationDependencies,
  organization: Organization,
  candidates: Parameters<typeof createDecisionCsv>[2],
  decisions: Parameters<typeof createDecisionCsv>[3],
  summary: OrganizationSummary
): Promise<NegativeKeywordMutationSummary> {
  const writer = dependencies.negativeKeywordWriter;
  if (!writer) return disabledMutationSummary();
  if (
    summary.status === "FAILED"
    || summary.failedBatchCount > 0
    || summary.decisionCount !== summary.candidateCount
  ) {
    return skippedMutationSummary(writer, "Mutation requires a complete, successful classification for every candidate.");
  }
  dependencies.logger?.info({
    progressEvent: "organization_mutation_started",
    mode: writer.mode,
    negativeDecisionCount: summary.decisions.NEGATIVE_EXACT ?? 0
  }, "Organization negative-keyword mutation stage started");
  try {
    const result = await applyNegativeExactDecisions({
      googleAds: dependencies.googleAds,
      writer,
      customerId: organization.customerId,
      candidates,
      decisions,
      chunkSize: dependencies.mutationChunkSize ?? 500
    });
    const fields = {
      progressEvent: "organization_mutation_completed",
      mode: writer.mode,
      mutationStatus: result.status,
      proposedCount: result.proposedCount,
      existingCount: result.existingCount,
      attemptedCount: result.attemptedCount,
      mockedCount: result.mockedCount,
      validatedCount: result.validatedCount,
      appliedCount: result.appliedCount,
      failedCount: result.failedCount,
      unknownCount: result.unknownCount,
      verifiedCount: result.verifiedCount
    };
    if (result.failedCount > 0 || result.unknownCount > 0) {
      dependencies.logger?.warn(fields, "Organization negative-keyword mutation stage completed with failures");
    } else {
      dependencies.logger?.info(fields, "Organization negative-keyword mutation stage completed");
    }
    return result;
  } catch (error) {
    dependencies.telemetry.error(error, {
      stage: "GOOGLE_ADS_MUTATION",
      code: "GOOGLE_ADS_MUTATION_STAGE_FAILED",
      retryable: false,
      organizationId: organization.customerId
    });
    dependencies.logger?.warn({
      progressEvent: "organization_mutation_failed",
      mode: writer.mode,
      errorCode: safeErrorCode(error)
    }, "Organization negative-keyword mutation stage failed");
    return {
      ...skippedMutationSummary(writer, errorMessage(error)),
      status: "FAILED",
      proposedCount: summary.decisions.NEGATIVE_EXACT ?? 0,
      failedCount: summary.decisions.NEGATIVE_EXACT ?? 0
    };
  }
}

export function createOrganizationTokenUsageReport(
  provider: string,
  model: string,
  summary: OrganizationSummary
): Record<string, unknown> {
  const batchTotals = summary.batchTokenUsage.reduce((total, batch) => ({
    ...addTokenUsage(total, batch),
    generationRequests: total.generationRequests + batch.generationRequests
  }), { ...emptyTokenUsage(), generationRequests: 0 });
  const reconciled = tokenUsageFields().every((field) => batchTotals[field] === summary.tokenUsage[field])
    && batchTotals.generationRequests === summary.tokenUsage.generationRequests;
  return {
    provider,
    model,
    customerId: summary.customerId,
    fixedInputTokens: summary.tokenUsage.fixedInputTokens,
    fixedInputDefinition: summary.tokenUsage.fixedInputDefinition,
    batches: summary.batchTokenUsage,
    totals: summary.tokenUsage,
    reconciliation: {
      reconciled,
      batchTotals,
      expectedBatchCount: summary.batchTokenUsage.length,
      successfulBatches: summary.batchTokenUsage.filter((item) => item.status === "VALIDATED").length,
      failedBatches: summary.batchTokenUsage.filter((item) => item.status === "FAILED").length
    }
  };
}

function organizationContext(organization: Organization): {
  customerId: string;
  descriptiveName: string;
  timeZone: string;
} {
  return {
    customerId: organization.customerId,
    descriptiveName: organization.descriptiveName,
    timeZone: organization.timeZone
  };
}

function emptyOrganizationUsage(): OrganizationTokenUsage {
  return {
    ...emptyTokenUsage(),
    generationRequests: 0,
    fixedInputTokens: null,
    fixedInputDefinition: null
  };
}

function addOrganizationUsage(
  current: OrganizationTokenUsage,
  usage: LlmTokenUsage,
  generationRequests: number
): OrganizationTokenUsage {
  return {
    ...addTokenUsage(current, usage),
    generationRequests: current.generationRequests + generationRequests,
    fixedInputTokens: current.fixedInputTokens,
    fixedInputDefinition: current.fixedInputDefinition
  };
}

function createBatchTokenUsage(
  batchId: string,
  status: BatchTokenUsage["status"],
  candidateCount: number,
  generationRequests: number,
  usage: LlmTokenUsage
): BatchTokenUsage {
  return { batchId, status, candidateCount, generationRequests, ...usage };
}

function compareBatchUsage(left: BatchTokenUsage, right: BatchTokenUsage): number {
  return left.batchId.localeCompare(right.batchId);
}

function tokenUsageFields(): Array<keyof LlmTokenUsage> {
  return ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "thoughtTokens"];
}

function recordAttempts(
  telemetry: RunTelemetry,
  attempts: LlmGenerationAttempt[],
  organizationId: string,
  batchId: string,
  provider: string
): void {
  for (const generation of attempts) {
    telemetry.recordGeneration(generation.usage);
    for (const request of generation.httpAttempts) {
      telemetry.event({
        stage: "LLM_HTTP_REQUEST",
        status: request.outcome,
        startedAt: request.startedAt,
        completedAt: request.completedAt,
        durationMs: request.durationMs,
        organizationId,
        batchId,
        provider,
        requestId: request.requestId,
        attempt: request.attempt,
        ...(request.statusCode === null ? {} : { statusCode: request.statusCode }),
        details: {
          generationAttempt: generation.attempt,
          generationOutcome: generation.outcome,
          error: request.error
        }
      });
    }
  }
}

export function date48HoursBackInTimeZone(timeZone: string, now = new Date()): DateRange {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localMidnightUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  const processingDate = new Date(localMidnightUtc - 2 * 86_400_000).toISOString().slice(0, 10);
  return { startDate: processingDate, endDate: processingDate };
}

export function singleDateRange(date: string): DateRange {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid date '${date}'. Expected YYYY-MM-DD.`);
  }
  return { startDate: date, endDate: date };
}

function formatDateRange(dateRange: DateRange): string {
  return `${dateRange.startDate}..${dateRange.endDate}`;
}

export function filterRowsByCampaignName(
  rows: SearchTermRow[],
  campaignNameContains: string | null | undefined
): SearchTermRow[] {
  const needle = campaignNameContains?.trim().toLocaleLowerCase("en-US");
  if (!needle) return rows;
  return rows.filter((row) => row.campaignName.toLocaleLowerCase("en-US").includes(needle));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
