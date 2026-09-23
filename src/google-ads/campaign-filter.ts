import type { ClassificationCandidate, SearchTermRow } from "../types.js";
import type { GoogleAdsClient } from "./client.js";

/**
 * The only campaign states that may enter classification or receive a
 * campaign-level negative from the daily sweeper.
 *
 * A primary status that has no entry in `allowedPrimaryStatusReasons` passes
 * without a reason restriction. When an entry exists, every returned reason
 * must be allowlisted. To permit another LIMITED reason, add its enum name as
 * one line in the LIMITED array below.
 */
export const CAMPAIGN_SWEEP_FILTER: Readonly<{
  allowedStatuses: readonly string[];
  allowedPrimaryStatuses: readonly string[];
  allowedPrimaryStatusReasons: Readonly<Record<string, readonly string[]>>;
}> = {
  allowedStatuses: ["ENABLED"],
  allowedPrimaryStatuses: ["ELIGIBLE", "LIMITED"],
  allowedPrimaryStatusReasons: {
    LIMITED: [
      "BUDGET_CONSTRAINED",
      "BIDDING_STRATEGY_LIMITED",
      "BIDDING_STRATEGY_CONSTRAINED",
      "SEARCH_VOLUME_LIMITED"
    ]
  }
};

export interface CampaignSweepFilterContext {
  campaignId: string;
  campaignStatus: string;
  campaignPrimaryStatus: string;
  campaignPrimaryStatusReasons: readonly string[];
}

const CAMPAIGN_ID_QUERY_CHUNK_SIZE = 200;

export class CampaignSweepFilterError extends Error {}

/**
 * Server-side portion of the eligibility policy. The repeated reason field is
 * checked locally because it may contain multiple values.
 */
export function campaignSweepGaqlFilter(): string {
  return [
    `campaign.status IN (${CAMPAIGN_SWEEP_FILTER.allowedStatuses.join(", ")})`,
    `campaign.primary_status IN (${CAMPAIGN_SWEEP_FILTER.allowedPrimaryStatuses.join(", ")})`
  ].join("\n      AND ");
}

/**
 * Fetches campaign metadata only, then applies the complete eligibility policy
 * locally. Callers must use the returned IDs to scope any later metrics or
 * search-term query so rejected LIMITED campaigns never have their data read.
 */
export async function fetchCampaignsPassingSweepFilter(
  googleAds: Pick<GoogleAdsClient, "searchStream">,
  customerId: string
): Promise<CampaignSweepFilterContext[]> {
  const rows = await googleAds.searchStream(customerId, `
    SELECT
      campaign.id,
      campaign.status,
      campaign.primary_status,
      campaign.primary_status_reasons
    FROM campaign
    WHERE ${campaignSweepGaqlFilter()}
  `);

  const passingByCampaignId = new Map<string, CampaignSweepFilterContext>();
  for (const row of rows) {
    const campaign = recordValue(row.campaign);
    const campaignId = stringValue(campaign?.id);
    if (!campaignId) continue;
    const context = campaignSweepFilterContext(campaignId, campaign);
    if (campaignPassesSweepFilter(context)) {
      passingByCampaignId.set(campaignId, context);
    }
  }
  return [...passingByCampaignId.values()].sort((left, right) =>
    left.campaignId.localeCompare(right.campaignId)
  );
}

/** Fails closed when Google omits an enum value or returns an unknown state. */
export function campaignPassesSweepFilter(context: CampaignSweepFilterContext): boolean {
  const campaignStatus = enumValue(context.campaignStatus);
  if (!CAMPAIGN_SWEEP_FILTER.allowedStatuses.includes(campaignStatus)) return false;

  const primaryStatus = enumValue(context.campaignPrimaryStatus);
  if (!CAMPAIGN_SWEEP_FILTER.allowedPrimaryStatuses.includes(primaryStatus)) return false;

  const allowedReasons = CAMPAIGN_SWEEP_FILTER.allowedPrimaryStatusReasons[primaryStatus];
  if (allowedReasons === undefined) return true;

  const reasons = context.campaignPrimaryStatusReasons
    .map(enumValue)
    .filter(Boolean);
  return reasons.length > 0 && reasons.every((reason) => allowedReasons.includes(reason));
}

/**
 * Prevents an unfiltered row from reaching classification if a future fetch
 * path bypasses the campaign filter.
 */
export function assertCampaignsPassSweepFilter(
  contexts: readonly CampaignSweepFilterContext[],
  stage: "classification" | "mutation preparation"
): void {
  const rejectedCampaignIds = uniqueRejectedCampaignIds(contexts);
  if (rejectedCampaignIds.length === 0) return;
  throw new CampaignSweepFilterError(
    `Refusing ${stage}: ${rejectedCampaignIds.length} campaign(s) did not pass the daily campaign filter ` +
    `(${rejectedCampaignIds.join(", ")}).`
  );
}

/**
 * Reads the campaign state again immediately before the writer can validate or
 * apply a mutation. Any missing, paused, or newly ineligible campaign blocks
 * the whole mutation stage before its first mutation request.
 */
export async function assertCampaignsStillPassSweepFilter(
  googleAds: Pick<GoogleAdsClient, "searchStream">,
  customerId: string,
  campaignIds: readonly string[]
): Promise<void> {
  const uniqueCampaignIds = [...new Set(campaignIds.map((campaignId) => digits(campaignId, "campaign ID")))];
  if (uniqueCampaignIds.length === 0) return;

  const currentByCampaignId = new Map<string, CampaignSweepFilterContext>();
  for (let offset = 0; offset < uniqueCampaignIds.length; offset += CAMPAIGN_ID_QUERY_CHUNK_SIZE) {
    const chunk = uniqueCampaignIds.slice(offset, offset + CAMPAIGN_ID_QUERY_CHUNK_SIZE);
    const rows = await googleAds.searchStream(customerId, `
      SELECT
        campaign.id,
        campaign.status,
        campaign.primary_status,
        campaign.primary_status_reasons
      FROM campaign
      WHERE campaign.id IN (${chunk.join(", ")})
    `);
    for (const row of rows) {
      const campaign = recordValue(row.campaign);
      const campaignId = stringValue(campaign?.id);
      if (!uniqueCampaignIds.includes(campaignId)) continue;
      currentByCampaignId.set(campaignId, campaignSweepFilterContext(campaignId, campaign));
    }
  }

  const rejectedCampaignIds = uniqueCampaignIds.filter((campaignId) => {
    const context = currentByCampaignId.get(campaignId);
    return context === undefined || !campaignPassesSweepFilter(context);
  });
  if (rejectedCampaignIds.length === 0) return;
  throw new CampaignSweepFilterError(
    `Refusing Google Ads mutation: ${rejectedCampaignIds.length} campaign(s) no longer pass the daily campaign filter ` +
    `(${rejectedCampaignIds.join(", ")}). No mutation request was sent.`
  );
}

export function campaignSweepFilterContext(
  campaignId: string,
  campaign: Record<string, unknown> | null | undefined
): CampaignSweepFilterContext {
  return {
    campaignId: stringValue(campaignId),
    campaignStatus: enumValue(campaign?.status),
    campaignPrimaryStatus: enumValue(campaign?.primaryStatus),
    campaignPrimaryStatusReasons: enumValues(campaign?.primaryStatusReasons)
  };
}

export function campaignSweepFilterContextFromRow(
  row: Pick<SearchTermRow | ClassificationCandidate,
    "campaignId" | "campaignStatus" | "campaignPrimaryStatus" | "campaignPrimaryStatusReasons">
): CampaignSweepFilterContext {
  return {
    campaignId: row.campaignId,
    campaignStatus: row.campaignStatus ?? "",
    campaignPrimaryStatus: row.campaignPrimaryStatus ?? "",
    campaignPrimaryStatusReasons: row.campaignPrimaryStatusReasons ?? []
  };
}

function uniqueRejectedCampaignIds(contexts: readonly CampaignSweepFilterContext[]): string[] {
  return [...new Set(contexts
    .filter((context) => !campaignPassesSweepFilter(context))
    .map((context) => context.campaignId || "unknown"))]
    .sort((left, right) => left.localeCompare(right));
}

function digits(value: string, label: string): string {
  const clean = value.replaceAll("-", "");
  if (!/^\d+$/u.test(clean)) throw new Error(`Google Ads ${label} must contain only digits.`);
  return clean;
}

function enumValues(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const normalized = enumValue(value);
    return normalized ? [normalized] : [];
  }
  return value.map(enumValue).filter(Boolean);
}

function enumValue(value: unknown): string {
  return stringValue(value).trim().toUpperCase();
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
