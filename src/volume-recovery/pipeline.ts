import { analyzeRecovery, recoveryCandidates, type RecoveryIntent } from "./analysis.js";
import { recoveryRecord, type RecoveryCoverage } from "./contract.js";
import { verifyRecoverySnapshot, type RecoveryStore } from "./persistence.js";
import type { RecoverySources } from "./sources.js";
import type { RecoveryRequest } from "./persistence.js";
import type { RecoveryCandidate } from "./analysis.js";
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
    const selected = candidates.slice(0, 2000);
    if (candidates.length > 2000) modelCoverage.push({
      source: "classification_limit",
      available: false,
      detail: "Only the first 2,000 findings were classified; all other findings require manual review."
    });
    for (let offset = 0; offset < selected.length; offset += 25) {
      if (heartbeatError) throw new Error("Recovery heartbeat could not be persisted.");
      if ((services.now?.() ?? new Date()).valueOf() - started > 20 * 60000) {
        modelCoverage.push({
          source: "classification_time_limit",
          available: false,
          detail: "Classification stopped at its time bound; remaining items require review."
        });
        break;
      }
      stage = "Classifying intent " + String(offset + 1) + "–" + String(Math.min(offset + 25, selected.length));
      await services.store.progress(request, execution, stage);
      try {
        if (!categories.length) throw new Error("No valid taxonomy categories.");
        const response = await services.classify(request, selected.slice(offset, offset + 25), categories);
        usage.inputTokens += response.usage.inputTokens;
        usage.outputTokens += response.usage.outputTokens;
        if (!response.intents) throw new Error("Invalid classification output.");
        intents.push(...response.intents);
      } catch {
        modelCoverage.push({
          source: "intent_batch_" + String(offset / 25 + 1),
          available: false,
          detail: "This intent batch could not be validated. Its items remain review-only."
        });
      }
    }
    sources.coverage.push(...modelCoverage);
    stage = "Ranking and saving report";
    await services.store.progress(request, execution, stage);
    const report = analyzeRecovery(sources, request.policy, intents, request.targetCpa);
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
