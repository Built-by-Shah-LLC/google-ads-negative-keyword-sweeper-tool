import assert from "node:assert/strict";
import test from "node:test";
import { PipelineError } from "../src/observability/errors.js";
import { RunTelemetry } from "../src/observability/run-telemetry.js";

test("records stage failures with organization context and typed error metadata", async () => {
  const telemetry = new RunTelemetry();
  await assert.rejects(() => telemetry.track("FETCH", { organizationId: "123" }, async () => {
    throw new PipelineError("rate limited", {
      stage: "GOOGLE_ADS_REQUEST",
      code: "GOOGLE_ADS_HTTP_ERROR",
      statusCode: 429,
      requestId: "request-1",
      retryable: true,
      provider: "google-ads"
    });
  }), /rate limited/u);

  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.events[0]?.status, "FAILED");
  assert.equal(snapshot.errors[0]?.organizationId, "123");
  assert.equal(snapshot.errors[0]?.code, "GOOGLE_ADS_HTTP_ERROR");
  assert.equal(snapshot.errors[0]?.requestId, "request-1");
  assert.equal(snapshot.errors[0]?.retryable, true);
});

test("aggregates actual LLM usage separately from fixed organization input", () => {
  const telemetry = new RunTelemetry();
  telemetry.recordGeneration({
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 125,
    cachedInputTokens: 10,
    thoughtTokens: 5
  });
  telemetry.recordGeneration({
    inputTokens: 110,
    outputTokens: 25,
    totalTokens: 135,
    cachedInputTokens: 0,
    thoughtTokens: 0
  });
  telemetry.recordFixedInput(1_891);
  telemetry.recordBatch(true);

  assert.deepEqual(telemetry.snapshot().tokenUsage, {
    inputTokens: 210,
    outputTokens: 45,
    totalTokens: 260,
    cachedInputTokens: 10,
    thoughtTokens: 5,
    generationRequests: 2,
    successfulBatches: 1,
    failedBatches: 0,
    fixedInputTokens: 1_891,
    organizationsCounted: 1
  });
});
