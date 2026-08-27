import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadRuleSet } from "../src/config/rule-set.js";
import { buildClassifierPrompt, createResponseSchema } from "../src/llm/prompt.js";
import { validateDecisions } from "../src/llm/validation.js";
import { createLogger } from "../src/observability/logger.js";
import { RunArtifacts } from "../src/storage/run-artifacts.js";
import { createLimiter } from "../src/util/concurrency.js";
import type { ClassificationCandidate, ClassificationDecision, Decision, Organization } from "../src/types.js";

const logger = createLogger();

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
  const config = await loadKimiConfig(workspace);
  const rules = await loadRuleSet(workspace);
  const csvPath = resolve(workspace, "handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv");
  const allRows = parseCsv(await readFile(csvPath, "utf8")) as LabeledRow[];
  const requestedIds = requestedExampleIds(process.argv.slice(2));
  const rows = requestedIds === null
    ? allRows
    : allRows.filter((row) => requestedIds.has(row.example_id));
  if (rows.length === 0) throw new Error("No labeled examples matched the requested IDs.");
  const artifacts = new RunArtifacts(workspace, `eval-${timestamp()}`);
  const date = "2026-08-27";
  const decisions: ClassificationDecision[] = [];
  const rawUsages: unknown[] = [];

  await artifacts.write("run-manifest.json", {
    status: "RUNNING",
    purpose: "Kimi regression evaluation over handoff labeled examples",
    sourcePath: "handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv",
    exampleCount: rows.length,
    model: config.model,
    ruleVersion: rules.version,
    promptVersion: rules.promptVersion,
    googleAdsMutationPerformed: false
  });
  await artifacts.writeText("rules.md", rules.markdown);

  const groups = groupRows(rows);
  const limit = createLimiter(2);
  await Promise.all(groups.map((group, groupIndex) => limit(async () => {
    const organization = evaluationOrganization(group.organizationName, groupIndex);
    const candidates = group.rows.map((row) => candidateFromRow(row, organization.customerId, date));
    const prompt = buildClassifierPrompt({
      account: {
        customerId: organization.customerId,
        descriptiveName: organization.descriptiveName,
        timeZone: organization.timeZone
      },
      date,
      rules,
      searchTerms: candidates
    });
    const request = {
      model: config.model,
      messages: [
        { role: "system", content: prompt.systemInstruction },
        { role: "user", content: prompt.userPrompt }
      ],
      reasoning_effort: "low",
      max_completion_tokens: 50_000,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "negative_keyword_decisions",
          strict: true,
          schema: createResponseSchema(candidates.map((candidate) => candidate.itemId), rules.ruleIds)
        }
      },
      prompt_cache_key: `negative-keyword-eval:${rules.version}:${groupIndex}`
    };
    await artifacts.write(`groups/group-${groupIndex + 1}-input.json`, { organization, rows: group.rows, request });
    const response = await callKimi(config, request);
    await artifacts.write(`groups/group-${groupIndex + 1}-output.json`, response);
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") throw new Error(`Evaluation group ${groupIndex + 1} returned no content.`);
    decisions.push(...validateDecisions(JSON.parse(content) as unknown, candidates, rules));
    rawUsages.push(response.usage ?? null);
  })));

  const report = createReport(rows, decisions, rules.version, config.model, rawUsages);
  await artifacts.write("report.json", report);
  await artifacts.write("run-manifest.json", {
    status: "SUCCEEDED",
    purpose: "Kimi regression evaluation over handoff labeled examples",
    exampleCount: rows.length,
    model: config.model,
    ruleVersion: rules.version,
    promptVersion: rules.promptVersion,
    metrics: report.metrics,
    googleAdsMutationPerformed: false
  });
  logger.info({ runDirectory: artifacts.runDirectory, metrics: report.metrics }, "Kimi evaluation completed");
}

function createReport(
  rows: LabeledRow[],
  decisions: ClassificationDecision[],
  ruleVersion: string,
  model: string,
  rawUsages: unknown[]
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
      expectedOperation: row.expected_operation,
      evidenceStatus: row.evidence_status,
      expectedRuleIds: row.rule_ids.split(";").filter(Boolean),
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
    metrics: {
      examples: comparisons.length,
      overallAgreement: ratio(comparisons.filter((item) => item.correct).length, comparisons.length),
      keepSideAccuracy: ratio(expectedKeep.filter((item) => item.correct).length, expectedKeep.length),
      negativeRecall: ratio(expectedNegative.filter((item) => item.correct).length, expectedNegative.length),
      negativePrecision: ratio(predictedNegative.filter((item) => item.expected === "NEGATIVE_EXACT").length, predictedNegative.length),
      falsePositiveCount: falsePositives.length,
      falseNegativeCount: falseNegatives.length
    },
    providerUsage: rawUsages,
    falsePositives,
    falseNegatives,
    comparisons
  };
}

function groupRows(rows: LabeledRow[]): Array<{ organizationName: string; rows: LabeledRow[] }> {
  const groups = new Map<string, LabeledRow[]>();
  for (const row of rows) {
    const organizationName = /^Account name\s+(.+)$/iu.exec(row.campaign_context)?.[1] ?? "Evaluation Collision Center";
    const group = groups.get(organizationName) ?? [];
    group.push(row);
    groups.set(organizationName, group);
  }
  return [...groups].flatMap(([organizationName, groupedRows]) => {
    const chunks: Array<{ organizationName: string; rows: LabeledRow[] }> = [];
    for (let index = 0; index < groupedRows.length; index += 30) {
      chunks.push({ organizationName, rows: groupedRows.slice(index, index + 30) });
    }
    return chunks;
  });
}

function candidateFromRow(row: LabeledRow, customerId: string, date: string): ClassificationCandidate {
  return {
    itemId: row.example_id,
    customerId,
    date,
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
  "EX-042", // custom body shop
  "EX-036", // informational price wording, latest undefined-category lock
  "EX-055", // cheap/affordable
  "EX-056", "EX-057", // estimate/quote
  "EX-058", "EX-070", // financing/payment
  "EX-067", "EX-095", // Spanish repair demand
  "EX-087", // affordable
  "EX-073", // explicit generic collision service intent
  "EX-097", // informational bumper question
  "EX-113" // custom body shop
]);

const OWNER_LOCKED_NEGATIVE = new Set([
  "EX-013", "EX-017", "EX-061", "EX-115", // cosmetic-only, zero collision signal
  "EX-116", // parts/component-only
  "EX-117", // Spanish DIY
  "EX-118", "EX-119", // named competitors
  "EX-030" // contextless named competitor; own-brand protection does not apply
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

interface KimiConfig { apiKey: string; baseUrl: string; model: string }

async function loadKimiConfig(workspace: string): Promise<KimiConfig> {
  const values = Object.fromEntries((await readFile(resolve(workspace, ".env"), "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
  const apiKey = process.env.KIMI_API_KEY || values.KIMI_API_KEY;
  if (!apiKey) throw new Error("KIMI_API_KEY is missing.");
  return {
    apiKey,
    baseUrl: process.env.KIMI_BASE_URL || values.KIMI_BASE_URL || "https://api.kimi.com/coding/v1",
    model: process.env.KIMI_MODEL || values.KIMI_MODEL || "kimi-for-coding"
  };
}

async function callKimi(config: KimiConfig, request: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/u, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(300_000)
  });
  const payload = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(`Kimi evaluation failed with HTTP ${response.status}.`);
  return payload;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/gu, "");
}

function requestedExampleIds(argumentsList: string[]): Set<string> | null {
  const index = argumentsList.indexOf("--ids");
  if (index < 0) return null;
  const value = argumentsList[index + 1];
  if (!value) throw new Error("--ids requires a comma-separated list of example IDs.");
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Kimi evaluation failed");
  process.exitCode = 1;
});
