import assert from "node:assert/strict";
import test from "node:test";
import { PipelineError } from "../src/observability/errors.js";
import { RunTelemetry } from "../src/observability/run-telemetry.js";
import { createRunTokenUsageReport } from "../src/pipeline/run-sweeper.js";
import type { OrganizationSummary } from "../src/pipeline/process-organization.js";

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

test("reconciles run token totals from organization and batch records", () => {
  const summary: OrganizationSummary = {
    customerId: "123",
    descriptiveName: "Test Collision",
    dateRange: { startDate: "2026-08-24", endDate: "2026-08-25" },
    status: "SUCCEEDED",
    rawRowCount: 2,
    candidateCount: 2,
    decisionCount: 2,
    failedBatchCount: 0,
    decisions: { KEEP: 2, NEGATIVE_EXACT: 0 },
    tokenUsage: {
      inputTokens: 200,
      outputTokens: 40,
      totalTokens: 240,
      cachedInputTokens: 100,
      thoughtTokens: 0,
      generationRequests: 2,
      fixedInputTokens: 321,
      fixedInputDefinition: "fixed baseline"
    },
    batchTokenUsage: [{
      batchId: "0001",
      status: "VALIDATED",
      candidateCount: 2,
      generationRequests: 2,
      inputTokens: 200,
      outputTokens: 40,
      totalTokens: 240,
      cachedInputTokens: 100,
      thoughtTokens: 0
    }],
    errorCount: 0
  };
  const totals = {
    inputTokens: 200,
    outputTokens: 40,
    totalTokens: 240,
    cachedInputTokens: 100,
    thoughtTokens: 0,
    generationRequests: 2,
    successfulBatches: 1,
    failedBatches: 0,
    fixedInputTokens: 321,
    organizationsCounted: 1
  };

  const report = createRunTokenUsageReport(totals, [summary]);

  assert.equal(report.reconciliation.reconciled, true);
  assert.deepEqual(report.reconciliation.organizationTotals, totals);
  assert.equal(report.organizations[0]?.batchCount, 1);
});
