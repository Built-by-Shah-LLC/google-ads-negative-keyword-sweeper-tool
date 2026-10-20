import assert from "node:assert/strict";
import test from "node:test";
import { inspectRecoveryIntents, RecoveryIntentValidationError, validateRecoveryIntents } from "../src/volume-recovery/classifier.js";
import { runVolumeRecovery } from "../src/volume-recovery/pipeline.js";
import { completion, offlineHarness, reply } from "./helpers/recovery-classification.js";

const row = { itemId: "a", category: null, competitorLikelihood: "unknown", confidence: 0.4, reason: "Uncertain synthetic intent." };
test("validation diagnostics identify the exact rule and row without logging values", () => {
  const result = inspectRecoveryIntents({ items: [row, { ...row, itemId: "b", confidence: "private-value", reason: "private-reason".repeat(100) }] }, ["a", "b"], []);
  assert.deepEqual(result.intents, [row]);
  assert.deepEqual(result.issues, [
    { code: "confidence_not_number", field: "confidence", rowIndex: 1, actualType: "string" },
    { code: "reason_too_long", field: "reason", rowIndex: 1, actualLength: 1400, maximumLength: 1000 }
  ]);
  assert.equal(JSON.stringify(result.issues).includes("private"), false);
  assert.throws(() => validateRecoveryIntents({ items: [row, row] }, ["a", "b"], []), RecoveryIntentValidationError);
  assert.equal(inspectRecoveryIntents({ items: [row, row] }, ["a", "b"], []).intents.length, 0, "Neither duplicate may win arbitrarily");
});

test("one invalid row preserves 24 accepted inputs and retries only the missing input", async () => {
  const h = offlineHarness((candidates, index) => completion(reply(candidates).map((intent, i) => index === 0 && i === 0 ? { ...intent, confidence: "0.9" } : intent)));
  const logs: Record<string, unknown>[] = [];
  h.services.logger = { info: (fields: Record<string, unknown>) => logs.push(fields), warn: (fields: Record<string, unknown>) => logs.push(fields), error: (fields: Record<string, unknown>) => logs.push(fields) } as NonNullable<typeof h.services.logger>;
  assert.equal(await runVolumeRecovery(h.request.id, "synthetic", h.services), "succeeded");
  assert.deepEqual(h.model.requests.map(request => JSON.parse(request.messages[1]!.content).items.length), [25, 1]);
  assert.ok(h.saved.every(row => row.item.semanticConfidence !== null));
  assert.deepEqual(h.terminal().usage, { inputTokens: 200, outputTokens: 40 });
  const rejected = logs.find(row => row.recoveryEvent === "recovery_classification_batch_rejected")!;
  assert.equal(rejected.acceptedUniqueInputCount, 24);
  assert.deepEqual(rejected.validationIssues, [{ code: "confidence_not_number", field: "confidence", rowIndex: 0, actualType: "string" }]);
  assert.equal((h.terminal().summary.coverage as { source: string }[]).some(row => row.source === "classification_rejected"), false);
});

test("more than 10000 findings and 2000 inputs are all classified and saved with bounded concurrency", async () => {
  const h = offlineHarness(candidates => completion(candidates.map(candidate => ({ ...row, itemId: candidate.key }))));
  const sources = await h.services.collect(h.request);
  const original = sources.exclusions.find(exclusion => exclusion.scope === "campaign")!;
  sources.exclusions = Array.from({ length: 10025 }, (_, i) => ({ ...original, resource: `synthetic/${i}`, text: `synthetic repair ${i}` }));
  sources.facts = [];
  sources.conversionFacts = [];
  sources.campaignContexts = {};
  h.services.collect = async () => sources;
  h.services.classificationConcurrency = 4;
  const classify = h.services.classify;
  let active = 0, peak = 0;
  h.services.classify = async (...args) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    try { return await classify(...args); } finally { active--; }
  };
  assert.notEqual(await runVolumeRecovery(h.request.id, "synthetic", h.services), "failed");
  assert.equal(h.saved.length, 10025);
  assert.ok(h.saved.every(row => row.item.semanticConfidence === 0.4));
  assert.equal(h.model.requests.length, 401);
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.match((h.terminal().summary.coverage as { source: string; detail: string }[]).find(row => row.source === "classification_summary")!.detail, /10025 evaluated, 0 rejected, 0 not evaluated/);
});
