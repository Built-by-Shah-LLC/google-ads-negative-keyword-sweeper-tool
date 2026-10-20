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
  inspectRecoveryIntents,
  recoveryCategories,
  recoveryIntentInputs,
  RECOVERY_FALLBACK_CATEGORY,
  RecoveryIntentValidationError,
  type RecoveryClassificationDiagnostics,
  type RecoveryRepairContext
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
  classify(request: RecoveryRequest, candidates: RecoveryCandidate[], categories: string[], repair?: RecoveryRepairContext): Promise<{
    intents: RecoveryIntent[] | null;
    usage: {
      inputTokens: number;
      outputTokens: number;
    };
    diagnostics?: RecoveryClassificationDiagnostics;
  }>;
  now?: () => Date;
  classificationConcurrency?: number;
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
    const categories = recoveryCategories(snapshot.rulesMarkdown);
    log("info", "recovery_snapshot_validated", {
      phase: "validation",
      taxonomyCategoryCount: categories.length,
      keepCategoryCount: categories.filter(category => category.endsWith("-KEEP")).length,
      negativeCategoryCount: categories.filter(category => category.endsWith("-NEGATIVE")).length,
      policyFallbackAvailable: categories.includes(RECOVERY_FALLBACK_CATEGORY),
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
    const intentUnavailable = new Map<string, string>();
    const attempted = new Set<string>();
    const accepted = new Set<string>();
    const acceptedIntents = new Map<string, RecoveryIntent>();
    const validationIssueCounts: Record<string, number> = {};
    const concurrency = Math.max(1, Math.min(8, Math.floor(services.classificationConcurrency ?? 4)));
    const timeBudgetMs = 90 * 60000;
    let nextBatch = 0;
    let timeLimitReached = false;
    log("info", "recovery_classification_planned", {
      phase: "classification", keywordFindingCount: candidates.length,
      uniqueModelInputCount: groups.length, selectedUniqueInputCount: groups.length,
      uniqueInputLimitSkipped: 0, batchSize: 25, batchCount: Math.ceil(groups.length / 25),
      concurrency, taxonomyCategoryCount: categories.length, timeBudgetMs
    }, "Volume Recovery intent classification planned");
    async function classifyBatch(batch: typeof groups, batchNumber: number) {
      let pending = batch;
      const repairCodes = new Set<string>();
      let failure = "Intent unavailable: the provider request did not return an accepted response. Available traffic is retained for review.";
      for (let attempt = 1; attempt <= 3 && pending.length; attempt++) {
        const retry: typeof groups = [];
        // Isolate invalid output while preserving valid rows; the final retry uses one input per request.
        const size = attempt === 1 ? 25 : attempt === 2 ? 5 : 1;
        for (let offset = 0; offset < pending.length; offset += size) {
          if (heartbeatError) throw new Error("Recovery heartbeat could not be persisted.");
          if ((services.now?.() ?? new Date()).valueOf() - started >= timeBudgetMs) {
            timeLimitReached = true;
            return;
          }
          const chunk = pending.slice(offset, offset + size);
          const chunkStarted = performance.now();
          const chunkFields = { phase: "classification", batchNumber, attempt, retryChunk: offset / size + 1,
            uniqueInputCount: chunk.length, findingCount: chunk.reduce((sum, group) => sum + group.members.length, 0) };
          stage = "Classifying intent " + accepted.size + " of " + groups.length + " unique inputs";
          await services.store.progress(request!, execution, stage);
          log("info", "recovery_classification_batch_started", chunkFields, "Volume Recovery classification batch started");
          chunk.forEach(group => attempted.add(group.candidate.key));
          let diagnostics: RecoveryClassificationDiagnostics | undefined;
          let classificationOutcome: RecoveryClassificationDiagnostics["outcome"] = "provider_request_failed";
          let valid: RecoveryIntent[] = [];
          try {
            const response = await services.classify(request!, chunk.map(group => group.candidate), categories,
              attempt > 1 ? { attempt, validationCodes: [...repairCodes].sort() } : undefined);
            diagnostics = response.diagnostics;
            usage.inputTokens += response.usage.inputTokens;
            usage.outputTokens += response.usage.outputTokens;
            failure = "Intent unavailable: the model response failed validation. Available traffic is retained for review.";
            classificationOutcome = diagnostics?.outcome ?? "response_schema_invalid";
            if (response.intents) {
              const result = inspectRecoveryIntents({ items: response.intents }, recoveryIntentInputs(chunk.map(group => group.candidate)), categories);
              valid = result.intents;
              if (result.issues.length && !diagnostics?.validationIssues?.length) {
                classificationOutcome = result.issues.some(issue => issue.code.startsWith("semantic_")) ? "response_semantic_invalid" : "response_schema_invalid";
                diagnostics = diagnostics ? { ...diagnostics, validationIssues: result.issues, outcome: classificationOutcome } : undefined;
                for (const issue of result.issues) {
                  repairCodes.add(issue.code);
                  if (!diagnostics) validationIssueCounts[issue.code] = (validationIssueCounts[issue.code] ?? 0) + 1;
                }
                log("warn", "recovery_pipeline_validation_failed", { ...chunkFields, validationIssues: result.issues }, "Volume Recovery pipeline response validation failed");
              }
            }
          } catch (error) {
            if (error instanceof RecoveryClassificationFailure) diagnostics = error.diagnostics;
            classificationOutcome = "provider_request_failed";
            failure = "Intent unavailable: the provider request did not return an accepted response. Available traffic is retained for review.";
            log("warn", "recovery_classification_request_failed", { ...chunkFields, ...safeRecoveryError(error) }, "Volume Recovery classification request failed");
          }
          for (const issue of diagnostics?.validationIssues ?? []) {
            repairCodes.add(issue.code);
            validationIssueCounts[issue.code] = (validationIssueCounts[issue.code] ?? 0) + 1;
          }
          if (classificationOutcome !== "provider_request_failed" && repairCodes.size) failure = `Intent unavailable: the model response failed validation. Batch ${batchNumber}, attempt ${attempt}. Batch checks: ${[...repairCodes].sort().slice(0, 8).join(", ")}. See batch diagnostics for all checks. Available traffic is retained for review.`;
          const byId = new Map(valid.map(intent => [intent.itemId, intent]));
          for (const group of chunk) {
            const intent = byId.get(group.candidate.key);
            if (intent) {
              accepted.add(group.candidate.key);
              acceptedIntents.set(group.candidate.key, intent);
              for (const member of group.members) intents.push({ ...intent, itemId: member.key });
            } else {
              retry.push(group);
              for (const member of group.members) intentUnavailable.set(member.key, failure);
            }
          }
          const complete = valid.length === chunk.length;
          log(complete ? "info" : "warn", complete ? "recovery_classification_batch_accepted" : "recovery_classification_batch_rejected", {
            ...chunkFields, acceptedUniqueInputCount: valid.length, rejectedUniqueInputCount: chunk.length - valid.length,
            keepUniqueInputCount: valid.filter(intent => intent.decision === "KEEP").length,
            unknownUniqueInputCount: valid.filter(intent => intent.category === null).length,
            fallbackUniqueInputCount: valid.filter(intent => intent.category === RECOVERY_FALLBACK_CATEGORY).length,
            willRetry: !complete && attempt < 3, durationMs: elapsedMs(chunkStarted),
            ...classificationDiagnosticsFields(diagnostics, complete ? "accepted" : classificationOutcome)
          }, complete ? "Volume Recovery classification batch accepted" : "Volume Recovery classification batch needs repair");
        }
        pending = retry;
      }
    }
    if (categories.length) {
      const workers = await Promise.allSettled(Array.from({ length: Math.min(concurrency, Math.ceil(groups.length / 25)) }, async () => {
        while (nextBatch * 25 < groups.length && !timeLimitReached && !heartbeatError) {
          const batchNumber = ++nextBatch;
          try {
            await classifyBatch(groups.slice((batchNumber - 1) * 25, batchNumber * 25), batchNumber);
          } catch (error) {
            heartbeatError = true;
            throw error;
          }
        }
      }));
      const failed = workers.find(worker => worker.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      if (heartbeatError) throw new Error("Recovery heartbeat could not be persisted.");
    }
    const evaluated = accepted.size;
    const rejected = attempted.size - evaluated;
    const notEvaluated = groups.length - attempted.size;
    const semanticCounts = {
      keepUniqueInputCount: [...acceptedIntents.values()].filter(intent => intent.decision === "KEEP").length,
      negativeUniqueInputCount: [...acceptedIntents.values()].filter(intent => intent.decision === "NEGATIVE").length,
      unknownUniqueInputCount: [...acceptedIntents.values()].filter(intent => intent.category === null).length,
      fallbackUniqueInputCount: [...acceptedIntents.values()].filter(intent => intent.category === RECOVERY_FALLBACK_CATEGORY).length,
      unknownFindingIntentCount: intents.filter(intent => intent.category === null).length,
      zeroConfidenceFindingIntentCount: intents.filter(intent => intent.confidence === 0).length
    };
    for (const group of groups) if (!accepted.has(group.candidate.key)) {
      const reason = !categories.length
        ? "Intent not evaluated: no valid policy taxonomy was available. Review the pinned policy."
        : !attempted.has(group.candidate.key)
          ? "Intent not evaluated: the classification time budget was reached. Available traffic is retained for review."
          : intentUnavailable.get(group.candidate.key) ?? "Intent unavailable: the model response failed validation. Available traffic is retained for review.";
      for (const member of group.members) intentUnavailable.set(member.key, reason);
    }
    if (timeLimitReached) {
      modelCoverage.push({ source: "classification_time_limit", available: false, detail: "The 90-minute classification safety budget was reached; remaining findings require review." });
      log("warn", "recovery_classification_stopped", { phase: "classification", reason: "time_budget", timeBudgetMs, notEvaluatedUniqueInputCount: notEvaluated }, "Volume Recovery classification safety budget reached");
    }
    if (!categories.length) modelCoverage.push({ source: "classification_taxonomy", available: false, detail: "No valid policy taxonomy was available; intent was not evaluated." });
    if (rejected) modelCoverage.push({ source: "classification_rejected", available: false, detail: `${rejected} unique inputs still lack accepted intent after three classification attempts. See batch diagnostics for exact validation or provider failures.` });
    modelCoverage.push({ source: "classification_summary", available: true, detail: `${candidates.length} keyword findings; ${groups.length} unique model inputs; ${evaluated} evaluated, ${rejected} rejected, ${notEvaluated} not evaluated. Identical inputs share intent, never campaign metrics.` });
    modelCoverage.push({ source: "classification_semantics", available: true, detail: `Accepted unique inputs: ${semanticCounts.keepUniqueInputCount} KEEP, ${semanticCounts.negativeUniqueInputCount} NEGATIVE (${semanticCounts.fallbackUniqueInputCount} policy fallback), ${semanticCounts.unknownUniqueInputCount} UNKNOWN. ${semanticCounts.unknownFindingIntentCount} unknown findings; ${semanticCounts.zeroConfidenceFindingIntentCount} zero-confidence findings. Consistency checks do not certify model accuracy.` });
    log(notEvaluated || rejected ? "warn" : "info", "recovery_classification_completed", {
      phase: "classification", keywordFindingCount: candidates.length, uniqueModelInputCount: groups.length,
      evaluatedUniqueInputCount: evaluated, rejectedUniqueInputCount: rejected, notEvaluatedUniqueInputCount: notEvaluated,
      uniqueInputLimitSkipped: 0, classificationTimeSkipped: timeLimitReached ? notEvaluated : 0,
      acceptedFindingIntentCount: intents.length, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      ...semanticCounts, validationIssueCounts
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
    const items = report.items;
    log("info", "recovery_persistence_started", {
      phase: "persistence",
      reportItemCount: items.length,
      sourceReportItemCount: report.items.length,
      reportItemLimitReached: false,
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
    cachedInputTokensReported: diagnostics.cachedInputTokensReported,
    validationIssues: diagnostics.validationIssues ?? [],
    finishReason: diagnostics.finishReason ?? null,
    outputCharacters: diagnostics.outputCharacters ?? null
  };
}

function safeRecoveryError(error: unknown): Record<string, unknown> {
  if (error instanceof RecoveryIntentValidationError) return { errorType: error.name, errorCode: "RECOVERY_RESPONSE_VALIDATION_FAILED", validationIssues: error.issues };
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
