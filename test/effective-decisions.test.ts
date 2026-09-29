import assert from "node:assert/strict";
import test from "node:test";
import { disabledMutationSummary, type NegativeKeywordMutationSummary } from "../src/google-ads/negative-keyword-writer.js";
import { createEffectiveDecisions } from "../src/storage/effective-decisions.js";
import type { ClassificationCandidate, ClassificationDecision } from "../src/types.js";

const candidate: ClassificationCandidate = {
  itemId: "item-1",
  customerId: "123",
  startDate: "2026-09-01",
  endDate: "2026-09-01",
  channel: "SEARCH",
  campaignId: "456",
  campaignName: "Competitors",
  adGroupId: "789",
  adGroupName: "General",
  searchTerm: "caliber collision",
  targetingStatus: "NONE",
  matchedKeyword: "collision repair",
  matchedKeywordMatchType: "BROAD",
  impressions: 10,
  clicks: 2,
  costMicros: 1000,
  conversions: 0,
  conversionValue: 0,
  positiveKeywordContext: {
    exactTextMatchCount: 1,
    activeSameCampaignExactMatch: true,
    pausedSameCampaignExactMatch: false,
    activeOtherCampaignExactMatch: false,
    activeSameCampaignMatchTypes: ["PHRASE"]
  }
};

const negative: ClassificationDecision = {
  itemId: candidate.itemId,
  decision: "NEGATIVE_EXACT",
  negativeText: candidate.searchTerm,
  ruleIds: ["POL-COMPETITOR-NEGATIVE"],
  reason: "Competitor intent",
  confidence: 0.99
};

test("effective outcomes pass the LLM decision through unchanged (protection is classification-time policy)", () => {
  const mutation: NegativeKeywordMutationSummary = {
    ...disabledMutationSummary(),
    mode: "validation",
    status: "VALIDATED",
    proposedCount: 1,
    attemptedCount: 1,
    validatedCount: 1
  };

  const [effective] = createEffectiveDecisions([candidate], [negative], mutation);
  assert.equal(effective?.decision, "NEGATIVE_EXACT");
  assert.equal(effective?.effectiveOutcome, "NEGATIVE_EXACT");
  assert.equal(effective?.positiveKeywordProtectionSource, null);
  assert.deepEqual(effective?.positiveCriterionIds, []);
  assert.deepEqual(effective?.positiveMatchTypes, []);
});

test("positive-keyword snapshot context no longer rewrites read-only outcomes", () => {
  const [effective] = createEffectiveDecisions([candidate], [negative], disabledMutationSummary());
  assert.equal(effective?.effectiveOutcome, "NEGATIVE_EXACT");
  assert.equal(effective?.positiveKeywordProtectionSource, null);
});

test("KEEP decisions pass through unchanged", () => {
  const keep: ClassificationDecision = { ...negative, decision: "KEEP", negativeText: null };
  const [effective] = createEffectiveDecisions([candidate], [keep]);
  assert.equal(effective?.effectiveOutcome, "KEEP");
  assert.equal(effective?.positiveKeywordProtectionSource, null);
});
