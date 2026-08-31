import assert from "node:assert/strict";
import test from "node:test";
import { createDecisionCsv } from "../src/storage/decision-csv.js";
import type { ClassificationCandidate, Organization } from "../src/types.js";

const organization: Organization = {
  customerId: "123",
  descriptiveName: "Example, Body Shop",
  timeZone: "America/New_York",
  currencyCode: "USD"
};
const candidate: ClassificationCandidate = {
  itemId: "item-1",
  customerId: "123",
  startDate: "2026-08-24",
  endDate: "2026-08-25",
  channel: "SEARCH",
  campaignId: "456",
  campaignName: "Collision \"Search\"",
  adGroupId: "789",
  adGroupName: "General",
  searchTerm: "=HYPERLINK(\"https://example.com\")",
  targetingStatus: "NONE",
  matchedKeyword: "collision repair",
  matchedKeywordMatchType: "BROAD",
  impressions: 4,
  clicks: 1,
  costMicros: 250000,
  conversions: 0,
  conversionValue: 0
};

test("creates one spreadsheet-safe CSV row with validated context", () => {
  const csv = createDecisionCsv(organization, `${candidate.startDate}..${candidate.endDate}`, [candidate], [{
    itemId: candidate.itemId,
    decision: "KEEP",
    negativeText: null,
    ruleIds: ["POL-AMBIGUOUS-KEEP"],
    reason: "Kept conservatively because context is limited",
    confidence: 0.5
  }], "openai-test", "rules-v1");

  assert.match(csv, /"Example, Body Shop"/u);
  assert.match(csv, /"Collision ""Search"""/u);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.com""\)"/u);
  assert.match(csv, /"VALIDATED"/u);
  assert.equal(csv.split("\r\n").filter(Boolean).length, 2);
});
