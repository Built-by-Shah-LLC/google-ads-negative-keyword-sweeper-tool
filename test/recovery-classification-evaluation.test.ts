import assert from "node:assert/strict";
import test from "node:test";
import { assessReference, evaluateRecoveryFixture, evaluationApproval, evaluationCandidates, type EvaluationApproval } from "../scripts/evaluate-recovery-classification.js";
import { completion, config, fakeDispatcher, reply } from "./helpers/recovery-classification.js";

const approval: EvaluationApproval = { approvedFixture: true, budgetUsd: 1, inputUsdPerMillion: 1, outputUsdPerMillion: 1, priceBasis: "Synthetic pricing for offline tests only" };
test("optional paid evaluator is disabled by default and validates consent/budget before transport", async () => {
  const model = fakeDispatcher(() => { throw new Error("must not call"); });
  assert.throws(() => evaluationApproval([]), /disabled/);
  assert.throws(() => evaluationApproval(["--approve-paid-fixture"]), /budget/);
  assert.throws(() => evaluationApproval(["--unknown"]), /arguments/);
  await assert.rejects(evaluateRecoveryFixture({ ...approval, approvedFixture: false }, config, model.dispatcher), /disabled/);
  await assert.rejects(evaluateRecoveryFixture({ ...approval, budgetUsd: 0.000001 }, config, model.dispatcher), /quote/);
  await assert.rejects(evaluateRecoveryFixture(approval, { ...config, maxRetries: 1 }, model.dispatcher), /no retries/);
  assert.equal(model.requests.length, 0);
});
test("fake evaluation uses actual recovery adapter, reports disagreements and supplied cost basis", async () => {
  const answers = reply(evaluationCandidates);
  answers.find(item => item.itemId === "csv-row-34")!.category = "BODYWORK-NEGATIVE"; // Deliberate clear-case disagreement.
  const model = fakeDispatcher(() => completion(answers));
  const result = await evaluateRecoveryFixture(approval, config, model.dispatcher);
  assert.equal(model.requests.length, 1);
  assert.equal(result.status, "accepted");
  assert.equal(result.counts.accepted, 25);
  assert.deepEqual(result.usage && { input: result.usage.inputTokens, output: result.usage.outputTokens, cache: result.usage.cachedInputTokens }, { input: 100, output: 20, cache: 10 });
  assert.equal(result.estimatedCostUsd, 0.00012);
  assert.ok(result.assessment.clearCases.labelAgreement < result.assessment.clearCases.total);
  assert.equal(result.assessment.rows.find(row => row.csvRow === 34)!.disagreements.length, 1);
  assert.equal(JSON.stringify(result).includes(config.apiKey), false);
  assert.match(result.assessment.note, /not semantic certification/);
  assert.equal(result.policyHash.length, 64);
  assert.equal(result.inputHash.length, 64);
});
test("rejected and unavailable evaluations retain honest counts/cost unknowns, not invented accuracy", async () => {
  const rejected = await evaluateRecoveryFixture(approval, config, fakeDispatcher(() => completion([])).dispatcher);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.counts.rejected, 25);
  assert.equal(rejected.usage?.inputTokens, 100);
  const failed = await evaluateRecoveryFixture(approval, config, fakeDispatcher(() => { throw new Error("private secret"); }).dispatcher);
  assert.equal(failed.status, "provider_unavailable");
  assert.equal(failed.estimatedCostUsd, null);
  assert.equal(JSON.stringify(failed).includes("private secret"), false);
  assert.equal(assessReference(null).clearCases.labelAgreement, 0);
});
test("accepted semantics do not turn absent or malformed provider usage into a zero-cost claim", async () => {
  for (const usage of [undefined, {}, { prompt_tokens: "100", completion_tokens: 20 }, { prompt_tokens: 100 }, { prompt_tokens: 100, completion_tokens: -1 }]) {
    const result = await evaluateRecoveryFixture(approval, config, fakeDispatcher(() => ({ ...completion(reply(evaluationCandidates)), usage })).dispatcher);
    assert.equal(result.status, "accepted");
    assert.equal(result.estimatedCostUsd, null);
    assert.equal(result.usage, null);
    assert.equal("budgetExceeded" in result && result.budgetExceeded, null);
    assert.match(result.costBasis, /unknown/);
  }
});
test("explicit zero usage and absent/invalid cache counts stay distinguishable", async () => {
  const run = (usage: unknown) => evaluateRecoveryFixture({ ...approval, cachedInputUsdPerMillion: 0.1 }, config, fakeDispatcher(() => ({ ...completion(reply(evaluationCandidates)), usage })).dispatcher);
  const zero = await run({ prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 });
  assert.equal(zero.estimatedCostUsd, 0);
  assert.equal(zero.usage?.cachedInputTokens, 0);
  for (const usage of [{ prompt_tokens: 100, completion_tokens: 20 }, { prompt_tokens: 100, completion_tokens: 20, cached_tokens: 101 }, { prompt_tokens: 100, completion_tokens: 20, cached_tokens: "10" }]) {
    const result = await run(usage);
    assert.equal(result.usage?.cachedInputTokens, null);
    assert.equal(result.estimatedCostUsd, 0.00012, "Unknown cache is priced conservatively at full input rate");
  }
  const cached = await run({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 10 } });
  assert.equal(cached.usage?.cachedInputTokens, 10);
  assert.equal(cached.estimatedCostUsd, 0.000111);
});
