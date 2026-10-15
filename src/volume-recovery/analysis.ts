import { createHash } from "node:crypto";
import type { RecoveryItem, RecoveryPolicy, RecoveryCoverage } from "./contract.js";
import type { RecoveryExclusion, RecoverySources } from "./sources.js";
import { decimal, divide, fraction, monday, negativeMatches, recoveryScore, sumDecimals } from "./scoring.js";
export interface RecoveryIntent {
  itemId: string;
  category: string | null;
  competitorLikelihood: RecoveryItem["competitorLikelihood"];
  confidence: number;
  reason: string;
}
export interface RecoveryCandidate {
  key: string;
  exclusion: RecoveryExclusion;
  campaignId: string | null;
}
export function recoveryCandidates(sources: RecoverySources): RecoveryCandidate[] {
  const active = new Set(sources.campaigns.filter(c => c.status === "ENABLED").map(c => c.id));
  const result: RecoveryCandidate[] = [];
  for (const exclusion of sources.exclusions) {
    const campaigns = exclusion.campaignIds.filter(id => active.has(id));
    for (const campaignId of campaigns.length ? campaigns : [null]) {
      result.push({
        key: createHash("sha256").update(JSON.stringify([exclusion.resource, exclusion.scope, campaignId, exclusion.adGroupId])).digest("hex"),
        exclusion,
        campaignId
      });
      if (result.length > 10000) return result; // One extra row signals a bounded, explicitly partial report.
    }
  }
  return result;
}
function available(sources: RecoverySources, source: string): boolean {
  return sources.coverage.some(entry => entry.source === source && entry.available);
}
export function analyzeRecovery(sources: RecoverySources, policy: RecoveryPolicy, intents: RecoveryIntent[], targetCpa: string | null): {
  items: {
    key: string;
    resource: string;
    item: RecoveryItem;
  }[];
  readiness: "green" | "amber" | "red";
  readinessReasons: string[];
  coverage: RecoveryCoverage[];
} {
  const priorities = {
    qualified_lead: 3,
    revenue: 2,
    raw_lead: 1,
    ignore: 0
  };
  // One outcome action avoids counting several funnel steps as separate people.
  const measurement = [...sources.actions].filter(a => a.kind !== "ignore").sort((a, b) => priorities[b.kind] - priorities[a.kind] || Number(b.primary) - Number(a.primary))[0];
  const readiness = !measurement ? "red" : measurement.kind === "raw_lead" ? "amber" : "green";
  const readinessReasons = !measurement ? ["No interpretable lead or sale action was available."] : measurement.kind === "raw_lead" ? ["Selected action records raw conversion events; lead quality is unconfirmed."] : ["Google Ads reports a qualified outcome or sale; this is reported attribution, not independent CRM verification."];
  readinessReasons.push("Conversion counts are events for one selected action, not deduplicated people.");
  const intentById = new Map(intents.map(intent => [intent.itemId, intent]));
  const inventoryComplete = ["campaigns", "campaign_negatives", "ad_group_negatives", "account_negatives", "shared_sets", "shared_attachments", "shared_keywords", "brand_exclusions"].every(name => available(sources, name));
  const factsByCampaign = new Map<string, RecoverySources["facts"]>();
  for (const fact of sources.facts) {
    const list = factsByCampaign.get(fact.campaignId) ?? [];
    list.push(fact);
    factsByCampaign.set(fact.campaignId, list);
  }
  const exclusionsByCampaign = new Map<string, RecoveryExclusion[]>();
  for (const exclusion of sources.exclusions) for (const id of exclusion.campaignIds) {
    const list = exclusionsByCampaign.get(id) ?? [];
    list.push(exclusion);
    exclusionsByCampaign.set(id, list);
  }
  const conversionByKey = new Map<string, RecoverySources["conversionFacts"]>();
  for (const fact of sources.conversionFacts) {
    const list = conversionByKey.get(fact.key) ?? [];
    list.push(fact);
    conversionByKey.set(fact.key, list);
  }
  const blockerCache = new Map<string, {
    resources: Set<string>;
    uncertain: boolean;
  }>();
  const results = recoveryCandidates(sources).map(candidate => {
    const {
      exclusion,
      campaignId,
      key
    } = candidate;
    const campaign = sources.campaigns.find(c => c.id === campaignId);
    const channel = campaign?.channel ?? null;
    const intent = intentById.get(key);
    let uncertain = false;
    const facts = (factsByCampaign.get(campaignId ?? "") ?? []).filter(fact => {
      if (campaignId !== fact.campaignId || exclusion.kind !== "keyword" || !exclusion.matchType || exclusion.adGroupId && exclusion.adGroupId !== fact.adGroupId) return false;
      const match = negativeMatches(exclusion.text, fact.query, exclusion.matchType);
      if (match === null) uncertain = true;
      return match === true;
    });
    const otherBlockers = new Set<string>();
    for (const fact of facts) {
      const cacheKey = JSON.stringify([fact.campaignId, fact.adGroupId, fact.query]);
      let blockers = blockerCache.get(cacheKey);
      if (!blockers) {
        blockers = {
          resources: new Set(),
          uncertain: false
        };
        for (const other of exclusionsByCampaign.get(fact.campaignId) ?? []) {
          if (other.adGroupId && other.adGroupId !== fact.adGroupId) continue;
          if (other.kind === "brand") {
            blockers.uncertain = true;
            continue;
          }
          const match = negativeMatches(other.text, fact.query, other.matchType!);
          if (match === true) blockers.resources.add(other.resource);
          if (match === null) blockers.uncertain = true;
        }
        blockerCache.set(cacheKey, blockers);
      }
      uncertain ||= blockers.uncertain;
      for (const resource of blockers.resources) if (resource !== exclusion.resource) otherBlockers.add(resource);
    }
    if ((exclusionsByCampaign.get(campaignId ?? "") ?? []).some(other => other.kind === "brand")) uncertain = true;
    const complete = inventoryComplete && !uncertain;
    const sum = (values: (string | null)[]) => values.length && values.every((v): v is string => v !== null) ? sumDecimals(values) : null;
    const actionFacts = facts.flatMap(fact => conversionByKey.get(fact.key) ?? []);
    const conversionsAvailable = Boolean(channel && available(sources, channel + "_conversion_events") && available(sources, "conversion_actions"));
    const actionEvidence = sources.actions.map(action => {
      const matched = actionFacts.filter(fact => fact.action === action.resource);
      return {
        ...action,
        events: facts.length && conversionsAvailable ? matched.length ? sum(matched.map(fact => fact.events)) : "0" : null,
        value: facts.length && conversionsAvailable ? matched.length ? sum(matched.map(fact => fact.value)) : "0" : null
      };
    });
    const supported = actionEvidence.filter(action => action.kind !== "ignore");
    const observed = supported.filter(action => action.events !== null && fraction(action.events).n > 0n);
    // Select one supported outcome for this query context; preserve, but never sum, overlapping funnel actions.
    const selected = (observed.length ? observed : supported).sort((a, b) => priorities[b.kind] - priorities[a.kind] || Number(b.primary) - Number(a.primary) || a.resource.localeCompare(b.resource))[0];
    const conversions = actionFacts.filter(fact => fact.action === selected?.resource);
    const clicks = sum(facts.map(f => f.clicks)),
      impressions = sum(facts.map(f => f.impressions)),
      micros = sum(facts.map(f => f.costMicros));
    const cost = micros === null ? null : decimal({
      n: fraction(micros).n,
      d: fraction(micros).d * 1000000n
    }, 6);
    const events = selected?.events ?? null;
    const value = selected?.value ?? null;
    const positive = events !== null && fraction(events).n > 0n;
    const valueClass = positive ? selected?.kind === "qualified_lead" || selected?.kind === "revenue" ? "A" : "C" : clicks !== null && fraction(clicks).n > 0n ? "D" : "E";
    const dates = facts.map(f => f.date).sort();
    const recentStart = new Date(Date.parse(sources.dates.endDate + "T00:00:00Z") - 29 * 86400000).toISOString().slice(0, 10);
    const conversionKeys = new Set(conversions.filter(c => c.events !== null && fraction(c.events).n > 0n).map(c => c.key));
    const weeks = new Set(facts.filter(f => conversionKeys.has(f.key) && monday(f.date) < monday(sources.dates.today)).map(f => monday(f.date)));
    // No revenue target is configured in v1: never substitute event counts for ROAS.
    const targetApplicable = selected?.kind !== "revenue" && selected?.primary && sources.goalCategories.length === 1 && sources.goalCategories[0] === selected.category && available(sources, "campaign_goal_configuration") && sources.campaignGoalLevels?.[campaignId ?? ""] === "CUSTOMER";
    const score = facts.length ? recoveryScore({
      qualityEvents: selected?.kind === "qualified_lead" ? events : null,
      conversions: events,
      clicks,
      cost,
      targetCpa: targetApplicable ? targetCpa : null,
      recent: dates.some(date => date >= recentStart),
      completedConversionWeeks: weeks.size
    }) : null;
    const category = intent?.category ?? null;
    const action = category ? policy.categoryActions[category] ?? (/COMPETITOR|AMBIGUOUS/.test(category) ? "review" : "retain") : "review";
    let recommendation: RecoveryItem["recommendation"] = action === "retain" ? "retain" : facts.length ? "manual_review" : "insufficient_evidence";
    if (action === "consider" && valueClass === "A" && readiness === "green" && complete && conversionsAvailable && available(sources, (channel ?? "") + "_traffic") && otherBlockers.size === 0 && exclusion.scope === "campaign" && exclusion.matchType === "EXACT" && intent && intent.confidence >= 0.8 && facts.length) recommendation = "potential_pilot";
    if (exclusion.kind === "brand") recommendation = "manual_review";
    const cpa = cost !== null && events !== null ? divide(fraction(cost), fraction(events)) : null;
    const item: RecoveryItem = {
      id: key,
      negativeText: exclusion.text,
      kind: exclusion.kind,
      scope: exclusion.scope,
      matchType: exclusion.matchType,
      campaignId,
      campaignName: campaign?.name ?? null,
      channel,
      adGroupName: exclusion.adGroupName,
      affectedCampaignCount: new Set(exclusion.campaignIds).size,
      remainingBlockers: otherBlockers.size,
      blockerCoverageComplete: complete,
      provenance: "legacy_unattributed",
      category,
      competitorLikelihood: intent?.competitorLikelihood ?? "unknown",
      semanticConfidence: intent?.confidence ?? null,
      evidenceConfidence: !complete || !facts.length || !conversionsAvailable ? "low" : "medium",
      valueClass,
      recommendation,
      explanation: exclusion.kind === "brand" ? "Brand exclusions require separate review; their traffic effect is not scored." : intent?.reason ?? "Intent classification is unavailable. Review the evidence before changing account policy.",
      metrics: {
        impressions,
        clicks,
        cost,
        conversionEvents: events,
        conversionValue: value,
        cpa: cpa ? decimal(cpa, 6) : null
      },
      score: exclusion.kind === "brand" ? null : score,
      conversionBasis: selected ? selected.name + " (" + selected.kind + " events)" : "No usable conversion basis",
      conversionActions: actionEvidence.filter(action => action.resource === selected?.resource || action.events !== null && fraction(action.events).n > 0n).slice(0, 100).map(action => ({
        resourceId: action.resource,
        name: action.name,
        kind: action.kind,
        events: action.events,
        value: action.value
      })),
      evidenceStart: dates[0] ?? null,
      evidenceEnd: dates[dates.length - 1] ?? null,
      querySamples: [...new Set(facts.map(f => f.query))].slice(0, 10)
    };
    return {
      key,
      resource: exclusion.resource,
      item
    };
  });
  const rank = {
    potential_pilot: 0,
    manual_review: 1,
    insufficient_evidence: 2,
    retain: 3
  };
  results.sort((a, b) => rank[a.item.recommendation] - rank[b.item.recommendation] || (a.item.channel ?? "").localeCompare(b.item.channel ?? "") || a.item.conversionBasis.localeCompare(b.item.conversionBasis) || a.item.valueClass.localeCompare(b.item.valueClass) || Number(b.item.score?.total ?? 0) - Number(a.item.score?.total ?? 0) || a.key.localeCompare(b.key));
  return {
    items: results,
    readiness,
    readinessReasons,
    coverage: sources.coverage
  };
}
