import assert from "node:assert/strict";
import test from "node:test";
import { filterOrganizationsByAllowlist } from "../src/google-ads/organizations.js";
import { filterRowsByCampaignName } from "../src/pipeline/process-organization.js";
import type { Organization, SearchTermRow } from "../src/types.js";

function organization(customerId: string, descriptiveName: string): Organization {
  return { customerId, descriptiveName, timeZone: "UTC", currencyCode: "USD" };
}

function row(campaignName: string): SearchTermRow {
  return {
    customerId: "123",
    date: "2026-09-01",
    channel: "SEARCH",
    campaignId: "456",
    campaignName,
    adGroupId: "789",
    adGroupName: "Ad group",
    searchTerm: "collision repair",
    targetingStatus: "NONE",
    matchedKeyword: null,
    matchedKeywordMatchType: null,
    impressions: 1,
    clicks: 0,
    costMicros: 0,
    conversions: 0,
    conversionValue: 0
  };
}

test("allowlist matches customer IDs with or without dashes", () => {
  const organizations = [
    organization("8847499121", "10X AUTO GROUP INC"),
    organization("8500809656", "3J Collision Center"),
    organization("9990001112", "Unrelated Account")
  ];
  const selected = filterOrganizationsByAllowlist(organizations, ["884-749-9121", "8500809656"]);
  assert.deepEqual(selected.map((item) => item.customerId), ["8847499121", "8500809656"]);
});

test("allowlist matches account name fragments case-insensitively", () => {
  const organizations = [
    organization("111", "Auto Arena Body Shop"),
    organization("222", "Tello's Collision Center"),
    organization("333", "Other Shop")
  ];
  const selected = filterOrganizationsByAllowlist(organizations, ["auto arena", "TELLO'S COLLISION"]);
  assert.deepEqual(selected.map((item) => item.customerId), ["111", "222"]);
});

test("empty allowlist keeps every organization", () => {
  const organizations = [organization("111", "A"), organization("222", "B")];
  assert.equal(filterOrganizationsByAllowlist(organizations, []).length, 2);
  assert.equal(filterOrganizationsByAllowlist(organizations, [" ", ""]).length, 2);
});

test("campaign name filter keeps only 'Built by Shah' campaigns", () => {
  const rows = [
    row("Built by Shah - Collision Search"),
    row("built by shah | pmax"),
    row("Third Party Campaign"),
    row("")
  ];
  const scoped = filterRowsByCampaignName(rows, "Built by Shah");
  assert.equal(scoped.length, 2);
  assert.ok(scoped.every((item) => item.campaignName.toLowerCase().includes("built by shah")));
});

test("campaign name filter is disabled by null, undefined, or blank", () => {
  const rows = [row("Anything"), row("Everything")];
  assert.equal(filterRowsByCampaignName(rows, null).length, 2);
  assert.equal(filterRowsByCampaignName(rows, undefined).length, 2);
  assert.equal(filterRowsByCampaignName(rows, "  ").length, 2);
});
