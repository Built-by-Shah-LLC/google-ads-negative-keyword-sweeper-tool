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

async function main(
  rootDirectory: string,
  logger: Logger,
  emailAlerts: EmailAlertService,
  runReportEmail: RunReportEmailService
): Promise<void> {
  const options = parseArguments(process.argv.slice(2), rootDirectory);
  const config = await loadConfig(rootDirectory);
  const rules = await loadRuleSet(rootDirectory);

  logger.info({
    scope: options.allOrganizations
      ? { type: "ALL_ORGANIZATIONS" }
      : options.customerId
        ? { type: "CUSTOMER", customerId: options.customerId.replaceAll("-", "") }
        : { type: "LIMITED", organizationLimit: options.organizationLimit ?? 1 },
    provider: config.llm.provider,
    model: config.llm.model,
    readOnly: true
  }, "Starting Google Ads classification pipeline");

  const result = await runSweeper(config, rules, options, { logger, emailAlerts, runReportEmail });
  logger.info({ ...result }, "Pipeline run finished");
  if (result.status === "FAILED") process.exitCode = 1;
}

function parseArguments(argumentsList: string[], rootDirectory: string): SweepOptions {
  const options: SweepOptions = {
    rootDirectory,
    date: null,
    customerId: null,
    organizationLimit: 1,
    allOrganizations: false,
    candidateLimitPerOrganization: null
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--all-organizations") {
      options.allOrganizations = true;
      options.organizationLimit = null;
      continue;
    }
    if (
      argument === "--date"
      || argument === "--customer"
      || argument === "--organization-limit"
      || argument === "--candidate-limit-per-organization"
    ) {
      const value = argumentsList[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--date") {
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("--date must use YYYY-MM-DD.");
        options.date = value;
      } else if (argument === "--customer") {
        if (!/^[\d-]+$/u.test(value)) throw new Error("--customer must be a Google Ads customer ID.");
        options.customerId = value;
      } else if (argument === "--organization-limit") {
        const limit = Number(value);
        if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("--organization-limit must be positive.");
        options.organizationLimit = limit;
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
  if (options.customerId && options.allOrganizations) {
    throw new Error("Use either --customer or --all-organizations, not both.");
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
