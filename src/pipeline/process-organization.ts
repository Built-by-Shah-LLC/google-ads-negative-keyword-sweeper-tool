import type { FixedInputTokenCount, LlmTokenUsage, Organization, RuleSet } from "../types.js";
import type { GoogleAdsClient } from "../google-ads/client.js";
import { aggregateCandidates, fetchDailySearchTerms } from "../google-ads/search-terms.js";
import { ClassificationFailure, type KeywordClassifier, type LlmGenerationAttempt } from "../llm/classifier.js";
import { serializeError } from "../observability/errors.js";
import { addTokenUsage, emptyTokenUsage, type RunTelemetry } from "../observability/run-telemetry.js";
import type { RunArtifacts } from "../storage/run-artifacts.js";
import { createDecisionCsv } from "../storage/decision-csv.js";
import { chunksOf, type Limit } from "../util/concurrency.js";

export interface OrganizationTokenUsage extends LlmTokenUsage {
  generationRequests: number;
  fixedInputTokens: number | null;
  fixedInputDefinition: string | null;
}

export interface OrganizationSummary {
  customerId: string;
  descriptiveName: string;
  date: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  rawRowCount: number;
  candidateCount: number;
  decisionCount: number;
  failedBatchCount: number;
  decisions: Record<string, number>;
  tokenUsage: OrganizationTokenUsage;
  errorCount: number;
  error?: string;
}

interface ProcessOrganizationDependencies {
  googleAds: GoogleAdsClient;
  classifier: KeywordClassifier;
  artifacts: RunArtifacts;
  telemetry: RunTelemetry;
  rules: RuleSet;
  batchSize: number;
  llmLimit: Limit;
}

export async function processOrganization(
  organization: Organization,
  requestedDate: string | null,
  dependencies: ProcessOrganizationDependencies
): Promise<OrganizationSummary> {
  const date = requestedDate || previousDateInTimeZone(organization.timeZone);
  const basePath = `organizations/${organization.customerId}`;
  const errorContext = { organizationId: organization.customerId };
  let rawRowCount = 0;
  let candidateCount = 0;
  let failedBatchCount = 0;
  let organizationUsage = emptyOrganizationUsage();
  let fixedInput: FixedInputTokenCount | null = null;
  let fixedInputFailed = false;

  try {
    const rows = await dependencies.telemetry.track("GOOGLE_SEARCH_TERM_FETCH", errorContext, () =>
      fetchDailySearchTerms(dependencies.googleAds, organization.customerId, date)
    );
    rawRowCount = rows.length;
    await dependencies.artifacts.write(`${basePath}/fetch.json`, {
      organization,
      date,
      fetchedAt: new Date().toISOString(),
      rows
    });

    const candidates = aggregateCandidates(rows);
    candidateCount = candidates.length;
    await dependencies.artifacts.write(`${basePath}/candidates.json`, { organization, date, candidates });

    try {
      fixedInput = await dependencies.telemetry.track("LLM_FIXED_TOKEN_COUNT", {
        ...errorContext,
        provider: dependencies.classifier.provider
      }, () => dependencies.classifier.countFixedInputTokens({
        account: organizationContext(organization),
        date,
        rules: dependencies.rules
      }));
      organizationUsage.fixedInputTokens = fixedInput.totalTokens;
      organizationUsage.fixedInputDefinition = fixedInput.definition;
      dependencies.telemetry.recordFixedInput(fixedInput.totalTokens);
    } catch {
      fixedInputFailed = true;
    }
    await dependencies.artifacts.write(`${basePath}/fixed-input-tokens.json`, {
      status: fixedInput ? "COUNTED" : "FAILED",
      provider: dependencies.classifier.provider,
      model: dependencies.classifier.model,
      ruleVersion: dependencies.rules.version,
      promptVersion: dependencies.rules.promptVersion,
      fixedInput
    });

    if (candidates.length === 0) {
      const summary = createSummary(
        organization,
        date,
        rawRowCount,
        0,
        [],
        0,
        organizationUsage,
        false,
        dependencies.telemetry.errorsForOrganization(organization.customerId).length
      );
      await writeOrganizationResults(dependencies, basePath, organization, date, candidates, [], summary);
      return summary;
    }

    const batches = chunksOf(candidates, dependencies.batchSize);
    const settled = await Promise.allSettled(batches.map((batch, index) => dependencies.llmLimit(async () => {
      const batchId = String(index + 1).padStart(4, "0");
      const context = {
        account: organizationContext(organization),
        date,
        rules: dependencies.rules,
        searchTerms: batch
      };
      await dependencies.artifacts.write(`${basePath}/llm/batch-${batchId}-input.json`, {
        provider: dependencies.classifier.provider,
        model: dependencies.classifier.model,
        ruleVersion: dependencies.rules.version,
        promptVersion: dependencies.rules.promptVersion,
        fixedInputTokens: fixedInput?.totalTokens ?? null,
        ...context
      });
      try {
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
        return result.validated.decisions;
      } catch (error) {
        failedBatchCount += 1;
        dependencies.telemetry.recordBatch(false);
        const failure = error instanceof ClassificationFailure ? error : null;
        const attempts = failure?.attempts ?? [];
        recordAttempts(
          dependencies.telemetry,
          attempts,
          organization.customerId,
          batchId,
          dependencies.classifier.provider
        );
        const failedUsage = attempts.reduce(
          (total, attempt) => addTokenUsage(total, attempt.usage),
          emptyTokenUsage()
        );
        organizationUsage = addOrganizationUsage(organizationUsage, failedUsage, attempts.length);
        const serialized = serializeError(error, {
          stage: "LLM_CLASSIFICATION",
          organizationId: organization.customerId,
          batchId,
          provider: dependencies.classifier.provider
        });
        await dependencies.artifacts.write(`${basePath}/llm/batch-${batchId}-error.json`, {
          status: "FAILED",
          failedAt: new Date().toISOString(),
          error: serialized,
          attempts,
          tokenUsage: failedUsage,
          providerRequest: failure?.request ?? null,
          lastRawResponse: failure?.lastResponse ?? null
        });
        throw error;
      }
    })));

    const decisions = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    // Reconcile from settled state in case a failure occurred before entering the classifier catch.
    failedBatchCount = settled.filter((result) => result.status === "rejected").length;
    const summary = createSummary(
      organization,
      date,
      rawRowCount,
      candidateCount,
      decisions,
      failedBatchCount,
      organizationUsage,
      fixedInputFailed,
      dependencies.telemetry.errorsForOrganization(organization.customerId).length
    );
    await writeOrganizationResults(dependencies, basePath, organization, date, candidates, decisions, summary);
    return summary;
  } catch (error) {
    const alreadyTracked = dependencies.telemetry.errorsForOrganization(organization.customerId)
      .some((item) => item.message === errorMessage(error));
    if (!alreadyTracked) dependencies.telemetry.error(error, { stage: "ORGANIZATION_PIPELINE", ...errorContext });
    const summary: OrganizationSummary = {
      customerId: organization.customerId,
      descriptiveName: organization.descriptiveName,
      date,
      status: "FAILED",
      rawRowCount,
      candidateCount,
      decisionCount: 0,
      failedBatchCount,
      decisions: { KEEP: 0, NEGATIVE_EXACT: 0 },
      tokenUsage: organizationUsage,
      errorCount: dependencies.telemetry.errorsForOrganization(organization.customerId).length,
      error: errorMessage(error)
    };
    await dependencies.artifacts.write(`${basePath}/errors.json`, {
      errors: dependencies.telemetry.errorsForOrganization(organization.customerId)
    });
    await dependencies.artifacts.write(`${basePath}/summary.json`, summary);
    return summary;
  }
}

async function writeOrganizationResults(
  dependencies: ProcessOrganizationDependencies,
  basePath: string,
  organization: Organization,
  date: string,
  candidates: Parameters<typeof createDecisionCsv>[2],
  decisions: Parameters<typeof createDecisionCsv>[3],
  summary: OrganizationSummary
): Promise<void> {
  await dependencies.artifacts.write(`${basePath}/decisions.json`, {
    contractVersion: "classification-output-v2",
    ruleVersion: dependencies.rules.version,
    promptVersion: dependencies.rules.promptVersion,
    provider: dependencies.classifier.provider,
    model: dependencies.classifier.model,
    tokenUsage: summary.tokenUsage,
    decisions
  });
  await dependencies.artifacts.writeText(
    `${basePath}/llm-decisions.csv`,
    createDecisionCsv(
      organization,
      date,
      candidates,
      decisions,
      dependencies.classifier.model,
      dependencies.rules.version
    )
  );
  await dependencies.artifacts.write(`${basePath}/errors.json`, {
    errors: dependencies.telemetry.errorsForOrganization(organization.customerId)
  });
  await dependencies.artifacts.write(`${basePath}/summary.json`, summary);
}

function createSummary(
  organization: Organization,
  date: string,
  rawRowCount: number,
  candidateCount: number,
  decisions: Array<{ decision: string }>,
  failedBatchCount: number,
  tokenUsage: OrganizationTokenUsage,
  fixedInputFailed: boolean,
  errorCount: number
): OrganizationSummary {
  const counts: Record<string, number> = { KEEP: 0, NEGATIVE_EXACT: 0 };
  for (const decision of decisions) counts[decision.decision] = (counts[decision.decision] || 0) + 1;
  return {
    customerId: organization.customerId,
    descriptiveName: organization.descriptiveName,
    date,
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
    errorCount
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

export function previousDateInTimeZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localMidnightUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  return new Date(localMidnightUtc - 86_400_000).toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
