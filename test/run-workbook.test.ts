import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import type { OrganizationSummary } from "../src/pipeline/process-organization.js";
import { RunArtifacts } from "../src/storage/run-artifacts.js";
import { createRunWorkbook } from "../src/storage/run-workbook.js";
import type { ClassificationCandidate, RuleSet } from "../src/types.js";

test("creates one organization worksheet with decisions, batch tokens, rules, and timeouts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sweeper-workbook-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = new RunArtifacts(root, "run-1");
  const candidate: ClassificationCandidate = {
    itemId: "item-1",
    customerId: "123",
    startDate: "2026-09-01",
    endDate: "2026-09-01",
    channel: "SEARCH",
    campaignId: "456",
    campaignName: "Collision",
    adGroupId: "789",
    adGroupName: "Repair",
    searchTerm: "free car",
    targetingStatus: "NONE",
    matchedKeyword: "collision repair",
    matchedKeywordMatchType: "BROAD",
    impressions: 10,
    clicks: 2,
    costMicros: 1000,
    conversions: 0,
    conversionValue: 0
  };
  await run.write("organizations/123/candidates.json", { candidates: [candidate] });
  await run.write("organizations/123/decisions.json", { decisions: [{
    itemId: "item-1",
    decision: "NEGATIVE_EXACT",
    negativeText: "free car",
    ruleIds: ["POL-FREE-NEGATIVE"],
    reason: "Free-item intent",
    confidence: 0.99
  }] });
  await run.write("organizations/123/errors.json", { errors: [{
    name: "ClassificationFailure",
    message: "Moonshot request timed out after 600000ms.",
    occurredAt: "2026-09-03T01:00:00.000Z",
    stage: "LLM_CLASSIFICATION",
    code: "LLM_CLASSIFICATION_FAILED",
    organizationId: "123",
    batchId: "0001",
    provider: "moonshot-kimi",
    retryable: true
  }] });
  const summary: OrganizationSummary = {
    customerId: "123",
    descriptiveName: "Example Body Shop",
    dateRange: { startDate: "2026-09-01", endDate: "2026-09-01" },
    status: "PARTIAL",
    rawRowCount: 1,
    candidateCount: 1,
    decisionCount: 1,
    failedBatchCount: 1,
    decisions: { KEEP: 0, NEGATIVE_EXACT: 1 },
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 0,
      thoughtTokens: 0,
      generationRequests: 1,
      fixedInputTokens: 300,
      fixedInputDefinition: "provider count"
    },
    batchTokenUsage: [{
      batchId: "0001",
      status: "FAILED",
      candidateCount: 1,
      generationRequests: 1,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 0,
      thoughtTokens: 0
    }],
    errorCount: 1
  };
  const rules: RuleSet = {
    version: "rules-v1",
    promptVersion: "prompt-v1",
    sourcePath: "rules.md",
    markdown: "### `POL-FREE-NEGATIVE` — Free intent\n\nMark free-item queries negative.",
    ruleIds: ["POL-FREE-NEGATIVE"]
  };

  const buffer = await createRunWorkbook({
    runId: "run-1",
    runDirectory: run.runDirectory,
    status: "PARTIAL",
    startedAt: "2026-09-03T00:00:00.000Z",
    completedAt: "2026-09-03T01:00:00.000Z",
    provider: "moonshot-kimi",
    model: "kimi-k2.6",
    rules,
    summaries: [summary]
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  assert.equal(workbook.worksheets.length, 1);
  const values = workbook.worksheets[0]!.getSheetValues().flat(Infinity).join(" | ");
  assert.match(values, /Actual LLM generation input tokens .* \| 100/u);
  assert.match(values, /Actual LLM generation output tokens .* \| 20/u);
  assert.match(values, /Provider-reported generation total tokens \| 120/u);
  assert.match(values, /Generation-token arithmetic check \| PASS/u);
  assert.match(values, /Batch sums equal organization totals \| PASS/u);
  assert.match(values, /BATCH SUM \| RECONCILED/u);
  assert.match(values, /Fixed shared-input baseline .* \| 300/u);
  assert.match(values, /NEGATIVE_EXACT/u);
  assert.match(values, /Free-item intent/u);
  assert.match(values, /timed out after 600000ms/u);
  assert.match(values, /POL-FREE-NEGATIVE/u);

  // Rows classified as negative keywords must be highlighted light red (FFF4CCCC).
  const sheet = workbook.worksheets[0]!;
  let negativeRowFill: string | undefined;
  sheet.eachRow((row) => {
    if (row.getCell(21).value === "NEGATIVE_EXACT") {
      negativeRowFill = (row.getCell(21).fill as ExcelJS.FillPattern)?.fgColor?.argb;
    }
  });
  assert.equal(negativeRowFill, "FFF4CCCC");
});
