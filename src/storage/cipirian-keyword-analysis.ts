import ExcelJS from "exceljs";
import type { OrganizationSummary } from "../pipeline/process-organization.js";
import { loadOrganizationClassificationArtifacts } from "./classification-artifacts.js";

export const CIPIRIAN_KEYWORD_ANALYSIS_HEADERS = [
  "Classification status",
  "Organization",
  "Search term",
  "Decision",
  "Reason",
  "Campaign",
  "Ad group",
  "Negative keyword",
  "Rule IDs",
  "Confidence",
  "Impressions",
  "Clicks",
  "Cost micros",
  "Conversions",
  "Conversion value",
  "Channel",
  "Targeting status",
  "Matched keyword",
  "Matched keyword match type",
  "Start date",
  "End date",
  "Customer ID",
  "Campaign ID",
  "Ad group ID",
  "Item ID",
  "Run ID",
  "Provider",
  "Model",
  "Rule version"
] as const;

export interface ClassifiedKeywordRow {
  classificationStatus: "VALIDATED" | "MISSING_OR_FAILED";
  runId: string;
  customerId: string;
  organizationName: string;
  startDate: string;
  endDate: string;
  itemId: string;
  channel: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string | null;
  adGroupName: string | null;
  searchTerm: string;
  targetingStatus: string | null;
  matchedKeyword: string | null;
  matchedKeywordMatchType: string | null;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  conversionValue: number;
  decision: string | null;
  negativeText: string | null;
  ruleIds: string[];
  reason: string | null;
  confidence: number | null;
  provider: string;
  model: string;
  ruleVersion: string;
}

export interface RunReportAccountOverview {
  customerId: string;
  descriptiveName: string;
  status: OrganizationSummary["status"];
  startDate: string;
  endDate: string;
  rawRowCount: number;
  candidateCount: number;
  decisionCount: number;
  keepCount: number;
  negativeExactCount: number;
  errorCount: number;
  mutation: Pick<
    OrganizationSummary["mutation"],
    | "mode"
    | "status"
    | "mockedCount"
    | "validatedCount"
    | "appliedCount"
    | "verifiedCount"
    | "googleAdsMutationPerformed"
  >;
  negativeKeywords: Array<{
    channel: string;
    campaignName: string;
    negativeText: string;
    ruleIds: string[];
  }>;
}

export interface RunClassificationReport {
  rows: ClassifiedKeywordRow[];
  accountOverviews: RunReportAccountOverview[];
}

interface RunClassificationReportInput {
  runId: string;
  runDirectory: string;
  summaries: OrganizationSummary[];
  provider: string;
  model: string;
  ruleVersion: string;
}

/**
 * Joins every fetched candidate to its validated classifier output once. The
 * joined rows drive both the all-account attachment and the concise account
 * sections in the email, so those two views cannot drift apart.
 */
export async function createRunClassificationReport(
  input: RunClassificationReportInput
): Promise<RunClassificationReport> {
  const rows: ClassifiedKeywordRow[] = [];
  const accountOverviews: RunReportAccountOverview[] = [];

  for (const summary of input.summaries) {
    const artifacts = await loadOrganizationClassificationArtifacts(input.runDirectory, summary.customerId);
    const decisionsById = new Map(artifacts.decisions.map((decision) => [decision.itemId, decision]));
    const accountRows = artifacts.candidates.map((candidate) => {
      const decision = decisionsById.get(candidate.itemId);
      return {
        classificationStatus: decision ? "VALIDATED" : "MISSING_OR_FAILED",
        runId: input.runId,
        customerId: summary.customerId,
        organizationName: summary.descriptiveName,
        startDate: candidate.startDate,
        endDate: candidate.endDate,
        itemId: candidate.itemId,
        channel: candidate.channel,
        campaignId: candidate.campaignId,
        campaignName: candidate.campaignName,
        adGroupId: candidate.adGroupId,
        adGroupName: candidate.adGroupName,
        searchTerm: candidate.searchTerm,
        targetingStatus: candidate.targetingStatus,
        matchedKeyword: candidate.matchedKeyword,
        matchedKeywordMatchType: candidate.matchedKeywordMatchType,
        impressions: candidate.impressions,
        clicks: candidate.clicks,
        costMicros: candidate.costMicros,
        conversions: candidate.conversions,
        conversionValue: candidate.conversionValue,
        decision: decision?.decision ?? null,
        negativeText: decision?.negativeText ?? null,
        ruleIds: decision?.ruleIds ?? [],
        reason: decision?.reason ?? null,
        confidence: decision?.confidence ?? null,
        provider: input.provider,
        model: input.model,
        ruleVersion: input.ruleVersion
      } satisfies ClassifiedKeywordRow;
    }).sort(compareRowsBySearchTerm);
    rows.push(...accountRows);
    accountOverviews.push({
      customerId: summary.customerId,
      descriptiveName: summary.descriptiveName,
      status: summary.status,
      startDate: summary.dateRange.startDate,
      endDate: summary.dateRange.endDate,
      rawRowCount: summary.rawRowCount,
      candidateCount: summary.candidateCount,
      decisionCount: summary.decisionCount,
      keepCount: summary.decisions.KEEP ?? 0,
      negativeExactCount: summary.decisions.NEGATIVE_EXACT ?? 0,
      errorCount: summary.errorCount,
      mutation: {
        mode: summary.mutation.mode,
        status: summary.mutation.status,
        mockedCount: summary.mutation.mockedCount,
        validatedCount: summary.mutation.validatedCount,
        appliedCount: summary.mutation.appliedCount,
        verifiedCount: summary.mutation.verifiedCount,
        googleAdsMutationPerformed: summary.mutation.googleAdsMutationPerformed
      },
      negativeKeywords: accountRows
        .filter((row) => row.decision === "NEGATIVE_EXACT" && row.negativeText !== null)
        .slice(0, 12)
        .map((row) => ({
          channel: row.channel,
          campaignName: row.campaignName,
          negativeText: row.negativeText!,
          ruleIds: row.ruleIds
        }))
    });
  }

  return { rows, accountOverviews };
}

/**
 * Creates the supplemental all-account analysis attachment. It intentionally
 * contains one worksheet with one native Excel table and no summary sections,
 * so recipients can filter or export the complete classified-keyword set.
 */
export async function createCipirianKeywordAnalysisWorkbook(input: {
  completedAt: string;
  rows: ClassifiedKeywordRow[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Google Ads Negative Keyword Sweeper";
  workbook.created = new Date(input.completedAt);
  workbook.modified = new Date(input.completedAt);
  workbook.properties.date1904 = false;

  const sheet = workbook.addWorksheet("Keyword Analysis", {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }]
  });
  sheet.columns = CIPIRIAN_KEYWORD_ANALYSIS_HEADERS.map((header, index) => ({
    header,
    key: `column-${index + 1}`,
    width: columnWidth(index)
  }));
  sheet.addTable({
    name: "CipirianKeywordAnalysisTable",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: {
      theme: "TableStyleMedium2",
      showFirstColumn: false,
      showLastColumn: false,
      showRowStripes: true,
      showColumnStripes: false
    },
    columns: CIPIRIAN_KEYWORD_ANALYSIS_HEADERS.map((name) => ({ name, filterButton: true })),
    rows: input.rows.map(rowToCells)
  });
  sheet.getRow(1).height = 30;
  sheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
  for (const column of [2, 3, 5, 6, 7, 8, 9, 17, 18, 19]) {
    sheet.getColumn(column).alignment = { vertical: "top", wrapText: true };
  }
  for (const column of [10, 11, 12, 13, 14, 15]) {
    sheet.getColumn(column).alignment = { horizontal: "right", vertical: "top" };
  }
  sheet.getColumn(10).numFmt = "0.00";
  sheet.getColumn(11).numFmt = "#,##0";
  sheet.getColumn(12).numFmt = "#,##0";
  sheet.getColumn(13).numFmt = "#,##0";
  sheet.getColumn(14).numFmt = "0.00";
  sheet.getColumn(15).numFmt = "0.00";

  const generated = await workbook.xlsx.writeBuffer();
  return Buffer.from(generated);
}

function rowToCells(row: ClassifiedKeywordRow): Array<string | number> {
  return [
    safeCell(row.classificationStatus),
    safeCell(row.organizationName),
    safeCell(row.searchTerm),
    safeCell(row.decision),
    safeCell(row.reason),
    safeCell(row.campaignName),
    safeCell(row.adGroupName),
    safeCell(row.negativeText),
    safeCell(row.ruleIds.join("; ")),
    row.confidence ?? "",
    row.impressions,
    row.clicks,
    row.costMicros,
    row.conversions,
    row.conversionValue,
    safeCell(row.channel),
    safeCell(row.targetingStatus),
    safeCell(row.matchedKeyword),
    safeCell(row.matchedKeywordMatchType),
    safeCell(row.startDate),
    safeCell(row.endDate),
    safeCell(row.customerId),
    safeCell(row.campaignId),
    safeCell(row.adGroupId),
    safeCell(row.itemId),
    safeCell(row.runId),
    safeCell(row.provider),
    safeCell(row.model),
    safeCell(row.ruleVersion)
  ];
}

function compareRowsBySearchTerm(left: ClassifiedKeywordRow, right: ClassifiedKeywordRow): number {
  return left.searchTerm.localeCompare(right.searchTerm, "en-US", { sensitivity: "base", numeric: true })
    || left.campaignName.localeCompare(right.campaignName, "en-US", { sensitivity: "base", numeric: true })
    || left.campaignId.localeCompare(right.campaignId, "en-US", { numeric: true })
    || left.itemId.localeCompare(right.itemId, "en-US");
}

function safeCell(value: string | null): string {
  if (value === null) return "";
  return /^[\t\r ]*[=+\-@]/u.test(value) ? `'${value}` : value;
}

function columnWidth(index: number): number {
  const widths = [20, 28, 32, 18, 38, 32, 28, 30, 26, 12, 14, 12, 16, 14, 18, 18, 18, 28, 22, 13, 13, 16, 16, 16, 23, 30, 18, 22, 20];
  return widths[index] ?? 18;
}
