import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { analyzeRecovery, recoveryCandidates } from "../src/volume-recovery/analysis.js";
import { canonicalRecoveryJson } from "../src/volume-recovery/contract.js";
import { createRecoveryClassifier, inspectRecoveryIntents, RECOVERY_FALLBACK_CATEGORY, recoveryCategories, recoveryIntentInputs, recoveryModelRequest } from "../src/volume-recovery/classifier.js";
import { runVolumeRecovery } from "../src/volume-recovery/pipeline.js";
import { completion, config, fakeDispatcher, offlineHarness, reply } from "./helpers/recovery-classification.js";

const keep = "POL-BODYWORK-KEEP";
const competitor = "POL-COMPETITOR-NEGATIVE";
const categories = [keep, competitor, RECOVERY_FALLBACK_CATEGORY];
const snapshot = { rulesMarkdown: `### \`${keep}\`\nKEEP generic body-shop demand.\n### \`${competitor}\`\nNEGATIVE competing business demand.\n### \`${RECOVERY_FALLBACK_CATEGORY}\`\nNEGATIVE with no approved KEEP signal and no specific negative rule.`, phraseProtections: [] };
const inputs = [{ itemId: "a", negativeText: "body shop near me" }, { itemId: "b", negativeText: "windows 10" }];
const row = { ...inputs[0]!, decision: "KEEP", category: keep, competitorLikelihood: "unlikely", confidence: 0.8, reason: "Generic body-shop demand satisfies the pinned KEEP rule." } as const;

test("pinned taxonomy contains all KEEP and NEGATIVE rules without meta rules or duplicates", async () => {
  const rules = await readFile(new URL("../src/config/negative-keyword-rules.md", import.meta.url), "utf8");
  const actual = recoveryCategories(rules);
  assert.equal(actual.filter(id => id.endsWith("-KEEP")).length, 6);
  assert.equal(actual.filter(id => id.endsWith("-NEGATIVE")).length, 24);
  assert.ok(actual.includes(RECOVERY_FALLBACK_CATEGORY));
  assert.deepEqual(recoveryCategories(snapshot.rulesMarkdown + "\n### `POL-META`\nMeta."), categories);
  assert.throws(() => recoveryCategories(snapshot.rulesMarkdown + `\n### \`${keep}\`\nDuplicate.`), /Duplicate/);
});

test("semantic checks reject inconsistent rows and retain valid peers without logging input values", async t => {
  const cases: [string, object, string][] = [
    ["unknown despite fallback", { decision: "UNKNOWN", category: null, confidence: 0 }, "semantic_unknown_with_policy_fallback"],
    ["wrong text for correct ID", { negativeText: "l" }, "semantic_input_text_mismatch"],
    ["negative disposition with KEEP rule", { decision: "NEGATIVE" }, "semantic_decision_category_mismatch"],
    ["zero confidence with category", { confidence: 0 }, "semantic_zero_confidence_category"],
    ["KEEP claims competitor", { competitorLikelihood: "likely" }, "semantic_keep_competitor_conflict"],
    ["competitor category denies competitor", { decision: "NEGATIVE", category: competitor }, "semantic_competitor_category_conflict"]
  ];
  for (const [name, bad, code] of cases) await t.test(name, () => {
    const valid = { ...row, ...inputs[1], decision: "NEGATIVE", category: RECOVERY_FALLBACK_CATEGORY };
    const result = inspectRecoveryIntents({ items: [{ ...row, ...bad }, valid] }, inputs, categories);
    assert.deepEqual(result.intents, [valid]);
    assert.ok(result.issues.some(issue => issue.code === code && issue.rowIndex === 0));
    assert.equal(JSON.stringify(result.issues).includes("windows"), false);
    assert.equal(JSON.stringify(result.issues).includes("body shop"), false);
  });
  assert.equal(inspectRecoveryIntents({ items: [{ ...row, confidence: 0.01 }] }, inputs.slice(0, 1), categories).intents[0]?.confidence, 0.01, "Low confidence is preserved, not promoted");
  const unknown = { ...row, category: null, decision: "UNKNOWN", confidence: 0 };
  assert.deepEqual(inspectRecoveryIntents({ items: [unknown] }, inputs.slice(0, 1), [keep]).intents, [unknown], "Policies without fallback can retain genuine unknowns");
  const ambiguousCompetitor = { ...row, decision: "NEGATIVE", category: competitor, competitorLikelihood: "unknown", confidence: 0.2 };
  assert.deepEqual(inspectRecoveryIntents({ items: [ambiguousCompetitor] }, inputs.slice(0, 1), categories).intents, [ambiguousCompetitor], "Aggressive policy classification does not invent competitor certainty");
});

test("model request declares trusted policy, complete taxonomy, input binding and exact repair checks", async () => {
  const h = offlineHarness();
  const candidates = (await h.services.collect(h.request)).exclusions.slice(0, 1).map(exclusion => ({ key: "a", campaignId: null, exclusion }));
  const request = recoveryModelRequest(config, "Fictional shop", snapshot, candidates, categories, { attempt: 2, validationCodes: ["semantic_unknown_with_policy_fallback"] });
  const messages = request.messages as { content: string }[];
  assert.match(messages[0]!.content, /authoritative BUSINESS POLICY/);
  assert.match(messages[0]!.content, /Insufficient service intent is the policy fallback, not UNKNOWN/);
  const user = JSON.parse(messages[1]!.content);
  assert.deepEqual(user.allowedCategories, categories);
  assert.deepEqual(user.repair.validationCodes, ["semantic_unknown_with_policy_fallback"]);
  const schema = (request.response_format as { json_schema: { schema: { properties: { items: { items: { properties: Record<string, unknown> } } } } } }).json_schema.schema.properties.items.items.properties;
  assert.deepEqual(schema.decision, { type: "string", enum: ["KEEP", "NEGATIVE"] });
  assert.equal(JSON.stringify(schema.category).includes('"null"'), false);
  const model = fakeDispatcher(() => completion([{ ...row, ...recoveryIntentInputs(candidates)[0], decision: "UNKNOWN", category: null, confidence: 0 }]));
  const result = await createRecoveryClassifier(config, model.dispatcher).classify("Fictional shop", snapshot, candidates, categories);
  assert.equal(result.diagnostics.outcome, "response_semantic_invalid");
  assert.equal(result.intents, null);
});

test("pipeline repairs semantic rejection, preserves peers, reports dispositions and never invents fallback", async () => {
  const h = offlineHarness((candidates, index) => completion(reply(candidates).map((item, i) => ({
    ...item, decision: index === 0 && i === 0 ? "UNKNOWN" : "NEGATIVE",
    category: index === 0 && i === 0 ? null : RECOVERY_FALLBACK_CATEGORY,
    competitorLikelihood: "unknown", confidence: index === 0 && i === 0 ? 0 : 0.4
  }))));
  h.request.snapshot = snapshot;
  h.request.policyHash = createHash("sha256").update(canonicalRecoveryJson(snapshot)).digest("hex");
  const logs: Record<string, unknown>[] = [];
  h.services.logger = { info: (fields: Record<string, unknown>) => logs.push(fields), warn: (fields: Record<string, unknown>) => logs.push(fields), error: (fields: Record<string, unknown>) => logs.push(fields) } as NonNullable<typeof h.services.logger>;
  assert.equal(await runVolumeRecovery(h.request.id, "fictional", h.services), "succeeded");
  assert.deepEqual(h.model.requests.map(request => JSON.parse(request.messages[1]!.content).items.length), [25, 1]);
  assert.deepEqual(JSON.parse(h.model.requests[1]!.messages[1]!.content).repair.validationCodes, ["semantic_unknown_with_policy_fallback"]);
  const complete = logs.find(row => row.recoveryEvent === "recovery_classification_completed")!;
  assert.equal(complete.unknownUniqueInputCount, 0);
  assert.equal(complete.fallbackUniqueInputCount, 25);
  assert.equal(complete.zeroConfidenceFindingIntentCount, 0);
  assert.deepEqual(complete.validationIssueCounts, { semantic_unknown_with_policy_fallback: 1 });
  assert.ok(h.saved.every(saved => saved.item.category === RECOVERY_FALLBACK_CATEGORY && saved.item.semanticConfidence === 0.4));

  const rejected = offlineHarness(candidates => completion(reply(candidates).map(item => ({ ...item, decision: "UNKNOWN", category: null, competitorLikelihood: "unknown", confidence: 0 }))));
  rejected.request.snapshot = snapshot;
  rejected.request.policyHash = h.request.policyHash;
  assert.equal(await runVolumeRecovery(rejected.request.id, "fictional", rejected.services), "partial");
  assert.ok(rejected.saved.every(saved => saved.item.category === null && saved.item.semanticConfidence === null && saved.item.explanation.includes("semantic_unknown_with_policy_fallback")));
  assert.ok(rejected.saved.every(saved => saved.item.recommendation !== "potential_pilot"));
});

test("KEEP findings default to review, retain explicit policy, and cannot bypass pilot evidence", async () => {
  const h = offlineHarness();
  const sources = await h.services.collect(h.request);
  const model = recoveryCandidates(sources).map(candidate => ({ ...row, itemId: candidate.key, negativeText: candidate.exclusion.text, decision: "KEEP" as const }));
  const review = analyzeRecovery(sources, h.request.policy, model, "85").items;
  assert.ok(review.every(saved => saved.item.recommendation !== "retain" && saved.item.recommendation !== "potential_pilot"));
  const retain = analyzeRecovery(sources, { ...h.request.policy, categoryActions: { [keep]: "retain" } }, model, "85").items;
  assert.ok(retain.every(saved => saved.item.recommendation === "retain"));
});
