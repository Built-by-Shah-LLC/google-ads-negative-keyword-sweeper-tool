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
  assert.ok(csv.startsWith('"classificationStatus","organizationName","searchTerm","decision","reason"'));
  assert.equal(csv.split("\r\n").filter(Boolean).length, 2);
});

test("sorts each organization's CSV rows alphabetically by search term", () => {
  const later = { ...candidate, itemId: "item-z", searchTerm: "Zoo repair" };
  const earlier = { ...candidate, itemId: "item-a", searchTerm: "auto repair" };
  const csv = createDecisionCsv(organization, "2026-08-24..2026-08-25", [later, earlier], [], "model", "rules");
  const rows = csv.split("\r\n").filter(Boolean);

  assert.match(rows[1]!, /"auto repair"/u);
  assert.match(rows[2]!, /"Zoo repair"/u);
});
