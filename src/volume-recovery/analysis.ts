import { createHash } from "node:crypto";
import { RECOVERY_ITEM_MAX_BYTES, type RecoveryItem, type RecoveryPolicy, type RecoveryCoverage } from "./contract.js";
import type { RecoveryExclusion, RecoverySources } from "./sources.js";
import { decimal, divide, fraction, monday, negativeMatches, recoveryScore, sumDecimals } from "./scoring.js";
import { exclusionDetails, recoveryBlockers, type BlockerLookup } from "./blockers.js";
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
  const inventoryComplete = ["campaigns", "campaign_negatives", "ad_group_negatives", "account_negatives", "account_direct_negatives", "shared_sets", "shared_attachments", "shared_keywords", "brand_exclusions"].every(name => available(sources, name));
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
  const blockerLookup: BlockerLookup = { cache: new Map(), remaining: 2000000 };
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
    const blockerResult = recoveryBlockers(exclusion, exclusionsByCampaign.get(campaignId ?? "") ?? [], facts, campaignId ?? "", blockerLookup);
    const complete = Boolean(campaignId) && inventoryComplete && !uncertain && blockerResult.complete && exclusion.details?.detailsComplete !== false;
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
    const selected = (observed.length ? observed : supported).sort((a, b) => priorities[b.kind] - priorities[a.kind] || Number(Boolean(policy.valueTargets?.[b.resource])) - Number(Boolean(policy.valueTargets?.[a.resource])) || Number(b.primary) - Number(a.primary) || a.resource.localeCompare(b.resource))[0];
    const reportedActions = [...(selected ? [selected] : []), ...actionEvidence.filter(action => action.resource !== selected?.resource && action.events !== null && fraction(action.events).n > 0n)];
    const detailsTruncated = reportedActions.length > 100 || blockerResult.known + blockerResult.possible > blockerResult.blockers.length || (campaignId !== null && sources.contextTruncatedCampaignIds?.includes(campaignId) === true);
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
    const context = campaignId ? sources.campaignContexts?.[campaignId] ?? null : null;
    const goalActions = sources.campaignGoalActionIds?.[campaignId ?? ""];
    const soleGoal = Boolean(selected && goalActions?.length === 1 && goalActions[0] === selected.resource);
    const configuredValueTarget = selected ? policy.valueTargets?.[selected.resource] : undefined;
    const unitValues = value !== null && events !== null && fraction(value).n * fraction(events).d === fraction(events).n * fraction(value).d;
    // API purchase metadata can establish reported revenue, but generic form values and mixed-goal targets cannot.
    const defaultValue = selected?.defaultValue == null ? null : fraction(selected.defaultValue);
    const defaultFallback = value === null || events === null || defaultValue === null || fraction(value).n * fraction(events).d * defaultValue.d === fraction(events).n * defaultValue.n * fraction(value).d;
    const automaticValueTarget = selected?.kind === "revenue" && ["PURCHASE", "STORE_SALE"].includes(selected.category) && selected.alwaysUseDefaultValue === false && !unitValues && !defaultFallback && soleGoal && context?.bidding?.targetRoas ? { interpretation: "revenue" as const, targetRoas: context.bidding.targetRoas } : undefined;
    const valueTarget = configuredValueTarget ?? automaticValueTarget;
    const meaningfulValue = Boolean(positive && valueTarget && value !== null && fraction(value).n > 0n);
    const valueBased = selected?.kind === "revenue" || Boolean(meaningfulValue && selected?.kind !== "qualified_lead");
    const valueClass = positive ? selected?.kind === "qualified_lead" || selected?.kind === "revenue" ? "A" : meaningfulValue ? "B" : "C" : clicks !== null && fraction(clicks).n > 0n ? "D" : "E";
    const dates = facts.map(f => f.date).sort();
    const recentStart = new Date(Date.parse(sources.dates.endDate + "T00:00:00Z") - 29 * 86400000).toISOString().slice(0, 10);
    const conversionKeys = new Set(conversions.filter(c => c.events !== null && fraction(c.events).n > 0n).map(c => c.key));
    const weeks = new Set(facts.filter(f => conversionKeys.has(f.key) && monday(f.date) < monday(sources.dates.today)).map(f => monday(f.date)));
    // An account CPA cannot be assigned to one action in a multi-action/custom funnel.
    const targetApplicable = !valueBased && selected?.primary && soleGoal && sources.campaignGoalLevels?.[campaignId ?? ""] === "CUSTOMER";
    const appliedCpa = targetApplicable && targetCpa !== null && fraction(targetCpa).n > 0n ? targetCpa : null;
    const appliedRoas = meaningfulValue ? valueTarget!.targetRoas : null;
    const score = facts.length ? recoveryScore({
      qualityEvents: selected?.kind === "qualified_lead" ? events : null,
      conversions: events,
      clicks,
      cost,
      targetCpa: appliedCpa,
      valueBased,
      conversionValue: meaningfulValue ? value : null,
      targetRoas: appliedRoas,
      recent: dates.some(date => date >= recentStart),
      completedConversionWeeks: weeks.size
    }) : null;
    const category = intent?.category ?? null;
    const action = category ? policy.categoryActions[category] ?? (/COMPETITOR|AMBIGUOUS/.test(category) ? "review" : "retain") : "review";
    let recommendation: RecoveryItem["recommendation"] = action === "retain" ? "retain" : facts.length ? "manual_review" : "insufficient_evidence";
    const suitableMeasurement = selected?.kind === "qualified_lead" || selected?.kind === "revenue" && meaningfulValue && appliedRoas !== null;
    if (action === "consider" && valueClass === "A" && suitableMeasurement && readiness === "green" && complete && !detailsTruncated && conversionsAvailable && available(sources, (channel ?? "") + "_traffic") && blockerResult.known === 0 && exclusion.scope === "campaign" && exclusion.matchType === "EXACT" && intent && intent.confidence >= 0.8 && facts.length) recommendation = "potential_pilot";
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
      remainingBlockers: blockerResult.known,
      possibleBlockers: blockerResult.possible,
      detailsTruncated,
      blockers: blockerResult.blockers,
      exclusion: exclusionDetails(exclusion),
      context,
      ranking: { basis: selected?.kind === "qualified_lead" ? "qualified_events" : valueBased ? "value_roas" : positive ? "raw_events" : "demand", selectedAction: selected?.resource ?? null, valueMeaning: valueTarget?.interpretation ?? "unconfirmed", targetCpa: appliedCpa, targetRoas: appliedRoas, targetSource: appliedRoas ? configuredValueTarget ? "account_policy" : "google_single_action_goal" : appliedCpa ? "account_policy" : "unavailable", recentEvidence: dates.some(date => date >= recentStart), completedConversionWeeks: weeks.size, scoringVersion: 1, rounding: "half_up" },
      blockerCoverageComplete: complete && !detailsTruncated,
      provenance: "legacy_unattributed",
      category,
      competitorLikelihood: intent?.competitorLikelihood ?? "unknown",
      semanticConfidence: intent?.confidence ?? null,
      evidenceConfidence: !complete || detailsTruncated || !facts.length || !conversionsAvailable ? "low" : "medium",
      valueClass,
      recommendation,
      explanation: exclusion.kind === "brand" ? "Brand exclusions require separate review; their traffic effect is not scored." : intent?.reason ?? "Intent classification is unavailable. Review the evidence before changing account policy.",
      metrics: {
        impressions,
        clicks,
        cost,
        conversionEvents: events,
        conversionValue: value,
        cpa: cpa ? decimal(cpa, 6) : null,
        roas: meaningfulValue && cost !== null && fraction(cost).n > 0n ? decimal(divide(fraction(value!), fraction(cost))!, 6) : null
      },
      score: exclusion.kind === "brand" ? null : score,
      conversionBasis: selected ? selected.name + " (" + selected.kind + " events)" : "No usable conversion basis",
      conversionActions: reportedActions.slice(0, 100).map(action => ({
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
      item: boundedRecoveryItem(item)
    };
  });
  const rank = {
    potential_pilot: 0,
    manual_review: 1,
    insufficient_evidence: 2,
    retain: 3
  };
  if (blockerLookup.remaining <= 0) sources.coverage.push({ source: "blocker_matching_limit", available: false, detail: "The two-million-comparison bound was reached; affected blocker assessments are incomplete and cannot enter a future pilot." });
  if (results.some(row => row.item.detailsTruncated)) sources.coverage.push({ source: "retained_detail_limit", available: false, detail: "Some retained detail reached its storage bound; affected findings are review-only and detail is explicitly partial." });
  results.sort((a, b) => rank[a.item.recommendation] - rank[b.item.recommendation] || (a.item.channel ?? "").localeCompare(b.item.channel ?? "") || (a.item.ranking?.selectedAction ?? "").localeCompare(b.item.ranking?.selectedAction ?? "") || a.item.valueClass.localeCompare(b.item.valueClass) || Number(b.item.score?.total ?? 0) - Number(a.item.score?.total ?? 0) || a.key.localeCompare(b.key));
  return {
    items: results,
    readiness,
    readinessReasons,
    coverage: sources.coverage
  };
}

export function boundedRecoveryItem(original: RecoveryItem): RecoveryItem {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  if (bytes(original) <= RECOVERY_ITEM_MAX_BYTES - 4000) return original;
  const item = structuredClone(original);
  const arrays: { list: unknown[]; keep: number }[] = [item.blockers ?? [], item.exclusion?.campaigns ?? [], item.exclusion?.attachmentResourceIds ?? [], item.exclusion?.brandMembers ?? [], item.context?.changes ?? [], item.context?.goals?.actionResourceIds ?? [], item.context?.goals?.biddableGoals ?? [], item.context?.primaryStatusReasons ?? []].map(list => ({ list, keep: 0 }));
  arrays.push({ list: item.conversionActions, keep: 1 });
  // Keep the selected action, primary metrics, known counts and score inputs; reduce optional detail only.
  while (bytes(item) > RECOVERY_ITEM_MAX_BYTES - 4000) {
    const largest = arrays.filter(({ list, keep }) => list.length > keep).sort((a, b) => bytes(b.list) - bytes(a.list))[0];
    if (!largest) break;
    largest.list.splice(Math.max(largest.keep, Math.floor(largest.list.length / 2)));
  }
  item.detailsTruncated = true;
  item.evidenceConfidence = "low";
  item.blockerCoverageComplete = false;
  if (item.exclusion) item.exclusion.detailsComplete = false;
  if (item.context) item.context.limitations.push("Retained detail reached its byte bound; omitted entries require review.");
  if (item.recommendation === "potential_pilot") item.recommendation = "manual_review";
  return item;
}
