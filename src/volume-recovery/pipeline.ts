import { analyzeRecovery, recoveryCandidates, type RecoveryIntent } from "./analysis.js";
import { recoveryRecord, type RecoveryCoverage } from "./contract.js";
import { verifyRecoverySnapshot, type RecoveryStore } from "./persistence.js";
import type { RecoverySources } from "./sources.js";
import type { RecoveryRequest } from "./persistence.js";
import type { RecoveryCandidate } from "./analysis.js";
import { validateRecoveryIntents } from "./classifier.js";
import { fraction, negativeMatches, normalizeRecoveryText, sumDecimals } from "./scoring.js";

/** Group only identical model inputs; campaign-specific metrics and recommendations remain separate. */
export function recoveryIntentGroups(sources: RecoverySources, candidates: RecoveryCandidate[]) {
  const groups = new Map<string, { candidate: RecoveryCandidate; members: RecoveryCandidate[]; priority: number; clicks: string }>();
  for (const candidate of candidates) {
    const signature = JSON.stringify([candidate.exclusion.text, candidate.exclusion.scope, candidate.exclusion.matchType]);
    const group = groups.get(signature) ?? { candidate, members: [], priority: -1, clicks: "0" };
    group.members.push(candidate);
    groups.set(signature, group);
  }
  const campaignFacts = new Map<string, RecoverySources["facts"]>();
  const exactFacts = new Map<string, RecoverySources["facts"]>();
  for (const fact of sources.facts) {
    for (const [index, key] of [[campaignFacts, fact.campaignId], [exactFacts, JSON.stringify([fact.campaignId, normalizeRecoveryText(fact.query)])]] as const) {
      const rows = index.get(key) ?? [];
      rows.push(fact);
      index.set(key, rows);
    }
  }
  const kinds = new Map(sources.actions.map(action => [action.resource, action.kind]));
  const outcomes = new Map<string, number>();
  for (const fact of sources.conversionFacts) if (fact.events !== null && fraction(fact.events).n > 0n) {
    const priority = { qualified_lead: 4, revenue: 3, raw_lead: 2, ignore: -1 }[kinds.get(fact.action) ?? "ignore"];
    outcomes.set(fact.key, Math.max(outcomes.get(fact.key) ?? -1, priority));
  }
  for (const group of groups.values()) {
    const matched = new Map<string, RecoverySources["facts"][number]>();
    for (const { exclusion, campaignId } of group.members) {
      const facts = exclusion.matchType === "EXACT" ? exactFacts.get(JSON.stringify([campaignId, normalizeRecoveryText(exclusion.text)])) : campaignFacts.get(campaignId ?? "");
      for (const fact of facts ?? []) if ((!exclusion.adGroupId || exclusion.adGroupId === fact.adGroupId) && negativeMatches(exclusion.text, fact.query, exclusion.matchType!) === true) matched.set(fact.key, fact);
    }
    const facts = [...matched.values()];
    group.clicks = sumDecimals(facts.flatMap(fact => fact.clicks === null ? [] : [fact.clicks]));
    for (const fact of facts) group.priority = Math.max(group.priority, outcomes.get(fact.key) ?? -1, fact.clicks !== null && fraction(fact.clicks).n > 0n ? 1 : fact.impressions !== null && fraction(fact.impressions).n > 0n ? 0 : -1);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const left = fraction(a.clicks), right = fraction(b.clicks);
    const difference = left.n * right.d - right.n * left.d;
    return difference === 0n ? a.candidate.key.localeCompare(b.candidate.key) : difference > 0n ? -1 : 1;
  });
}
export interface RecoveryServices {
  store: RecoveryStore;
  collect(request: RecoveryRequest): Promise<RecoverySources>;
  classify(request: RecoveryRequest, candidates: RecoveryCandidate[], categories: string[]): Promise<{
    intents: RecoveryIntent[] | null;
    usage: {
      inputTokens: number;
      outputTokens: number;
    };
  }>;
  now?: () => Date;
}
export async function runVolumeRecovery(runId: string, execution: string, services: RecoveryServices): Promise<"duplicate" | "succeeded" | "partial" | "failed"> {
  const request = await services.store.claim(runId, execution);
  if (!request) return "duplicate";
  const usage = {
    inputTokens: 0,
    outputTokens: 0
  };
  let stage = "Validating request";
  const started = (services.now?.() ?? new Date()).valueOf();
  let heartbeatError = false;
  const heartbeat = setInterval(() => {
    void services.store.progress(request, execution, stage).catch(() => {
      heartbeatError = true;
    });
  }, 60000);
  heartbeat.unref();
  try {
    verifyRecoverySnapshot(request);
    const snapshot = recoveryRecord(request.snapshot);
    if (typeof snapshot.rulesMarkdown !== "string" || !snapshot.rulesMarkdown.trim()) throw new Error("Missing pinned policy.");
    const categories = [...snapshot.rulesMarkdown.matchAll(/^###\s+`([A-Z][A-Z0-9-]*-NEGATIVE)`/gm)].map(match => match[1]!);
    stage = "Collecting exclusions and historic evidence";
    await services.store.progress(request, execution, stage);
    const sources = await services.collect(request);
    await services.store.progress(request, execution, stage, sources.dates);
    const candidates = recoveryCandidates(sources).filter(candidate => candidate.exclusion.kind === "keyword");
    const intents: RecoveryIntent[] = [];
    const modelCoverage: RecoveryCoverage[] = [];
    const groups = recoveryIntentGroups(sources, candidates);
    const selected = groups.slice(0, 2000);
    const intentUnavailable = new Map<string, string>();
    const missing = (members: RecoveryCandidate[], reason: string) => members.forEach(candidate => intentUnavailable.set(candidate.key, reason));
    let evaluated = 0, rejected = 0;
    for (const group of groups.slice(2000)) missing(group.members, "Intent not evaluated: the 2,000-unique-input bound was reached. Available traffic is retained for review.");
    if (groups.length > 2000) modelCoverage.push({
      source: "classification_limit",
      available: false,
      detail: "Intent is bounded to 2,000 unique inputs, prioritizing observed outcomes, then clicks and impressions. Remaining findings retain traffic and require review."
    });
    for (let offset = 0; offset < selected.length; offset += 25) {
      if (heartbeatError) throw new Error("Recovery heartbeat could not be persisted.");
      if ((services.now?.() ?? new Date()).valueOf() - started >= 20 * 60000) {
        for (const group of selected.slice(offset)) missing(group.members, "Intent not evaluated: the classification time budget was reached. Available traffic is retained for review.");
        modelCoverage.push({
          source: "classification_time_limit",
          available: false,
          detail: "Classification stopped at its time bound; remaining items require review."
        });
        break;
      }
      stage = "Classifying intent " + String(offset + 1) + "–" + String(Math.min(offset + 25, selected.length)) + " unique inputs";
      await services.store.progress(request, execution, stage);
      const batch = selected.slice(offset, offset + 25);
      let failure = "Intent unavailable: the provider request did not return an accepted response. Available traffic is retained for review.";
      try {
        if (!categories.length) {
          failure = "Intent not evaluated: no valid policy taxonomy was available. Review the pinned policy.";
          throw new Error("No valid taxonomy categories.");
        }
        const response = await services.classify(request, batch.map(group => group.candidate), categories);
        usage.inputTokens += response.usage.inputTokens;
        usage.outputTokens += response.usage.outputTokens;
        failure = "Intent unavailable: the model response failed validation. Available traffic is retained for review.";
        if (!response.intents) throw new Error("Invalid classification output.");
        const validated = validateRecoveryIntents({ items: response.intents }, batch.map(group => group.candidate.key), categories);
        for (const intent of validated) for (const member of batch.find(group => group.candidate.key === intent.itemId)!.members) intents.push({ ...intent, itemId: member.key });
        evaluated += batch.length;
      } catch {
        if (categories.length) rejected += batch.length;
        for (const group of batch) missing(group.members, failure);
        modelCoverage.push({
          source: "intent_batch_" + String(offset / 25 + 1),
          available: false,
          detail: failure
        });
      }
    }
    modelCoverage.push({ source: "classification_summary", available: true, detail: `${candidates.length} keyword findings; ${groups.length} unique model inputs; ${evaluated} evaluated, ${rejected} rejected, ${groups.length - evaluated - rejected} not evaluated. Identical inputs share intent, never campaign metrics.` });
    sources.coverage.push(...modelCoverage);
    stage = "Ranking and saving report";
    await services.store.progress(request, execution, stage);
    const report = analyzeRecovery(sources, request.policy, intents, request.targetCpa, intentUnavailable);
    const items = report.items.slice(0, 10000);
    if (report.items.length > 10000) report.coverage.push({
      source: "report_item_limit",
      available: false,
      detail: "The 10,000-item report bound was reached; this inventory is partial."
    });
    for (let offset = 0; offset < items.length; offset += 100) await services.store.items(request, execution, items.slice(offset, offset + 100), offset + 1);
    const partial = report.coverage.some(source => !source.available && source.source !== "conversion_diagnostics");
    const status = partial ? "partial" : "succeeded";
    await services.store.finish(request, execution, status, {
      contractVersion: 1,
      scoringVersion: 1,
      readiness: report.readiness,
      readinessReasons: report.readinessReasons,
      coverage: report.coverage,
      matchedCandidateCount: items.filter(item => item.item.evidenceStart !== null).length,
      sourceItemCount: report.items.length,
      note: "Historic observed events are not a forecast of incremental recovered leads."
    }, usage);
    return status;
  } catch {
    await services.store.finish(request, execution, "failed", {}, usage, "The review could not be completed. Retained evidence may be incomplete; run a new review to retry.");
    return "failed";
  } finally {
    clearInterval(heartbeat);
  }
}
