import type { AppConfig } from "./config/env.js";
import type { SweepOptions } from "./pipeline/run-sweeper.js";

/**
 * DEV-9 bounded manual keyword sweeper — argument parsing, range validation,
 * and read-only enforcement. Pure functions only (no I/O, no bootstrap) so the
 * manual entry point stays thin and every guard is unit-testable.
 *
 * The manual sweeper is read-only by construction: it refuses any mutation
 * mode other than disabled, never accepts the production-execution flag, and
 * requires an explicit bounded scope (one company + <= 31-day range, or the
 * all-companies single-date mode designed for a future, currently inactive
 * scheduler).
 */

/** Maximum inclusive day span allowed for one manual bounded range. */
export const MAX_MANUAL_SWEEP_RANGE_DAYS = 31;

export interface ManualSweepCliOptions {
  customerId: string | null;
  allOrganizations: boolean;
  startDate: string | null;
  endDate: string | null;
  date: string | null;
  candidateLimitPerOrganization: number | null;
}

export function parseManualSweepCliArguments(argumentsList: string[]): ManualSweepCliOptions {
  const options: ManualSweepCliOptions = {
    customerId: null,
    allOrganizations: false,
    startDate: null,
    endDate: null,
    date: null,
    candidateLimitPerOrganization: null
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--all-organizations") {
      options.allOrganizations = true;
      continue;
    }
    if (argument === "--execute-production-google-ads-mutations") {
      throw new Error(
        "Manual bounded sweeps are read-only and never accept --execute-production-google-ads-mutations."
      );
    }
    if (
      argument === "--customer"
      || argument === "--start-date"
      || argument === "--end-date"
      || argument === "--date"
      || argument === "--candidate-limit-per-organization"
    ) {
      const value = argumentsList[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--customer") {
        if (!/^[\d-]+$/u.test(value)) throw new Error("--customer must be a Google Ads customer ID.");
        options.customerId = value;
      } else if (argument === "--start-date") {
        options.startDate = assertIsoDate(value, "--start-date");
      } else if (argument === "--end-date") {
        options.endDate = assertIsoDate(value, "--end-date");
      } else if (argument === "--date") {
        options.date = assertIsoDate(value, "--date");
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
  return options;
}

function assertIsoDate(value: string, flag: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error(`${flag} must use YYYY-MM-DD.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${flag} '${value}' is not a real calendar date.`);
  }
  return value;
}

function inclusiveDaySpan(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

/** Current calendar date (YYYY-MM-DD) in the given IANA time zone. */
export function currentDateInTimeZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Validates the manual bounded range: both bounds required, start <= end,
 * span within MAX_MANUAL_SWEEP_RANGE_DAYS, and the end date not in the future
 * relative to the processing time zone.
 */
export function assertBoundedManualDateRange(
  startDate: string | null,
  endDate: string | null,
  processingTimeZone: string,
  now = new Date()
): { startDate: string; endDate: string } {
  if (startDate === null || endDate === null) {
    throw new Error(
      "Manual sweeps require an explicit bounded range: --start-date and --end-date (YYYY-MM-DD)."
    );
  }
  if (startDate > endDate) {
    throw new Error("--start-date must not be after --end-date.");
  }
  const span = inclusiveDaySpan(startDate, endDate);
  if (span > MAX_MANUAL_SWEEP_RANGE_DAYS) {
    throw new Error(
      `Manual sweep date range spans ${span} days; the maximum is ${MAX_MANUAL_SWEEP_RANGE_DAYS} days.`
    );
  }
  const today = currentDateInTimeZone(processingTimeZone, now);
  if (endDate > today) {
    throw new Error(`--end-date ${endDate} is in the future relative to ${processingTimeZone} (${today}).`);
  }
  return { startDate, endDate };
}

/**
 * DEV-9 hard read-only gate: the manual sweeper refuses to run unless the
 * Google Ads mutation mode is disabled. With mode disabled no negative-keyword
 * writer is constructed anywhere in the pipeline, so no mutation request can
 * be built or sent.
 */
export function assertManualSweepReadOnly(
  config: Pick<AppConfig, "googleAdsMutation">
): void {
  if (config.googleAdsMutation.mode !== "disabled") {
    throw new Error(
      `Manual bounded sweeps are read-only: GOOGLE_ADS_MUTATION_MODE must be disabled (or unset), got '${config.googleAdsMutation.mode}'.`
    );
  }
}

export function buildManualSweepOptions(
  cli: ManualSweepCliOptions,
  rootDirectory: string,
  processingTimeZone: string,
  now = new Date()
): SweepOptions {
  if (cli.customerId && cli.allOrganizations) {
    throw new Error("Use either --customer or --all-organizations, not both.");
  }
  if (!cli.customerId && !cli.allOrganizations) {
    throw new Error(
      "Manual sweeps require --customer <id> with --start-date and --end-date, or --all-organizations."
    );
  }
  const base: SweepOptions = {
    rootDirectory,
    date: null,
    customerId: null,
    organizationLimit: null,
    allOrganizations: false,
    candidateLimitPerOrganization: cli.candidateLimitPerOrganization,
    productionMutationAuthorized: false,
    thirtyDayMode: false,
    allPending: false,
    // Deliberate: the manual invocation (operator + explicit scope) is the
    // authorization; the future scheduled mode covers every master-list
    // company. The 30-day baseline gate governs the daily mutating sweeper,
    // not this read-only instance.
    ignoreThirtyDayCheck: true,
    accountPolicies: {}
  };
  if (cli.customerId) {
    if (cli.date !== null) {
      throw new Error("Use --start-date/--end-date with --customer, not --date.");
    }
    const dateRange = assertBoundedManualDateRange(cli.startDate, cli.endDate, processingTimeZone, now);
    return {
      ...base,
      customerId: cli.customerId,
      dateRange,
      // The run's requested date is the range end (inclusive), recorded as
      // an explicit command-line request.
      date: dateRange.endDate
    };
  }
  if (cli.startDate !== null || cli.endDate !== null) {
    throw new Error(
      "--all-organizations processes one date per run (future scheduled mode); --start-date/--end-date require --customer."
    );
  }
  return { ...base, allOrganizations: true, date: cli.date };
}
