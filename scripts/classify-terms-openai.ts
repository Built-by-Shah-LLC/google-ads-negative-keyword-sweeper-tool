import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config/env.js";
import { loadRuleSet } from "../src/config/rule-set.js";
import { OpenAIKeywordClassifier } from "../src/llm/openai-classifier.js";
import { createLogger } from "../src/observability/logger.js";
import { addTokenUsage, emptyTokenUsage } from "../src/observability/run-telemetry.js";
import { RunArtifacts } from "../src/storage/run-artifacts.js";
import { chunksOf } from "../src/util/concurrency.js";
import type { ClassificationCandidate, ClassificationDecision, LlmTokenUsage } from "../src/types.js";

// Sandbox classifier: classify a hand-provided list of search terms with OpenAI
// (default gpt-5.6-luna, reasoning effort low, via the production OpenAIKeywordClassifier
// and its Responses API request shape). No Google Ads API calls. Mirrors
// classify-terms-kimi.ts for provider comparisons.
//
//   npx tsx scripts/classify-terms-openai.ts --input test-terms.txt
//
// Outputs land in runs/sandbox-openai-<timestamp>/: decisions.csv, summary.md, raw llm JSON.

const DEFAULT_ACCOUNT_NAME = "P&C AUTOMOTIVE";
const DATE_RANGE = { startDate: "2026-08-02", endDate: "2026-08-31" };

const logger = createLogger();

interface TermRow {
  searchTerm: string;
  campaignName: string;
  adGroupName: string | null;
  matchedKeyword: string | null;
  matchedKeywordMatchType: string | null;
}

async function main(): Promise<void> {
  const workspace = process.cwd();
  const args = process.argv.slice(2);
  const inputPath = optionValue(args, "--input") ?? "test-terms.txt";
  const accountName = optionValue(args, "--account-name") ?? DEFAULT_ACCOUNT_NAME;

  const config = await loadConfig(workspace);
  const rules = await loadRuleSet(workspace);
  const classifier = new OpenAIKeywordClassifier(config.llm);
  const rows = await readTerms(resolve(workspace, inputPath));
  if (rows.length === 0) throw new Error(`No search terms found in ${inputPath}.`);

  const candidates: ClassificationCandidate[] = rows.map((row, index) => ({
    itemId: `T-${String(index + 1).padStart(3, "0")}`,
    customerId: "3825219066",
    startDate: DATE_RANGE.startDate,
    endDate: DATE_RANGE.endDate,
    channel: "SEARCH",
    campaignId: "sandbox",
    campaignName: row.campaignName,
    adGroupId: null,
    adGroupName: row.adGroupName,
    searchTerm: row.searchTerm,
    targetingStatus: null,
    matchedKeyword: row.matchedKeyword,
    matchedKeywordMatchType: row.matchedKeywordMatchType,
    impressions: 1,
    clicks: 0,
    costMicros: 0,
    conversions: 0,
    conversionValue: 0
  }));

  const artifacts = new RunArtifacts(workspace, `sandbox-openai-${timestamp()}`);
  const startedAt = new Date().toISOString();
  const decisions: ClassificationDecision[] = [];
  let usage = emptyTokenUsage();
  let generationRequests = 0;
  const batches = chunksOf(candidates, config.llm.batchSize);

  for (const [index, batch] of batches.entries()) {
    const batchId = String(index + 1).padStart(4, "0");
    const context = {
      account: { customerId: "3825219066", descriptiveName: accountName, timeZone: "America/Chicago" },
      dateRange: DATE_RANGE,
      rules,
      searchTerms: batch
    };
    await artifacts.write(`llm/batch-${batchId}-input.json`, {
      provider: classifier.provider,
      model: classifier.model,
      ruleVersion: rules.version,
      promptVersion: rules.promptVersion,
      ...context
    });
    try {
      const result = await classifier.classify(context);
      generationRequests += result.attempts.length;
      usage = addTokenUsage(usage, result.validated.usage);
      decisions.push(...result.validated.decisions);
      await artifacts.write(`llm/batch-${batchId}-output.json`, {
        status: "VALIDATED",
        provider: classifier.provider,
        model: classifier.model,
        providerRequestId: result.validated.providerRequestId,
        tokenUsage: result.validated.usage,
        attempts: result.attempts.length,
        decisions: result.validated.decisions
      });
    } catch (error) {
      await artifacts.write(`llm/batch-${batchId}-error.json`, {
        status: "FAILED",
        failedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  const completedAt = new Date().toISOString();
  const decisionCounts = {
    KEEP: decisions.filter((item) => item.decision === "KEEP").length,
    NEGATIVE_EXACT: decisions.filter((item) => item.decision === "NEGATIVE_EXACT").length
  };

  await artifacts.writeText("decisions.csv", decisionsCsv(candidates, decisions));
  await artifacts.writeText("summary.md", summaryMd({
    accountName,
    inputPath,
    startedAt,
    completedAt,
    model: classifier.model,
    ruleVersion: rules.version,
    promptVersion: rules.promptVersion,
    termCount: rows.length,
    decisionCounts,
    generationRequests,
    usage,
    candidates,
    decisions
  }));
  await artifacts.write("run-manifest.json", {
    purpose: "Sandbox classification of a hand-provided term list (no Google Ads calls)",
    inputPath,
    accountName,
    startedAt,
    completedAt,
    provider: classifier.provider,
    model: classifier.model,
    exactModelString: classifier.model,
    reasoningEffort: "low",
    ruleVersion: rules.version,
    promptVersion: rules.promptVersion,
    terms: rows.length,
    decisions: decisionCounts,
    generationRequests,
    tokenUsage: { ...usage, generationRequests },
    readOnly: true
  });

  logger.info({
    runDirectory: artifacts.runDirectory,
    terms: rows.length,
    decisionCounts,
    generationRequests,
    tokenUsage: usage
  }, "Sandbox OpenAI classification completed");
}

function decisionsCsv(candidates: ClassificationCandidate[], decisions: ClassificationDecision[]): string {
  const byId = new Map(decisions.map((decision) => [decision.itemId, decision]));
  const escape = (value: string | null) => {
    const text = value ?? "";
    return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = ["item_id,search_term,decision,negative_text,rule_ids,confidence,reason"];
  for (const candidate of candidates) {
    const decision = byId.get(candidate.itemId);
    lines.push([
      candidate.itemId,
      escape(candidate.searchTerm),
      decision?.decision ?? "MISSING",
      escape(decision?.negativeText ?? null),
      escape(decision ? decision.ruleIds.join(";") : ""),
      decision ? String(decision.confidence) : "",
      escape(decision?.reason ?? "")
    ].join(","));
  }
  return lines.join("\n") + "\n";
}

function summaryMd(options: {
  accountName: string;
  inputPath: string;
  startedAt: string;
  completedAt: string;
  model: string;
  ruleVersion: string;
  promptVersion: string;
  termCount: number;
  decisionCounts: { KEEP: number; NEGATIVE_EXACT: number };
  generationRequests: number;
  usage: LlmTokenUsage;
  candidates: ClassificationCandidate[];
  decisions: ClassificationDecision[];
}): string {
  const byId = new Map(options.decisions.map((decision) => [decision.itemId, decision]));
  const durationS = Math.round((new Date(options.completedAt).getTime() - new Date(options.startedAt).getTime()) / 100) / 10;
  const lines = [
    "# Sandbox OpenAI classification — ad-hoc term list",
    "",
    `- **Model (exact string):** \`${options.model}\` via OpenAI Responses API (pay-per-token)`,
    `- **Reasoning effort:** low`,
    `- **Rule set:** \`${options.ruleVersion}\` · **Prompt:** \`${options.promptVersion}\``,
    `- **Account context:** ${options.accountName} · **Input:** \`${options.inputPath}\` (${options.termCount} terms)`,
    `- **Started:** ${options.startedAt} · **Duration:** ${durationS}s · **Generation requests:** ${options.generationRequests}`,
    "",
    "## Token usage (measured)",
    "",
    "| Metric | Tokens |",
    "|---|---:|",
    `| Input | ${options.usage.inputTokens.toLocaleString()} |`,
    `| — cached input | ${options.usage.cachedInputTokens.toLocaleString()} |`,
    `| Output | ${options.usage.outputTokens.toLocaleString()} |`,
    `| — reasoning | ${options.usage.thoughtTokens.toLocaleString()} |`,
    `| Total | ${options.usage.totalTokens.toLocaleString()} |`,
    "",
    "## Decisions",
    "",
    `- **KEEP:** ${options.decisionCounts.KEEP} · **NEGATIVE_EXACT:** ${options.decisionCounts.NEGATIVE_EXACT}`,
    "",
    "| Term | Decision | Rules | Confidence | Reason |",
    "|---|---|---|---:|---|"
  ];
  for (const candidate of options.candidates) {
    const decision = byId.get(candidate.itemId);
    lines.push(`| ${candidate.searchTerm.replaceAll("|", "\\|")} | ${decision?.decision ?? "MISSING"} | ${decision ? decision.ruleIds.join(", ") : ""} | ${decision ? decision.confidence.toFixed(2) : ""} | ${(decision?.reason ?? "").replaceAll("|", "\\|")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

async function readTerms(absolutePath: string): Promise<TermRow[]> {
  const source = await readFile(absolutePath, "utf8");
  if (absolutePath.endsWith(".csv")) {
    const rows = parseCsv(source);
    const header = rows.shift() ?? [];
    const indexOf = (name: string) => header.findIndex((item) => item.trim().toLowerCase() === name);
    const termIndex = indexOf("search_term");
    if (termIndex < 0) throw new Error("CSV input must have a search_term column.");
    const campaignIndex = indexOf("campaign_name");
    const adGroupIndex = indexOf("ad_group_name");
    const keywordIndex = indexOf("matched_keyword");
    const matchTypeIndex = indexOf("match_type");
    return rows.filter((values) => values[termIndex]?.trim()).map((values) => ({
      searchTerm: values[termIndex]!.trim(),
      campaignName: campaignIndex >= 0 ? values[campaignIndex]!.trim() || "Sandbox campaign" : "Sandbox campaign",
      adGroupName: adGroupIndex >= 0 ? values[adGroupIndex]!.trim() || null : null,
      matchedKeyword: keywordIndex >= 0 ? values[keywordIndex]!.trim() || null : null,
      matchedKeywordMatchType: matchTypeIndex >= 0 ? values[matchTypeIndex]!.trim() || null : null
    }));
  }
  return source.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((term) => ({
      searchTerm: term,
      campaignName: "Sandbox campaign",
      adGroupName: null,
      matchedKeyword: null,
      matchedKeywordMatchType: null
    }));
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const text = source.replace(/^﻿/u, "");
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
  return rows;
}

function optionValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/gu, "");
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Sandbox OpenAI classification failed");
  process.exitCode = 1;
});
