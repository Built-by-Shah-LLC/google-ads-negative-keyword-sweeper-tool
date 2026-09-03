import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadRuleSet } from "../src/config/rule-set.js";
import { OpenAIKeywordClassifier } from "../src/llm/openai-classifier.js";
import { createLogger } from "../src/observability/logger.js";
import { addTokenUsage, emptyTokenUsage } from "../src/observability/run-telemetry.js";
import { RunArtifacts } from "../src/storage/run-artifacts.js";
import { createLimiter } from "../src/util/concurrency.js";
import type {
  ClassificationCandidate,
  ClassificationDecision,
  Decision,
  LlmTokenUsage,
  Organization
} from "../src/types.js";

const logger = createLogger();
const DEFAULT_MODELS = ["gpt-5-nano", "gpt-5.4-nano", "gpt-5.6-luna", "gpt-5.4-mini"];
const PRICING_PER_MILLION: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-4.1-nano": { input: 0.10, cached: 0.025, output: 0.40 },
  "gpt-4o-mini": { input: 0.15, cached: 0.075, output: 0.60 },
  "gpt-5-nano": { input: 0.05, cached: 0.005, output: 0.40 },
  "gpt-5.4-nano": { input: 0.20, cached: 0.02, output: 1.25 },
  "gpt-5.6-luna": { input: 0.20, cached: 0.02, output: 1.20 },
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.50 }
};

interface LabeledRow extends Record<string, string> {
  example_id: string;
  search_term: string;
  campaign_context: string;
  ad_group_context: string;
  matched_keyword: string;
  expected_operation: string;
  rule_ids: string;
  evidence_status: string;
}

async function main(): Promise<void> {
  const workspace = process.cwd();
  const apiKey = await loadOpenAIKey(workspace);
  const models = requestedModels(process.argv.slice(2));
  const rules = await loadRuleSet(workspace);
  const csvPath = resolve(workspace, "handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv");
  const allRows = parseCsv(await readFile(csvPath, "utf8")) as LabeledRow[];
  const requestedIds = requestedExampleIds(process.argv.slice(2));
  const batchSize = requestedBatchSize(process.argv.slice(2));
  const rows = requestedIds === null ? allRows : allRows.filter((row) => requestedIds.has(row.example_id));
  if (rows.length === 0) throw new Error("No labeled examples matched the requested IDs.");

  const artifacts = new RunArtifacts(workspace, `eval-openai-${timestamp()}`);
  const dateRange = { startDate: "2026-08-26", endDate: "2026-08-27" };
  const groups = groupRows(rows, batchSize);
  const modelReports: Record<string, unknown>[] = [];
  await artifacts.write("run-manifest.json", {
    status: "RUNNING",
    purpose: "OpenAI model comparison over handoff labeled examples",
    sourcePath: "handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv",
    exampleCount: rows.length,
    batchSize,
    models,
    ruleVersion: rules.version,
    promptVersion: rules.promptVersion,
    pricingSnapshotDate: "2026-08-31",
    googleAdsMutationPerformed: false
  });

  for (const model of models) {
    const classifier = new OpenAIKeywordClassifier({
      provider: "openai",
      apiKey,
      model,
      baseUrl: "https://api.openai.com/v1",
      thinking: "disabled",
      batchSize,
      concurrency: 2,
      requestTimeoutMs: 600_000,
      maxRetries: 4
    });
    const decisions: ClassificationDecision[] = [];
    let usage = emptyTokenUsage();
    const limit = createLimiter(2);
    await Promise.all(groups.map((group, groupIndex) => limit(async () => {
      const organization = evaluationOrganization(group.organizationName, groupIndex);
      const candidates = group.rows.map((row) => candidateFromRow(row, organization.customerId, dateRange));
      const result = await classifier.classify({
        account: {
          customerId: organization.customerId,
          descriptiveName: organization.descriptiveName,
          timeZone: organization.timeZone
        },
        dateRange,
        rules,
        searchTerms: candidates
      });
      decisions.push(...result.validated.decisions);
      usage = addTokenUsage(usage, result.validated.usage);
      await artifacts.write(`${safePath(model)}/group-${String(groupIndex + 1).padStart(4, "0")}.json`, {
        organization: organization.descriptiveName,
        candidateCount: candidates.length,
        usage: result.validated.usage,
        decisions: result.validated.decisions
      });
    })));
    const report = createReport(rows, decisions, rules.version, model, usage);
    modelReports.push(report);
    await artifacts.write(`${safePath(model)}/report.json`, report);
    logger.info({ model, metrics: report.metrics, estimatedCostUsd: report.estimatedCostUsd }, "OpenAI model evaluation completed");
  }

  await artifacts.write("comparison.json", { models: modelReports });
  await artifacts.write("run-manifest.json", {
    status: "SUCCEEDED",
    purpose: "OpenAI model comparison over handoff labeled examples",
    exampleCount: rows.length,
    batchSize,
    models,
    ruleVersion: rules.version,
    promptVersion: rules.promptVersion,
    pricingSnapshotDate: "2026-08-31",
    googleAdsMutationPerformed: false
  });
  logger.info({ runDirectory: artifacts.runDirectory }, "OpenAI comparison completed");
}

function createReport(
  rows: LabeledRow[],
  decisions: ClassificationDecision[],
  ruleVersion: string,
  model: string,
  usage: LlmTokenUsage
): Record<string, any> {
  const decisionsById = new Map(decisions.map((decision) => [decision.itemId, decision]));
  const comparisons = rows.map((row) => {
    const expected = expectedDecision(row);
    const actualDecision = decisionsById.get(row.example_id);
    if (!actualDecision) throw new Error(`Missing evaluation decision for ${row.example_id}.`);
    return {
      exampleId: row.example_id,
      searchTerm: row.search_term,
      expected,
      actual: actualDecision.decision,
      correct: expected === actualDecision.decision,
      actualDecision
    };
  });
  const expectedKeep = comparisons.filter((item) => item.expected === "KEEP");
  const expectedNegative = comparisons.filter((item) => item.expected === "NEGATIVE_EXACT");
  const predictedNegative = comparisons.filter((item) => item.actual === "NEGATIVE_EXACT");
  const falsePositives = comparisons.filter((item) => item.expected === "KEEP" && item.actual === "NEGATIVE_EXACT");
  const falseNegatives = comparisons.filter((item) => item.expected === "NEGATIVE_EXACT" && item.actual === "KEEP");
  return {
    generatedAt: new Date().toISOString(),
    ruleVersion,
    model,
    usage,
    estimatedCostUsd: estimatedCost(model, usage),
    metrics: {
      examples: comparisons.length,
      overallAgreement: ratio(comparisons.filter((item) => item.correct).length, comparisons.length),
      keepSideAccuracy: ratio(expectedKeep.filter((item) => item.correct).length, expectedKeep.length),
      negativeRecall: ratio(expectedNegative.filter((item) => item.correct).length, expectedNegative.length),
      negativePrecision: ratio(predictedNegative.filter((item) => item.expected === "NEGATIVE_EXACT").length, predictedNegative.length),
      falsePositiveCount: falsePositives.length,
      falseNegativeCount: falseNegatives.length
    },
    falsePositives,
    falseNegatives,
    comparisons
  };
}

function estimatedCost(model: string, usage: LlmTokenUsage): number | null {
  const pricing = PRICING_PER_MILLION[model];
  if (!pricing) return null;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const cost = (uncached * pricing.input + usage.cachedInputTokens * pricing.cached + usage.outputTokens * pricing.output) / 1_000_000;
  return Math.round(cost * 100_000_000) / 100_000_000;
}

function groupRows(rows: LabeledRow[], batchSize: number): Array<{ organizationName: string; rows: LabeledRow[] }> {
  const groups = new Map<string, LabeledRow[]>();
  for (const row of rows) {
    const organizationName = /^Account name\s+(.+)$/iu.exec(row.campaign_context)?.[1] ?? "Evaluation Collision Center";
    const group = groups.get(organizationName) ?? [];
    group.push(row);
    groups.set(organizationName, group);
  }
  return [...groups].flatMap(([organizationName, groupedRows]) => {
    const chunks: Array<{ organizationName: string; rows: LabeledRow[] }> = [];
    for (let index = 0; index < groupedRows.length; index += batchSize) {
      chunks.push({ organizationName, rows: groupedRows.slice(index, index + batchSize) });
    }
    return chunks;
  });
}

function candidateFromRow(
  row: LabeledRow,
  customerId: string,
  dateRange: { startDate: string; endDate: string }
): ClassificationCandidate {
  return {
    itemId: row.example_id,
    customerId,
    ...dateRange,
    channel: "SEARCH",
    campaignId: `eval-${row.example_id}`,
    campaignName: row.campaign_context || "Evaluation campaign",
    adGroupId: null,
    adGroupName: row.ad_group_context || null,
    searchTerm: row.search_term,
    targetingStatus: null,
    matchedKeyword: row.matched_keyword || null,
    matchedKeywordMatchType: null,
    impressions: 1,
    clicks: 0,
    costMicros: 0,
    conversions: 0,
    conversionValue: 0
  };
}

function evaluationOrganization(name: string, index: number): Organization {
  return {
    customerId: `99999999${String(index).padStart(2, "0")}`,
    descriptiveName: name,
    timeZone: "America/New_York",
    currencyCode: "USD"
  };
}

const OWNER_LOCKED_KEEP = new Set([
  "EX-042", "EX-036", "EX-055", "EX-056", "EX-057", "EX-058", "EX-070", "EX-067",
  "EX-095", "EX-087", "EX-073", "EX-097", "EX-113"
]);
const OWNER_LOCKED_NEGATIVE = new Set([
  "EX-013", "EX-017", "EX-026", "EX-061", "EX-115", "EX-116", "EX-117", "EX-118", "EX-119", "EX-030"
]);

function expectedDecision(row: LabeledRow): Decision {
  if (OWNER_LOCKED_KEEP.has(row.example_id)) return "KEEP";
  if (OWNER_LOCKED_NEGATIVE.has(row.example_id)) return "NEGATIVE_EXACT";
  return row.expected_operation === "AUTO_NEGATIVE_ALLOWED" ? "NEGATIVE_EXACT" : "KEEP";
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 10_000;
}

function parseCsv(source: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const text = source.replace(/^\uFEFF/u, "");
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  const headers = rows.shift() ?? [];
  return rows.filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
  );
}

async function loadOpenAIKey(workspace: string): Promise<string> {
  const sources = await Promise.all([".env", ".env.openai"].map(async (name) => {
    try {
      return await readFile(resolve(workspace, name), "utf8");
    } catch {
      return "";
    }
  }));
  const values = Object.fromEntries(sources.join("\n").split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
  const apiKey = process.env.OPENAI_API_KEY || values.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing.");
  return apiKey;
}

function requestedModels(argumentsList: string[]): string[] {
  const index = argumentsList.indexOf("--models");
  if (index < 0) return DEFAULT_MODELS;
  const value = argumentsList[index + 1];
  if (!value) throw new Error("--models requires a comma-separated list.");
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function requestedExampleIds(argumentsList: string[]): Set<string> | null {
  const index = argumentsList.indexOf("--ids");
  if (index < 0) return null;
  const value = argumentsList[index + 1];
  if (!value) throw new Error("--ids requires a comma-separated list of example IDs.");
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
}

function requestedBatchSize(argumentsList: string[]): number {
  const index = argumentsList.indexOf("--batch-size");
  if (index < 0) return 50;
  const value = Number(argumentsList[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) {
    throw new Error("--batch-size must be an integer from 1 through 50.");
  }
  return value;
}

function safePath(value: string): string {
  return value.replace(/[^a-z0-9._-]+/giu, "-");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/gu, "");
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "OpenAI evaluation failed");
  process.exitCode = 1;
});
