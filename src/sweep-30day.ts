import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  loadConfig,
  loadOperationalConfig,
  type EmailAlertConfig,
  type RunReportEmailConfig
} from "./config/env.js";
import { loadRuleSet } from "./config/rule-set.js";
import { EmailAlertService } from "./notifications/email-alerts.js";
import { RunReportEmailService } from "./notifications/run-report-email.js";
import { runSweeper, type SweepOptions } from "./pipeline/run-sweeper.js";
import { serializeError } from "./observability/errors.js";
import { createLogger, type Logger } from "./observability/logger.js";

/**
 * Initial 30-day-lookback sweep for master-list companies. Runs the same
 * pipeline as the regular sweeper but with a 30-day window ending on the
 * requested date, and records each successful account in the 30-day state
 * file. The regular sweeper only runs for companies recorded there.
 *
 * Usage:
 *   npm run sweep:30day -- --customer 8402372674
 *   npm run sweep:30day -- --all-pending
 */
async function main(
  rootDirectory: string,
  logger: Logger,
  emailAlerts: EmailAlertService,
  runReportEmail: RunReportEmailService
): Promise<void> {
  const options = parseArguments(process.argv.slice(2), rootDirectory);
  const config = await loadConfig(rootDirectory);
  if (!config.persistence.enabled) {
    throw new Error("PERSIST_RUNS_TO_DATABASE must be true for keyword sweeper runs.");
  }
  if (config.sweepAccounts.source !== "master-file") {
    throw new Error(
      `30-day sweeps require the sweep accounts master file (expected at ${config.sweepAccounts.filePath}).`
    );
  }
  const rules = await loadRuleSet(rootDirectory);

  logger.info({
    scope: options.customerId
      ? { type: "CUSTOMER", customerId: options.customerId.replaceAll("-", "") }
      : { type: "ALL_PENDING" },
    lookbackDays: 30,
    provider: config.llm.provider,
    model: config.llm.model,
    googleAdsMutationMode: config.googleAdsMutation.mode,
    readOnly: config.googleAdsMutation.mode !== "production"
  }, "Starting 30-day initial sweep");

  const result = await runSweeper(config, rules, options, { logger, emailAlerts, runReportEmail });
  logger.info({ ...result }, "Pipeline run finished");
  if (result.status === "FAILED") process.exitCode = 1;
}

function parseArguments(argumentsList: string[], rootDirectory: string): SweepOptions {
  const options: SweepOptions = {
    rootDirectory,
    date: null,
    customerId: null,
    organizationLimit: null,
    allOrganizations: false,
    candidateLimitPerOrganization: null,
    productionMutationAuthorized: false,
    thirtyDayMode: true,
    allPending: false,
    ignoreThirtyDayCheck: false
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--all-pending") {
      options.allPending = true;
      continue;
    }
    if (argument === "--execute-production-google-ads-mutations") {
      options.productionMutationAuthorized = true;
      continue;
    }
    if (argument === "--date" || argument === "--customer" || argument === "--candidate-limit-per-organization") {
      const value = argumentsList[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--date") {
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("--date must use YYYY-MM-DD.");
        options.date = value;
      } else if (argument === "--customer") {
        if (!/^[\d-]+$/u.test(value)) throw new Error("--customer must be a Google Ads customer ID.");
        options.customerId = value;
      } else {
        const limit = Number(value);
        if (!Number.isSafeInteger(limit) || limit < 1) {
          throw new Error("--candidate-limit-per-organization must be positive.");
        }
        options.candidateLimitPerOrganization = limit;
      }
      continue;
    }
    throw new Error(`Unknown argument '${argument}'.`);
  }
  if (options.customerId && options.allPending) {
    throw new Error("Use either --customer or --all-pending, not both.");
  }
  if (!options.customerId && !options.allPending) {
    throw new Error("30-day sweeps require --customer <id> or --all-pending.");
  }
  return options;
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
