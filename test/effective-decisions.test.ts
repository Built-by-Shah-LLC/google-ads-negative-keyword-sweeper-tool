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

test("reports the final mutation guard conflict without changing the LLM decision", () => {
  const mutation: NegativeKeywordMutationSummary = {
    ...disabledMutationSummary(),
    mode: "validation",
    status: "NO_CHANGES",
    proposedCount: 1,
    positiveKeywordConflictCount: 1,
    positiveKeywordConflicts: [{
      operationId: "operation-1",
      campaignId: candidate.campaignId,
      negativeText: candidate.searchTerm,
      sourceItemIds: [candidate.itemId],
      positiveCriterionIds: ["333"],
      positiveMatchTypes: ["PHRASE"]
    }]
  };

  const [effective] = createEffectiveDecisions([candidate], [negative], mutation);
  assert.equal(effective?.decision, "NEGATIVE_EXACT");
  assert.equal(effective?.effectiveOutcome, "PROTECTED_BY_POSITIVE_KEYWORD");
  assert.equal(effective?.positiveKeywordProtectionSource, "FINAL_MUTATION_GUARD");
  assert.deepEqual(effective?.positiveCriterionIds, ["333"]);
});

test("uses the account snapshot for read-only reports when the final guard did not run", () => {
  const [effective] = createEffectiveDecisions([candidate], [negative], disabledMutationSummary());
  assert.equal(effective?.effectiveOutcome, "PROTECTED_BY_POSITIVE_KEYWORD");
  assert.equal(effective?.positiveKeywordProtectionSource, "INITIAL_ACCOUNT_SNAPSHOT");
  assert.deepEqual(effective?.positiveMatchTypes, ["PHRASE"]);
});

test("a completed final guard overrides stale initial snapshot context", () => {
  const mutation: NegativeKeywordMutationSummary = {
    ...disabledMutationSummary(),
    mode: "validation",
    status: "VALIDATED",
    proposedCount: 1,
    attemptedCount: 1,
    validatedCount: 1
  };

  const [effective] = createEffectiveDecisions([candidate], [negative], mutation);
  assert.equal(effective?.effectiveOutcome, "NEGATIVE_EXACT");
  assert.equal(effective?.positiveKeywordProtectionSource, null);
});
