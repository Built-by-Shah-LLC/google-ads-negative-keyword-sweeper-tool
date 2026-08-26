import { createHash } from "node:crypto";
import type { ClassificationCandidate, SearchTermRow } from "../types.js";
import type { GoogleAdsClient } from "./client.js";

export async function fetchDailySearchTerms(
  client: GoogleAdsClient,
  customerId: string,
  date: string
): Promise<SearchTermRow[]> {
  assertDate(date);
  const searchQuery = `
    SELECT
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      search_term_view.search_term,
      search_term_view.status,
      segments.date,
      segments.keyword.info.text,
      segments.keyword.info.match_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM search_term_view
    WHERE segments.date = '${date}'
      AND metrics.impressions > 0
  `;
  const performanceMaxQuery = `
    SELECT
      campaign.id,
      campaign.name,
      campaign_search_term_view.search_term,
      segments.date,
      segments.search_term_targeting_status,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign_search_term_view
    WHERE segments.date = '${date}'
      AND campaign.advertising_channel_type = PERFORMANCE_MAX
      AND metrics.impressions > 0
  `;

  const [searchRows, performanceMaxRows] = await Promise.all([
    client.searchStream(customerId, searchQuery),
    client.searchStream(customerId, performanceMaxQuery)
  ]);
  return [
    ...searchRows.map((row) => mapSearchRow(customerId, row, "SEARCH")),
    ...performanceMaxRows.map((row) => mapSearchRow(customerId, row, "PERFORMANCE_MAX"))
  ].filter((row): row is SearchTermRow => row !== null);
}

export function aggregateCandidates(rows: SearchTermRow[]): ClassificationCandidate[] {
  const candidates = new Map<string, ClassificationCandidate>();
  for (const row of rows) {
    const normalizedTerm = row.searchTerm.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
    const itemId = createHash("sha256")
      .update([
        row.customerId,
        row.date,
        row.channel,
        row.campaignId,
        row.adGroupId || "",
        normalizedTerm
      ].join("\u0000"))
      .digest("hex")
      .slice(0, 24);
    const existing = candidates.get(itemId);
    if (!existing) {
      candidates.set(itemId, { ...row, itemId });
      continue;
    }
    existing.impressions += row.impressions;
    existing.clicks += row.clicks;
    existing.costMicros += row.costMicros;
    existing.conversions += row.conversions;
    existing.conversionValue += row.conversionValue;
  }
  return [...candidates.values()].sort((left, right) => left.itemId.localeCompare(right.itemId));
}

function mapSearchRow(
  customerId: string,
  row: Record<string, any>,
  channel: SearchTermRow["channel"]
): SearchTermRow | null {
  const view = channel === "SEARCH" ? row.searchTermView : row.campaignSearchTermView;
  const searchTerm = stringValue(view?.searchTerm);
  const campaignId = stringValue(row.campaign?.id);
  const date = stringValue(row.segments?.date);
  if (!searchTerm || !campaignId || !date) return null;
  return {
    customerId,
    date,
    channel,
    campaignId,
    campaignName: stringValue(row.campaign?.name),
    adGroupId: nullableString(row.adGroup?.id),
    adGroupName: nullableString(row.adGroup?.name),
    searchTerm,
    targetingStatus: nullableString(
      channel === "SEARCH" ? row.searchTermView?.status : row.segments?.searchTermTargetingStatus
    ),
    matchedKeyword: nullableString(row.segments?.keyword?.info?.text),
    matchedKeywordMatchType: nullableString(row.segments?.keyword?.info?.matchType),
    impressions: numberValue(row.metrics?.impressions),
    clicks: numberValue(row.metrics?.clicks),
    costMicros: numberValue(row.metrics?.costMicros),
    conversions: numberValue(row.metrics?.conversions),
    conversionValue: numberValue(row.metrics?.conversionsValue)
  };
}

function assertDate(value: string): void {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Invalid date '${value}'. Expected YYYY-MM-DD.`);
  }
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function nullableString(value: unknown): string | null {
  return stringValue(value) || null;
}
