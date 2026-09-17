import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  filterOrganizationsBySweepAccounts,
  loadSweepAccountList,
  loadSweepAccountSelection,
  normalizeCustomerId,
  parseSweepAccountList,
  sweepAccountFor
} from "../src/config/sweep-accounts.js";
import {
  hasSweep30DayCompletion,
  loadSweep30DayState,
  parseSweep30DayState,
  recordSweep30DayCompletion
} from "../src/config/sweep-30day-state.js";
import type { Organization } from "../src/types.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function organization(customerId: string, descriptiveName = "Account"): Organization {
  return { customerId, descriptiveName, timeZone: "UTC", currencyCode: "USD" };
}

async function withTempDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sweeper-accounts-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("the committed master list holds 45 unique ten-digit companies", async () => {
  const accounts = await loadSweepAccountList(resolve(repositoryRoot, "config/sweep-accounts.json"));
  assert.equal(accounts.length, 45);
  assert.equal(new Set(accounts.map((account) => account.customerId)).size, 45);
  assert.ok(accounts.every((account) => /^\d{10}$/u.test(account.customerId)));
  assert.equal(accounts[0]?.customerId, "8500809656");
  assert.equal(accounts[0]?.name, "3J Collision Center");
});

test("master list validation rejects invalid shapes", () => {
  assert.throws(() => parseSweepAccountList("not json", "file.json"), /not valid JSON/u);
  assert.throws(() => parseSweepAccountList("[]", "file.json"), /non-empty array/u);
  assert.throws(
    () => parseSweepAccountList(JSON.stringify([{ customerId: "850-080-9656", name: "Dashed" }]), "file.json"),
    /ten digits without dashes/u
  );
  assert.throws(
    () => parseSweepAccountList(JSON.stringify([{ customerId: "123", name: "Short" }]), "file.json"),
    /ten digits/u
  );
  assert.throws(
    () => parseSweepAccountList(JSON.stringify([{ customerId: "1234567890", name: " " }]), "file.json"),
    /non-empty string/u
  );
  assert.throws(
    () => parseSweepAccountList(JSON.stringify([
      { customerId: "1234567890", name: "One" },
      { customerId: "1234567890", name: "Two" }
    ]), "file.json"),
    /duplicates customerId 1234567890/u
  );
});

test("customer IDs match with or without dashes", () => {
  assert.equal(normalizeCustomerId("850-080-9656"), "8500809656");
  const accounts = [
    { customerId: "8500809656", name: "3J Collision Center" },
    { customerId: "8402372674", name: "Akins Collision Center" }
  ];
  const discovered = [
    organization("8500809656", "3J Collision Center"),
    organization("9990001112", "Unrelated Account")
  ];
  assert.deepEqual(
    filterOrganizationsBySweepAccounts(discovered, accounts).map((item) => item.customerId),
    ["8500809656"]
  );
  assert.equal(sweepAccountFor(accounts, "840-237-2674")?.name, "Akins Collision Center");
  assert.equal(sweepAccountFor(accounts, "9990001112"), undefined);
});

test("selection falls back to the env allowlist only when the master file is missing", async () => {
  await withTempDirectory(async (directory) => {
    const missing = await loadSweepAccountSelection(directory, undefined);
    assert.equal(missing.source, "env-allowlist");
    assert.deepEqual(missing.accounts, []);

    await writeFile(join(directory, "accounts.json"), JSON.stringify([
      { customerId: "1234567890", name: "Example" }
    ]), "utf8");
    const loaded = await loadSweepAccountSelection(directory, "accounts.json");
    assert.equal(loaded.source, "master-file");
    assert.equal(loaded.accounts.length, 1);
  });
});

test("a present but invalid master file fails fast instead of falling back", async () => {
  await withTempDirectory(async (directory) => {
    await writeFile(join(directory, "accounts.json"), "{ invalid", "utf8");
    await assert.rejects(() => loadSweepAccountSelection(directory, "accounts.json"), /not valid JSON/u);
  });
});

test("the committed state activates the 15 confirmed daily-sweep accounts", async () => {
  const { state, existed } = await loadSweep30DayState(resolve(repositoryRoot, "data/sweep-30day-state.json"));
  assert.equal(existed, true);
  const confirmedIds = [
    "8500809656",
    "8402372674",
    "2305040084",
    "9459997727",
    "6304919700",
    "1130534333",
    "8820051592",
    "3666014313",
    "7990574090",
    "6592667815",
    "8791302016",
    "7289311819",
    "1618289856",
    "3419276158",
    "4007102747"
  ];
  assert.deepEqual(Object.keys(state.completed).sort(), [...confirmedIds].sort());
  assert.equal(state.completed["8500809656"]?.source, "seeded-manual");
  for (const customerId of confirmedIds.slice(1)) {
    assert.equal(state.completed[customerId]?.source, "manual-server-confirmed");
    assert.equal(hasSweep30DayCompletion(state, customerId), true);
  }
});

test("a missing state file reads as no completions", async () => {
  await withTempDirectory(async (directory) => {
    const { state, existed } = await loadSweep30DayState(join(directory, "state.json"));
    assert.equal(existed, false);
    assert.deepEqual(state.completed, {});
    assert.equal(hasSweep30DayCompletion(state, "8500809656"), false);
  });
});

test("state validation rejects malformed content", () => {
  assert.throws(() => parseSweep30DayState("[]", "state.json"), /must contain an object/u);
  assert.throws(() => parseSweep30DayState(JSON.stringify({ version: 2, completed: {} }), "state.json"), /"version": 1/u);
  assert.throws(
    () => parseSweep30DayState(JSON.stringify({ version: 1, completed: { "123": { completedAt: "x" } } }), "state.json"),
    /ten digits/u
  );
});

test("recording a completion round-trips atomically", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = join(directory, "nested", "state.json");
    const next = await recordSweep30DayCompletion(statePath, "840-237-2674", {
      runId: "run-1",
      completedAt: "2026-09-15T01:00:00.000Z"
    });
    assert.equal(next.completed["8402372674"]?.runId, "run-1");
    assert.equal(next.completed["8402372674"]?.completedAt, "2026-09-15T01:00:00.000Z");

    const reloaded = await loadSweep30DayState(statePath);
    assert.equal(reloaded.existed, true);
    assert.equal(hasSweep30DayCompletion(reloaded.state, "8402372674"), true);

    // A second record preserves earlier completions and leaves no temp file behind.
    await recordSweep30DayCompletion(statePath, "2305040084", { runId: "run-2" });
    const finalState = (await loadSweep30DayState(statePath)).state;
    assert.deepEqual(Object.keys(finalState.completed).sort(), ["2305040084", "8402372674"]);
    await assert.rejects(() => readFile(`${statePath}.tmp`, "utf8"), /ENOENT/u);

    await assert.rejects(
      () => recordSweep30DayCompletion(statePath, "123", { runId: "run-3" }),
      /ten digits/u
    );
  });
});

test("eligibility is the master list intersected with the 30-day state", async () => {
  await withTempDirectory(async (directory) => {
    const accounts = [
      { customerId: "1111111111", name: "One" },
      { customerId: "2222222222", name: "Two" },
      { customerId: "3333333333", name: "Three" }
    ];
    const discovered = [
      organization("1111111111"),
      organization("2222222222"),
      organization("4444444444") // enabled under the MCC but not in the master list
    ];
    const statePath = join(directory, "state.json");
    await recordSweep30DayCompletion(statePath, "1111111111", { runId: "seed" });
    const { state } = await loadSweep30DayState(statePath);

    const eligible = filterOrganizationsBySweepAccounts(discovered, accounts)
      .filter((item) => hasSweep30DayCompletion(state, item.customerId));
    assert.deepEqual(eligible.map((item) => item.customerId), ["1111111111"]);

    const pending = filterOrganizationsBySweepAccounts(discovered, accounts)
      .filter((item) => !hasSweep30DayCompletion(state, item.customerId));
    assert.deepEqual(pending.map((item) => item.customerId), ["2222222222"]);
  });
});
