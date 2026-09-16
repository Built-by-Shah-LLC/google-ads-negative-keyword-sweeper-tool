import assert from "node:assert/strict";
import test from "node:test";
import {
  activeSameCampaignPositiveMatches,
  attachPositiveKeywordContext,
  fetchPositiveKeywords,
  normalizeKeywordText
} from "../src/google-ads/positive-keywords.js";
import type { ClassificationCandidate, PositiveKeywordCriterion } from "../src/types.js";

const candidate: ClassificationCandidate = {
  itemId: "item-1",
  customerId: "1234567890",
  startDate: "2026-09-15",
  endDate: "2026-09-15",
  channel: "SEARCH",
  campaignId: "100",
  campaignName: "Search",
  adGroupId: "200",
  adGroupName: "General",
  searchTerm: " Competitor   Collision ",
  targetingStatus: "ADDED",
  matchedKeyword: "competitor collision",
  matchedKeywordMatchType: "PHRASE",
  impressions: 1,
  clicks: 0,
  costMicros: 0,
  conversions: 0,
  conversionValue: 0
};

function criterion(overrides: Partial<PositiveKeywordCriterion> = {}): PositiveKeywordCriterion {
  return {
    campaignId: "100",
    campaignName: "Search",
    campaignStatus: "ENABLED",
    adGroupId: "200",
    adGroupName: "General",
    adGroupStatus: "ENABLED",
    criterionId: "300",
    criterionStatus: "ENABLED",
    keywordText: "competitor collision",
    normalizedKeywordText: "competitor collision",
    matchType: "PHRASE",
    active: true,
    ...overrides
  };
}

test("fetches only non-removed positive keyword criteria and derives active state", async () => {
  let query = "";
  const criteria = await fetchPositiveKeywords({
    async searchStream(_customerId, receivedQuery) {
      query = receivedQuery;
      return [
        {
          campaign: { id: "100", name: "Search", status: "ENABLED" },
          adGroup: { id: "200", name: "General", status: "ENABLED" },
          adGroupCriterion: {
            criterionId: "300", status: "ENABLED", negative: false,
            keyword: { text: "Competitor Collision", matchType: "PHRASE" }
          }
        },
        {
          campaign: { id: "100", name: "Search", status: "ENABLED" },
          adGroup: { id: "201", name: "Paused", status: "PAUSED" },
          adGroupCriterion: {
            criterionId: "301", status: "ENABLED",
            keyword: { text: "Body Shop", matchType: "BROAD" }
          }
        },
        {
          campaign: { id: "100", name: "Search", status: "ENABLED" },
          adGroup: { id: "200", name: "General", status: "ENABLED" },
          adGroupCriterion: {
            criterionId: "302", status: "ENABLED", negative: true,
            keyword: { text: "must skip", matchType: "EXACT" }
          }
        }
      ];
    }
  }, "1234567890");

  assert.match(query, /ad_group_criterion\.negative = FALSE/u);
  assert.match(query, /ad_group_criterion\.status != REMOVED/u);
  assert.equal(criteria.length, 2);
  assert.equal(criteria[0]?.normalizedKeywordText, "competitor collision");
  assert.equal(criteria[0]?.active, true);
  assert.equal(criteria[1]?.active, false);
});

test("annotates exact positive matches without treating broad expansions as exact conflicts", () => {
  const criteria = [
    criterion(),
    criterion({ criterionId: "301", campaignId: "101" }),
    criterion({ criterionId: "302", criterionStatus: "PAUSED", active: false })
  ];
  const [annotated] = attachPositiveKeywordContext([candidate], criteria);
  assert.deepEqual(annotated?.positiveKeywordContext, {
    exactTextMatchCount: 3,
    activeSameCampaignExactMatch: true,
    pausedSameCampaignExactMatch: true,
    activeOtherCampaignExactMatch: true,
    activeSameCampaignMatchTypes: ["PHRASE"]
  });
  assert.equal(activeSameCampaignPositiveMatches("100", candidate.searchTerm, criteria).length, 1);

  const [expanded] = attachPositiveKeywordContext([
    { ...candidate, itemId: "item-2", searchTerm: "competitor collision reviews" }
  ], criteria);
  assert.equal(expanded?.positiveKeywordContext?.exactTextMatchCount, 0);
  assert.equal(normalizeKeywordText("  BODY   SHOP  "), "body shop");
});
