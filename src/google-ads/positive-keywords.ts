import type {
  ClassificationCandidate,
  PositiveKeywordContext,
  PositiveKeywordCriterion
} from "../types.js";
import type { GoogleAdsClient } from "./client.js";

/**
 * Fetches the complete non-removed positive keyword inventory. This is a
 * configuration read, not a dated performance query, so zero-impression and
 * newly added keywords are included.
 */
export async function fetchPositiveKeywords(
  client: Pick<GoogleAdsClient, "searchStream">,
  customerId: string
): Promise<PositiveKeywordCriterion[]> {
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
    WHERE ad_group_criterion.type = KEYWORD
      AND ad_group_criterion.negative = FALSE
      AND ad_group_criterion.status != REMOVED
      AND campaign.status != REMOVED
      AND ad_group.status != REMOVED
  `);
  const criteria: PositiveKeywordCriterion[] = [];
  for (const row of rows) {
    const campaign = recordValue(row.campaign);
    const adGroup = recordValue(row.adGroup);
    const criterion = recordValue(row.adGroupCriterion);
    const keyword = recordValue(criterion?.keyword);
    const campaignId = idValue(campaign?.id);
    const adGroupId = idValue(adGroup?.id);
    const criterionId = idValue(criterion?.criterionId);
    const keywordText = stringValue(keyword?.text);
    if (!campaignId || !adGroupId || !criterionId || !keywordText || criterion?.negative === true) continue;
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
  return criteria.sort((left, right) =>
    left.campaignId.localeCompare(right.campaignId)
    || left.adGroupId.localeCompare(right.adGroupId)
    || left.criterionId.localeCompare(right.criterionId)
  );
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
