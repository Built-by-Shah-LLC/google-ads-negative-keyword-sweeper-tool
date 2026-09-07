import type {
  ClassificationCandidate,
  ClassificationDecision,
  Organization
} from "../types.js";

const HEADERS = [
  "classificationStatus",
  "customerId",
  "organizationName",
  "date",
  "itemId",
  "channel",
  "campaignId",
  "campaignName",
  "adGroupId",
  "adGroupName",
  "searchTerm",
  "targetingStatus",
  "matchedKeyword",
  "matchedKeywordMatchType",
  "impressions",
  "clicks",
  "costMicros",
  "conversions",
  "conversionValue",
  "decision",
  "negativeText",
  "ruleIds",
  "reason",
  "confidence",
  "model",
  "ruleVersion"
] as const;

export function createDecisionCsv(
  organization: Organization,
  date: string,
  candidates: ClassificationCandidate[],
  decisions: ClassificationDecision[],
  model: string,
  ruleVersion: string
): string {
  const decisionsById = new Map(decisions.map((decision) => [decision.itemId, decision]));
  const lines = [HEADERS.map(csvCell).join(",")];
  for (const candidate of candidates) {
    const decision = decisionsById.get(candidate.itemId);
    lines.push([
      decision ? "VALIDATED" : "MISSING",
      organization.customerId,
      organization.descriptiveName,
      date,
      candidate.itemId,
      candidate.channel,
      candidate.campaignId,
      candidate.campaignName,
      candidate.adGroupId,
      candidate.adGroupName,
      candidate.searchTerm,
      candidate.targetingStatus,
      candidate.matchedKeyword,
      candidate.matchedKeywordMatchType,
      candidate.impressions,
      candidate.clicks,
      candidate.costMicros,
      candidate.conversions,
      candidate.conversionValue,
      decision?.decision ?? null,
      decision?.negativeText ?? null,
      decision?.ruleIds.join(";") ?? null,
      decision?.reason ?? null,
      decision?.confidence ?? null,
      model,
      ruleVersion
    ].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function csvCell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  // CSV is for inspection, not mutation input. Neutralize spreadsheet formulas;
  // exact unmodified terms remain available in the JSON artifacts.
  if (/^[\t\r ]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
