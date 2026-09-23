import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { disabledMutationSummary } from "../src/google-ads/negative-keyword-writer.js";
import type { OrganizationSummary } from "../src/pipeline/process-organization.js";
import { RunArtifacts } from "../src/storage/run-artifacts.js";
import {
  CIPIRIAN_KEYWORD_ANALYSIS_HEADERS,
  createCipirianKeywordAnalysisWorkbook,
  createRunClassificationReport
} from "../src/storage/cipirian-keyword-analysis.js";
import type { ClassificationCandidate } from "../src/types.js";

test("creates one all-account analysis worksheet and one table from classified candidates", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "cipirian-keyword-analysis-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const artifacts = new RunArtifacts(root, "run-1");
  const candidates: ClassificationCandidate[] = [
    {
      itemId: "item-1",
      customerId: "1234567890",
      startDate: "2026-09-16",
      endDate: "2026-09-16",
      channel: "SEARCH",
      campaignId: "111",
      campaignName: "Collision",
      adGroupId: "222",
      adGroupName: "Repair",
      searchTerm: "free car",
      targetingStatus: "NONE",
      matchedKeyword: "collision repair",
      matchedKeywordMatchType: "BROAD",
      impressions: 12,
      clicks: 2,
      costMicros: 1500000,
      conversions: 0,
      conversionValue: 0
    },
    {
      itemId: "item-2",
      customerId: "1234567890",
      startDate: "2026-09-16",
      endDate: "2026-09-16",
      channel: "PERFORMANCE_MAX",
      campaignId: "111",
      campaignName: "Collision",
      adGroupId: null,
      adGroupName: null,
      searchTerm: "=formula-shaped query",
      targetingStatus: null,
      matchedKeyword: null,
      matchedKeywordMatchType: null,
      impressions: 8,
      clicks: 1,
      costMicros: 900000,
      conversions: 0,
      conversionValue: 0
    }
  ];
  await artifacts.write("organizations/1234567890/candidates.json", { candidates });
  await artifacts.write("organizations/1234567890/decisions.json", {
    decisions: [{
      itemId: "item-1",
      decision: "NEGATIVE_EXACT",
      negativeText: "free car",
      ruleIds: ["POL-FREE"],
      reason: "Free-item intent",
      confidence: 0.99
    }]
  });
  await artifacts.write("organizations/1234567890/errors.json", { errors: [] });
  const summary: OrganizationSummary = {
    customerId: "1234567890",
    descriptiveName: "Example Collision",
    dateRange: { startDate: "2026-09-16", endDate: "2026-09-16" },
    status: "PARTIAL",
    rawRowCount: 20,
    candidateCount: 2,
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
      fixedInputTokens: null,
      fixedInputDefinition: null
    },
    batchTokenUsage: [],
    mutation: disabledMutationSummary(),
    errorCount: 1
  };

  const report = await createRunClassificationReport({
    runId: "run-1",
    runDirectory: artifacts.runDirectory,
    summaries: [summary],
    provider: "test-provider",
    model: "test-model",
    ruleVersion: "rules-v1"
  });
  assert.equal(report.rows.length, 2);
  assert.equal(report.rows[0]?.searchTerm, "=formula-shaped query");
  assert.equal(report.rows[0]?.classificationStatus, "MISSING_OR_FAILED");
  assert.equal(report.rows[1]?.searchTerm, "free car");
  assert.equal(report.rows[1]?.classificationStatus, "VALIDATED");
  assert.deepEqual(report.accountOverviews[0]?.negativeKeywords, [{
    channel: "SEARCH",
    campaignName: "Collision",
    negativeText: "free car",
    ruleIds: ["POL-FREE"]
  }]);

  const buffer = await createCipirianKeywordAnalysisWorkbook({
    completedAt: "2026-09-18T01:00:00.000Z",
    rows: report.rows
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  assert.equal(workbook.worksheets.length, 1);
  const sheet = workbook.worksheets[0]!;
  assert.equal(sheet.name, "Keyword Analysis");
  const view = sheet.views[0];
  assert.equal(view?.state, "frozen");
  assert.equal(view?.state === "frozen" ? view.xSplit : undefined, 0);
  assert.deepEqual(
    CIPIRIAN_KEYWORD_ANALYSIS_HEADERS.map((_, index) => sheet.getRow(1).getCell(index + 1).value),
    [...CIPIRIAN_KEYWORD_ANALYSIS_HEADERS]
  );
  assert.equal(sheet.getTables().length, 1);
  assert.equal(sheet.getTable("CipirianKeywordAnalysisTable").name, "CipirianKeywordAnalysisTable");
  assert.equal(sheet.getRow(2).getCell(1).value, "MISSING_OR_FAILED");
  assert.equal(sheet.getRow(3).getCell(1).value, "VALIDATED");
  assert.equal(sheet.getRow(2).getCell(3).value, "'=formula-shaped query");
  assert.equal(sheet.getRow(3).getCell(3).value, "free car");
  assert.equal(sheet.getRow(3).getCell(4).value, "NEGATIVE_EXACT");
  assert.equal(sheet.getRow(3).getCell(5).value, "Free-item intent");
});

test("keeps the one-sheet, one-table contract when no candidates were classified", async () => {
  const buffer = await createCipirianKeywordAnalysisWorkbook({
    completedAt: "2026-09-18T01:00:00.000Z",
    rows: []
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0]!;
  assert.equal(workbook.worksheets.length, 1);
  assert.equal(sheet.name, "Keyword Analysis");
  assert.equal(sheet.getTables().length, 1);
  assert.deepEqual(
    CIPIRIAN_KEYWORD_ANALYSIS_HEADERS.map((_, index) => sheet.getRow(1).getCell(index + 1).value),
    [...CIPIRIAN_KEYWORD_ANALYSIS_HEADERS]
  );
});
