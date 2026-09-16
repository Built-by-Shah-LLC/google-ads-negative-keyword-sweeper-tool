import type {
  ClassificationCandidate,
  ClassificationDecision,
  Organization
} from "../types.js";
import type { NegativeKeywordMutationSummary } from "../google-ads/negative-keyword-writer.js";
import { createEffectiveDecisions } from "./effective-decisions.js";

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
  "positiveKeywordExactMatchCount",
  "activeSameCampaignPositiveKeyword",
  "pausedSameCampaignPositiveKeyword",
  "activeOtherCampaignPositiveKeyword",
  "activeSameCampaignPositiveMatchTypes",
  "impressions",
  "clicks",
  "costMicros",
  "conversions",
  "conversionValue",
  "decision",
  "effectiveOutcome",
  "positiveKeywordProtectionSource",
  "positiveKeywordCriterionIds",
  "positiveKeywordMatchTypes",
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
  ruleVersion: string,
  mutation?: NegativeKeywordMutationSummary
): string {
  const decisionsById = new Map(
    createEffectiveDecisions(candidates, decisions, mutation).map((decision) => [decision.itemId, decision])
  );
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
      candidate.positiveKeywordContext?.exactTextMatchCount ?? 0,
      candidate.positiveKeywordContext?.activeSameCampaignExactMatch ? "true" : "false",
      candidate.positiveKeywordContext?.pausedSameCampaignExactMatch ? "true" : "false",
      candidate.positiveKeywordContext?.activeOtherCampaignExactMatch ? "true" : "false",
      candidate.positiveKeywordContext?.activeSameCampaignMatchTypes.join(";") ?? "",
      candidate.impressions,
      candidate.clicks,
      candidate.costMicros,
      candidate.conversions,
      candidate.conversionValue,
      decision?.decision ?? null,
      decision?.effectiveOutcome ?? null,
      decision?.positiveKeywordProtectionSource ?? null,
      decision?.positiveCriterionIds.join(";") ?? null,
      decision?.positiveMatchTypes.join(";") ?? null,
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
