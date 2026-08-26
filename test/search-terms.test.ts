import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCandidates } from "../src/google-ads/search-terms.js";
import type { SearchTermRow } from "../src/types.js";

const base: SearchTermRow = {
  customerId: "123",
  date: "2026-08-25",
  channel: "SEARCH",
  campaignId: "456",
  campaignName: "Campaign",
  adGroupId: "789",
  adGroupName: "Ad group",
  searchTerm: "Body Shop Near Me",
  targetingStatus: "ADDED",
  matchedKeyword: "body shop",
  matchedKeywordMatchType: "BROAD",
  impressions: 2,
  clicks: 1,
  costMicros: 100,
  conversions: 0,
  conversionValue: 0
};

test("aggregates equivalent terms within the same campaign and ad group", () => {
  const candidates = aggregateCandidates([
    base,
    { ...base, searchTerm: " body   shop near me ", impressions: 3, clicks: 2, costMicros: 200 }
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.impressions, 5);
  assert.equal(candidates[0]?.clicks, 3);
  assert.equal(candidates[0]?.costMicros, 300);
});

test("keeps the same term in different campaigns as separate candidates", () => {
  assert.equal(aggregateCandidates([base, { ...base, campaignId: "999" }]).length, 2);
});
