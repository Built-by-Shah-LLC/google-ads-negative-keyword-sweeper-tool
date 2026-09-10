import { createHash } from "node:crypto";
import type { ClassificationCandidate, DateRange, SearchTermRow } from "../types.js";
import type { GoogleAdsClient } from "./client.js";

export async function fetchSearchTermsForDateRange(
  client: GoogleAdsClient,
  customerId: string,
  dateRange: DateRange
): Promise<SearchTermRow[]> {
  assertDateRange(dateRange);
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
    WHERE segments.date BETWEEN '${dateRange.startDate}' AND '${dateRange.endDate}'
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
    WHERE segments.date BETWEEN '${dateRange.startDate}' AND '${dateRange.endDate}'
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
        row.channel,
        row.campaignId,
        row.adGroupId || "",
        normalizedTerm
      ].join("\u0000"))
      .digest("hex")
      .slice(0, 24);
    const existing = candidates.get(itemId);
    if (!existing) {
      const { date, ...candidate } = row;
      candidates.set(itemId, {
        ...candidate,
        itemId,
        startDate: date,
        endDate: date,
        impressionsExact: exactInteger(row, "impressions"),
        clicksExact: exactInteger(row, "clicks"),
        costMicrosExact: exactInteger(row, "costMicros"),
        conversionsExact: exactDecimal(row, "conversions"),
        conversionValueExact: exactDecimal(row, "conversionValue")
      });
      continue;
    }
    if (row.date < existing.startDate) existing.startDate = row.date;
    if (row.date > existing.endDate) existing.endDate = row.date;
    existing.impressions += row.impressions;
    existing.clicks += row.clicks;
    existing.costMicros += row.costMicros;
    existing.conversions += row.conversions;
    existing.conversionValue += row.conversionValue;
    existing.impressionsExact = addIntegerStrings(
      existing.impressionsExact ?? nonNegativeIntegerString(existing.impressions),
      exactInteger(row, "impressions")
    );
    existing.clicksExact = addIntegerStrings(
      existing.clicksExact ?? nonNegativeIntegerString(existing.clicks),
      exactInteger(row, "clicks")
    );
    existing.costMicrosExact = addIntegerStrings(
      existing.costMicrosExact ?? nonNegativeIntegerString(existing.costMicros),
      exactInteger(row, "costMicros")
    );
    existing.conversionsExact = addDecimalStrings(
      existing.conversionsExact ?? nonNegativeDecimalString(existing.conversions),
      exactDecimal(row, "conversions")
    );
    existing.conversionValueExact = addDecimalStrings(
      existing.conversionValueExact ?? nonNegativeDecimalString(existing.conversionValue),
      exactDecimal(row, "conversionValue")
    );
  }
  return [...candidates.values()].sort((left, right) => left.itemId.localeCompare(right.itemId));
}

function assertDateRange(dateRange: DateRange): void {
  assertDate(dateRange.startDate);
  assertDate(dateRange.endDate);
  if (dateRange.startDate > dateRange.endDate) {
    throw new Error("Date range startDate must not be after endDate.");
  }
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
    conversionValue: numberValue(row.metrics?.conversionsValue),
    impressionsExact: nonNegativeIntegerString(row.metrics?.impressions),
    clicksExact: nonNegativeIntegerString(row.metrics?.clicks),
    costMicrosExact: nonNegativeIntegerString(row.metrics?.costMicros),
    conversionsExact: nonNegativeDecimalString(row.metrics?.conversions),
    conversionValueExact: nonNegativeDecimalString(row.metrics?.conversionsValue)
  };
}

function nonNegativeIntegerString(value: unknown): string {
  const normalized = String(value ?? "0").trim();
  if (!/^\d+$/u.test(normalized)) return "0";
  return BigInt(normalized).toString();
}

function nonNegativeDecimalString(value: unknown): string {
  const normalized = String(value ?? "0").trim();
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(normalized);
  if (!match) return "0";
  const whole = BigInt(match[1] ?? "0").toString();
  const fraction = (match[2] ?? "").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function exactInteger(row: SearchTermRow, field: "impressions" | "clicks" | "costMicros"): string {
  const exactField = `${field}Exact` as const;
  return row[exactField] ?? nonNegativeIntegerString(row[field]);
}

function exactDecimal(row: SearchTermRow, field: "conversions" | "conversionValue"): string {
  const exactField = `${field}Exact` as const;
  return row[exactField] ?? nonNegativeDecimalString(row[field]);
}

function addIntegerStrings(left: string, right: string): string {
  return (BigInt(left) + BigInt(right)).toString();
}

function addDecimalStrings(left: string, right: string): string {
  const [leftWhole = "0", leftFraction = ""] = left.split(".");
  const [rightWhole = "0", rightFraction = ""] = right.split(".");
  const places = Math.max(leftFraction.length, rightFraction.length);
  const scale = 10n ** BigInt(places);
  const leftScaled = BigInt(leftWhole) * scale + BigInt(leftFraction.padEnd(places, "0") || "0");
  const rightScaled = BigInt(rightWhole) * scale + BigInt(rightFraction.padEnd(places, "0") || "0");
  const total = leftScaled + rightScaled;
  if (places === 0) return total.toString();
  const digits = total.toString().padStart(places + 1, "0");
  const whole = digits.slice(0, -places);
  const fraction = digits.slice(-places).replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole;
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
