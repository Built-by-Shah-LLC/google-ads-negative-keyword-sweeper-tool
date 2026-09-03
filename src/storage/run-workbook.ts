import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import type { SerializedError } from "../observability/errors.js";
import type { OrganizationSummary } from "../pipeline/process-organization.js";
import type { ClassificationCandidate, ClassificationDecision, LlmTokenUsage, RuleSet } from "../types.js";

export interface RunWorkbookInput {
  runId: string;
  runDirectory: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  startedAt: string;
  completedAt: string;
  provider: string;
  model: string;
  rules: RuleSet;
  summaries: OrganizationSummary[];
}

interface OrganizationArtifacts {
  candidates: ClassificationCandidate[];
  decisions: ClassificationDecision[];
  errors: SerializedError[];
}

export async function createRunWorkbook(input: RunWorkbookInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Google Ads Negative Keyword Sweeper";
  workbook.created = new Date(input.startedAt);
  workbook.modified = new Date(input.completedAt);
  workbook.properties.date1904 = false;

  const usedNames = new Set<string>();
  for (const summary of input.summaries) {
    const artifacts = await loadOrganizationArtifacts(input.runDirectory, summary.customerId);
    const sheet = workbook.addWorksheet(uniqueSheetName(summary.descriptiveName, summary.customerId, usedNames), {
      views: [{ state: "frozen", ySplit: 1 }]
    });
    addOrganizationSheet(sheet, input, summary, artifacts);
  }

  if (workbook.worksheets.length === 0) {
    const sheet = workbook.addWorksheet("Run Summary");
    sheet.addRows([
      ["Run ID", safeCell(input.runId)],
      ["Status", input.status],
      ["Started at", input.startedAt],
      ["Completed at", input.completedAt],
      ["Provider", input.provider],
      ["Model", input.model],
      ["Organizations", 0]
    ]);
    styleKeyValueSection(sheet, 1, 7);
  }

  const generated = await workbook.xlsx.writeBuffer();
  return Buffer.from(generated);
}

async function loadOrganizationArtifacts(runDirectory: string, customerId: string): Promise<OrganizationArtifacts> {
  const base = join(runDirectory, "organizations", customerId);
  const candidatesFile = await readJsonIfExists<{ candidates?: ClassificationCandidate[] }>(join(base, "candidates.json"));
  const decisionsFile = await readJsonIfExists<{ decisions?: ClassificationDecision[] }>(join(base, "decisions.json"));
  const errorsFile = await readJsonIfExists<{ errors?: SerializedError[] }>(join(base, "errors.json"));
  return {
    candidates: Array.isArray(candidatesFile?.candidates) ? candidatesFile.candidates : [],
    decisions: Array.isArray(decisionsFile?.decisions) ? decisionsFile.decisions : [],
    errors: Array.isArray(errorsFile?.errors) ? errorsFile.errors : []
  };
}

function addOrganizationSheet(
  sheet: ExcelJS.Worksheet,
  input: RunWorkbookInput,
  summary: OrganizationSummary,
  artifacts: OrganizationArtifacts
): void {
  sheet.columns = Array.from({ length: 27 }, (_, index) => ({
    key: `column-${index + 1}`,
    width: index === 0 ? 24 : index < 5 ? 20 : 16
  }));

  const organizationArithmetic = tokenArithmetic(summary.tokenUsage);
  const batchTotals = summary.batchTokenUsage.reduce((total, batch) => ({
    inputTokens: total.inputTokens + batch.inputTokens,
    outputTokens: total.outputTokens + batch.outputTokens,
    totalTokens: total.totalTokens + batch.totalTokens,
    cachedInputTokens: total.cachedInputTokens + batch.cachedInputTokens,
    thoughtTokens: total.thoughtTokens + batch.thoughtTokens,
    generationRequests: total.generationRequests + batch.generationRequests
  }), {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    thoughtTokens: 0,
    generationRequests: 0
  });
  const batchesReconcile = batchTotals.inputTokens === summary.tokenUsage.inputTokens
    && batchTotals.outputTokens === summary.tokenUsage.outputTokens
    && batchTotals.totalTokens === summary.tokenUsage.totalTokens
    && batchTotals.cachedInputTokens === summary.tokenUsage.cachedInputTokens
    && batchTotals.thoughtTokens === summary.tokenUsage.thoughtTokens
    && batchTotals.generationRequests === summary.tokenUsage.generationRequests;

  addTitle(sheet, `Run information — ${summary.descriptiveName}`);
  const infoStart = sheet.rowCount + 1;
  const infoRows: Array<[string, string | number | null]> = [
    ["Run ID", input.runId],
    ["Run status", input.status],
    ["Organization status", summary.status],
    ["Customer ID", summary.customerId],
    ["Organization", summary.descriptiveName],
    ["Processing start date", summary.dateRange.startDate],
    ["Processing end date", summary.dateRange.endDate],
    ["Run started at", input.startedAt],
    ["Run completed at", input.completedAt],
    ["Provider", input.provider],
    ["Model", input.model],
    ["Rule version", input.rules.version],
    ["Prompt version", input.rules.promptVersion],
    ["Read only", "Yes — no Google Ads mutation performed"],
    ["Raw Google Ads rows", summary.rawRowCount],
    ["Candidates", summary.candidateCount],
    ["Validated decisions", summary.decisionCount],
    ["KEEP", summary.decisions.KEEP ?? 0],
    ["NEGATIVE_EXACT", summary.decisions.NEGATIVE_EXACT ?? 0],
    ["Batches used", summary.batchTokenUsage.length],
    ["Successful batches", summary.batchTokenUsage.filter((item) => item.status === "VALIDATED").length],
    ["Failed batches", summary.failedBatchCount],
    ["Actual LLM generation input tokens — all generation calls", summary.tokenUsage.inputTokens],
    ["Actual LLM generation output tokens — all generation calls", summary.tokenUsage.outputTokens],
    ["Provider-reported generation total tokens", summary.tokenUsage.totalTokens],
    [`Calculated generation total — ${organizationArithmetic.formula}`, organizationArithmetic.calculatedTotal],
    ["Generation-token arithmetic check", organizationArithmetic.reconciled ? "PASS" : `FAIL — difference ${organizationArithmetic.difference}`],
    ["Cached input tokens — subset of input; do not add again", summary.tokenUsage.cachedInputTokens],
    ["Reasoning/thought tokens — provider detail; arithmetic basis shown above", summary.tokenUsage.thoughtTokens],
    ["LLM generation calls — includes validation retries", summary.tokenUsage.generationRequests],
    ["Fixed shared-input baseline — separate count request; excluded from generation totals", summary.tokenUsage.fixedInputTokens],
    ["Batch sums equal organization totals", batchesReconcile ? "PASS" : "FAIL"],
    ["Recorded errors", summary.errorCount],
    ["Organization error", summary.error ?? null]
  ];
  for (const row of infoRows) sheet.addRow([safeCell(row[0]), safeCell(row[1])]);
  styleKeyValueSection(sheet, infoStart, sheet.rowCount);

  addTitle(sheet, "Batch token usage");
  const batchHeader = sheet.addRow([
    "Batch ID", "Status", "Candidates", "LLM generation calls (includes validation retries)",
    "Actual input tokens", "Cached input tokens (subset; do not add)", "Actual output tokens",
    "Reasoning/thought detail", "Provider-reported total tokens", "Calculated total tokens",
    "Arithmetic basis", "Arithmetic check", "Related error/timeout"
  ]);
  styleHeader(batchHeader);
  for (const batch of summary.batchTokenUsage) {
    const related = artifacts.errors.filter((error) => error.batchId === batch.batchId);
    const arithmetic = tokenArithmetic(batch);
    sheet.addRow([
      batch.batchId,
      batch.status,
      batch.candidateCount,
      batch.generationRequests,
      batch.inputTokens,
      batch.cachedInputTokens,
      batch.outputTokens,
      batch.thoughtTokens,
      batch.totalTokens,
      arithmetic.calculatedTotal,
      arithmetic.formula,
      arithmetic.reconciled ? "PASS" : `FAIL — difference ${arithmetic.difference}`,
      safeCell(related.map(formatError).join(" | "))
    ]);
  }
  if (summary.batchTokenUsage.length === 0) {
    sheet.addRow(["No LLM batches were required or started."]);
  } else {
    const totalArithmetic = tokenArithmetic(batchTotals);
    const totalRow = sheet.addRow([
      "BATCH SUM",
      batchesReconcile ? "RECONCILED" : "MISMATCH",
      summary.batchTokenUsage.reduce((sum, batch) => sum + batch.candidateCount, 0),
      batchTotals.generationRequests,
      batchTotals.inputTokens,
      batchTotals.cachedInputTokens,
      batchTotals.outputTokens,
      batchTotals.thoughtTokens,
      batchTotals.totalTokens,
      totalArithmetic.calculatedTotal,
      totalArithmetic.formula,
      totalArithmetic.reconciled && batchesReconcile ? "PASS" : "FAIL",
      ""
    ]);
    totalRow.font = { bold: true };
    totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
  }

  addTitle(sheet, "KEEP and negative-keyword decisions");
  const decisionHeader = sheet.addRow([
    "Classification status", "Customer ID", "Organization", "Start date", "End date", "Item ID", "Channel",
    "Campaign ID", "Campaign", "Ad group ID", "Ad group", "Search term", "Targeting status", "Matched keyword",
    "Matched keyword match type", "Impressions", "Clicks", "Cost micros", "Conversions", "Conversion value",
    "Decision", "Negative keyword", "Rule IDs", "Reason", "Confidence", "Provider", "Model"
  ]);
  styleHeader(decisionHeader);
  const decisionsById = new Map(artifacts.decisions.map((decision) => [decision.itemId, decision]));
  for (const candidate of artifacts.candidates) {
    const decision = decisionsById.get(candidate.itemId);
    sheet.addRow([
      decision ? "VALIDATED" : "MISSING_OR_FAILED",
      safeCell(summary.customerId),
      safeCell(summary.descriptiveName),
      candidate.startDate,
      candidate.endDate,
      safeCell(candidate.itemId),
      candidate.channel,
      safeCell(candidate.campaignId),
      safeCell(candidate.campaignName),
      safeCell(candidate.adGroupId),
      safeCell(candidate.adGroupName),
      safeCell(candidate.searchTerm),
      safeCell(candidate.targetingStatus),
      safeCell(candidate.matchedKeyword),
      safeCell(candidate.matchedKeywordMatchType),
      candidate.impressions,
      candidate.clicks,
      candidate.costMicros,
      candidate.conversions,
      candidate.conversionValue,
      decision?.decision ?? "",
      safeCell(decision?.negativeText ?? null),
      safeCell(decision?.ruleIds.join("; ") ?? null),
      safeCell(decision?.reason ?? null),
      decision?.confidence ?? "",
      input.provider,
      input.model
    ]);
  }
  if (artifacts.candidates.length === 0) sheet.addRow(["No candidates were fetched for this organization."]);

  addTitle(sheet, "Organization errors and timeouts");
  const errorHeader = sheet.addRow([
    "Occurred at", "Stage", "Code", "Batch ID", "Provider", "HTTP status", "Request ID", "Retryable", "Error / timeout"
  ]);
  styleHeader(errorHeader);
  for (const error of artifacts.errors) {
    sheet.addRow([
      error.occurredAt,
      error.stage,
      error.code ?? "",
      error.batchId ?? "",
      error.provider ?? "",
      error.statusCode ?? "",
      error.requestId ?? "",
      error.retryable === undefined ? "" : String(error.retryable),
      safeCell(formatError(error))
    ]);
  }
  if (artifacts.errors.length === 0) sheet.addRow(["No organization errors recorded."]);

  addTitle(sheet, "Authoritative rules used for this organization");
  sheet.addRow(["Rule source", safeCell(input.rules.sourcePath)]);
  sheet.addRow(["Rule IDs", safeCell(input.rules.ruleIds.join("; "))]);
  const ruleRow = sheet.addRow(["Full rule text", safeCell(input.rules.markdown)]);
  ruleRow.height = 180;
  ruleRow.getCell(2).alignment = { wrapText: true, vertical: "top" };

  sheet.autoFilter = {
    from: { row: decisionHeader.number, column: 1 },
    to: { row: Math.max(decisionHeader.number, decisionHeader.number + artifacts.candidates.length), column: 27 }
  };
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { ...cell.alignment, vertical: "top", wrapText: true };
    });
  });
}

function addTitle(sheet: ExcelJS.Worksheet, title: string): void {
  if (sheet.rowCount > 0) sheet.addRow([]);
  const row = sheet.addRow([title]);
  sheet.mergeCells(row.number, 1, row.number, 10);
  row.height = 22;
  row.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
  row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17365D" } };
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F81BD" } };
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 32;
}

function styleKeyValueSection(sheet: ExcelJS.Worksheet, start: number, end: number): void {
  for (let rowNumber = start; rowNumber <= end; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.getCell(1).font = { bold: true };
    if (rowNumber % 2 === 0) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
    }
  }
}

function formatError(error: SerializedError): string {
  const cause = error.cause ? `; cause: ${formatError(error.cause)}` : "";
  return `${error.name}: ${error.message}${cause}`;
}

function tokenArithmetic(usage: LlmTokenUsage): {
  calculatedTotal: number;
  formula: string;
  difference: number;
  reconciled: boolean;
} {
  const inputAndOutput = usage.inputTokens + usage.outputTokens;
  const inputOutputAndThought = inputAndOutput + usage.thoughtTokens;
  if (usage.totalTokens === inputAndOutput) {
    return {
      calculatedTotal: inputAndOutput,
      formula: "INPUT + OUTPUT (reasoning/thought is included in output or zero)",
      difference: 0,
      reconciled: true
    };
  }
  if (usage.totalTokens === inputOutputAndThought) {
    return {
      calculatedTotal: inputOutputAndThought,
      formula: "INPUT + OUTPUT + SEPARATELY REPORTED REASONING/THOUGHT",
      difference: 0,
      reconciled: true
    };
  }
  return {
    calculatedTotal: inputAndOutput,
    formula: "INPUT + OUTPUT",
    difference: usage.totalTokens - inputAndOutput,
    reconciled: false
  };
}

function safeCell(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  return /^[\t\r ]*[=+\-@]/u.test(value) ? `'${value}` : value;
}

function uniqueSheetName(name: string, customerId: string, used: Set<string>): string {
  const cleaned = `${name || "Organization"} ${customerId}`.replace(/[\\/*?:\[\]]/gu, " ").replace(/\s+/gu, " ").trim();
  const base = (cleaned || customerId || "Organization").slice(0, 31);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLocaleLowerCase("en-US"))) {
    const marker = ` (${suffix})`;
    candidate = `${base.slice(0, 31 - marker.length)}${marker}`;
    suffix += 1;
  }
  used.add(candidate.toLocaleLowerCase("en-US"));
  return candidate;
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
