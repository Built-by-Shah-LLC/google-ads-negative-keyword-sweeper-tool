import { analyzeRecovery, recoveryCandidates, type RecoveryIntent } from "./analysis.js";
import { recoveryRecord, type RecoveryCoverage } from "./contract.js";
import { PipelineError } from "../observability/errors.js";
import type { Logger } from "../observability/logger.js";
import { verifyRecoverySnapshot, type RecoveryStore } from "./persistence.js";
import type { RecoverySources } from "./sources.js";
import type { RecoveryRequest } from "./persistence.js";
import type { RecoveryCandidate } from "./analysis.js";
import {
  RecoveryClassificationFailure,
  validateRecoveryIntents,
  type RecoveryClassificationDiagnostics
} from "./classifier.js";
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
    diagnostics?: RecoveryClassificationDiagnostics;
  }>;
  now?: () => Date;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}
export async function runVolumeRecovery(runId: string, execution: string, services: RecoveryServices): Promise<"duplicate" | "succeeded" | "partial" | "failed"> {
  const log = (level: "info" | "warn" | "error", recoveryEvent: string, fields: Record<string, unknown>, message: string) => {
    const payload = { recoveryEvent, runId, execution, ...fields };
    if (level === "error") services.logger?.error(payload, message);
    else if (level === "warn") services.logger?.warn(payload, message);
    else services.logger?.info(payload, message);
  };
  const runStarted = performance.now();
  log("info", "recovery_claim_started", { phase: "claim" }, "Volume Recovery claim started");
  let request: RecoveryRequest | null;
  try {
    request = await services.store.claim(runId, execution);
  } catch (error) {
    log("error", "recovery_claim_failed", { phase: "claim", ...safeRecoveryError(error) }, "Volume Recovery claim failed");
    throw error;
  }
  if (!request) {
    log("info", "recovery_claim_skipped", { phase: "claim", reason: "duplicate_or_not_claimable" }, "Volume Recovery execution did not acquire the run");
    return "duplicate";
  }
  log("info", "recovery_run_claimed", { phase: "claim", readOnly: true }, "Volume Recovery run claimed");
  const usage = {
    inputTokens: 0,
    outputTokens: 0
  };
  let stage = "Validating request";
  const started = (services.now?.() ?? new Date()).valueOf();
  let heartbeatError = false;
  const heartbeat = setInterval(() => {
    void services.store.progress(request, execution, stage).catch(error => {
      heartbeatError = true;
      log("warn", "recovery_heartbeat_failed", { phase: "heartbeat", stage, ...safeRecoveryError(error) }, "Volume Recovery heartbeat persistence failed");
    });
  }, 60000);
  heartbeat.unref();
  try {
    verifyRecoverySnapshot(request);
    const snapshot = recoveryRecord(request.snapshot);
    if (typeof snapshot.rulesMarkdown !== "string" || !snapshot.rulesMarkdown.trim()) throw new Error("Missing pinned policy.");
    const categories = [...snapshot.rulesMarkdown.matchAll(/^###\s+`([A-Z][A-Z0-9-]*-NEGATIVE)`/gm)].map(match => match[1]!);
    log("info", "recovery_snapshot_validated", {
      phase: "validation",
      taxonomyCategoryCount: categories.length,
      taxonomyAvailable: categories.length > 0
    }, "Volume Recovery snapshot validated");
    stage = "Collecting exclusions and historic evidence";
    const collectionStarted = performance.now();
    log("info", "recovery_collection_started", { phase: "collection" }, "Volume Recovery source collection started");
    await services.store.progress(request, execution, stage);
    const sources = await services.collect(request);
    await services.store.progress(request, execution, stage, sources.dates);
    const candidates = recoveryCandidates(sources).filter(candidate => candidate.exclusion.kind === "keyword");
    log("info", "recovery_collection_completed", {
      phase: "collection",
      durationMs: elapsedMs(collectionStarted),
      campaignCount: sources.campaigns.length,
      exclusionCount: sources.exclusions.length,
      trafficFactCount: sources.facts.length,
      conversionFactCount: sources.conversionFacts.length,
      conversionActionCount: sources.actions.length,
      keywordFindingCount: candidates.length,
      coverageSourceCount: sources.coverage.length,
      unavailableCoverageSourceCount: sources.coverage.filter(source => !source.available).length
    }, "Volume Recovery source collection completed");
    const intents: RecoveryIntent[] = [];
    const modelCoverage: RecoveryCoverage[] = [];
    const groups = recoveryIntentGroups(sources, candidates);
    const selected = groups.slice(0, 2000);
    const uniqueInputLimitSkipped = Math.max(0, groups.length - selected.length);
    const intentUnavailable = new Map<string, string>();
    const missing = (members: RecoveryCandidate[], reason: string) => members.forEach(candidate => intentUnavailable.set(candidate.key, reason));
    let evaluated = 0, rejected = 0;
    for (const group of groups.slice(2000)) missing(group.members, "Intent not evaluated: the 2,000-unique-input bound was reached. Available traffic is retained for review.");
    log("info", "recovery_classification_planned", {
      phase: "classification",
      keywordFindingCount: candidates.length,
      uniqueModelInputCount: groups.length,
      selectedUniqueInputCount: selected.length,
      uniqueInputLimitSkipped,
      batchSize: 25,
      batchCount: Math.ceil(selected.length / 25),
      taxonomyCategoryCount: categories.length,
      timeBudgetMs: 20 * 60000
    }, "Volume Recovery intent classification planned");
    if (groups.length > 2000) modelCoverage.push({
      source: "classification_limit",
      available: false,
      detail: "Intent is bounded to 2,000 unique inputs, prioritizing observed outcomes, then clicks and impressions. Remaining findings retain traffic and require review."
    });
    if (uniqueInputLimitSkipped > 0) log("warn", "recovery_classification_limit_reached", {
      phase: "classification",
      reason: "unique_input_limit",
      uniqueInputLimit: 2000,
      notEvaluatedUniqueInputCount: uniqueInputLimitSkipped
    }, "Volume Recovery classification input limit reached");
    let classificationTimeSkipped = 0;
    for (let offset = 0; offset < selected.length; offset += 25) {
      if (heartbeatError) throw new Error("Recovery heartbeat could not be persisted.");
      const classificationElapsedMs = (services.now?.() ?? new Date()).valueOf() - started;
      if (classificationElapsedMs >= 20 * 60000) {
        classificationTimeSkipped = selected.length - offset;
        for (const group of selected.slice(offset)) missing(group.members, "Intent not evaluated: the classification time budget was reached. Available traffic is retained for review.");
        modelCoverage.push({
          source: "classification_time_limit",
          available: false,
          detail: "Classification stopped at its time bound; remaining items require review."
        });
        log("warn", "recovery_classification_stopped", {
          phase: "classification",
          reason: "time_budget",
          timeBudgetMs: 20 * 60000,
          classificationElapsedMs,
          nextUniqueInputOffset: offset,
          notEvaluatedUniqueInputCount: classificationTimeSkipped
        }, "Volume Recovery classification time budget reached");
        break;
      }
      stage = "Classifying intent " + String(offset + 1) + "–" + String(Math.min(offset + 25, selected.length)) + " unique inputs";
      await services.store.progress(request, execution, stage);
      const batch = selected.slice(offset, offset + 25);
      const batchNumber = offset / 25 + 1;
      const batchStarted = performance.now();
      const batchFindingCount = batch.reduce((count, group) => count + group.members.length, 0);
      log("info", "recovery_classification_batch_started", {
        phase: "classification",
        batchNumber,
        batchCount: Math.ceil(selected.length / 25),
        uniqueInputOffset: offset,
        uniqueInputCount: batch.length,
        findingCount: batchFindingCount,
        classificationElapsedMs,
        timeBudgetRemainingMs: Math.max(0, 20 * 60000 - classificationElapsedMs)
      }, "Volume Recovery classification batch started");
      let failure = "Intent unavailable: the provider request did not return an accepted response. Available traffic is retained for review.";
      let classificationOutcome = "provider_request_failed";
      let diagnostics: RecoveryClassificationDiagnostics | undefined;
      try {
        if (!categories.length) {
          failure = "Intent not evaluated: no valid policy taxonomy was available. Review the pinned policy.";
          classificationOutcome = "taxonomy_unavailable";
          throw new Error("No valid taxonomy categories.");
        }
        const response = await services.classify(request, batch.map(group => group.candidate), categories);
        diagnostics = response.diagnostics;
        usage.inputTokens += response.usage.inputTokens;
        usage.outputTokens += response.usage.outputTokens;
        failure = "Intent unavailable: the model response failed validation. Available traffic is retained for review.";
        classificationOutcome = diagnostics?.outcome ?? "response_schema_invalid";
        if (!response.intents) throw new Error("Invalid classification output.");
        classificationOutcome = "pipeline_schema_invalid";
        const validated = validateRecoveryIntents({ items: response.intents }, batch.map(group => group.candidate.key), categories);
        for (const intent of validated) for (const member of batch.find(group => group.candidate.key === intent.itemId)!.members) intents.push({ ...intent, itemId: member.key });
        evaluated += batch.length;
        classificationOutcome = "accepted";
        log("info", "recovery_classification_batch_accepted", {
          phase: "classification",
          batchNumber,
          uniqueInputCount: batch.length,
          findingCount: batchFindingCount,
          durationMs: elapsedMs(batchStarted),
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          ...classificationDiagnosticsFields(diagnostics, classificationOutcome)
        }, "Volume Recovery classification batch accepted");
      } catch (error) {
        if (error instanceof RecoveryClassificationFailure) {
          diagnostics = error.diagnostics;
          classificationOutcome = error.diagnostics.outcome;
        }
        if (categories.length) rejected += batch.length;
        for (const group of batch) missing(group.members, failure);
        modelCoverage.push({
          source: "intent_batch_" + String(batchNumber),
          available: false,
          detail: failure
        });
        log("warn", "recovery_classification_batch_rejected", {
          phase: "classification",
          batchNumber,
          uniqueInputCount: batch.length,
          findingCount: batchFindingCount,
          durationMs: elapsedMs(batchStarted),
          classificationOutcome,
          ...classificationDiagnosticsFields(diagnostics, classificationOutcome),
          ...safeRecoveryError(error)
        }, "Volume Recovery classification batch was not accepted");
      }
    }
    const notEvaluated = groups.length - evaluated - rejected;
    modelCoverage.push({ source: "classification_summary", available: true, detail: `${candidates.length} keyword findings; ${groups.length} unique model inputs; ${evaluated} evaluated, ${rejected} rejected, ${notEvaluated} not evaluated. Identical inputs share intent, never campaign metrics.` });
    log(notEvaluated > 0 || rejected > 0 ? "warn" : "info", "recovery_classification_completed", {
      phase: "classification",
      keywordFindingCount: candidates.length,
      uniqueModelInputCount: groups.length,
      evaluatedUniqueInputCount: evaluated,
      rejectedUniqueInputCount: rejected,
      notEvaluatedUniqueInputCount: notEvaluated,
      uniqueInputLimitSkipped,
      classificationTimeSkipped,
      acceptedFindingIntentCount: intents.length,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens
    }, "Volume Recovery intent classification completed");
    sources.coverage.push(...modelCoverage);
    stage = "Ranking and saving report";
    await services.store.progress(request, execution, stage);
    const analysisStarted = performance.now();
    log("info", "recovery_analysis_started", { phase: "analysis", keywordFindingCount: candidates.length }, "Volume Recovery report analysis started");
    const report = analyzeRecovery(sources, request.policy, intents, request.targetCpa, intentUnavailable);
    log("info", "recovery_analysis_completed", {
      phase: "analysis",
      durationMs: elapsedMs(analysisStarted),
      sourceReportItemCount: report.items.length,
      readiness: report.readiness,
      unavailableCoverageSourceCount: report.coverage.filter(source => !source.available).length
    }, "Volume Recovery report analysis completed");
    const items = report.items.slice(0, 10000);
    if (report.items.length > 10000) report.coverage.push({
      source: "report_item_limit",
      available: false,
      detail: "The 10,000-item report bound was reached; this inventory is partial."
    });
    log("info", "recovery_persistence_started", {
      phase: "persistence",
      reportItemCount: items.length,
      sourceReportItemCount: report.items.length,
      reportItemLimitReached: report.items.length > 10000,
      batchSize: 100,
      batchCount: Math.ceil(items.length / 100)
    }, "Volume Recovery report persistence started");
    for (let offset = 0; offset < items.length; offset += 100) {
      const itemBatch = items.slice(offset, offset + 100);
      await services.store.items(request, execution, itemBatch, offset + 1);
      log("info", "recovery_persistence_batch_saved", {
        phase: "persistence",
        batchNumber: offset / 100 + 1,
        batchCount: Math.ceil(items.length / 100),
        itemCount: itemBatch.length,
        savedItemCount: offset + itemBatch.length
      }, "Volume Recovery report batch persisted");
    }
    log("info", "recovery_persistence_completed", { phase: "persistence", savedItemCount: items.length }, "Volume Recovery report persistence completed");
    const partial = report.coverage.some(source => !source.available && source.source !== "conversion_diagnostics");
    const status = partial ? "partial" : "succeeded";
    log("info", "recovery_finalization_started", { phase: "finalization", status, savedItemCount: items.length }, "Volume Recovery finalization started");
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
    log(status === "partial" ? "warn" : "info", "recovery_run_completed", {
      phase: "finalization",
      status,
      durationMs: elapsedMs(runStarted),
      savedItemCount: items.length,
      sourceReportItemCount: report.items.length,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens
    }, "Volume Recovery run completed");
    return status;
  } catch (error) {
    log("error", "recovery_run_failed", {
      phase: "failure",
      stage,
      durationMs: elapsedMs(runStarted),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ...safeRecoveryError(error)
    }, "Volume Recovery run failed");
    await services.store.finish(request, execution, "failed", {}, usage, "The review could not be completed. Retained evidence may be incomplete; run a new review to retry.");
    log("error", "recovery_failure_persisted", { phase: "finalization", status: "failed" }, "Volume Recovery failure status persisted");
    return "failed";
  } finally {
    clearInterval(heartbeat);
  }
}

function elapsedMs(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}

function classificationDiagnosticsFields(diagnostics: RecoveryClassificationDiagnostics | undefined, fallbackOutcome: string): Record<string, unknown> {
  if (!diagnostics) return { classificationOutcome: fallbackOutcome, diagnosticsAvailable: false };
  return {
    classificationOutcome: diagnostics.outcome,
    diagnosticsAvailable: true,
    provider: diagnostics.provider,
    model: diagnostics.model,
    providerRequestId: diagnostics.providerRequestId,
    httpAttemptCount: diagnostics.httpAttemptCount,
    retryCount: diagnostics.retryCount,
    finalStatusCode: diagnostics.finalStatusCode,
    timedOut: diagnostics.timedOut,
    httpDurationMs: diagnostics.httpDurationMs,
    classifierDurationMs: diagnostics.durationMs,
    usageReported: diagnostics.usageReported,
    cachedInputTokensReported: diagnostics.cachedInputTokensReported
  };
}

function safeRecoveryError(error: unknown): Record<string, unknown> {
  if (error instanceof RecoveryClassificationFailure) return {
    errorType: error.name,
    errorCode: "RECOVERY_CLASSIFICATION_PROVIDER_REQUEST_FAILED"
  };
  if (error instanceof PipelineError) return {
    errorType: error.name,
    errorCode: error.context.code ?? "PIPELINE_ERROR",
    provider: error.context.provider,
    statusCode: error.context.statusCode,
    providerRequestId: error.context.requestId,
    retryable: error.context.retryable
  };
  return {
    errorType: error instanceof Error ? error.name : typeof error,
    errorCode: "UNCLASSIFIED_RECOVERY_ERROR"
  };
}
