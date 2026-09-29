import type {
  ClassificationCandidate,
  PositiveKeywordContext,
  PositiveKeywordCriterion
} from "../types.js";
import type { GoogleAdsClient } from "./client.js";

const CAMPAIGN_ID_QUERY_CHUNK_SIZE = 200;

/** Mirrors the daily campaign eligibility policy on main. */
export const POSITIVE_KEYWORD_CAMPAIGN_FILTER = {
  allowedStatuses: ["ENABLED"],
  allowedPrimaryStatuses: ["ELIGIBLE", "LIMITED"],
  allowedLimitedReasons: [
    "BUDGET_CONSTRAINED",
    "BIDDING_STRATEGY_LIMITED",
    "BIDDING_STRATEGY_CONSTRAINED",
    "SEARCH_VOLUME_LIMITED"
  ]
} as const;

export interface PositiveKeywordFetchOptions {
  /** Case-insensitive campaign-name substring. Null/blank disables the name gate. */
  campaignNameContains?: string | null | undefined;
}

/**
 * Fetches non-removed positive keywords only from campaigns that pass the
 * daily sweep campaign policy. Campaign metadata is filtered first so keyword
 * rows from rejected campaigns are never fetched. This is a configuration
 * read, not a dated performance query, so zero-impression and newly added
 * keywords inside qualifying campaigns are included.
 */
export async function fetchPositiveKeywords(
  client: Pick<GoogleAdsClient, "searchStream">,
  customerId: string,
  options: PositiveKeywordFetchOptions = {}
): Promise<PositiveKeywordCriterion[]> {
  const campaignIds = await fetchPositiveKeywordCampaignIds(client, customerId, options);
  if (campaignIds.length === 0) return [];

  const criteria: PositiveKeywordCriterion[] = [];
  for (let offset = 0; offset < campaignIds.length; offset += CAMPAIGN_ID_QUERY_CHUNK_SIZE) {
    const chunk = campaignIds.slice(offset, offset + CAMPAIGN_ID_QUERY_CHUNK_SIZE);
    const rows = await client.searchStream(customerId, `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group_criterion.criterion_id,
        ad_group_criterion.status,
        ad_group_criterion.negative,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type
      FROM ad_group_criterion
      WHERE campaign.id IN (${chunk.join(", ")})
        AND ad_group_criterion.type = KEYWORD
        AND ad_group_criterion.negative = FALSE
        AND ad_group_criterion.status != REMOVED
        AND campaign.status != REMOVED
        AND ad_group.status != REMOVED
    `);
    for (const row of rows) {
      const campaign = recordValue(row.campaign);
      const adGroup = recordValue(row.adGroup);
      const criterion = recordValue(row.adGroupCriterion);
      const keyword = recordValue(criterion?.keyword);
      const campaignId = idValue(campaign?.id);
      const adGroupId = idValue(adGroup?.id);
      const criterionId = idValue(criterion?.criterionId);
      const keywordText = stringValue(keyword?.text);
      if (!campaignIds.includes(campaignId) || !adGroupId || !criterionId || !keywordText || criterion?.negative === true) continue;
      const campaignStatus = enumValue(campaign?.status);
      const adGroupStatus = enumValue(adGroup?.status);
      const criterionStatus = enumValue(criterion?.status);
      criteria.push({
        campaignId,
        campaignName: stringValue(campaign?.name),
        campaignStatus,
        adGroupId,
        adGroupName: stringValue(adGroup?.name),
        adGroupStatus,
        criterionId,
        criterionStatus,
        keywordText,
        normalizedKeywordText: normalizeKeywordText(keywordText),
        matchType: enumValue(keyword?.matchType),
        active: campaignStatus === "ENABLED" && adGroupStatus === "ENABLED" && criterionStatus === "ENABLED"
      });
    }
  }
  return criteria.sort((left, right) =>
    left.campaignId.localeCompare(right.campaignId)
    || left.adGroupId.localeCompare(right.adGroupId)
    || left.criterionId.localeCompare(right.criterionId)
  );
}

export async function fetchPositiveKeywordCampaignIds(
  client: Pick<GoogleAdsClient, "searchStream">,
  customerId: string,
  options: PositiveKeywordFetchOptions = {}
): Promise<string[]> {
  const rows = await client.searchStream(customerId, `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.primary_status,
      campaign.primary_status_reasons
    FROM campaign
    WHERE campaign.status IN (${POSITIVE_KEYWORD_CAMPAIGN_FILTER.allowedStatuses.join(", ")})
      AND campaign.primary_status IN (${POSITIVE_KEYWORD_CAMPAIGN_FILTER.allowedPrimaryStatuses.join(", ")})
  `);
  const needle = options.campaignNameContains?.trim().toLocaleLowerCase("en-US") ?? "";
  const allowedReasons = new Set<string>(POSITIVE_KEYWORD_CAMPAIGN_FILTER.allowedLimitedReasons);
  const passing = new Set<string>();
  for (const row of rows) {
    const campaign = recordValue(row.campaign);
    const campaignId = idValue(campaign?.id);
    const name = stringValue(campaign?.name);
    const status = enumValue(campaign?.status);
    const primaryStatus = enumValue(campaign?.primaryStatus);
    const reasons = enumValues(campaign?.primaryStatusReasons);
    if (!campaignId || !POSITIVE_KEYWORD_CAMPAIGN_FILTER.allowedStatuses.includes(status as never)) continue;
    if (!POSITIVE_KEYWORD_CAMPAIGN_FILTER.allowedPrimaryStatuses.includes(primaryStatus as never)) continue;
    if (needle && !name.toLocaleLowerCase("en-US").includes(needle)) continue;
    if (primaryStatus === "LIMITED" && (reasons.length === 0 || reasons.some((reason) => !allowedReasons.has(reason)))) continue;
    passing.add(campaignId);
  }
  return [...passing].sort((left, right) => left.localeCompare(right));
}

export function attachPositiveKeywordContext(
  candidates: ClassificationCandidate[],
  criteria: PositiveKeywordCriterion[]
): ClassificationCandidate[] {
  const byText = new Map<string, PositiveKeywordCriterion[]>();
  for (const criterion of criteria) {
    const matches = byText.get(criterion.normalizedKeywordText) ?? [];
    matches.push(criterion);
    byText.set(criterion.normalizedKeywordText, matches);
  }
  return candidates.map((candidate) => ({
    ...candidate,
    positiveKeywordContext: positiveKeywordContext(candidate, byText.get(normalizeKeywordText(candidate.searchTerm)) ?? [])
  }));
}

export function activeSameCampaignPositiveMatches(
  campaignId: string,
  keywordText: string,
  criteria: PositiveKeywordCriterion[]
): PositiveKeywordCriterion[] {
  const normalized = normalizeKeywordText(keywordText);
  return criteria.filter((criterion) =>
    criterion.active
    && criterion.campaignId === campaignId
    && criterion.normalizedKeywordText === normalized
  );
}

export function normalizeKeywordText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function positiveKeywordContext(
  candidate: ClassificationCandidate,
  exactMatches: PositiveKeywordCriterion[]
): PositiveKeywordContext {
  const sameCampaign = exactMatches.filter((criterion) => criterion.campaignId === candidate.campaignId);
  const activeSameCampaign = sameCampaign.filter((criterion) => criterion.active);
  return {
    exactTextMatchCount: exactMatches.length,
    activeSameCampaignExactMatch: activeSameCampaign.length > 0,
    pausedSameCampaignExactMatch: sameCampaign.some((criterion) => !criterion.active),
    activeOtherCampaignExactMatch: exactMatches.some((criterion) =>
      criterion.active && criterion.campaignId !== candidate.campaignId),
    activeSameCampaignMatchTypes: [...new Set(activeSameCampaign.map((criterion) => criterion.matchType))].sort()
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function idValue(value: unknown): string {
  const result = stringValue(value);
  return /^\d+$/u.test(result) ? result : "";
}

function enumValue(value: unknown): string {
  return stringValue(value).trim().toUpperCase();
}

function enumValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(enumValue).filter(Boolean);
  const normalized = enumValue(value);
  return normalized ? [normalized] : [];
}
