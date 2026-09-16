import { loadConfig } from "../src/config/env.js";
import { loadRuleSet } from "../src/config/rule-set.js";
import { GoogleAdsClient } from "../src/google-ads/client.js";
import { disabledMutationSummary } from "../src/google-ads/negative-keyword-writer.js";
import { fetchOrganizations } from "../src/google-ads/organizations.js";
import { aggregateCandidates, fetchSearchTermsForDateRange } from "../src/google-ads/search-terms.js";
import { OpenAIKeywordClassifier } from "../src/llm/openai-classifier.js";
import type { ClassificationFailure } from "../src/llm/classifier.js";
import { createLogger } from "../src/observability/logger.js";
import { RunTelemetry, addTokenUsage, emptyTokenUsage } from "../src/observability/run-telemetry.js";
import { serializeError } from "../src/observability/errors.js";
import {
  createOrganizationTokenUsageReport,
  type BatchTokenUsage,
  type OrganizationSummary
} from "../src/pipeline/process-organization.js";
import { createRunTokenUsageReport } from "../src/pipeline/run-sweeper.js";
import { createDecisionCsv } from "../src/storage/decision-csv.js";
import { RunArtifacts } from "../src/storage/run-artifacts.js";
import { chunksOf, createLimiter } from "../src/util/concurrency.js";
import type { DateRange, FixedInputTokenCount, LlmTokenUsage, Organization } from "../src/types.js";

const logger = createLogger();
const DEFAULT_CUSTOMER_ID = "3825219066"; // P&C AUTOMOTIVE
const DEFAULT_RANGE: DateRange = { startDate: "2026-08-02", endDate: "2026-08-31" }; // last 30 completed days

async function main(): Promise<void> {
  const workspace = process.cwd();
  const args = process.argv.slice(2);
  const customerId = optionValue(args, "--customer") ?? DEFAULT_CUSTOMER_ID;
  const label = optionValue(args, "--label") ?? "pnc";
  const dateRange: DateRange = {
    startDate: optionValue(args, "--from") ?? DEFAULT_RANGE.startDate,
    endDate: optionValue(args, "--to") ?? DEFAULT_RANGE.endDate
  };

  const config = await loadConfig(workspace);
  const rules = await loadRuleSet(workspace);
  const telemetry = new RunTelemetry({ logger });
  const artifacts = new RunArtifacts(workspace, `measure-${label}-30day-openai-${timestamp()}`,
    (error, relativePath) => telemetry.error(error, {
      stage: "ARTIFACT_WRITE", code: "ARTIFACT_WRITE_FAILED", retryable: true, details: { relativePath }
    }));
  const googleAds = new GoogleAdsClient(config.googleAds, telemetry);
  const classifier = new OpenAIKeywordClassifier(config.llm);
  const startedAt = new Date().toISOString();

  const manifestBase = {
    runId: artifacts.runId,
    startedAt,
    purpose: "One-off 30-day token-usage measurement for P&C Automotive on OpenAI gpt-5.6-luna (low reasoning)",
    requestedDateRange: { from: dateRange.startDate, to: dateRange.endDate },
    readOnly: true,
    googleAdsMutationPerformed: false,
    ruleSet: { version: rules.version, sourcePath: rules.sourcePath, promptVersion: rules.promptVersion },
    llm: { provider: classifier.provider, model: classifier.model, reasoningEffort: "low" },
    limits: {
      googleFetchConcurrency: config.googleFetchConcurrency,
      llmConcurrency: config.llm.concurrency,
      llmBatchSize: config.llm.batchSize
    }
  };
  await artifacts.write("run-manifest.json", { ...manifestBase, status: "RUNNING" });
  await artifacts.writeText("rules.md", rules.markdown);

  const organization = await telemetry.track("ORGANIZATION_DISCOVERY", {}, async () => {
    const discovered = await fetchOrganizations(googleAds, config.googleAds.loginCustomerId);
    const found = discovered.find((item) => item.customerId === customerId);
    if (!found) throw new Error(`Customer ${customerId} was not found as an enabled leaf account.`);
    return found;
  });
  await artifacts.write("organizations.json", { discovered: [organization], selected: [organization] });

  const basePath = `organizations/${organization.customerId}`;
  const errorContext = { organizationId: organization.customerId };

  const rows = await telemetry.track("GOOGLE_SEARCH_TERM_FETCH", errorContext, () =>
    fetchSearchTermsForDateRange(googleAds, organization.customerId, dateRange)
  );
  await artifacts.write(`${basePath}/fetch.json`, { organization, dateRange, fetchedAt: new Date().toISOString(), rows });

  const candidates = aggregateCandidates(rows);
  await artifacts.write(`${basePath}/candidates.json`, { organization, dateRange, candidates });

  let fixedInput: FixedInputTokenCount | null = null;
  try {
    fixedInput = await telemetry.track("LLM_FIXED_TOKEN_COUNT", { ...errorContext, provider: classifier.provider }, () =>
      classifier.countFixedInputTokens({
        account: { customerId: organization.customerId, descriptiveName: organization.descriptiveName, timeZone: organization.timeZone },
        dateRange,
        rules
      })
    );
    telemetry.recordFixedInput(fixedInput.totalTokens);
  } catch (error) {
    telemetry.error(error, { stage: "LLM_FIXED_TOKEN_COUNT", ...errorContext });
  }
  await artifacts.write(`${basePath}/fixed-input-tokens.json`, {
    status: fixedInput ? "COUNTED" : "FAILED",
    provider: classifier.provider,
    model: classifier.model,
    ruleVersion: rules.version,
    promptVersion: rules.promptVersion,
    fixedInput
  });

  const batches = chunksOf(candidates, config.llm.batchSize);
  const llmLimit = createLimiter(config.llm.concurrency);
  const decisions: Array<{ decision: string }> = [];
  const batchTokenUsage: BatchTokenUsage[] = [];
  let organizationUsage = { ...emptyTokenUsage(), generationRequests: 0 };

  await Promise.allSettled(batches.map((batch, index) => llmLimit(async () => {
    const batchId = String(index + 1).padStart(4, "0");
    const context = {
      account: { customerId: organization.customerId, descriptiveName: organization.descriptiveName, timeZone: organization.timeZone },
      dateRange,
      rules,
      searchTerms: batch
    };
    await artifacts.write(`${basePath}/llm/batch-${batchId}-input.json`, {
      provider: classifier.provider,
      model: classifier.model,
      ruleVersion: rules.version,
      promptVersion: rules.promptVersion,
      fixedInputTokens: fixedInput?.totalTokens ?? null,
      ...context
    });
    try {
      const result = await telemetry.track("LLM_CLASSIFICATION", {
        ...errorContext, batchId, provider: classifier.provider, details: { candidateCount: batch.length }
      }, () => classifier.classify(context));
      for (const attempt of result.attempts) telemetry.recordGeneration(attempt.usage);
      telemetry.recordBatch(true);
      organizationUsage = mergeUsage(organizationUsage, result.validated.usage, result.attempts.length);
      batchTokenUsage.push({ batchId, status: "VALIDATED", candidateCount: batch.length, generationRequests: result.attempts.length, ...result.validated.usage });
      decisions.push(...result.validated.decisions);
      await artifacts.write(`${basePath}/llm/batch-${batchId}-output.json`, {
        status: "VALIDATED",
        provider: classifier.provider,
        model: classifier.model,
        ruleVersion: rules.version,
        promptVersion: rules.promptVersion,
        providerRequestId: result.validated.providerRequestId,
        tokenUsage: result.validated.usage,
        attempts: result.attempts,
        providerRequest: result.request,
        rawResponse: result.response,
        decisions: result.validated.decisions
      });
    } catch (error) {
      const failure = error as ClassificationFailure;
      const attempts = failure?.attempts ?? [];
      const failedUsage = attempts.reduce((total: LlmTokenUsage, attempt) => addTokenUsage(total, attempt.usage), emptyTokenUsage());
      for (const attempt of attempts) telemetry.recordGeneration(attempt.usage);
      telemetry.recordBatch(false);
      organizationUsage = mergeUsage(organizationUsage, failedUsage, attempts.length);
      batchTokenUsage.push({ batchId, status: "FAILED", candidateCount: batch.length, generationRequests: attempts.length, ...failedUsage });
      telemetry.error(error, { stage: "LLM_CLASSIFICATION", ...errorContext, batchId, provider: classifier.provider });
      await artifacts.write(`${basePath}/llm/batch-${batchId}-error.json`, {
        status: "FAILED",
        failedAt: new Date().toISOString(),
        error: serializeError(error, { stage: "LLM_CLASSIFICATION", ...errorContext, batchId, provider: classifier.provider }),
        attempts,
        tokenUsage: failedUsage,
        providerRequest: failure?.request ?? null,
        lastRawResponse: failure?.lastResponse ?? null
      });
    }
  })));

  batchTokenUsage.sort((left, right) => left.batchId.localeCompare(right.batchId));
  const failedBatchCount = batchTokenUsage.filter((item) => item.status === "FAILED").length;
  const decisionCounts: Record<string, number> = { KEEP: 0, NEGATIVE_EXACT: 0 };
  for (const decision of decisions) decisionCounts[decision.decision] = (decisionCounts[decision.decision] || 0) + 1;

  const summary: OrganizationSummary = {
    customerId: organization.customerId,
    descriptiveName: organization.descriptiveName,
    dateRange,
    status: candidates.length > 0 && decisions.length === 0
      ? "FAILED"
      : failedBatchCount > 0 || !fixedInput
        ? "PARTIAL"
        : "SUCCEEDED",
    rawRowCount: rows.length,
    candidateCount: candidates.length,
    decisionCount: decisions.length,
    failedBatchCount,
    positiveKeywords: {
      fetchedCount: 0,
      activeCount: 0,
      candidatesWithAnyExactMatch: 0,
      candidatesProtectedInCampaign: 0
    },
    decisions: decisionCounts,
    tokenUsage: {
      ...organizationUsage,
      fixedInputTokens: fixedInput?.totalTokens ?? null,
      fixedInputDefinition: fixedInput?.definition ?? null
    },
    batchTokenUsage,
    mutation: disabledMutationSummary(),
    errorCount: telemetry.errorsForOrganization(organization.customerId).length
  };

  await artifacts.write(`${basePath}/decisions.json`, {
    contractVersion: "classification-output-v2",
    readOnly: true,
    googleAdsMutationPerformed: false,
    ruleVersion: rules.version,
    promptVersion: rules.promptVersion,
    provider: classifier.provider,
    model: classifier.model,
    tokenUsage: summary.tokenUsage,
    decisions
  });
  await artifacts.writeText(`${basePath}/llm-decisions.csv`,
    createDecisionCsv(organization, `${dateRange.startDate}..${dateRange.endDate}`, candidates, decisions as never, classifier.model, rules.version));
  await artifacts.write(`${basePath}/errors.json`, { errors: telemetry.errorsForOrganization(organization.customerId) });
  await artifacts.write(`${basePath}/token-usage.json`, createOrganizationTokenUsageReport(classifier.provider, classifier.model, summary));
  await artifacts.write(`${basePath}/summary.json`, summary);

  const snapshot = telemetry.snapshot();
  const tokenUsageReport = createRunTokenUsageReport(snapshot.tokenUsage, [summary]);
  await artifacts.write("token-usage.json", tokenUsageReport);
  await artifacts.write("telemetry.json", snapshot);
  await artifacts.write("summary.json", {
    runId: artifacts.runId,
    status: summary.status,
    readOnly: true,
    startedAt,
    completedAt: new Date().toISOString(),
    organizationsDiscovered: 1,
    organizationsSelected: 1,
    rawRows: rows.length,
    candidates: candidates.length,
    decisions: decisions.length,
    tokenUsage: snapshot.tokenUsage,
    tokenUsageReconciled: tokenUsageReport.reconciliation.reconciled,
    errorCount: snapshot.errors.length,
    organizations: [summary]
  });
  await artifacts.write("run-manifest.json", {
    ...manifestBase,
    status: summary.status,
    completedAt: new Date().toISOString(),
    organizationsDiscovered: 1,
    organizationsSelected: 1,
    errorCount: snapshot.errors.length,
    fatalError: null
  });

  logger.info({
    runDirectory: artifacts.runDirectory,
    status: summary.status,
    rawRows: rows.length,
    candidates: candidates.length,
    decisions: decisions.length,
    decisionCounts,
    failedBatches: failedBatchCount,
    fixedInputTokens: fixedInput?.totalTokens ?? null,
    tokenUsage: snapshot.tokenUsage,
    reconciled: tokenUsageReport.reconciliation.reconciled
  }, "30-day measurement run completed");
}

function mergeUsage(current: { generationRequests: number } & LlmTokenUsage, usage: LlmTokenUsage, requests: number) {
  return { ...addTokenUsage(current, usage), generationRequests: current.generationRequests + requests };
}

function optionValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/gu, "");
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "30-day measurement run failed");
  process.exitCode = 1;
});
