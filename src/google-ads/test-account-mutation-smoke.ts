import { createHash } from "node:crypto";
import type { GoogleAdsClient } from "./client.js";
import {
  applyNegativeExactDecisions,
  type NegativeKeywordMutationSummary,
  type NegativeKeywordWriter
} from "./negative-keyword-writer.js";
import type { ClassificationCandidate, ClassificationDecision } from "../types.js";

export const TEST_ACCOUNT_MUTATION_CONFIRMATION = "WRITE_ONE_EXACT_NEGATIVE_TO_GOOGLE_TEST_ACCOUNT";

export async function runTestAccountMutationSmoke(input: {
  googleAds: Pick<GoogleAdsClient, "searchStream">;
  writer: NegativeKeywordWriter;
  customerId: string;
  campaignId: string;
  negativeText: string;
  confirmation: string;
}): Promise<NegativeKeywordMutationSummary> {
  if (input.confirmation !== TEST_ACCOUNT_MUTATION_CONFIRMATION) {
    throw new Error("Google Ads test-account mutation requires the exact confirmation value.");
  }
  if (input.writer.mode !== "production") {
    throw new Error("Google Ads test-account smoke requires the production mutation writer.");
  }
  const customerId = digits(input.customerId, "test customer ID");
  const campaignId = digits(input.campaignId, "test campaign ID");
  assertKeywordText(input.negativeText);
  await assertTestAccount(input.googleAds, customerId);
  await assertCampaignExists(input.googleAds, customerId, campaignId);

  const itemId = createHash("sha256")
    .update([customerId, campaignId, input.negativeText].join("\u0000"))
    .digest("hex")
    .slice(0, 24);
  const today = new Date().toISOString().slice(0, 10);
  const candidate: ClassificationCandidate = {
    itemId,
    customerId,
    startDate: today,
    endDate: today,
    channel: "SEARCH",
    campaignId,
    campaignName: "Google Ads test-account smoke campaign",
    adGroupId: null,
    adGroupName: null,
    searchTerm: input.negativeText,
    targetingStatus: null,
    matchedKeyword: null,
    matchedKeywordMatchType: null,
    impressions: 0,
    clicks: 0,
    costMicros: 0,
    conversions: 0,
    conversionValue: 0
  };
  const decision: ClassificationDecision = {
    itemId,
    decision: "NEGATIVE_EXACT",
    negativeText: input.negativeText,
    ruleIds: ["TEST-ACCOUNT-SMOKE"],
    reason: "Synthetic mutation used only in a Google Ads test account.",
    confidence: 1
  };
  const summary = await applyNegativeExactDecisions({
    googleAds: input.googleAds,
    writer: input.writer,
    customerId,
    candidates: [candidate],
    decisions: [decision],
    chunkSize: 1
  });
  if (summary.status !== "APPLIED" || summary.appliedCount !== 1 || summary.verifiedCount !== 1) {
    throw new Error(`Google Ads test-account mutation was not applied and verified (status ${summary.status}).`);
  }
  return summary;
}

export async function assertTestAccount(
  googleAds: Pick<GoogleAdsClient, "searchStream">,
  customerId: string
): Promise<void> {
  const cleanCustomerId = digits(customerId, "test customer ID");
  const rows = await googleAds.searchStream(cleanCustomerId, `
    SELECT
      customer.id,
      customer.test_account
    FROM customer
    LIMIT 1
  `);
  const customer = recordValue(rows[0]?.customer);
  if (String(customer?.id ?? "") !== cleanCustomerId || customer?.testAccount !== true) {
    throw new Error("Refusing mutation because Google Ads did not identify the target as a test account.");
  }
}

async function assertCampaignExists(
  googleAds: Pick<GoogleAdsClient, "searchStream">,
  customerId: string,
  campaignId: string
): Promise<void> {
  const rows = await googleAds.searchStream(customerId, `
    SELECT
      campaign.id,
      campaign.status
    FROM campaign
    WHERE campaign.id = ${campaignId}
    LIMIT 1
  `);
  const campaign = recordValue(rows[0]?.campaign);
  if (String(campaign?.id ?? "") !== campaignId || campaign?.status === "REMOVED") {
    throw new Error("The requested Google Ads test campaign was not found or has been removed.");
  }
}

function assertKeywordText(value: string): void {
  const wordCount = value.trim().split(/\s+/u).filter(Boolean).length;
  if (value.trim() !== value || value.length < 1 || value.length > 80 || wordCount > 10) {
    throw new Error("Test negative text must be trimmed and contain at most 80 characters and 10 words.");
  }
}

function digits(value: string, label: string): string {
  const clean = value.replaceAll("-", "");
  if (!/^\d+$/u.test(clean)) throw new Error(`Google Ads ${label} must contain only digits.`);
  return clean;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
