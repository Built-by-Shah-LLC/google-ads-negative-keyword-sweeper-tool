import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCandidates, fetchSearchTermsForDateRange } from "../src/google-ads/search-terms.js";
import type { GoogleAdsClient } from "../src/google-ads/client.js";
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
  assert.equal(candidates[0]?.startDate, "2026-08-25");
  assert.equal(candidates[0]?.endDate, "2026-08-25");
});

test("aggregates the same term across both dates in the 48-hour window", () => {
  const candidates = aggregateCandidates([
    { ...base, date: "2026-08-24", impressions: 3 },
    { ...base, date: "2026-08-25", impressions: 4 }
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.impressions, 7);
  assert.equal(candidates[0]?.startDate, "2026-08-24");
  assert.equal(candidates[0]?.endDate, "2026-08-25");
});

test("keeps the same term in different campaigns as separate candidates", () => {
  assert.equal(aggregateCandidates([base, { ...base, campaignId: "999" }]).length, 2);
});

test("retains exact Google metric strings beyond JavaScript safe integers", async () => {
  const client = {
    async searchStream(_customerId: string, query: string) {
      if (query.includes("campaign_search_term_view")) return [];
      return [{
        campaign: { id: "456", name: "Campaign" },
        adGroup: { id: "789", name: "Group" },
        searchTermView: { searchTerm: "query", status: "NONE" },
        segments: { date: "2026-08-25" },
        metrics: {
          impressions: "9007199254740993",
          clicks: "3",
          costMicros: "9007199254740995",
          conversions: "1.2500",
          conversionsValue: "9.9900",
        },
      }];
    },
  } as unknown as GoogleAdsClient;
  const rows = await fetchSearchTermsForDateRange(client, "123", {
    startDate: "2026-08-25",
    endDate: "2026-08-25",
  });
  assert.equal(rows[0]?.impressionsExact, "9007199254740993");
  assert.equal(rows[0]?.costMicrosExact, "9007199254740995");
  assert.equal(rows[0]?.conversionsExact, "1.25");
  assert.equal(rows[0]?.conversionValueExact, "9.99");
});
