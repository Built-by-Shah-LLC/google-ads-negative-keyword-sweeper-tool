import assert from "node:assert/strict";
import test from "node:test";
import type { ClassificationCandidate, RuleSet } from "../src/types.js";
import { validateDecisions } from "../src/llm/validation.js";

const rules: RuleSet = {
  version: "test",
  policy: "test",
  rules: [{ id: "RULE-1", title: "Rule", instruction: "Classify", examples: [] }]
};
const candidate: ClassificationCandidate = {
  itemId: "item-1",
  customerId: "123",
  date: "2026-08-25",
  channel: "SEARCH",
  campaignId: "456",
  campaignName: "Campaign",
  adGroupId: "789",
  adGroupName: "Ad group",
  searchTerm: "free collision repair course",
  targetingStatus: "NONE",
  matchedKeyword: "collision repair",
  matchedKeywordMatchType: "BROAD",
  impressions: 2,
  clicks: 1,
  costMicros: 1000000,
  conversions: 0,
  conversionValue: 0
};

test("validates and orders one exact-negative decision", () => {
  const result = validateDecisions({
    decisions: [{
      itemId: "item-1",
      decision: "NEGATIVE_EXACT",
      negativeText: "free collision repair course",
      ruleIds: ["RULE-1"],
      reason: "Education intent",
      confidence: 0.9
    }]
  }, [candidate], rules);
  assert.equal(result[0]?.decision, "NEGATIVE_EXACT");
});

test("rejects rewritten negative text", () => {
  assert.throws(() => validateDecisions({
    decisions: [{
      itemId: "item-1",
      decision: "NEGATIVE_EXACT",
      negativeText: "collision repair course",
      ruleIds: ["RULE-1"],
      reason: "Education intent",
      confidence: 0.9
    }]
  }, [candidate], rules), /complete search term/u);
});

test("rejects an omitted decision", () => {
  assert.throws(() => validateDecisions({ decisions: [] }, [candidate], rules), /0 decisions for 1/u);
});
