import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  loadConfig,
  loadOperationalConfig,
  type EmailAlertConfig,
  type RunReportEmailConfig
} from "./config/env.js";
import { loadPolicyFromDatabase } from "./config/db-policy.js";
import { EmailAlertService } from "./notifications/email-alerts.js";
import { RunReportEmailService } from "./notifications/run-report-email.js";
import {
  assertManualSweepReadOnly,
  buildManualSweepOptions,
  parseManualSweepCliArguments
} from "./manual-sweep-options.js";
import { runSweeper } from "./pipeline/run-sweeper.js";
import { serializeError } from "./observability/errors.js";
import { createLogger, type Logger } from "./observability/logger.js";

/**
 * DEV-9 bounded manual keyword sweeper (internal-only, read-only).
 *
 * This is a SEPARATE entry point and a SEPARATE Cloud Run job from the daily
 * sweeper. It never mutates Google Ads: it refuses to start unless
 * GOOGLE_ADS_MUTATION_MODE is disabled (or unset), and it never accepts the
 * --execute-production-google-ads-mutations flag. With mutation mode disabled
 * no writer is constructed and the Google Ads client is read-only by
 * assertion, so a manual run only reads Google Ads, classifies search terms,
 * and persists read-only run/candidate/decision evidence to the shared
 * database.
 *
 * Two scopes are supported:
 *
 *   Manual single-company bounded range (the only deployed invocation today):
 *     npm run sweep:manual -- --customer 8402372674 --start-date 2026-09-01 --end-date 2026-09-15
 *
 *   All-companies single date (designed for a FUTURE daily scheduler that is
 *   deliberately NOT created; activating it requires a separate approved
 *   decision and action-time approval):
 *     npm run sweep:manual -- --all-organizations [--date 2026-09-27]
 *
 * Both scopes keep the standard campaign-name filter (CAMPAIGN_NAME_CONTAINS,
 * default "Built by Shah") and the sweep accounts master file. The 30-day
 * completion gate is deliberately bypassed here: a manual invocation naming a
 * company and date range is itself the explicit authorization, and the future
 * scheduled mode is defined to cover every master-list company under the MCC.
 */
async function main(
  rootDirectory: string,
  logger: Logger,
  emailAlerts: EmailAlertService,
  runReportEmail: RunReportEmailService
): Promise<void> {
  const cli = parseManualSweepCliArguments(process.argv.slice(2));
  const config = await loadConfig(rootDirectory);
  assertManualSweepReadOnly(config);
  if (!config.persistence.enabled) {
    throw new Error("PERSIST_RUNS_TO_DATABASE must be true for keyword sweeper runs.");
  }
  if (config.sweepAccounts.source !== "master-file") {
    throw new Error(
      `Manual bounded sweeps require the sweep accounts master file (expected at ${config.sweepAccounts.filePath}).`
    );
  }
  const options = buildManualSweepOptions(cli, rootDirectory, config.processingTimeZone);
  const policy = await loadPolicyFromDatabase(config.persistence);
  options.accountPolicies = policy.accountPolicies;

  logger.info({
    scope: options.customerId
      ? { type: "CUSTOMER", customerId: options.customerId.replaceAll("-", ""), dateRange: options.dateRange }
      : { type: "ALL_ORGANIZATIONS", date: options.date ?? "AUTOMATIC_48_HOURS_BACK" },
    provider: config.llm.provider,
    model: config.llm.model,
    campaignNameContains: config.campaignNameContains,
    googleAdsMutationMode: config.googleAdsMutation.mode,
    readOnly: true,
    mutationWriterConstructed: false
  }, "Starting manual bounded read-only sweep");

  const result = await runSweeper(config, policy.rules, options, { logger, emailAlerts, runReportEmail });
  logger.info({ ...result }, "Pipeline run finished");
  if (result.status === "FAILED") process.exitCode = 1;
}

async function bootstrap(): Promise<void> {
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let logger = createLogger();
  const disabledAlerts: EmailAlertConfig = {
    enabled: false,
    handledErrorCodes: [],
    handledErrorStages: []
  };
  let emailAlerts = new EmailAlertService(disabledAlerts, logger);
  const disabledRunReports: RunReportEmailConfig = { enabled: false };
  let runReportEmail = new RunReportEmailService(disabledRunReports, logger);
  try {
    const operationalConfig = await loadOperationalConfig(rootDirectory);
    logger = createLogger(operationalConfig.logging);
    emailAlerts = new EmailAlertService(operationalConfig.emailAlerts, logger);
    runReportEmail = new RunReportEmailService(operationalConfig.runReportEmail, logger);
    await main(rootDirectory, logger, emailAlerts, runReportEmail);
  } catch (error) {
    const serialized = serializeError(error, {
      stage: "BOOTSTRAP",
      code: "UNHANDLED_PIPELINE_ERROR",
      retryable: false
    });
    logger.fatal({ pipelineError: serialized }, "Unhandled pipeline error");
    await emailAlerts.notifyUnhandled(serialized);
    process.exitCode = 1;
  } finally {
    await emailAlerts.flush();
    emailAlerts.close();
  }
}

void bootstrap();
