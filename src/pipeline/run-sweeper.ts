import type { AppConfig } from "../config/env.js";
import type { RuleSet } from "../types.js";
import { GoogleAdsClient } from "../google-ads/client.js";
import { fetchOrganizations } from "../google-ads/organizations.js";
import { OpenAIKeywordClassifier } from "../llm/openai-classifier.js";
import type { EmailAlertService } from "../notifications/email-alerts.js";
import { PipelineError } from "../observability/errors.js";
import { createLogger, type Logger } from "../observability/logger.js";
import { emptyTokenUsage, RunTelemetry, type TokenTotals } from "../observability/run-telemetry.js";
import { RunArtifacts } from "../storage/run-artifacts.js";
import { createLimiter } from "../util/concurrency.js";
import { processOrganization, type OrganizationSummary } from "./process-organization.js";

export interface SweepOptions {
  rootDirectory: string;
  date: string | null;
  customerId: string | null;
  organizationLimit: number | null;
  allOrganizations: boolean;
}

export interface SweepServices {
  logger?: Logger;
  emailAlerts?: EmailAlertService;
}

export async function runSweeper(config: AppConfig, rules: RuleSet, options: SweepOptions, services: SweepServices = {}): Promise<{
  runId: string;
  runDirectory: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
}> {
  let telemetry!: RunTelemetry;
  const artifacts = new RunArtifacts(options.rootDirectory, undefined, (error, relativePath) => {
    telemetry.error(error, {
      stage: "ARTIFACT_WRITE",
      code: "ARTIFACT_WRITE_FAILED",
      retryable: true,
      details: { relativePath }
    });
  });
  const logger = (services.logger ?? createLogger()).child({ runId: artifacts.runId });
  telemetry = new RunTelemetry({
    logger,
    onError: (error) => services.emailAlerts?.notifyHandled(error, {
      runId: artifacts.runId,
      runDirectory: artifacts.runDirectory
    })
  });
  const googleAds = new GoogleAdsClient(config.googleAds, telemetry);
  const classifier = new OpenAIKeywordClassifier(config.llm);
  const startedAt = new Date().toISOString();
  const manifestBase = {
    runId: artifacts.runId,
    startedAt,
    requestedDate: options.date,
    readOnly: true,
    ruleSet: {
      version: rules.version,
      sourcePath: rules.sourcePath,
      promptVersion: rules.promptVersion
    },
    llm: { provider: classifier.provider, model: classifier.model },
    limits: {
      googleFetchConcurrency: config.googleFetchConcurrency,
      llmConcurrency: config.llm.concurrency,
      llmBatchSize: config.llm.batchSize
    }
  };

  let discoveredCount = 0;
  let selectedCount = 0;
  let summaries: OrganizationSummary[] = [];
  try {
    logger.info({ ruleVersion: rules.version, promptVersion: rules.promptVersion }, "Sweep run started");
    await artifacts.write("run-manifest.json", { ...manifestBase, status: "RUNNING" });
    await artifacts.writeText("rules.md", rules.markdown);

    const discovered = await telemetry.track("ORGANIZATION_DISCOVERY", {}, () =>
      fetchOrganizations(googleAds, config.googleAds.loginCustomerId)
    );
    discoveredCount = discovered.length;
    let selected = discovered;
    if (options.customerId) {
      const customerId = options.customerId.replaceAll("-", "");
      selected = discovered.filter((organization) => organization.customerId === customerId);
      if (selected.length === 0) {
        throw new PipelineError(
          `Customer ${customerId} was not found as an enabled leaf account.`,
          { stage: "ORGANIZATION_SELECTION", code: "ORGANIZATION_NOT_FOUND", retryable: false }
        );
      }
    } else if (!options.allOrganizations) {
      selected = discovered.slice(0, options.organizationLimit ?? 1);
    }
    if (selected.length === 0) {
      throw new PipelineError(
        "No enabled leaf organizations were selected; refusing to report an empty successful run.",
        { stage: "ORGANIZATION_SELECTION", code: "NO_ORGANIZATIONS_SELECTED", retryable: false }
      );
    }
    selectedCount = selected.length;
    await artifacts.write("organizations.json", { discovered, selected });

    const fetchLimit = createLimiter(config.googleFetchConcurrency);
    const llmLimit = createLimiter(config.llm.concurrency);
    summaries = await Promise.all(selected.map((organization) => fetchLimit(() => processOrganization(
      organization,
      options.date,
      {
        googleAds,
        classifier,
        artifacts,
        telemetry,
        rules,
        batchSize: config.llm.batchSize,
        llmLimit
      }
    ))));

    const status = runStatus(summaries);
    await finalizeRun(artifacts, telemetry, manifestBase, summaries, discoveredCount, selectedCount, status, services.emailAlerts);
    logger.info({ status, organizationsSelected: selectedCount }, "Sweep run completed");
    return { runId: artifacts.runId, runDirectory: artifacts.runDirectory, status };
  } catch (error) {
    const alreadyTracked = telemetry.snapshot().errors.some((item) => item.message === errorMessage(error));
    if (!alreadyTracked) telemetry.error(error, { stage: "RUN_PIPELINE" });
    await finalizeRun(
      artifacts,
      telemetry,
      manifestBase,
      summaries,
      discoveredCount,
      selectedCount,
      "FAILED",
      services.emailAlerts,
      errorMessage(error)
    );
    logger.error({ status: "FAILED" }, "Sweep run failed");
    return { runId: artifacts.runId, runDirectory: artifacts.runDirectory, status: "FAILED" };
  }
}

async function finalizeRun(
  artifacts: RunArtifacts,
  telemetry: RunTelemetry,
  manifestBase: Record<string, unknown>,
  summaries: OrganizationSummary[],
  discoveredCount: number,
  selectedCount: number,
  status: "SUCCEEDED" | "PARTIAL" | "FAILED",
  emailAlerts?: EmailAlertService,
  fatalError?: string
): Promise<void> {
  const completedAt = new Date().toISOString();
  const telemetrySnapshot = telemetry.snapshot();
  const tokenUsageReport = createRunTokenUsageReport(telemetrySnapshot.tokenUsage, summaries);
  const failed = summaries.filter((summary) => summary.status === "FAILED").length;
  const partial = summaries.filter((summary) => summary.status === "PARTIAL").length;
  const summary = {
    runId: artifacts.runId,
    status,
    readOnly: true,
    startedAt: manifestBase.startedAt,
    completedAt,
    organizationsDiscovered: discoveredCount,
    organizationsSelected: selectedCount,
    organizationStatusCounts: {
      succeeded: summaries.filter((item) => item.status === "SUCCEEDED").length,
      partial,
      failed
    },
    rawRows: summaries.reduce((sum, item) => sum + item.rawRowCount, 0),
    candidates: summaries.reduce((sum, item) => sum + item.candidateCount, 0),
    decisions: summaries.reduce((sum, item) => sum + item.decisionCount, 0),
    tokenUsage: telemetrySnapshot.tokenUsage,
    tokenUsageReconciled: tokenUsageReport.reconciliation.reconciled,
    errorCount: telemetrySnapshot.errors.length,
    fatalError: fatalError ?? null,
    organizations: summaries
  };
  await artifacts.write("summary.json", summary);
  await artifacts.write("token-usage.json", tokenUsageReport);
  await artifacts.write("telemetry.json", telemetrySnapshot);
  await artifacts.write("run-manifest.json", {
    ...manifestBase,
    status,
    completedAt,
    organizationsDiscovered: discoveredCount,
    organizationsSelected: selectedCount,
    errorCount: telemetrySnapshot.errors.length,
    fatalError: fatalError ?? null
  });
  await emailAlerts?.flush();
}

export function createRunTokenUsageReport(
  telemetryTotals: TokenTotals,
  summaries: OrganizationSummary[]
): {
  totals: TokenTotals;
  organizations: Array<{
    customerId: string;
    status: OrganizationSummary["status"];
    batchCount: number;
    tokenUsage: OrganizationSummary["tokenUsage"];
  }>;
  reconciliation: {
    reconciled: boolean;
    organizationTotals: TokenTotals;
  };
} {
  const organizationTotals: TokenTotals = {
    ...emptyTokenUsage(),
    generationRequests: 0,
    successfulBatches: 0,
    failedBatches: 0,
    fixedInputTokens: 0,
    organizationsCounted: 0
  };
  for (const summary of summaries) {
    organizationTotals.inputTokens += summary.tokenUsage.inputTokens;
    organizationTotals.outputTokens += summary.tokenUsage.outputTokens;
    organizationTotals.totalTokens += summary.tokenUsage.totalTokens;
    organizationTotals.cachedInputTokens += summary.tokenUsage.cachedInputTokens;
    organizationTotals.thoughtTokens += summary.tokenUsage.thoughtTokens;
    organizationTotals.generationRequests += summary.tokenUsage.generationRequests;
    organizationTotals.successfulBatches += summary.batchTokenUsage.filter((item) => item.status === "VALIDATED").length;
    organizationTotals.failedBatches += summary.batchTokenUsage.filter((item) => item.status === "FAILED").length;
    if (summary.tokenUsage.fixedInputTokens !== null) {
      organizationTotals.fixedInputTokens += summary.tokenUsage.fixedInputTokens;
      organizationTotals.organizationsCounted += 1;
    }
  }
  const reconciled = (Object.keys(telemetryTotals) as Array<keyof TokenTotals>)
    .every((field) => telemetryTotals[field] === organizationTotals[field]);
  return {
    totals: telemetryTotals,
    organizations: summaries.map((summary) => ({
      customerId: summary.customerId,
      status: summary.status,
      batchCount: summary.batchTokenUsage.length,
      tokenUsage: summary.tokenUsage
    })),
    reconciliation: { reconciled, organizationTotals }
  };
}

function runStatus(summaries: OrganizationSummary[]): "SUCCEEDED" | "PARTIAL" | "FAILED" {
  const failed = summaries.filter((summary) => summary.status === "FAILED").length;
  const partial = summaries.filter((summary) => summary.status === "PARTIAL").length;
  if (failed === summaries.length && summaries.length > 0) return "FAILED";
  if (failed > 0 || partial > 0) return "PARTIAL";
  return "SUCCEEDED";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
