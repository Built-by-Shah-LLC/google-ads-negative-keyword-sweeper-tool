import type {
  ClassificationCandidate,
  ClassificationDecision,
  Organization
} from "../types.js";
import type { NegativeKeywordMutationSummary } from "../google-ads/negative-keyword-writer.js";
import { createEffectiveDecisions } from "./effective-decisions.js";

const HEADERS = [
  "classificationStatus",
  "organizationName",
  "searchTerm",
  "decision",
  "reason",
  "campaignName",
  "adGroupName",
  "negativeText",
  "ruleIds",
  "confidence",
  "effectiveOutcome",
  "positiveKeywordExactMatchCount",
  "activeSameCampaignPositiveKeyword",
  "pausedSameCampaignPositiveKeyword",
  "activeOtherCampaignPositiveKeyword",
  "activeSameCampaignPositiveMatchTypes",
  "positiveKeywordProtectionSource",
  "positiveKeywordCriterionIds",
  "positiveKeywordMatchTypes",
  "impressions",
  "clicks",
  "costMicros",
  "conversions",
  "conversionValue",
  "channel",
  "targetingStatus",
  "matchedKeyword",
  "matchedKeywordMatchType",
  "customerId",
  "date",
  "itemId",
  "campaignId",
  "adGroupId",
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
  for (const candidate of [...candidates].sort(compareCandidatesBySearchTerm)) {
    const decision = decisionsById.get(candidate.itemId);
    lines.push([
      decision ? "VALIDATED" : "MISSING",
      organization.descriptiveName,
      candidate.searchTerm,
      decision?.decision ?? null,
      decision?.reason ?? null,
      candidate.campaignName,
      candidate.adGroupName,
      decision?.negativeText ?? null,
      decision?.ruleIds.join(";") ?? null,
      decision?.confidence ?? null,
      decision?.effectiveOutcome ?? null,
      candidate.positiveKeywordContext?.exactTextMatchCount ?? 0,
      candidate.positiveKeywordContext?.activeSameCampaignExactMatch ? "true" : "false",
      candidate.positiveKeywordContext?.pausedSameCampaignExactMatch ? "true" : "false",
      candidate.positiveKeywordContext?.activeOtherCampaignExactMatch ? "true" : "false",
      candidate.positiveKeywordContext?.activeSameCampaignMatchTypes.join(";") ?? "",
      decision?.positiveKeywordProtectionSource ?? null,
      decision?.positiveCriterionIds.join(";") ?? null,
      decision?.positiveMatchTypes.join(";") ?? null,
      candidate.impressions,
      candidate.clicks,
      candidate.costMicros,
      candidate.conversions,
      candidate.conversionValue,
      candidate.channel,
      candidate.targetingStatus,
      candidate.matchedKeyword,
      candidate.matchedKeywordMatchType,
      organization.customerId,
      date,
      candidate.itemId,
      candidate.campaignId,
      candidate.adGroupId,
      model,
      ruleVersion
    ].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function compareCandidatesBySearchTerm(left: ClassificationCandidate, right: ClassificationCandidate): number {
  return left.searchTerm.localeCompare(right.searchTerm, "en-US", { sensitivity: "base", numeric: true })
    || left.campaignName.localeCompare(right.campaignName, "en-US", { sensitivity: "base", numeric: true })
    || left.campaignId.localeCompare(right.campaignId, "en-US", { numeric: true })
    || left.itemId.localeCompare(right.itemId, "en-US");
}

function csvCell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  // CSV is for inspection, not mutation input. Neutralize spreadsheet formulas;
  // exact unmodified terms remain available in the JSON artifacts.
  if (/^[\t\r ]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
