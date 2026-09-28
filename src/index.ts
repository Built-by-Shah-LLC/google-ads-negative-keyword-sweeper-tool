import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  loadConfig,
  loadOperationalConfig,
  type EmailAlertConfig,
  type RunReportEmailConfig
} from "./config/env.js";
import { loadPolicyFromDatabase } from "./config/db-policy.js";
import { EmailAlertService } from "./notifications/email-alerts.js";
import { RunReportEmailService } from "./notifications/run-report-email.js";
import { runSweeper, type SweepOptions } from "./pipeline/run-sweeper.js";
import { serializeError } from "./observability/errors.js";
import { createLogger, type Logger } from "./observability/logger.js";
import type { PilotRunDeclaration } from "./pilot/policy-pilot.js";

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
  const policy = await loadPolicyFromDatabase(config.persistence);
  const rules = policy.rules;
  options.accountPolicies = options.policyMode === "base-only" ? {} : policy.accountPolicies;
  if (options.pilotDeclarationPath !== null) {
    const declaration = JSON.parse(await readFile(resolve(options.pilotDeclarationPath), "utf8")) as PilotRunDeclaration;
    const customerId = options.customerId?.replaceAll("-", "") ?? null;
    if (!declaration.pilotId || !declaration.approver || !["baseline", "policy"].includes(declaration.phase)) throw new Error("Pilot declaration is incomplete.");
    if (declaration.mutationMode !== "disabled") throw new Error("Pilot declarations must explicitly set mutationMode to disabled.");
    if (customerId === null || customerId !== declaration.customerId.replaceAll("-", "")) throw new Error("Pilot runs require the one explicitly declared --customer.");
    if (options.date !== declaration.requestedDate || options.candidateLimitPerOrganization !== declaration.candidateLimit) throw new Error("Pilot date and candidate limit must exactly match the reviewed declaration.");
    if (config.googleAdsMutation.mode !== "disabled" || options.productionMutationAuthorized) throw new Error("Controlled policy pilots require Google Ads mutation mode disabled.");
    if ((options.policyMode === "base-only" ? "baseline" : "policy") !== declaration.phase) throw new Error("Pilot phase and --policy-mode do not match.");
    const configured = policy.accountPolicies[customerId];
    if (declaration.phase === "policy" && (configured?.revision !== declaration.policyRevision || configured.expectedEffectivePolicySha256 !== declaration.effectivePolicyHash)) throw new Error("Pilot declaration policy revision/hash does not match the enabled database policy.");
    options.pilot = { pilotId: declaration.pilotId, phase: declaration.phase, approver: declaration.approver, policyRevision: declaration.policyRevision };
  }

  logger.info({
    scope: options.allOrganizations
      ? { type: "ALL_ORGANIZATIONS" }
      : options.customerId
        ? { type: "CUSTOMER", customerId: options.customerId.replaceAll("-", "") }
        : { type: "LIMITED", organizationLimit: options.organizationLimit ?? 1 },
    provider: config.llm.provider,
    model: config.llm.model,
    googleAdsMutationMode: config.googleAdsMutation.mode,
    readOnly: config.googleAdsMutation.mode !== "production"
  }, "Starting Google Ads classification and negative-keyword pipeline");

  const result = await runSweeper(config, rules, options, { logger, emailAlerts, runReportEmail });
  logger.info({ ...result }, "Pipeline run finished");
  if (result.status === "FAILED") process.exitCode = 1;
}

interface CliSweepOptions extends SweepOptions { pilotDeclarationPath: string | null; }
function parseArguments(argumentsList: string[], rootDirectory: string): CliSweepOptions {
  const options: CliSweepOptions = {
    rootDirectory,
    date: null,
    customerId: null,
    organizationLimit: 1,
    allOrganizations: false,
    candidateLimitPerOrganization: null,
    productionMutationAuthorized: false,
    thirtyDayMode: false,
    allPending: false,
    ignoreThirtyDayCheck: false,
    accountPolicies: {},
    policyMode: "effective",
    pilot: null,
    pilotDeclarationPath: null
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--all-organizations") {
      options.allOrganizations = true;
      options.organizationLimit = null;
      continue;
    }
    if (argument === "--execute-production-google-ads-mutations") {
      options.productionMutationAuthorized = true;
      continue;
    }
    if (argument === "--ignore-30day-check") {
      options.ignoreThirtyDayCheck = true;
      continue;
    }
    if (
      argument === "--date"
      || argument === "--customer"
      || argument === "--organization-limit"
      || argument === "--candidate-limit-per-organization"
      || argument === "--policy-mode"
      || argument === "--pilot-declaration"
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
      } else if (argument === "--candidate-limit-per-organization") {
        const limit = Number(value);
        if (!Number.isSafeInteger(limit) || limit < 1) {
          throw new Error("--candidate-limit-per-organization must be positive.");
        }
        options.candidateLimitPerOrganization = limit;
      } else if (argument === "--policy-mode") {
        if (value !== "base-only" && value !== "effective") throw new Error("--policy-mode must be base-only or effective.");
        options.policyMode = value;
      } else {
        options.pilotDeclarationPath = value;
      }
      continue;
    }
    throw new Error(`Unknown argument '${argument}'.`);
  }
  if (options.customerId && options.allOrganizations) {
    throw new Error("Use either --customer or --all-organizations, not both.");
  }
  if (options.policyMode === "base-only" && options.pilotDeclarationPath === null) throw new Error("Base-only mode is restricted to a reviewed --pilot-declaration.");
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
