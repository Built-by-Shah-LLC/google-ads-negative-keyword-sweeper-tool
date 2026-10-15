import type { RecoveryBlocker, RecoveryExclusionDetails } from "./contract.js";
import type { RecoveryExclusion, RecoveryFact } from "./sources.js";
import { negativeMatches } from "./scoring.js";
export function exclusionDetails(exclusion: RecoveryExclusion): RecoveryExclusionDetails {
  return exclusion.details ?? { resourceId: exclusion.resource, listResourceId: null, listName: null, attachmentResourceIds: [], campaigns: exclusion.campaignIds.slice(0, 200).map(campaignId => ({ campaignId, campaignName: null, channel: null, status: null })), detailsComplete: false, brandMembers: [] };
}
export interface BlockerLookup {
  cache: Map<string, {
    matches: {
      other: RecoveryExclusion;
      match: boolean | null;
    }[];
    complete: boolean;
  }>;
  remaining: number;
}
export function recoveryBlockers(exclusion: RecoveryExclusion, others: RecoveryExclusion[], facts: RecoveryFact[], campaignId = "", lookup: BlockerLookup = { cache: new Map(), remaining: 2000000 }): {
  blockers: RecoveryBlocker[];
  known: number;
  possible: number;
  complete: boolean;
} {
  const found = new Map<string, RecoveryBlocker>();
  let coverageComplete = true;
  // Candidate text is only a minimum-query witness. It is not invented historic demand or proof of full phrase/broad overlap.
  const witnesses = facts.length ? [...new Map(facts.map(f => [JSON.stringify([f.adGroupId, f.query]), { query: f.query, group: f.adGroupId }])).values()] : [{ query: exclusion.text, group: exclusion.adGroupId }];
  for (const witness of witnesses) {
    const cacheKey = JSON.stringify([campaignId, witness.group, witness.query]);
    let cached = lookup.cache.get(cacheKey);
    if (!cached) {
      cached = { matches: [], complete: true };
      for (const other of others) {
        if (other.adGroupId && witness.group && other.adGroupId !== witness.group)
          continue;
        if (lookup.remaining-- <= 0) {
          cached.complete = false;
          break;
        }
        const match = other.kind === "brand" ? null : negativeMatches(other.text, witness.query, other.matchType!);
        if (match !== false)
          cached.matches.push({ other, match });
      }
      lookup.cache.set(cacheKey, cached);
    }
    coverageComplete &&= cached.complete;
    for (const { other, match } of cached.matches) {
      if (other.resource === exclusion.resource)
        continue;
      if (match === false)
        continue;
      const certainty = match === true && (!other.adGroupId || other.adGroupId === witness.group) ? "known" : "possible";
      const existing = found.get(other.resource);
      if (existing) {
        if (certainty === "known")
          existing.certainty = "known";
        if (!existing.querySamples.includes(witness.query) && existing.querySamples.length < 3)
          existing.querySamples.push(witness.query);
      }
      else {
        found.set(other.resource, { resourceId: other.resource, text: other.text, kind: other.kind, scope: other.scope, matchType: other.matchType, listResourceId: other.details?.listResourceId ?? null, listName: other.details?.listName ?? null, adGroupId: other.adGroupId, adGroupName: other.adGroupName, affectedCampaignCount: new Set(other.campaignIds).size, certainty, basis: facts.length ? "observed_query" : "candidate_text", querySamples: [witness.query] });
      }
    }
  }
  const all = [...found.values()].sort((a, b) => a.certainty.localeCompare(b.certainty) || a.resourceId.localeCompare(b.resourceId));
  return { blockers: all.slice(0, 200), known: all.filter(b => b.certainty === "known").length, possible: all.filter(b => b.certainty === "possible").length, complete: coverageComplete && (facts.length > 0 || exclusion.kind === "keyword" && exclusion.matchType === "EXACT") && all.length <= 200 && all.every(b => b.certainty === "known") };
}
