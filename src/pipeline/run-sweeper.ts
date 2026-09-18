import { createHash } from "node:crypto";
import type { AppConfig } from "../config/env.js";
import {
  filterOrganizationsBySweepAccounts,
  KNOWN_MISSING_CLIENT_ACCOUNT_MAPPINGS
} from "../config/sweep-accounts.js";
import {
  hasSweep30DayCompletion,
  loadSweep30DayState,
  recordSweep30DayCompletion
} from "../config/sweep-30day-state.js";
import type { RuleSet } from "../types.js";
import {
  compileAccountPolicy,
  type AccountPolicyConfig,
  type EffectiveAccountPolicy
} from "../config/account-policy-compiler.js";
import { GoogleAdsClient } from "../google-ads/client.js";
import { DevelopmentNegativeKeywordWriter } from "../google-ads/negative-keyword-writer.dev.js";
import { createLiveProductionNegativeKeywordWriter } from "../google-ads/negative-keyword-writer.prod.js";
import { createLiveValidationOnlyNegativeKeywordWriter } from "../google-ads/negative-keyword-writer.validation.js";
import type { NegativeKeywordWriter } from "../google-ads/negative-keyword-writer.js";
import { fetchOrganizations, filterOrganizationsByAllowlist } from "../google-ads/organizations.js";
import { createKeywordClassifier } from "../llm/classifier-factory.js";
import type { EmailAlertService } from "../notifications/email-alerts.js";
import type { RunReportEmailService } from "../notifications/run-report-email.js";
import { PipelineError } from "../observability/errors.js";
import { createLogger, type Logger } from "../observability/logger.js";
import { emptyTokenUsage, RunTelemetry, type TokenTotals } from "../observability/run-telemetry.js";
import { RunArtifacts } from "../storage/run-artifacts.js";
import { createRunWorkbook } from "../storage/run-workbook.js";
import {
  DisabledSweepPersistence,
  sweepAccountMutationRecord,
  type SweepPersistence
} from "../storage/persistence.js";
import { PostgresSweepPersistence } from "../storage/postgres/postgres-sweep-persistence.js";
import { createLimiter } from "../util/concurrency.js";
import type { Organization } from "../types.js";
import {
  date48HoursBackInTimeZone,
  lookbackDateRangeEndingAt,
  processOrganization,
  type OrganizationSummary
} from "./process-organization.js";

export interface SweepOptions {
  rootDirectory: string;
  date: string | null;
  customerId: string | null;
  organizationLimit: number | null;
  allOrganizations: boolean;
  candidateLimitPerOrganization: number | null;
  productionMutationAuthorized: boolean;
  /** Initial 30-day-lookback mode (sweep:30day): records completions in the state file. */
  thirtyDayMode: boolean;
  /** 30-day mode only: select every master-list company without a completion record. */
  allPending: boolean;
  /** Standard runs only: bypass the 30-day completion gate. Defaults to enforced. */
  ignoreThirtyDayCheck: boolean;
  /** Dynamic per-account policy loaded from the database by the entrypoint. */
  accountPolicies: Record<string, AccountPolicyConfig>;
}

export interface SweepServices {
  logger?: Logger;
  emailAlerts?: EmailAlertService;
  runReportEmail?: RunReportEmailService;
  persistence?: SweepPersistence;
  /** Test seam. Runtime selection comes from GOOGLE_ADS_MUTATION_MODE. */
  negativeKeywordWriter?: NegativeKeywordWriter;
}

export async function runSweeper(config: AppConfig, rules: RuleSet, options: SweepOptions, services: SweepServices = {}): Promise<{
  runId: string;
  runDirectory: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
}> {
  assertProductionMutationAuthorized(config, options);
  const persistence = services.persistence
    ?? (config.persistence.enabled
      ? new PostgresSweepPersistence(config.persistence)
      : new DisabledSweepPersistence());
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
  const classifier = createKeywordClassifier(config.llm);
  const negativeKeywordWriter = services.negativeKeywordWriter ?? createNegativeKeywordWriter(config);
  const mutationMode = negativeKeywordWriter?.mode ?? "disabled";
  const startedAt = new Date().toISOString();
  const processingDate = options.date
    ?? date48HoursBackInTimeZone(config.processingTimeZone, new Date(startedAt)).startDate;
  const thirtyDayDateRange = options.thirtyDayMode
    ? lookbackDateRangeEndingAt(processingDate, 30)
    : null;
  const manifestBase = {
    runId: artifacts.runId,
    startedAt,
    requestedDate: processingDate,
    requestedDateSource: options.date ? "COMMAND_LINE" : "AUTOMATIC_48_HOURS_BACK",
    processingTimeZone: config.processingTimeZone,
    readOnly: mutationMode !== "production",
    googleAdsMutationMode: mutationMode,
    googleAdsMutationPerformed: false,
    ruleSet: {
      version: rules.version,
      sourcePath: rules.sourcePath,
      promptVersion: rules.promptVersion
    },
    llm: { provider: classifier.provider, model: classifier.model },
    filters: {
      campaignNameContains: config.campaignNameContains,
      accountSelectionSource: config.sweepAccounts.source,
      sweepAccountCount: config.sweepAccounts.accounts.length,
      accountAllowlistEntries: config.accountAllowlist.length,
      thirtyDayMode: options.thirtyDayMode,
      ignoreThirtyDayCheck: options.ignoreThirtyDayCheck
    },
    limits: {
      googleFetchConcurrency: config.googleFetchConcurrency,
      llmConcurrency: config.llm.concurrency,
      llmBatchSize: config.llm.batchSize,
      candidateLimitPerOrganization: options.candidateLimitPerOrganization
    }
  };

  let discoveredCount = 0;
  let eligibleCount = 0;
  let selectedCount = 0;
  let organizationsCompleted = 0;
  let summaries: OrganizationSummary[] = [];
  try {
    logger.info({
      ruleVersion: rules.version,
      promptVersion: rules.promptVersion,
      thirtyDayMode: options.thirtyDayMode,
      ...(thirtyDayDateRange === null ? {} : { thirtyDayDateRange })
    }, "Sweep run started");
    await persistence.startRun({
      runId: artifacts.runId,
      executionKey: config.persistence.enabled ? config.persistence.executionKey : null,
      startedAt,
      requestedDate: processingDate,
      requestedDateSource: options.date ? "COMMAND_LINE" : "AUTOMATIC_48_HOURS_BACK",
      processingTimeZone: config.processingTimeZone,
      rules,
      provider: classifier.provider,
      model: classifier.model,
      campaignNameContains: config.campaignNameContains,
      accountSelectionMode: accountSelectionMode(config, options),
      accountAllowlistEntryCount: config.accountAllowlist.length,
      googleFetchConcurrency: config.googleFetchConcurrency,
      llmConcurrency: config.llm.concurrency,
      llmBatchSize: config.llm.batchSize,
      candidateLimitPerAccount: options.candidateLimitPerOrganization,
      googleAdsMutationMode: mutationMode
    });
    await artifacts.write("run-manifest.json", { ...manifestBase, status: "RUNNING" });
    await artifacts.writeText("rules.md", rules.markdown);

    logger.info({
      progressEvent: "organization_discovery_started"
    }, "Discovering enabled Google Ads organizations");
    const discovered = await telemetry.track("ORGANIZATION_DISCOVERY", {}, () =>
      fetchOrganizations(googleAds, config.googleAds.loginCustomerId)
    );
    discoveredCount = discovered.length;
    let eligible = selectEligibleOrganizations(config, discovered, logger);
    eligible = await applyThirtyDayGate(config, options, eligible, logger);
    eligibleCount = eligible.length;
    logger.info({
      progressEvent: "organization_discovery_completed",
      organizationsDiscovered: discoveredCount,
      organizationsEligible: eligible.length
    }, "Google Ads organization discovery completed");
    let selected = eligible;
    if (options.customerId) {
      const customerId = options.customerId.replaceAll("-", "");
      selected = eligible.filter((organization) => organization.customerId === customerId);
      if (selected.length === 0) {
        await persistence.recordDiscovery(discoveredCount, eligible.length, 0);
        throw new PipelineError(
          options.thirtyDayMode
            ? `Customer ${customerId} is not in the sweep accounts master list as an enabled leaf account; 30-day sweeps only run for master-list companies.`
            : `Customer ${customerId} was not found as an enabled leaf account.`,
          { stage: "ORGANIZATION_SELECTION", code: "ORGANIZATION_NOT_FOUND", retryable: false }
        );
      }
    } else if (options.thirtyDayMode && options.allPending) {
      selected = eligible;
    } else if (!options.allOrganizations) {
      selected = eligible.slice(0, options.organizationLimit ?? 1);
    }
    if (selected.length === 0) {
      await persistence.recordDiscovery(discoveredCount, eligible.length, 0);
      throw new PipelineError(
        emptySelectionMessage(config, options),
        { stage: "ORGANIZATION_SELECTION", code: "NO_ORGANIZATIONS_SELECTED", retryable: false }
      );
    }
    selectedCount = selected.length;
    await persistence.recordDiscovery(discoveredCount, eligible.length, selectedCount);
    await artifacts.write("organizations.json", { discovered, eligible, selected });

    // Compile the effective policy bundle for every selected account before any
    // LLM spend. Misconfigured account policy fails the run closed here.
    const accountPolicies = new Map<string, EffectiveAccountPolicy>();
    for (const organization of selected) {
      const accountPolicy = await compileAccountPolicy(rules, organization.customerId, options.accountPolicies);
      accountPolicies.set(organization.customerId, accountPolicy);
      const organizationBasePath = `organizations/${organization.customerId}`;
      await artifacts.write(`${organizationBasePath}/policy-manifest.json`, {
        runId: artifacts.runId,
        generatedAt: new Date().toISOString(),
        ...(accountPolicy.manifest ?? {
          customerId: organization.customerId,
          policyKey: null,
          revision: null,
          baseRuleVersion: rules.version,
          basePromptVersion: rules.promptVersion,
          baseReleaseId: rules.releaseId ?? null,
          dynamicRuleIds: [],
          accountPhraseProtectionCount: 0,
          phraseProtectionsSourcePath: null,
          effectivePolicySha256: null
        })
      });
      if (accountPolicy.manifest && accountPolicy.accountPhraseProtections !== null) {
        await artifacts.writeText(`${organizationBasePath}/rules.md`, accountPolicy.rules.markdown);
        await artifacts.write(
          `${organizationBasePath}/phrase-protections.json`,
          accountPolicy.accountPhraseProtections
        );
      }
      logger.info({
        progressEvent: "account_policy_compiled",
        customerId: organization.customerId,
        policyKey: accountPolicy.manifest?.policyKey ?? null,
        accountPolicyRevision: accountPolicy.manifest?.revision ?? null,
        dynamicRuleCount: accountPolicy.manifest?.dynamicRuleIds.length ?? 0,
        accountPhraseProtectionCount: accountPolicy.manifest?.accountPhraseProtectionCount ?? 0,
        effectivePolicySha256: accountPolicy.manifest?.effectivePolicySha256 ?? null
      }, "Effective account policy compiled");
    }
    logger.info({
      progressEvent: "organization_selection_completed",
      organizationsDiscovered: discoveredCount,
      organizationsEligible: eligible.length,
      organizationsSelected: selectedCount,
      googleFetchConcurrency: config.googleFetchConcurrency,
      llmConcurrency: config.llm.concurrency,
      llmBatchSize: config.llm.batchSize
    }, "Organizations selected; processing will begin");

    const fetchLimit = createLimiter(config.googleFetchConcurrency);
    const llmLimit = createLimiter(config.llm.concurrency);
    summaries = await Promise.all(selected.map((organization, index) => fetchLimit(async () => {
      const organizationRef = safeOrganizationRef(organization.customerId);
      const organizationLogger = logger.child({
        organizationRef,
        organizationPosition: index + 1,
        organizationTotal: selectedCount
      });
      const summary = await processOrganization(
        organization,
        processingDate,
        {
          googleAds,
          classifier,
          artifacts,
          telemetry,
          rules: accountPolicies.get(organization.customerId)?.rules ?? rules,
          batchSize: config.llm.batchSize,
          candidateLimit: options.candidateLimitPerOrganization,
          campaignNameContains: config.campaignNameContains,
          llmLimit,
          logger: organizationLogger,
          persistence,
          ...(negativeKeywordWriter === undefined ? {} : { negativeKeywordWriter }),
          mutationChunkSize: config.googleAdsMutation.chunkSize,
          ...(thirtyDayDateRange === null ? {} : { dateRange: thirtyDayDateRange })
        }
      );
      organizationsCompleted += 1;
      logger.info({
        progressEvent: "sweep_organization_progress",
        organizationRef,
        organizationPosition: index + 1,
        organizationTotal: selectedCount,
        organizationStatus: summary.status,
        organizationsCompleted,
        organizationsRemaining: selectedCount - organizationsCompleted,
        candidates: summary.candidateCount,
        decisions: summary.decisionCount,
        failedBatches: summary.failedBatchCount
      }, "Organization finished; sweep progress updated");
      return summary;
    })));

    if (options.thirtyDayMode) {
      await recordThirtyDayCompletions(config, artifacts.runId, summaries, telemetry, logger);
    }

    const classificationStatus = runStatus(summaries);
    const status = await finalizeRun(
      artifacts,
      telemetry,
      manifestBase,
      summaries,
      discoveredCount,
      eligibleCount,
      selectedCount,
      classificationStatus,
      rules,
      classifier.provider,
      classifier.model,
      services.emailAlerts,
      services.runReportEmail,
      persistence
    );
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
      eligibleCount,
      selectedCount,
      "FAILED",
      rules,
      classifier.provider,
      classifier.model,
      services.emailAlerts,
      services.runReportEmail,
      persistence,
      errorMessage(error)
    );
    logger.error({ status: "FAILED" }, "Sweep run failed");
    return { runId: artifacts.runId, runDirectory: artifacts.runDirectory, status: "FAILED" };
  } finally {
    await persistence.close();
  }
}

export function assertProductionMutationAuthorized(
  config: Pick<AppConfig, "googleAdsMutation">,
  options: Pick<SweepOptions, "productionMutationAuthorized">
): void {
  if (config.googleAdsMutation.mode === "production" && !options.productionMutationAuthorized) {
    throw new Error(
      "Production Google Ads mutation mode also requires the --execute-production-google-ads-mutations command flag."
    );
  }
}

async function finalizeRun(
  artifacts: RunArtifacts,
  telemetry: RunTelemetry,
  manifestBase: Record<string, unknown>,
  summaries: OrganizationSummary[],
  discoveredCount: number,
  eligibleCount: number,
  selectedCount: number,
  status: "SUCCEEDED" | "PARTIAL" | "FAILED",
  rules: RuleSet,
  provider: string,
  model: string,
  emailAlerts?: EmailAlertService,
  runReportEmail?: RunReportEmailService,
  persistence: SweepPersistence = new DisabledSweepPersistence(),
  fatalError?: string
): Promise<"SUCCEEDED" | "PARTIAL" | "FAILED"> {
  const completedAt = new Date().toISOString();
  const telemetrySnapshot = telemetry.snapshot();
  const tokenUsageReport = createRunTokenUsageReport(telemetrySnapshot.tokenUsage, summaries);
  const failed = summaries.filter((summary) => summary.status === "FAILED").length;
  const partial = summaries.filter((summary) => summary.status === "PARTIAL").length;
  const googleAdsMutationPerformed = summaries.some((item) => item.mutation.googleAdsMutationPerformed);
  const summary: Record<string, unknown> = {
    runId: artifacts.runId,
    status,
    readOnly: manifestBase.readOnly,
    googleAdsMutationMode: manifestBase.googleAdsMutationMode,
    googleAdsMutationPerformed,
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
    googleAdsMutationPerformed,
    fatalError: fatalError ?? null
  });
  let workbookWritten = false;
  let reportDelivery: import("../storage/persistence.js").SweepRunFinish["reportDelivery"] = {
    status: "NOT_CONFIGURED",
    messageId: null,
    attemptCount: 0,
    sentAt: null
  };
  try {
    const workbook = await createRunWorkbook({
      runId: artifacts.runId,
      runDirectory: artifacts.runDirectory,
      status,
      startedAt: String(manifestBase.startedAt),
      completedAt,
      provider,
      model,
      rules,
      summaries
    });
    const filename = `negative-keyword-sweeper-${artifacts.runId}.xlsx`;
    await artifacts.writeBuffer(filename, workbook);
    workbookWritten = true;
    const delivery = await runReportEmail?.send({
      runId: artifacts.runId,
      status,
      workbook,
      filename,
      organizationCount: summaries.length,
      inputTokens: telemetrySnapshot.tokenUsage.inputTokens,
      outputTokens: telemetrySnapshot.tokenUsage.outputTokens
    });
    reportDelivery = delivery ?? reportDelivery;
    await artifacts.write("report-email.json", reportDelivery);
  } catch (error) {
    const reportError = telemetry.error(error, {
      stage: "RUN_REPORT_EMAIL",
      code: "RUN_REPORT_DELIVERY_FAILED",
      provider: "resend",
      retryable: true
    });
    const finalStatus = status === "SUCCEEDED" ? "PARTIAL" : status;
    reportDelivery = {
      status: "FAILED",
      messageId: null,
      attemptCount: 0,
      sentAt: null,
      errorCode: reportError.code ?? null,
      errorMessage: reportError.message
    };
    await artifacts.write("report-email.json", { ...reportDelivery, error: reportError });
    const updatedTelemetry = telemetry.snapshot();
    summary.status = finalStatus;
    summary.errorCount = updatedTelemetry.errors.length;
    await artifacts.write("summary.json", summary);
    await artifacts.write("telemetry.json", updatedTelemetry);
    await artifacts.write("run-manifest.json", {
      ...manifestBase,
      status: finalStatus,
      completedAt,
      organizationsDiscovered: discoveredCount,
      organizationsSelected: selectedCount,
      errorCount: updatedTelemetry.errors.length,
      googleAdsMutationPerformed,
      fatalError: fatalError ?? null
    });
    if (workbookWritten) {
      try {
        const updatedWorkbook = await createRunWorkbook({
          runId: artifacts.runId,
          runDirectory: artifacts.runDirectory,
          status: finalStatus,
          startedAt: String(manifestBase.startedAt),
          completedAt,
          provider,
          model,
          rules,
          summaries
        });
        await artifacts.writeBuffer(`negative-keyword-sweeper-${artifacts.runId}.xlsx`, updatedWorkbook);
      } catch {
        // The original workbook remains available even if its status cell could not be refreshed.
      }
    }
    status = finalStatus;
  }
  await emailAlerts?.flush();
  const finalTelemetry = telemetry.snapshot();
  const finalTokenUsageReport = createRunTokenUsageReport(finalTelemetry.tokenUsage, summaries);
  await persistence.finishRun({
    status,
    completedAt,
    organizationsDiscovered: discoveredCount,
    organizationsEligible: eligibleCount,
    organizationsSelected: selectedCount,
    accountSummaries: summaries.map((item) => ({
      customerId: item.customerId,
      status: item.status,
      completedAt,
      rawRowCount: item.rawRowCount,
      candidateCount: item.candidateCount,
      decisionCount: item.decisionCount,
      failedBatchCount: item.failedBatchCount,
      positiveKeywordsFetched: item.positiveKeywords.fetchedCount,
      activePositiveKeywords: item.positiveKeywords.activeCount,
      candidatesProtectedByActivePositiveKeyword: item.positiveKeywords.candidatesProtectedInCampaign,
      keepCount: item.decisions.KEEP ?? 0,
      negativeExactCount: item.decisions.NEGATIVE_EXACT ?? 0,
      errorCount: item.errorCount,
      ...(item.error === undefined ? {} : { error: item.error }),
      tokenUsage: item.tokenUsage,
      mutation: sweepAccountMutationRecord(item.mutation)
    })),
    tokenUsage: finalTelemetry.tokenUsage,
    tokenUsageReconciled: finalTokenUsageReport.reconciliation.reconciled,
    googleAdsMutationPerformed,
    events: finalTelemetry.events,
    errors: finalTelemetry.errors,
    fatalError: fatalError ?? null,
    reportDelivery
  });
  return status;
}

/**
 * Eligibility step 1: the sweep accounts master file replaces ACCOUNT_ALLOWLIST
 * when it loads; otherwise the legacy env allowlist remains the fallback.
 */
export function selectEligibleOrganizations(
  config: AppConfig,
  discovered: Organization[],
  logger: Logger
): Organization[] {
  if (config.sweepAccounts.source !== "master-file") {
    logger.info({
      progressEvent: "account_selection_source",
      source: "env-allowlist",
      expectedFile: config.sweepAccounts.filePath,
      allowlistEntries: config.accountAllowlist.length
    }, "Sweep accounts master file not found; falling back to ACCOUNT_ALLOWLIST filtering");
    return filterOrganizationsByAllowlist(discovered, config.accountAllowlist);
  }
  const eligible = filterOrganizationsBySweepAccounts(discovered, config.sweepAccounts.accounts);
  logger.info({
    progressEvent: "account_selection_source",
    source: "master-file",
    file: config.sweepAccounts.filePath,
    masterListCompanies: config.sweepAccounts.accounts.length,
    matchedEnabledAccounts: eligible.length
  }, "Sweep accounts master file is the active account filter");
  const discoveredIds = new Set(discovered.map((organization) => organization.customerId));
  const notDiscovered = config.sweepAccounts.accounts.filter((account) => !discoveredIds.has(account.customerId));
  if (notDiscovered.length > 0) {
    logger.warn({
      progressEvent: "sweep_accounts_not_discovered",
      accounts: notDiscovered
    }, "Master-list companies not found as enabled leaf accounts under the MCC");
  }
  const unmapped = eligible.filter((organization) =>
    KNOWN_MISSING_CLIENT_ACCOUNT_MAPPINGS.includes(organization.customerId)
  );
  if (unmapped.length > 0) {
    logger.warn({
      progressEvent: "sweep_accounts_missing_db_mapping",
      accounts: unmapped.map((organization) => ({
        customerId: organization.customerId,
        descriptiveName: organization.descriptiveName
      }))
    }, "Selected master-list companies without a known client_accounts mapping; persistence will fail closed for them");
  }
  return eligible;
}

/**
 * Eligibility step 2: standard runs only sweep companies whose initial 30-day
 * sweep is recorded in the state file (unless --ignore-30day-check). 30-day
 * runs without an explicit --customer select the pending companies instead.
 */
export async function applyThirtyDayGate(
  config: AppConfig,
  options: SweepOptions,
  eligible: Organization[],
  logger: Logger
): Promise<Organization[]> {
  if (config.sweepAccounts.source !== "master-file") {
    return eligible;
  }
  const { state, existed } = await loadSweep30DayState(config.sweep30DayStateFile);
  if (!existed) {
    logger.warn({
      progressEvent: "sweep_30day_state_missing",
      stateFile: config.sweep30DayStateFile
    }, "30-day state file is missing; treating every master-list company as not completed");
  }
  if (options.thirtyDayMode) {
    if (options.customerId) return eligible;
    const completed = eligible.filter((organization) => hasSweep30DayCompletion(state, organization.customerId));
    if (completed.length > 0) {
      logger.info({
        progressEvent: "sweep_30day_already_completed",
        accounts: completed.map((organization) => ({
          customerId: organization.customerId,
          descriptiveName: organization.descriptiveName
        }))
      }, "Companies skipped because their 30-day sweep is already recorded");
    }
    return eligible.filter((organization) => !hasSweep30DayCompletion(state, organization.customerId));
  }
  if (options.ignoreThirtyDayCheck) {
    logger.warn({
      progressEvent: "sweep_30day_gate_bypassed"
    }, "--ignore-30day-check is set; running without the 30-day completion gate");
    return eligible;
  }
  const gatedOut = eligible.filter((organization) => !hasSweep30DayCompletion(state, organization.customerId));
  if (gatedOut.length > 0) {
    logger.warn({
      progressEvent: "sweep_30day_gate_skipped",
      stateFile: config.sweep30DayStateFile,
      accounts: gatedOut.map((organization) => ({
        customerId: organization.customerId,
        descriptiveName: organization.descriptiveName
      }))
    }, "Accounts skipped because their initial 30-day sweep is not recorded");
  }
  return eligible.filter((organization) => hasSweep30DayCompletion(state, organization.customerId));
}

function emptySelectionMessage(config: AppConfig, options: SweepOptions): string {
  if (options.thirtyDayMode) {
    return "No master-list companies are pending a 30-day sweep; refusing to report an empty successful run.";
  }
  if (config.sweepAccounts.source === "master-file" && !options.ignoreThirtyDayCheck) {
    return "No eligible master-list companies have a recorded 30-day sweep; refusing to report an empty successful run.";
  }
  if (config.sweepAccounts.source === "master-file" || config.accountAllowlist.length > 0) {
    return "No enabled leaf organizations matched the account selection; refusing to report an empty successful run.";
  }
  return "No enabled leaf organizations were selected; refusing to report an empty successful run.";
}

/** Records one state-file completion per successfully processed account; failures are logged, never fatal. */
async function recordThirtyDayCompletions(
  config: AppConfig,
  runId: string,
  summaries: OrganizationSummary[],
  telemetry: RunTelemetry,
  logger: Logger
): Promise<void> {
  for (const summary of summaries) {
    if (summary.status !== "SUCCEEDED") {
      logger.warn({
        progressEvent: "sweep_30day_completion_not_recorded",
        customerId: summary.customerId,
        organizationStatus: summary.status
      }, "30-day completion not recorded because the account run did not succeed");
      continue;
    }
    try {
      await recordSweep30DayCompletion(config.sweep30DayStateFile, summary.customerId, {
        runId,
        source: "sweep:30day"
      });
      logger.info({
        progressEvent: "sweep_30day_completion_recorded",
        customerId: summary.customerId,
        stateFile: config.sweep30DayStateFile
      }, "30-day sweep completion recorded");
    } catch (error) {
      telemetry.error(error, {
        stage: "SWEEP_30DAY_STATE",
        code: "SWEEP_30DAY_STATE_WRITE_FAILED",
        retryable: true,
        details: { customerId: summary.customerId }
      });
      logger.warn({
        progressEvent: "sweep_30day_completion_record_failed",
        customerId: summary.customerId
      }, "Failed to record the 30-day completion; rerun sweep:30day for this company");
    }
  }
}

function createNegativeKeywordWriter(config: AppConfig): NegativeKeywordWriter | undefined {
  if (config.googleAdsMutation.mode === "disabled") return undefined;
  if (config.googleAdsMutation.mode === "development") return new DevelopmentNegativeKeywordWriter();
  if (config.googleAdsMutation.mode === "validation") {
    return createLiveValidationOnlyNegativeKeywordWriter(config.googleAds);
  }
  return createLiveProductionNegativeKeywordWriter(
    config.googleAds,
    config.googleAdsMutation.productionConfirmed
  );
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

function safeOrganizationRef(customerId: string): string {
  return createHash("sha256").update(customerId).digest("hex").slice(0, 12);
}

function accountSelectionMode(
  config: AppConfig,
  options: SweepOptions
): "all" | "allowlist" | "customer" | "limited" {
  if (options.customerId) return "customer";
  if (config.accountAllowlist.length > 0) return "allowlist";
  if (options.allOrganizations) return "all";
  return "limited";
}
