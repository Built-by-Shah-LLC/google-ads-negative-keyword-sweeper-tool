import assert from "node:assert/strict";
import test from "node:test";
import { DevelopmentNegativeKeywordWriter } from "../src/google-ads/negative-keyword-writer.dev.js";
import {
  ProductionNegativeKeywordWriter,
  type GoogleAdsMutationHttpTransport
} from "../src/google-ads/negative-keyword-writer.prod.js";
import { ValidationOnlyNegativeKeywordWriter } from "../src/google-ads/negative-keyword-writer.validation.js";
import {
  applyNegativeExactDecisions,
  createNegativeKeywordOperations,
  type NegativeKeywordCreate,
  type NegativeKeywordWriter
} from "../src/google-ads/negative-keyword-writer.js";
import type { ClassificationCandidate, ClassificationDecision } from "../src/types.js";
import { assertProductionMutationAuthorized } from "../src/pipeline/run-sweeper.js";

function candidate(overrides: Partial<ClassificationCandidate> = {}): ClassificationCandidate {
  return {
    itemId: "item-1",
    customerId: "1234567890",
    startDate: "2026-09-08",
    endDate: "2026-09-08",
    channel: "SEARCH",
    campaignId: "100",
    campaignName: "Built by Shah - Search",
    adGroupId: "200",
    adGroupName: "General",
    searchTerm: "free collision repair course",
    targetingStatus: "NONE",
    matchedKeyword: "collision repair",
    matchedKeywordMatchType: "BROAD",
    impressions: 1,
    clicks: 0,
    costMicros: 0,
    conversions: 0,
    conversionValue: 0,
    ...overrides
  };
}

function negative(item: ClassificationCandidate): ClassificationDecision {
  return {
    itemId: item.itemId,
    decision: "NEGATIVE_EXACT",
    negativeText: item.searchTerm,
    ruleIds: ["POL-FREE-NEGATIVE"],
    reason: "Free-service intent",
    confidence: 0.99
  };
}

test("development writer records deterministic mock writes without any HTTP dependency", async () => {
  const writer = new DevelopmentNegativeKeywordWriter();
  const operation: NegativeKeywordCreate = {
    operationId: "op-1",
    customerId: "1234567890",
    campaignId: "100",
    negativeText: "free collision repair course",
    sourceItemIds: ["item-1"]
  };
  const first = await writer.writeChunk("1234567890", [operation]);
  const second = await writer.writeChunk("1234567890", [operation]);

  assert.deepEqual(first, second);
  assert.equal(first.results[0]?.status, "MOCKED");
  assert.match(first.results[0]?.resourceName ?? "", /^mock:\/\/google-ads\//u);
});

test("validation writer sends one validateOnly request and has no mutation follow-up", async () => {
  const calls: Array<{ path: string; body: Record<string, any> }> = [];
  const transport: GoogleAdsMutationHttpTransport = {
    async post(path, body) {
      calls.push({ path, body });
      return { ok: true, status: 200, requestId: "validation-only-request", payload: {} };
    }
  };
  const operation = createNegativeKeywordOperations(
    "1234567890",
    [candidate()],
    [negative(candidate())]
  ).operations;

  const result = await new ValidationOnlyNegativeKeywordWriter(transport)
    .writeChunk("1234567890", operation);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, "/customers/1234567890/campaignCriteria:mutate");
  assert.equal(calls[0]?.body.validateOnly, true);
  assert.equal(calls[0]?.body.partialFailure, true);
  assert.equal(result.results[0]?.status, "VALIDATED");
  assert.equal(result.results[0]?.resourceName, null);
});

test("validation orchestration reports validated without a post-mutation read", async () => {
  const item = candidate();
  let reads = 0;
  const summary = await applyNegativeExactDecisions({
    googleAds: {
      async searchStream() {
        reads += 1;
        return [];
      }
    },
    writer: new ValidationOnlyNegativeKeywordWriter({
      async post() {
        return { ok: true, status: 200, requestId: "validation-only", payload: {} };
      }
    }),
    customerId: item.customerId,
    candidates: [item],
    decisions: [negative(item)],
    chunkSize: 500
  });

  assert.equal(reads, 1);
  assert.equal(summary.status, "VALIDATED");
  assert.equal(summary.validatedCount, 1);
  assert.equal(summary.appliedCount, 0);
  assert.equal(summary.verifiedCount, 0);
  assert.equal(summary.googleAdsMutationPerformed, false);
});

test("mutation preparation deduplicates normalized campaign terms and skips existing exact negatives", async () => {
  const first = candidate();
  const duplicate = candidate({
    itemId: "item-2",
    adGroupId: "201",
    searchTerm: " Free  Collision Repair Course "
  });
  const existing = candidate({ itemId: "item-3", campaignId: "101", searchTerm: "competitor shop" });
  let searchCalls = 0;
  const googleAds = {
    async searchStream() {
      searchCalls += 1;
      return [{
        campaign: { id: "101" },
        campaignCriterion: { negative: true, keyword: { text: "Competitor Shop", matchType: "EXACT" } }
      }];
    }
  };

  const summary = await applyNegativeExactDecisions({
    googleAds,
    writer: new DevelopmentNegativeKeywordWriter(),
    customerId: "123-456-7890",
    candidates: [first, duplicate, existing],
    decisions: [negative(first), negative(duplicate), negative(existing)],
    chunkSize: 500
  });

  assert.equal(searchCalls, 1);
  assert.equal(summary.status, "MOCKED");
  assert.equal(summary.proposedCount, 2);
  assert.equal(summary.duplicateDecisionCount, 1);
  assert.equal(summary.existingCount, 1);
  assert.equal(summary.attemptedCount, 1);
  assert.equal(summary.mockedCount, 1);
  assert.equal(summary.appliedCount, 0);
  assert.equal(summary.googleAdsMutationPerformed, false);
});

test("production writer validates first, submits only valid operations, and uses exact campaign criteria", async () => {
  const calls: Array<{ path: string; body: Record<string, any> }> = [];
  const transport: GoogleAdsMutationHttpTransport = {
    async post(path, body) {
      calls.push({ path, body });
      if (body.validateOnly === true) {
        return {
          ok: true,
          status: 200,
          requestId: "validation-request",
          payload: {
            partialFailureError: {
              details: [{ errors: [{
                message: "Rejected test operation",
                location: { fieldPathElements: [{ fieldName: "operations", index: 1 }] }
              }] }]
            }
          }
        };
      }
      return {
        ok: true,
        status: 200,
        requestId: "mutation-request",
        payload: { results: [{ resourceName: "customers/1234567890/campaignCriteria/100~999" }] }
      };
    }
  };
  const items = [candidate(), candidate({ itemId: "item-2", campaignId: "101", searchTerm: "bad term" })];
  const operations = createNegativeKeywordOperations(
    "1234567890",
    items,
    items.map(negative)
  ).operations;
  const writer = new ProductionNegativeKeywordWriter(true, transport);

  const result = await writer.writeChunk("1234567890", operations);

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.path, "/customers/1234567890/campaignCriteria:mutate");
  assert.equal(calls[0]?.body.validateOnly, true);
  assert.equal(calls[1]?.body.validateOnly, false);
  assert.equal(calls[1]?.body.partialFailure, true);
  assert.equal(calls[1]?.body.operations.length, 1);
  const create = calls[1]?.body.operations[0].create;
  assert.equal(create.campaign, `customers/1234567890/campaigns/${operations[0]?.campaignId}`);
  assert.equal(create.negative, true);
  assert.deepEqual(create.keyword, { text: operations[0]?.negativeText, matchType: "EXACT" });
  assert.equal(result.results[0]?.status, "APPLIED");
  assert.equal(result.results[1]?.status, "FAILED");
  assert.equal(result.requestId, "mutation-request");
});

test("production writer cannot run unless explicitly armed", async () => {
  let called = false;
  const transport: GoogleAdsMutationHttpTransport = {
    async post() {
      called = true;
      throw new Error("should not be called");
    }
  };
  const operation = createNegativeKeywordOperations(
    "1234567890",
    [candidate()],
    [negative(candidate())]
  ).operations;
  await assert.rejects(
    () => new ProductionNegativeKeywordWriter(false, transport).writeChunk("1234567890", operation),
    /not armed/u
  );
  assert.equal(called, false);
});

test("production mode also requires an explicit per-invocation command authorization", () => {
  const config = {
    googleAdsMutation: { mode: "production" as const, chunkSize: 500, productionConfirmed: true as const }
  };
  assert.throws(
    () => assertProductionMutationAuthorized(config, { productionMutationAuthorized: false }),
    /--execute-production-google-ads-mutations/u
  );
  assert.doesNotThrow(
    () => assertProductionMutationAuthorized(config, { productionMutationAuthorized: true })
  );
  assert.doesNotThrow(() => assertProductionMutationAuthorized(
    { googleAdsMutation: { mode: "development", chunkSize: 500 } },
    { productionMutationAuthorized: false }
  ));
});

test("production orchestration verifies applied writes through a read before reporting success", async () => {
  const item = candidate();
  let reads = 0;
  const googleAds = {
    async searchStream() {
      reads += 1;
      return reads === 1 ? [] : [{
        campaign: { id: item.campaignId },
        campaignCriterion: { negative: true, keyword: { text: item.searchTerm, matchType: "EXACT" } }
      }];
    }
  };
  const writer: NegativeKeywordWriter = {
    mode: "production",
    async writeChunk(_customerId, operations) {
      return {
        requestId: "fake-request",
        results: operations.map((operation) => ({
          ...operation,
          status: "APPLIED" as const,
          resourceName: `customers/1234567890/campaignCriteria/${operation.campaignId}~999`,
          error: null
        }))
      };
    }
  };
  const summary = await applyNegativeExactDecisions({
    googleAds,
    writer,
    customerId: item.customerId,
    candidates: [item],
    decisions: [negative(item)],
    chunkSize: 500
  });

  assert.equal(reads, 2);
  assert.equal(summary.status, "APPLIED");
  assert.equal(summary.appliedCount, 1);
  assert.equal(summary.verifiedCount, 1);
  assert.equal(summary.googleAdsMutationPerformed, true);
});

test("an ambiguous production write is read back once and never blindly retried", async () => {
  const item = candidate();
  let reads = 0;
  let writes = 0;
  const googleAds = {
    async searchStream() {
      reads += 1;
      return reads === 1 ? [] : [{
        campaign: { id: item.campaignId },
        campaignCriterion: { negative: true, keyword: { text: item.searchTerm, matchType: "EXACT" } }
      }];
    }
  };
  const writer: NegativeKeywordWriter = {
    mode: "production",
    async writeChunk() {
      writes += 1;
      throw new Error("simulated connection loss after submit");
    }
  };

  const summary = await applyNegativeExactDecisions({
    googleAds,
    writer,
    customerId: item.customerId,
    candidates: [item],
    decisions: [negative(item)],
    chunkSize: 500
  });

  assert.equal(writes, 1);
  assert.equal(reads, 2);
  assert.equal(summary.status, "APPLIED");
  assert.equal(summary.appliedCount, 1);
  assert.equal(summary.verifiedCount, 1);
  assert.equal(summary.outcomeAmbiguous, false);
});
