import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config/env.js";
import { recordSweep30DayCompletion } from "../src/config/sweep-30day-state.js";
import { createLogger } from "../src/observability/logger.js";
import { lookbackDateRangeEndingAt } from "../src/pipeline/process-organization.js";
import { applyThirtyDayGate, type SweepOptions } from "../src/pipeline/run-sweeper.js";
import type { Organization } from "../src/types.js";

const logger = createLogger({ level: "silent" });

function organization(customerId: string, descriptiveName = "Account"): Organization {
  return { customerId, descriptiveName, timeZone: "UTC", currencyCode: "USD" };
}

function configWith(stateFile: string, source: "master-file" | "env-allowlist" = "master-file"): AppConfig {
  return {
    sweepAccounts: {
      source,
      filePath: "accounts.json",
      accounts: source === "master-file"
        ? [
            { customerId: "1111111111", name: "One" },
            { customerId: "2222222222", name: "Two" }
          ]
        : []
    },
    sweep30DayStateFile: stateFile
  } as AppConfig;
}

function optionsWith(overrides: Partial<SweepOptions>): SweepOptions {
  return {
    rootDirectory: ".",
    date: null,
    customerId: null,
    organizationLimit: null,
    allOrganizations: true,
    candidateLimitPerOrganization: null,
    productionMutationAuthorized: false,
    thirtyDayMode: false,
    allPending: false,
    ignoreThirtyDayCheck: false,
    ...overrides
  };
}

async function withTempDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sweeper-30day-gate-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("the 30-day window ends on the requested date and starts 29 days earlier", () => {
  assert.deepEqual(lookbackDateRangeEndingAt("2026-09-15", 30), {
    startDate: "2026-08-17",
    endDate: "2026-09-15"
  });
  assert.deepEqual(lookbackDateRangeEndingAt("2026-03-01", 30), {
    startDate: "2026-01-31",
    endDate: "2026-03-01"
  });
  assert.deepEqual(lookbackDateRangeEndingAt("2026-09-15", 1), {
    startDate: "2026-09-15",
    endDate: "2026-09-15"
  });
  assert.throws(() => lookbackDateRangeEndingAt("2026-13-40", 30), /Invalid date/u);
  assert.throws(() => lookbackDateRangeEndingAt("2026-09-15", 0), /positive integer/u);
});

test("standard runs keep only companies with a recorded 30-day completion", async () => {
  await withTempDirectory(async (directory) => {
    const stateFile = join(directory, "state.json");
    await recordSweep30DayCompletion(stateFile, "1111111111", { runId: "seed" });
    const eligible = [organization("1111111111"), organization("2222222222")];
    const gated = await applyThirtyDayGate(configWith(stateFile), optionsWith({}), eligible, logger);
    assert.deepEqual(gated.map((item) => item.customerId), ["1111111111"]);
  });
});

test("a missing state file gates out every account instead of sweeping all", async () => {
  await withTempDirectory(async (directory) => {
    const eligible = [organization("1111111111"), organization("2222222222")];
    const gated = await applyThirtyDayGate(
      configWith(join(directory, "missing.json")),
      optionsWith({}),
      eligible,
      logger
    );
    assert.deepEqual(gated, []);
  });
});

test("--ignore-30day-check bypasses the completion gate", async () => {
  await withTempDirectory(async (directory) => {
    const eligible = [organization("1111111111"), organization("2222222222")];
    const gated = await applyThirtyDayGate(
      configWith(join(directory, "missing.json")),
      optionsWith({ ignoreThirtyDayCheck: true }),
      eligible,
      logger
    );
    assert.deepEqual(gated.map((item) => item.customerId), ["1111111111", "2222222222"]);
  });
});

test("30-day mode selects pending companies unless a customer is explicit", async () => {
  await withTempDirectory(async (directory) => {
    const stateFile = join(directory, "state.json");
    await recordSweep30DayCompletion(stateFile, "1111111111", { runId: "seed" });
    const eligible = [organization("1111111111"), organization("2222222222")];

    const pending = await applyThirtyDayGate(
      configWith(stateFile),
      optionsWith({ thirtyDayMode: true, allPending: true }),
      eligible,
      logger
    );
    assert.deepEqual(pending.map((item) => item.customerId), ["2222222222"]);

    const explicit = await applyThirtyDayGate(
      configWith(stateFile),
      optionsWith({ thirtyDayMode: true, customerId: "1111111111" }),
      eligible,
      logger
    );
    assert.deepEqual(explicit.map((item) => item.customerId), ["1111111111", "2222222222"]);
  });
});

test("the gate is inactive when the env allowlist fallback is in use", async () => {
  await withTempDirectory(async (directory) => {
    const eligible = [organization("1111111111")];
    const gated = await applyThirtyDayGate(
      configWith(join(directory, "missing.json"), "env-allowlist"),
      optionsWith({}),
      eligible,
      logger
    );
    assert.deepEqual(gated, eligible);
  });
});

test("the committed repository state admits confirmed daily-sweep accounts", async () => {
  const config = {
    sweepAccounts: {
      source: "master-file",
      filePath: "config/sweep-accounts.json",
      accounts: [
        { customerId: "8500809656", name: "3J Collision Center" },
        { customerId: "8402372674", name: "Akins Collision Center" }
      ]
    },
    sweep30DayStateFile: join(process.cwd(), "data", "sweep-30day-state.json")
  } as AppConfig;
  const eligible = [organization("8500809656", "3J Collision Center"), organization("8402372674", "Akins")];
  const gated = await applyThirtyDayGate(config, optionsWith({}), eligible, logger);
  assert.deepEqual(gated.map((item) => item.customerId), ["8500809656", "8402372674"]);
});
