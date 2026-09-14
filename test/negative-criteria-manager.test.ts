import assert from "node:assert/strict";
import test from "node:test";
import {
  accountNegativeCreateRequest,
  accountNegativeCriteriaQuery,
  accountNegativeRemoveRequest,
  campaignNegativeCreateRequest,
  campaignNegativeCriteriaQuery,
  campaignNegativeRemoveRequest,
  NegativeCriteriaManager,
  normalizeMatchType
} from "../src/google-ads/negative-criteria-manager.js";
import type { GoogleAdsMutationHttpTransport } from "../src/google-ads/negative-keyword-writer.prod.js";

function okTransport(calls: Array<{ path: string; body: Record<string, any> }>, mutationResults: unknown[] = []): GoogleAdsMutationHttpTransport {
  return {
    async post(path, body) {
      calls.push({ path, body });
      if (body.validateOnly === true) {
        return { ok: true, status: 200, requestId: "validation-request", payload: {} };
      }
      return {
        ok: true,
        status: 200,
        requestId: "mutation-request",
        payload: { results: mutationResults }
      };
    }
  };
}

const noRows = async () => [] as Record<string, unknown>[];

test("campaign create request builds campaignCriteria:mutate create operations", () => {
  const request = campaignNegativeCreateRequest("123-456-7890", "555", [
    { text: "free quote", matchType: "EXACT" },
    { text: "cheap jobs", matchType: "PHRASE" }
  ], true);

  assert.equal(request.validateOnly, true);
  assert.equal(request.partialFailure, true);
  assert.equal(request.responseContentType, "RESOURCE_NAME_ONLY");
  const operations = request.operations as Array<Record<string, any>>;
  assert.equal(operations.length, 2);
  assert.deepEqual(operations[0], {
    create: {
      campaign: "customers/1234567890/campaigns/555",
      negative: true,
      keyword: { text: "free quote", matchType: "EXACT" }
    }
  });
  assert.equal(operations[1]?.create.keyword.matchType, "PHRASE");
});

test("campaign remove request only accepts campaignCriteria resource names for the customer", () => {
  const request = campaignNegativeRemoveRequest(
    "1234567890",
    ["customers/1234567890/campaignCriteria/555~777"],
    false
  );
  assert.deepEqual(request.operations, [{ remove: "customers/1234567890/campaignCriteria/555~777" }]);
  assert.throws(
    () => campaignNegativeRemoveRequest("1234567890", ["customers/9999999999/campaignCriteria/555~777"], false),
    /Refusing to remove/u
  );
  assert.throws(
    () => campaignNegativeRemoveRequest("1234567890", ["customers/1234567890/customerNegativeCriteria/777"], false),
    /Refusing to remove/u
  );
});

test("account create request omits campaign and rejects non-EXACT/PHRASE match types", () => {
  const request = accountNegativeCreateRequest("1234567890", [{ text: "spam", matchType: "PHRASE" }], true);
  const operation = (request.operations as Array<Record<string, any>>)[0]!;
  assert.equal(operation.create.negative, true);
  assert.equal("campaign" in operation.create, false);
  assert.deepEqual(operation.create.keyword, { text: "spam", matchType: "PHRASE" });
  assert.throws(
    () => accountNegativeCreateRequest("1234567890", [{ text: "spam", matchType: "BROAD" as any }], true),
    /EXACT or PHRASE/u
  );
});

test("account remove request uses customerNegativeCriteria resource names", () => {
  const request = accountNegativeRemoveRequest(
    "1234567890",
    ["customers/1234567890/customerNegativeCriteria/4242"],
    false
  );
  assert.deepEqual(request.operations, [{ remove: "customers/1234567890/customerNegativeCriteria/4242" }]);
  assert.throws(
    () => accountNegativeRemoveRequest("1234567890", ["customers/1234567890/campaignCriteria/5~7"], false),
    /Refusing to remove/u
  );
});

test("GAQL lookup queries target the right resources with digit-only IDs", () => {
  const campaignQuery = campaignNegativeCriteriaQuery("555");
  assert.match(campaignQuery, /FROM campaign_criterion/u);
  assert.match(campaignQuery, /campaign\.id = 555/u);
  assert.match(campaignQuery, /campaign_criterion\.type = KEYWORD/u);
  assert.match(campaignQuery, /campaign_criterion\.negative = TRUE/u);
  assert.match(campaignQuery, /campaign_criterion\.resource_name/u);

  const accountQuery = accountNegativeCriteriaQuery();
  assert.match(accountQuery, /FROM customer_negative_criterion/u);
  assert.match(accountQuery, /customer_negative_criterion\.type = KEYWORD/u);

  assert.throws(() => campaignNegativeCriteriaQuery("555; DROP"), /digits/u);
});

test("BROAD is rejected at account level and anywhere else", () => {
  assert.throws(() => normalizeMatchType("broad", "account"), /not allowed at the account/u);
  assert.throws(() => normalizeMatchType("BROAD", "campaign"), /not supported/u);
  assert.equal(normalizeMatchType("phrase", "account"), "PHRASE");
  assert.equal(normalizeMatchType("exact", "campaign"), "EXACT");
  assert.throws(() => normalizeMatchType("SMART", "campaign"), /EXACT or PHRASE/u);
});

test("manager validates then applies a campaign add in live mode", async () => {
  const calls: Array<{ path: string; body: Record<string, any> }> = [];
  const manager = new NegativeCriteriaManager(
    okTransport(calls, [{ resourceName: "customers/1234567890/campaignCriteria/555~901" }]),
    noRows
  );
  const summary = await manager.run({
    customerId: "123-456-7890",
    scope: "campaign",
    campaignId: "555",
    add: ["junk leads"],
    remove: [],
    matchType: "EXACT",
    dryRun: false
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.path, "/customers/1234567890/campaignCriteria:mutate");
  assert.equal(calls[0]?.body.validateOnly, true);
  assert.equal(calls[1]?.body.validateOnly, false);
  assert.equal(summary.appliedCount, 1);
  assert.equal(summary.failedCount, 0);
  assert.equal(summary.googleAdsMutationPerformed, true);
  assert.equal(summary.results[0]?.status, "APPLIED");
  assert.equal(summary.results[0]?.resourceName, "customers/1234567890/campaignCriteria/555~901");
});

test("dry-run stops after validation and reports VALIDATED", async () => {
  const calls: Array<{ path: string; body: Record<string, any> }> = [];
  const manager = new NegativeCriteriaManager(okTransport(calls), noRows);
  const summary = await manager.run({
    customerId: "1234567890",
    scope: "account",
    add: ["spam calls"],
    remove: [],
    matchType: "PHRASE",
    dryRun: true
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, "/customers/1234567890/customerNegativeCriteria:mutate");
  assert.equal(calls[0]?.body.validateOnly, true);
  assert.equal(summary.validatedCount, 1);
  assert.equal(summary.appliedCount, 0);
  assert.equal(summary.googleAdsMutationPerformed, false);
});

test("remove by text looks up the campaign criterion via GAQL and removes its resource name", async () => {
  const calls: Array<{ path: string; body: Record<string, any> }> = [];
  const queries: string[] = [];
  const manager = new NegativeCriteriaManager(
    okTransport(calls, [{ resourceName: "customers/1234567890/campaignCriteria/555~777" }]),
    async (_customerId, query) => {
      queries.push(query);
      return [{
        campaignCriterion: {
          criterionId: "777",
          resourceName: "customers/1234567890/campaignCriteria/555~777",
          negative: true,
          keyword: { text: " Free  Quote ", matchType: "EXACT" }
        }
      }];
    }
  );
  const summary = await manager.run({
    customerId: "1234567890",
    scope: "campaign",
    campaignId: "555",
    add: [],
    remove: ["free quote"],
    matchType: "EXACT",
    dryRun: false
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0]!, /FROM campaign_criterion/u);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]?.body.operations, [{ remove: "customers/1234567890/campaignCriteria/555~777" }]);
  assert.equal(summary.appliedCount, 1);
});

test("remove of an unknown account-level text fails clearly without any mutation request", async () => {
  const calls: Array<{ path: string; body: Record<string, any> }> = [];
  const manager = new NegativeCriteriaManager(
    okTransport(calls),
    async () => [{
      customerNegativeCriterion: {
        criterionId: "42",
        resourceName: "customers/1234567890/customerNegativeCriteria/42",
        keyword: { text: "other term", matchType: "EXACT" }
      }
    }]
  );
  const summary = await manager.run({
    customerId: "1234567890",
    scope: "account",
    add: [],
    remove: ["missing term"],
    matchType: "EXACT",
    dryRun: false
  });

  assert.equal(calls.length, 0);
  assert.equal(summary.failedCount, 1);
  assert.match(summary.results[0]?.error ?? "", /No existing account-level EXACT negative keyword matches/u);
  assert.equal(summary.googleAdsMutationPerformed, false);
});

test("validation partial failures are surfaced per operation and only valid ops are applied", async () => {
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
                message: "Duplicate keyword",
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
        payload: { results: [{ resourceName: "customers/1234567890/campaignCriteria/555~1" }] }
      };
    }
  };
  const manager = new NegativeCriteriaManager(transport, noRows);
  const summary = await manager.run({
    customerId: "1234567890",
    scope: "campaign",
    campaignId: "555",
    add: ["good term", "duplicate term"],
    remove: [],
    matchType: "EXACT",
    dryRun: false
  });

  assert.equal(calls.length, 2);
  assert.equal((calls[1]?.body.operations as unknown[]).length, 1);
  const good = summary.results.find((result) => result.text === "good term");
  const duplicate = summary.results.find((result) => result.text === "duplicate term");
  assert.equal(good?.status, "APPLIED");
  assert.equal(duplicate?.status, "FAILED");
  assert.match(duplicate?.error ?? "", /Duplicate keyword/u);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.appliedCount, 1);
});

test("mutation-time unmapped partial failure fails the whole batch clearly", async () => {
  const calls: Array<{ path: string; body: Record<string, any> }> = [];
  const transport: GoogleAdsMutationHttpTransport = {
    async post(path, body) {
      calls.push({ path, body });
      if (body.validateOnly === true) {
        return { ok: true, status: 200, requestId: "v", payload: {} };
      }
      return {
        ok: true,
        status: 200,
        requestId: "m",
        payload: { partialFailureError: { message: "INTERNAL_ERROR", details: [] } }
      };
    }
  };
  const manager = new NegativeCriteriaManager(transport, noRows);
  const summary = await manager.run({
    customerId: "1234567890",
    scope: "account",
    add: ["spam"],
    remove: [],
    matchType: "EXACT",
    dryRun: false
  });

  assert.equal(summary.appliedCount, 0);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.googleAdsMutationPerformed, false);
  assert.ok((summary.results[0]?.error ?? "").length > 0);
});

test("HTTP failure during validation throws a pipeline-style error", async () => {
  const transport: GoogleAdsMutationHttpTransport = {
    async post() {
      return {
        ok: false,
        status: 403,
        requestId: "denied",
        payload: { error: { status: "PERMISSION_DENIED", message: "Nope" } }
      };
    }
  };
  const manager = new NegativeCriteriaManager(transport, noRows);
  await assert.rejects(
    () => manager.run({
      customerId: "1234567890",
      scope: "account",
      add: ["spam"],
      remove: [],
      matchType: "EXACT",
      dryRun: true
    }),
    /HTTP 403/u
  );
});

test("conflicting add/remove of the same text is rejected before any API call", async () => {
  const manager = new NegativeCriteriaManager(okTransport([]), noRows);
  await assert.rejects(
    () => manager.run({
      customerId: "1234567890",
      scope: "campaign",
      campaignId: "555",
      add: ["Same Term"],
      remove: ["same term"],
      matchType: "EXACT",
      dryRun: true
    }),
    /both --add and --remove/u
  );
});

test("campaign scope requires a campaign id", async () => {
  const manager = new NegativeCriteriaManager(okTransport([]), noRows);
  await assert.rejects(
    () => manager.run({
      customerId: "1234567890",
      scope: "campaign",
      add: ["spam"],
      remove: [],
      matchType: "EXACT",
      dryRun: true
    }),
    /--campaign-id is required/u
  );
});
