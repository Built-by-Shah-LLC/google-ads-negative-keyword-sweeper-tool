import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config/env.js";
import { loadRuleSet } from "../src/config/rule-set.js";
import { runSweeper } from "../src/pipeline/run-sweeper.js";
import { DisabledSweepPersistence } from "../src/storage/persistence.js";

const CUSTOMER_ID = "8500809656";
const DATE = "2026-09-13";
const CANDIDATE_LIMIT = 5;

const rootDirectory = resolve(process.cwd());
const loaded = await loadConfig(rootDirectory);
const config = {
  ...loaded,
  googleAdsMutation: {
    mode: "disabled" as const,
    chunkSize: loaded.googleAdsMutation.chunkSize,
  },
  persistence: {
    enabled: false as const,
    maxPayloadBytes: loaded.persistence.maxPayloadBytes,
  },
};
const rules = await loadRuleSet(rootDirectory);

const result = await runSweeper(config, rules, {
  rootDirectory,
  date: DATE,
  customerId: CUSTOMER_ID,
  organizationLimit: null,
  allOrganizations: false,
  candidateLimitPerOrganization: CANDIDATE_LIMIT,
  productionMutationAuthorized: false,
  thirtyDayMode: false,
  allPending: false,
  ignoreThirtyDayCheck: true,
  accountPolicies: {},
}, {
  // This explicit no-op persistence seam guarantees this validation cannot
  // touch Cloud SQL even when the local environment normally enables it.
  persistence: new DisabledSweepPersistence(),
  // Deliberately omit both email services and every mutation writer.
});

const summary = JSON.parse(await readFile(join(result.runDirectory, "summary.json"), "utf8")) as {
  status: string;
  readOnly: boolean;
  googleAdsMutationMode: string;
  googleAdsMutationPerformed: boolean;
  organizations: Array<{
    customerId: string;
    candidateCount: number;
    decisionCount: number;
    positiveKeywords: {
      fetchedCount: number;
      activeCount: number;
      candidatesWithAnyExactMatch: number;
      candidatesProtectedInCampaign: number;
    };
    mutation: {
      mode: string;
      status: string;
      googleAdsMutationPerformed: boolean;
    };
  }>;
};
const reportDelivery = JSON.parse(
  await readFile(join(result.runDirectory, "report-email.json"), "utf8"),
) as { status: string; attemptCount: number };
const positiveInventory = JSON.parse(
  await readFile(
    join(result.runDirectory, "organizations", CUSTOMER_ID, "positive-keywords.json"),
    "utf8",
  ),
) as { fetchedCount: number; activeCount: number; criteria: unknown[] };

assert.notEqual(result.status, "FAILED", "The bounded validation run failed.");
assert.equal(summary.readOnly, true);
assert.equal(summary.googleAdsMutationMode, "disabled");
assert.equal(summary.googleAdsMutationPerformed, false);
assert.equal(summary.organizations.length, 1);
assert.equal(summary.organizations[0]?.customerId, CUSTOMER_ID);
assert.ok((summary.organizations[0]?.candidateCount ?? 0) <= CANDIDATE_LIMIT);
assert.equal(summary.organizations[0]?.mutation.mode, "disabled");
assert.equal(summary.organizations[0]?.mutation.googleAdsMutationPerformed, false);
assert.equal(reportDelivery.status, "NOT_CONFIGURED");
assert.equal(reportDelivery.attemptCount, 0);
assert.equal(positiveInventory.criteria.length, positiveInventory.fetchedCount);

process.stdout.write(`${JSON.stringify({
  runId: result.runId,
  runDirectory: result.runDirectory,
  status: result.status,
  customerId: CUSTOMER_ID,
  date: DATE,
  candidateLimit: CANDIDATE_LIMIT,
  candidateCount: summary.organizations[0]?.candidateCount,
  decisionCount: summary.organizations[0]?.decisionCount,
  positiveKeywords: summary.organizations[0]?.positiveKeywords,
  mutation: summary.organizations[0]?.mutation,
  persistence: "DISABLED",
  email: reportDelivery,
}, null, 2)}\n`);
