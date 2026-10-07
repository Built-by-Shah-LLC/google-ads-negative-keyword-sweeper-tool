import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config/env.js";
import {
  assertBoundedManualDateRange,
  assertManualSweepReadOnly,
  buildManualSweepOptions,
  currentDateInTimeZone,
  MAX_MANUAL_SWEEP_RANGE_DAYS,
  parseManualSweepCliArguments
} from "../src/manual-sweep-options.js";
import { assertValidDateRange, resolveActiveDateRange } from "../src/pipeline/run-sweeper.js";

const TIME_ZONE = "Europe/Moscow";
const NOW = new Date("2026-09-29T12:00:00Z");
const TODAY = currentDateInTimeZone(TIME_ZONE, NOW);

function configWithMutationMode(mode: string): Pick<AppConfig, "googleAdsMutation"> {
  return { googleAdsMutation: { mode, chunkSize: 500 } } as Pick<AppConfig, "googleAdsMutation">;
}

test("manual sweep parses a customer with a bounded date range", () => {
  const cli = parseManualSweepCliArguments([
    "--customer", "8402372674",
    "--start-date", "2026-09-01",
    "--end-date", "2026-09-15"
  ]);
  assert.equal(cli.customerId, "8402372674");
  assert.equal(cli.startDate, "2026-09-01");
  assert.equal(cli.endDate, "2026-09-15");
  const options = buildManualSweepOptions(cli, ".", TIME_ZONE, NOW);
  assert.equal(options.customerId, "8402372674");
  assert.deepEqual(options.dateRange, { startDate: "2026-09-01", endDate: "2026-09-15" });
  assert.equal(options.date, "2026-09-15");
  assert.equal(options.allOrganizations, false);
  assert.equal(options.thirtyDayMode, false);
  assert.equal(options.productionMutationAuthorized, false);
  assert.equal(options.ignoreThirtyDayCheck, true);
  assert.equal(options.triggerKind, "manual");
  assert.equal(options.requestedDateSource, "COMMAND_LINE");
});

test("browser-started manual sweeps retain their semantic origin", () => {
  const cli = parseManualSweepCliArguments([
    "--customer", "8402372674",
    "--start-date", "2026-09-01",
    "--end-date", "2026-09-15",
    "--request-source", "built-ads-manager-ui"
  ]);
  const options = buildManualSweepOptions(cli, ".", TIME_ZONE, NOW);
  assert.equal(options.triggerKind, "manual");
  assert.equal(options.requestedDateSource, "BUILT_ADS_MANAGER_UI");
});

test("manual sweep requires an explicit scope", () => {
  assert.throws(
    () => buildManualSweepOptions(parseManualSweepCliArguments([]), ".", TIME_ZONE, NOW),
    /require --customer/
  );
});

test("manual sweep rejects a customer without both date bounds", () => {
  const onlyStart = parseManualSweepCliArguments(["--customer", "8402372674", "--start-date", "2026-09-01"]);
  assert.throws(() => buildManualSweepOptions(onlyStart, ".", TIME_ZONE, NOW), /--start-date and --end-date/);
  const onlyEnd = parseManualSweepCliArguments(["--customer", "8402372674", "--end-date", "2026-09-01"]);
  assert.throws(() => buildManualSweepOptions(onlyEnd, ".", TIME_ZONE, NOW), /--start-date and --end-date/);
});

test("manual sweep rejects combining --customer with --all-organizations", () => {
  const cli = parseManualSweepCliArguments([
    "--customer", "8402372674",
    "--all-organizations",
    "--start-date", "2026-09-01",
    "--end-date", "2026-09-02"
  ]);
  assert.throws(() => buildManualSweepOptions(cli, ".", TIME_ZONE, NOW), /not both/);
});

test("manual sweep rejects --date in customer range mode", () => {
  const cli = parseManualSweepCliArguments([
    "--customer", "8402372674",
    "--date", "2026-09-10",
    "--start-date", "2026-09-01",
    "--end-date", "2026-09-02"
  ]);
  assert.throws(() => buildManualSweepOptions(cli, ".", TIME_ZONE, NOW), /not --date/);
});

test("manual sweep rejects malformed and impossible dates", () => {
  assert.throws(() => parseManualSweepCliArguments(["--start-date", "2026-9-1"]), /YYYY-MM-DD/);
  assert.throws(() => parseManualSweepCliArguments(["--start-date", "2026-02-30"]), /not a real calendar date/);
  assert.throws(() => parseManualSweepCliArguments(["--customer", "abc123"]), /customer ID/);
  assert.throws(() => parseManualSweepCliArguments(["--customer"]), /requires a value/);
});

test("manual sweep rejects an inverted date range", () => {
  assert.throws(
    () => assertBoundedManualDateRange("2026-09-10", "2026-09-01", TIME_ZONE, NOW),
    /must not be after/
  );
});

test("manual sweep enforces the maximum bounded range", () => {
  const within = assertBoundedManualDateRange("2026-08-30", "2026-09-29", TIME_ZONE, NOW);
  assert.equal(within.startDate, "2026-08-30");
  assert.throws(
    () => assertBoundedManualDateRange("2026-08-01", "2026-09-29", TIME_ZONE, NOW),
    new RegExp(`maximum is ${MAX_MANUAL_SWEEP_RANGE_DAYS} days`)
  );
});

test("manual sweep rejects a future end date", () => {
  const tomorrow = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  assert.throws(
    () => assertBoundedManualDateRange(TODAY, tomorrow, TIME_ZONE, NOW),
    /in the future/
  );
});

test("manual sweep never accepts the production execution flag", () => {
  assert.throws(
    () => parseManualSweepCliArguments(["--execute-production-google-ads-mutations"]),
    /read-only/
  );
});

test("manual sweep rejects unknown arguments", () => {
  assert.throws(() => parseManualSweepCliArguments(["--organization-limit", "3"]), /Unknown argument/);
  assert.throws(() => parseManualSweepCliArguments(["--ignore-30day-check"]), /Unknown argument/);
});

test("manual sweep rejects invalid or scheduled use of the UI request source", () => {
  assert.throws(
    () => parseManualSweepCliArguments(["--request-source", "browser"]),
    /must be built-ads-manager-ui/
  );
  const cli = parseManualSweepCliArguments(["--all-organizations", "--request-source", "built-ads-manager-ui"]);
  assert.throws(() => buildManualSweepOptions(cli, ".", TIME_ZONE, NOW), /requires --customer/);
});

test("manual sweep validates the candidate limit", () => {
  assert.throws(
    () => parseManualSweepCliArguments(["--candidate-limit-per-organization", "0"]),
    /must be positive/
  );
  const cli = parseManualSweepCliArguments([
    "--customer", "8402372674",
    "--start-date", "2026-09-01",
    "--end-date", "2026-09-02",
    "--candidate-limit-per-organization", "25"
  ]);
  assert.equal(cli.candidateLimitPerOrganization, 25);
});

test("all-organizations mode uses a single date and forbids explicit ranges", () => {
  const cli = parseManualSweepCliArguments(["--all-organizations", "--date", "2026-09-27"]);
  const options = buildManualSweepOptions(cli, ".", TIME_ZONE, NOW);
  assert.equal(options.allOrganizations, true);
  assert.equal(options.date, "2026-09-27");
  assert.equal(options.dateRange ?? null, null);
  assert.equal(options.customerId, null);
  assert.equal(options.triggerKind, "scheduled");
  assert.equal(options.requestedDateSource, "COMMAND_LINE");

  const withRange = parseManualSweepCliArguments(["--all-organizations", "--start-date", "2026-09-01"]);
  assert.throws(() => buildManualSweepOptions(withRange, ".", TIME_ZONE, NOW), /require --customer/);
});

test("all-organizations mode defaults to the automatic 48-hours-back date", () => {
  const options = buildManualSweepOptions(parseManualSweepCliArguments(["--all-organizations"]), ".", TIME_ZONE, NOW);
  assert.equal(options.allOrganizations, true);
  assert.equal(options.date, null);
  assert.equal(options.triggerKind, "scheduled");
  assert.equal(options.requestedDateSource, "AUTOMATIC_48_HOURS_BACK");
});

test("manual sweeps refuse every mutation mode except disabled", () => {
  assert.doesNotThrow(() => assertManualSweepReadOnly(configWithMutationMode("disabled")));
  for (const mode of ["development", "validation", "production"]) {
    assert.throws(() => assertManualSweepReadOnly(configWithMutationMode(mode)), /read-only/);
  }
});

test("explicit date ranges are validated and win over no range", () => {
  const range = { startDate: "2026-09-01", endDate: "2026-09-15" };
  assert.deepEqual(resolveActiveDateRange({ thirtyDayMode: false, dateRange: range }, null), range);
  assert.equal(resolveActiveDateRange({ thirtyDayMode: false, dateRange: null }, null), null);
  assert.throws(
    () => resolveActiveDateRange({ thirtyDayMode: true, dateRange: range }, range),
    /cannot be combined with 30-day mode/
  );
});

test("explicit date range validation rejects bad bounds", () => {
  assert.throws(() => assertValidDateRange({ startDate: "2026-9-1", endDate: "2026-09-02" }), /YYYY-MM-DD/);
  assert.throws(() => assertValidDateRange({ startDate: "2026-09-01", endDate: "2026-13-01" }), /YYYY-MM-DD|real calendar date/);
  assert.throws(() => assertValidDateRange({ startDate: "2026-09-10", endDate: "2026-09-01" }), /must not be after/);
  assert.doesNotThrow(() => assertValidDateRange({ startDate: "2026-09-01", endDate: "2026-09-01" }));
});

test("30-day mode still resolves its lookback range when no explicit range is set", () => {
  const thirtyDay = { startDate: "2026-08-17", endDate: "2026-09-15" };
  assert.deepEqual(resolveActiveDateRange({ thirtyDayMode: true, dateRange: null }, thirtyDay), thirtyDay);
});
