import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { analyzeRecovery, recoveryCandidates } from "../src/volume-recovery/analysis.js";
import { canonicalRecoveryJson, EMPTY_RECOVERY_POLICY, parseRecoveryItem, validateRecoveryPolicy } from "../src/volume-recovery/contract.js";
import { validateRecoveryIntents } from "../src/volume-recovery/classifier.js";
import { runVolumeRecovery } from "../src/volume-recovery/pipeline.js";
import { PostgresRecoveryStore, type RecoveryStore, type RecoveryRequest } from "../src/volume-recovery/persistence.js";
import { collectRecoverySources, sourceDecimal, type RecoverySources } from "../src/volume-recovery/sources.js";
import { negativeMatches, recoveryDates, recoveryScore, sumDecimals } from "../src/volume-recovery/scoring.js";
import { parseRecoveryArguments } from "../src/volume-recovery.js";
const accountId = "00000000-0000-4000-8000-000000000003";
const runId = "00000000-0000-4000-8000-000000000004";
const action = "customers/1234567890/conversionActions/1";
const now = new Date("2026-10-15T12:00:00Z");
function sources(): RecoverySources {
  return {
    campaigns: [{
      id: "1",
      name: "Search repair",
      channel: "SEARCH",
      status: "ENABLED",
      reasons: []
    }],
    exclusions: [{
      resource: "customers/1234567890/campaignCriteria/1~1",
      text: "riverton collision repair",
      kind: "keyword",
      scope: "campaign",
      matchType: "EXACT",
      campaignIds: ["1"],
      adGroupId: null,
      adGroupName: null
    }],
    facts: [{
      key: "f1",
      campaignId: "1",
      adGroupId: "2",
      channel: "SEARCH",
      query: "riverton collision repair",
      date: "2026-10-06",
      impressions: "520",
      clicks: "38",
      costMicros: "304000000"
    }],
    conversionFacts: [{
      key: "f1",
      action,
      events: "3",
      value: "3"
    }],
    actions: [{
      resource: action,
      name: "Submit lead form",
      category: "SUBMIT_LEAD_FORM",
      kind: "raw_lead",
      primary: true
    }],
    coverage: ["campaigns", "campaign_negatives", "ad_group_negatives", "account_negatives", "shared_sets", "shared_attachments", "shared_keywords", "brand_exclusions", "conversion_actions", "SEARCH_traffic", "SEARCH_conversion_events", "campaign_goal_configuration"].map(source => ({
      source,
      available: true,
      detail: "Synthetic fixture"
    })),
    dates: recoveryDates("America/Los_Angeles", now),
    goalCategories: ["SUBMIT_LEAD_FORM"],
    campaignGoalLevels: {
      "1": "CUSTOMER"
    },
    conversionOwner: "1234567890"
  };
}
function intent(data: RecoverySources) {
  return [{
    itemId: recoveryCandidates(data)[0]!.key,
    category: "COMPETITOR-NEGATIVE",
    competitorLikelihood: "likely" as const,
    confidence: 0.95,
    reason: "Likely competing repair service."
  }];
}
const policy = {
  ...EMPTY_RECOVERY_POLICY,
  categoryActions: {
    "COMPETITOR-NEGATIVE": "consider" as const
  }
};
test("negative matching uses negative semantics, with conservative unknown punctuation", () => {
  assert.equal(negativeMatches("repair shop", "best repair shop nearby", "EXACT"), false);
  assert.equal(negativeMatches("repair shop", "best repair shop nearby", "PHRASE"), true);
  assert.equal(negativeMatches("repair shop", "shop for repair", "BROAD"), true);
  assert.equal(negativeMatches("repair shop", "repair shops", "BROAD"), false);
  assert.equal(negativeMatches("a a", "a b", "BROAD"), false);
  assert.equal(negativeMatches("collision-repair", "collision repair", "PHRASE"), null);
});
test("money, fractional attribution, nulls and timezone boundaries remain exact", () => {
  assert.equal(sumDecimals(["0.1", "0.2", "1.333333"]), "1.633333");
  assert.equal(sourceDecimal(undefined), null);
  assert.equal(sourceDecimal("0"), "0");
  assert.deepEqual(recoveryDates("America/Los_Angeles", new Date("2026-10-15T01:00:00Z")), {
    today: "2026-10-14",
    endDate: "2026-10-12",
    startDate: "2026-07-15"
  });
  assert.equal(recoveryScore({
    qualityEvents: null,
    conversions: "3",
    clicks: "38",
    cost: "304",
    targetCpa: "85",
    recent: true,
    completedConversionWeeks: 2
  }).total, "48.15");
  const zero = recoveryScore({
    qualityEvents: null,
    conversions: "0",
    clicks: null,
    cost: "0",
    targetCpa: "85",
    recent: false,
    completedConversionWeeks: 0
  });
  assert.equal(zero.efficiency, "0");
  assert.ok(zero.unavailable.includes("efficiency"));
});
test("legacy raw leads remain Class C/manual review, never qualified by LLM confidence", () => {
  const data = sources(),
    report = analyzeRecovery(data, policy, intent(data), "85");
  const row = report.items[0]!.item;
  assert.equal(report.readiness, "amber");
  assert.equal(row.provenance, "legacy_unattributed");
  assert.equal(row.metrics.cost, "304");
  assert.equal(row.metrics.cpa, "101.333333");
  assert.equal(row.valueClass, "C");
  assert.equal(row.score?.quality, "0");
  assert.equal(row.recommendation, "manual_review");
});
test("qualified evidence still needs account permission, complete blockers and narrow scope", () => {
  const data = sources();
  data.actions[0]!.kind = "qualified_lead";
  assert.equal(analyzeRecovery(data, policy, intent(data), "85").items[0]!.item.recommendation, "potential_pilot");
  data.exclusions.push({
    ...data.exclusions[0]!,
    resource: "shared/2",
    scope: "account",
    matchType: "PHRASE",
    text: "collision repair"
  });
  const row = analyzeRecovery(data, policy, intent(data), "85").items.find(item => item.resource.endsWith("1~1"))!.item;
  assert.equal(row.remainingBlockers, 1);
  assert.equal(row.recommendation, "manual_review");
  data.coverage.find(c => c.source === "shared_keywords")!.available = false;
  assert.equal(analyzeRecovery(data, policy, intent(data), "85").items[0]!.item.blockerCoverageComplete, false);
});
test("missing query conversions are null, funnel actions never inflate traffic or people", () => {
  const data = sources();
  data.actions.push({
    ...data.actions[0]!,
    resource: action + "2",
    kind: "qualified_lead",
    name: "Qualified appointment"
  });
  data.conversionFacts.push({
    key: "f1",
    action: action + "2",
    events: "1.5",
    value: "0"
  });
  const row = analyzeRecovery(data, policy, intent(data), "85").items[0]!.item;
  assert.equal(row.metrics.clicks, "38");
  assert.equal(row.metrics.conversionEvents, "1.5");
  assert.equal(row.valueClass, "A");
  data.coverage.find(c => c.source === "SEARCH_conversion_events")!.available = false;
  assert.equal(analyzeRecovery(data, policy, intent(data), "85").items[0]!.item.metrics.conversionEvents, null);
});
test("absent history is insufficient evidence, not zero historic conversions", () => {
  const data = sources();
  data.facts = [];
  const row = analyzeRecovery(data, policy, intent(data), "85").items[0]!.item;
  assert.equal(row.recommendation, "insufficient_evidence");
  assert.equal(row.metrics.clicks, null);
  assert.equal(row.score, null);
});
test("an unused old qualified action does not erase a current action's attributed outcomes", () => {
  const data = sources();
  data.actions[0]!.kind = "qualified_lead";
  data.conversionFacts = [];
  data.actions.push({
    ...data.actions[0]!,
    resource: action + "2",
    name: "Current qualified appointment"
  });
  data.conversionFacts.push({
    key: "f1",
    action: action + "2",
    events: "3",
    value: "0"
  });
  const row = analyzeRecovery(data, policy, intent(data), "85").items[0]!.item;
  assert.equal(row.metrics.conversionEvents, "3");
  assert.equal(row.valueClass, "A");
  assert.ok(row.conversionBasis.includes("Current qualified"));
  assert.equal(row.conversionActions[0]!.resourceId, action + "2");
});
test("model and browser contracts reject invented IDs, malformed policies and missing scores", () => {
  assert.throws(() => validateRecoveryIntents({
    items: []
  }, ["a"], ["COMPETITOR-NEGATIVE"]));
  assert.throws(() => validateRecoveryIntents({
    items: [{
      itemId: "a",
      category: "MADE-UP",
      competitorLikelihood: "likely",
      confidence: 1,
      reason: "x"
    }]
  }, ["a"], []));
  assert.throws(() => validateRecoveryPolicy({
    ...policy,
    execute: true
  }));
  assert.throws(() => parseRecoveryArguments(["--request-id", runId, "--execute-production-google-ads-mutations"]));
  const data = sources(),
    row = analyzeRecovery(data, policy, intent(data), "85").items[0]!.item;
  assert.equal("providerPayload" in parseRecoveryItem({
    ...row,
    providerPayload: "secret"
  }), false);
  assert.throws(() => parseRecoveryItem({
    ...row,
    score: {
      ...row.score,
      quality: null
    }
  }));
});
function harness(duplicate = false) {
  const snapshot = {
    rulesMarkdown: "### `COMPETITOR-NEGATIVE`\nCompeting service.",
    phraseProtections: []
  };
  const request: RecoveryRequest = {
    id: runId,
    accountId,
    customerId: "1234567890",
    accountName: "Mock repair",
    timeZone: "America/Los_Angeles",
    currencyCode: "USD",
    targetCpa: "85",
    policy,
    snapshot,
    policyHash: createHash("sha256").update(canonicalRecoveryJson(snapshot)).digest("hex")
  };
  const saved: unknown[] = [];
  let collectCalls = 0;
  const store: RecoveryStore = {
    async claim() {
      return duplicate ? null : request;
    },
    async progress() {},
    async items(_r, _e, rows) {
      saved.push(...rows);
    },
    async finish(_r, _e, status, summary, usage) {
      saved.push({
        status,
        summary,
        usage
      });
    }
  };
  return {
    request,
    saved,
    services: {
      store,
      async collect() {
        collectCalls++;
        return sources();
      },
      async classify(_r: RecoveryRequest, candidates: ReturnType<typeof recoveryCandidates>) {
        return {
          intents: candidates.map(c => ({
            ...intent(sources())[0]!,
            itemId: c.key
          })),
          usage: {
            inputTokens: 100,
            outputTokens: 20
          }
        };
      },
      now: () => now
    },
    calls: () => collectCalls
  };
}
test("duplicate executions exit before collection or model calls", async () => {
  const h = harness(true);
  assert.equal(await runVolumeRecovery(runId, "recovery-abc", h.services), "duplicate");
  assert.equal(h.calls(), 0);
  assert.deepEqual(h.saved, []);
});
test("an archived account is terminalized when its pending worker cannot claim",async()=>{
  const store=new PostgresRecoveryStore("postgresql://mock:mock@127.0.0.1:1/mock","00000000-0000-4000-8000-000000000001");
  const statements:string[]=[];
  store.transaction=async(_execution,operation)=>operation({async query(sql:string){statements.push(sql);return {rows:[],rowCount:0};}} as unknown as PoolClient);
  try {
    assert.equal(await store.claim(runId,"recovery-abc"),null);
    assert.equal(statements.length,2);assert.ok(statements[1]!.includes("run.status='pending'"));
    assert.ok(statements[1]!.includes("account.onboarding_status='archived'"));
    assert.ok(statements[1]!.includes("error_code='ACCOUNT_ARCHIVED'"));
  }finally{await store.close();}
});
test("offline worker writes a report only after claim and validates its pinned policy", async () => {
  const h = harness();
  assert.equal(await runVolumeRecovery(runId, "recovery-abc", h.services), "succeeded");
  assert.equal(h.calls(), 1);
  assert.equal(h.saved.length, 2);
  const bad = harness();
  bad.request.policyHash = "invalid";
  assert.equal(await runVolumeRecovery(runId, "recovery-abc", bad.services), "failed");
  assert.equal(bad.calls(), 0);
});
test("invalid model output retains evidence, tokens and a partial status", async () => {
  const h = harness();
  const services = {
    ...h.services,
    async classify() {
      return {
        intents: null,
        usage: {
          inputTokens: 123,
          outputTokens: 45
        }
      };
    }
  };
  assert.equal(await runVolumeRecovery(runId, "recovery-abc", services), "partial");
  assert.deepEqual((h.saved.at(-1) as {
    usage: unknown;
  }).usage, {
    inputTokens: 123,
    outputTokens: 45
  });
});
test("source collection is SELECT-only, resolves manager conversion ownership and preserves source gaps", async () => {
  const calls: {
    customer: string;
    query: string;
  }[] = [];
  const data = await collectRecoverySources({
    async searchStream(customer, query) {
      calls.push({
        customer,
        query
      });
      if (query.includes(" FROM customer LIMIT")) return [{
        customer: {
          id: "1234567890",
          timeZone: "America/Los_Angeles",
          currencyCode: "USD",
          conversionTrackingSetting: {
            googleAdsConversionCustomer: "customers/9876543210"
          }
        }
      }];
      if (query.includes(" FROM conversion_action")) return [{
        conversionAction: {
          resourceName: action,
          name: "Phone Call",
          category: "DEFAULT",
          primaryForGoal: true
        }
      }];
      if (query.includes(" FROM campaign_shared_set")) throw new Error("private provider error");
      return [];
    }
  }, {
    customerId: "1234567890",
    timeZone: "America/Los_Angeles",
    currencyCode: "USD",
    policy: EMPTY_RECOVERY_POLICY
  }, now);
  assert.ok(calls.every(call => call.query.startsWith("SELECT ") && !/mutate/i.test(call.query)));
  assert.equal(calls.find(call => call.query.includes(" FROM conversion_action"))!.customer, "9876543210");
  assert.equal(data.actions[0]!.kind, "ignore");
  assert.equal(data.coverage.find(c => c.source === "shared_attachments")!.available, false);
  assert.ok(!JSON.stringify(data.coverage).includes("private provider error"));
});
