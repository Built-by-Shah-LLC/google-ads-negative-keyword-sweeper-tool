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

test("fetches positive keywords only from campaign-name and main-branch eligible campaigns", async () => {
  const queries: string[] = [];
  const criteria = await fetchPositiveKeywords({
    async searchStream(_customerId, receivedQuery) {
      queries.push(receivedQuery);
      if (/FROM campaign\s/u.test(receivedQuery)) {
        return [
          { campaign: { id: "100", name: "Built by Shah - Search", status: "ENABLED", primaryStatus: "ELIGIBLE", primaryStatusReasons: [] } },
          { campaign: { id: "101", name: "built by shah | limited", status: "ENABLED", primaryStatus: "LIMITED", primaryStatusReasons: ["BUDGET_CONSTRAINED"] } },
          { campaign: { id: "102", name: "Third Party", status: "ENABLED", primaryStatus: "ELIGIBLE", primaryStatusReasons: [] } },
          { campaign: { id: "103", name: "Built by Shah - Policy", status: "ENABLED", primaryStatus: "LIMITED", primaryStatusReasons: ["HAS_ADS_LIMITED_BY_POLICY"] } },
          { campaign: { id: "104", name: "Built by Shah - Mixed", status: "ENABLED", primaryStatus: "LIMITED", primaryStatusReasons: ["SEARCH_VOLUME_LIMITED", "HAS_ADS_LIMITED_BY_POLICY"] } },
          { campaign: { id: "105", name: "Built by Shah - Paused", status: "PAUSED", primaryStatus: "ELIGIBLE", primaryStatusReasons: [] } },
          { campaign: { id: "106", name: "Built by Shah - Empty reasons", status: "ENABLED", primaryStatus: "LIMITED", primaryStatusReasons: [] } },
          { campaign: { id: "107", name: "Built by Shah - Volume", status: "ENABLED", primaryStatus: "LIMITED", primaryStatusReasons: ["BIDDING_STRATEGY_LIMITED", "SEARCH_VOLUME_LIMITED"] } }
        ];
      }
      return [
        {
          campaign: { id: "100", name: "Built by Shah - Search", status: "ENABLED" },
          adGroup: { id: "200", name: "General", status: "ENABLED" },
          adGroupCriterion: {
            criterionId: "300", status: "ENABLED", negative: false,
            keyword: { text: "Competitor Collision", matchType: "PHRASE" }
          }
        },
        {
          campaign: { id: "100", name: "Built by Shah - Search", status: "ENABLED" },
          adGroup: { id: "201", name: "Paused", status: "PAUSED" },
          adGroupCriterion: {
            criterionId: "301", status: "ENABLED",
            keyword: { text: "Body Shop", matchType: "BROAD" }
          }
        },
        {
          campaign: { id: "101", name: "built by shah | limited", status: "ENABLED" },
          adGroup: { id: "202", name: "Limited", status: "ENABLED" },
          adGroupCriterion: {
            criterionId: "302", status: "ENABLED", negative: false,
            keyword: { text: "Collision Repair", matchType: "EXACT" }
          }
        },
        {
          campaign: { id: "107", name: "Built by Shah - Volume", status: "ENABLED" },
          adGroup: { id: "203", name: "Paused criterion", status: "ENABLED" },
          adGroupCriterion: {
            criterionId: "303", status: "PAUSED", negative: false,
            keyword: { text: "Body Shop", matchType: "BROAD" }
          }
        },
        {
          campaign: { id: "102", name: "Third Party", status: "ENABLED" },
          adGroup: { id: "204", name: "Should not pass", status: "ENABLED" },
          adGroupCriterion: {
            criterionId: "304", status: "ENABLED", negative: false,
            keyword: { text: "Excluded Campaign Keyword", matchType: "EXACT" }
          }
        },
        {
          campaign: { id: "100", name: "Built by Shah - Search", status: "ENABLED" },
          adGroup: { id: "200", name: "General", status: "ENABLED" },
          adGroupCriterion: {
            criterionId: "305", status: "ENABLED", negative: true,
            keyword: { text: "must skip", matchType: "EXACT" }
          }
        }
      ];
    }
  }, "1234567890", { campaignNameContains: "Built by Shah" });

  assert.equal(queries.length, 2);
  assert.match(queries[0]!, /campaign\.status IN \(ENABLED\)/u);
  assert.match(queries[0]!, /campaign\.primary_status IN \(ELIGIBLE, LIMITED\)/u);
  assert.match(queries[1]!, /campaign\.id IN \(100, 101, 107\)/u);
  assert.match(queries[1]!, /ad_group_criterion\.negative = FALSE/u);
  assert.match(queries[1]!, /ad_group_criterion\.status != REMOVED/u);
  assert.equal(criteria.length, 4);
  assert.equal(criteria[0]?.normalizedKeywordText, "competitor collision");
  assert.equal(criteria[0]?.active, true);
  assert.equal(criteria[1]?.active, false);
  assert.equal(criteria[2]?.normalizedKeywordText, "collision repair");
  assert.equal(criteria[2]?.active, true);
  assert.equal(criteria[3]?.active, false);
});

test("does not fetch keyword criteria when no campaign passes the positive-keyword campaign filter", async () => {
  const queries: string[] = [];
  const criteria = await fetchPositiveKeywords({
    async searchStream(_customerId, query) {
      queries.push(query);
      return [{
        campaign: {
          id: "200",
          name: "Built by Shah - Rejected",
          status: "ENABLED",
          primaryStatus: "LIMITED",
          primaryStatusReasons: ["HAS_ADS_DISAPPROVED"]
        }
      }];
    }
  }, "1234567890", { campaignNameContains: "Built by Shah" });

  assert.deepEqual(criteria, []);
  assert.equal(queries.length, 1);
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
