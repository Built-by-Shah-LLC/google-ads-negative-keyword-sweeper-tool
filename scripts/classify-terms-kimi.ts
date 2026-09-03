import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadRuleSet } from "../src/config/rule-set.js";
import { buildClassifierPrompt, createResponseSchema } from "../src/llm/prompt.js";
import { parseClassifierPayload } from "../src/llm/parse-classifier-payload.js";
import { validateDecisions } from "../src/llm/validation.js";
import { createLogger } from "../src/observability/logger.js";
import { addTokenUsage, emptyTokenUsage } from "../src/observability/run-telemetry.js";
import { RunArtifacts } from "../src/storage/run-artifacts.js";
import { chunksOf } from "../src/util/concurrency.js";
import type { ClassificationCandidate, ClassificationDecision, LlmTokenUsage } from "../src/types.js";

// Sandbox classifier: classify a hand-provided list of search terms with Moonshot Kimi.
// No Google Ads API calls. Input: a .txt (one term per line) or .csv with a
// search_term column (optional campaign_name, ad_group_name, matched_keyword, match_type).
//
//   npx tsx scripts/classify-terms-kimi.ts --input my-terms.txt
//   npx tsx scripts/classify-terms-kimi.ts --input my-terms.csv --account-name "P&C AUTOMOTIVE"
//
// Defaults: kimi-k2.6 on https://api.moonshot.ai/v1 with thinking enabled.
// Outputs land in runs/sandbox-kimi-<timestamp>/: decisions.csv, summary.md, raw llm JSON.

const KIMI_CODING_BASE_URL = "https://api.kimi.com/coding/v1";
const MOONSHOT_PLATFORM_BASE_URL = "https://api.moonshot.ai/v1";
const MOONSHOT_DEFAULT_MODEL = "kimi-k2.6";
const BATCH_SIZE = 25;

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
  const accountName = optionValue(args, "--account-name") ?? "P&C AUTOMOTIVE";

  const kimi = await loadKimiEnv(workspace);
  const rules = await loadRuleSet(workspace);
  const rows = await readTerms(resolve(workspace, inputPath));
  if (rows.length === 0) throw new Error(`No search terms found in ${inputPath}.`);

  const dateRange = { startDate: "2026-08-02", endDate: "2026-08-31" };
  const candidates: ClassificationCandidate[] = rows.map((row, index) => ({
    itemId: `T-${String(index + 1).padStart(3, "0")}`,
    customerId: "3825219066",
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
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

  const artifacts = new RunArtifacts(workspace, `sandbox-kimi-${timestamp()}`);
  const startedAt = new Date().toISOString();
  const decisions: ClassificationDecision[] = [];
  let usage = emptyTokenUsage();
  const batches = chunksOf(candidates, BATCH_SIZE);

  for (const [index, batch] of batches.entries()) {
    const batchId = String(index + 1).padStart(4, "0");
    const context = {
      account: { customerId: "3825219066", descriptiveName: accountName, timeZone: "America/Chicago" },
      dateRange,
      rules,
      searchTerms: batch
    };
    const prompt = buildClassifierPrompt(context);
    const request = createKimiRequest(kimi, prompt, batch, rules);
    await artifacts.write(`llm/batch-${batchId}-input.json`, { provider: kimi.provider, model: kimi.model, thinking: kimi.thinking, ...context });

    let lastError: Error | null = null;
    let succeeded = false;
    for (let validationAttempt = 1; validationAttempt <= 2 && !succeeded; validationAttempt += 1) {
      const call = await callKimi(kimi.baseUrl, kimi.apiKey, request);
      usage = addTokenUsage(usage, call.usage);
      await artifacts.write(`llm/batch-${batchId}-output-attempt-${validationAttempt}.json`, {
        requestId: call.requestId,
        usage: call.usage,
        rawResponse: call.payload
      });
      try {
        const parsed = parseClassifierPayload(extractKimiResponseText(call.payload));
        decisions.push(...validateDecisions(parsed, batch, rules));
        succeeded = true;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn({ batchId, validationAttempt, error: lastError.message }, "Kimi batch failed validation, retrying once");
      }
    }
    if (!succeeded) {
      throw new Error(`Batch ${batchId} failed validation twice: ${lastError?.message ?? "unknown error"}`);
    }
  }

  const completedAt = new Date().toISOString();
  const decisionCounts = {
    KEEP: decisions.filter((item) => item.decision === "KEEP").length,
    NEGATIVE_EXACT: decisions.filter((item) => item.decision === "NEGATIVE_EXACT").length
  };

  await artifacts.writeText("decisions.csv", decisionsCsv(rows, candidates, decisions));
  await artifacts.writeText("summary.md", summaryMd({
    accountName,
    inputPath,
    startedAt,
    completedAt,
    model: kimi.model,
    baseUrl: kimi.baseUrl,
    ruleVersion: rules.version,
    termCount: rows.length,
    decisionCounts,
    usage,
    rows,
    candidates,
    decisions
  }));
  await artifacts.write("run-manifest.json", {
    purpose: "Sandbox classification of a hand-provided term list (no Google Ads calls)",
    inputPath,
    accountName,
    startedAt,
    completedAt,
    provider: kimi.provider,
    model: kimi.model,
    exactModelString: kimi.model,
    thinking: kimi.thinking,
    reasoningEffort: kimi.thinking ? null : "low",
    ruleVersion: rules.version,
    terms: rows.length,
    decisions: decisionCounts,
    tokenUsage: usage,
    readOnly: true
  });

  logger.info({
    runDirectory: artifacts.runDirectory,
    terms: rows.length,
    decisionCounts,
    tokenUsage: usage
  }, "Sandbox Kimi classification completed");
}

function decisionsCsv(rows: TermRow[], candidates: ClassificationCandidate[], decisions: ClassificationDecision[]): string {
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
  void rows;
  return lines.join("\n") + "\n";
}

function summaryMd(options: {
  accountName: string;
  inputPath: string;
  startedAt: string;
  completedAt: string;
  model: string;
  baseUrl: string;
  ruleVersion: string;
  termCount: number;
  decisionCounts: { KEEP: number; NEGATIVE_EXACT: number };
  usage: LlmTokenUsage;
  rows: TermRow[];
  candidates: ClassificationCandidate[];
  decisions: ClassificationDecision[];
}): string {
  const byId = new Map(options.decisions.map((decision) => [decision.itemId, decision]));
  const durationS = Math.round((new Date(options.completedAt).getTime() - new Date(options.startedAt).getTime()) / 100) / 10;
  const lines = [
    "# Sandbox Kimi classification — ad-hoc term list",
    "",
    `- **Model (exact string):** \`${options.model}\` via \`${options.baseUrl}\``,
    `- **Thinking:** enabled (kimi-k2.6 binary thinking)`,
    `- **Rule set:** \`${options.ruleVersion}\``,
    `- **Account context:** ${options.accountName} · **Input:** \`${options.inputPath}\` (${options.termCount} terms)`,
    `- **Started:** ${options.startedAt} · **Duration:** ${durationS}s`,
    "",
    "## Token usage (measured)",
    "",
    "| Metric | Tokens |",
    "|---|---:|",
    `| Input (prompt) | ${options.usage.inputTokens.toLocaleString()} |`,
    `| — cached input | ${options.usage.cachedInputTokens.toLocaleString()} |`,
    `| Output (completion) | ${options.usage.outputTokens.toLocaleString()} |`,
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

function createKimiRequest(
  kimi: KimiEnv,
  prompt: { systemInstruction: string; userPrompt: string },
  batch: { itemId: string }[],
  rules: { version: string; ruleIds: string[] }
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    model: kimi.model,
    messages: [
      { role: "system", content: prompt.systemInstruction },
      { role: "user", content: prompt.userPrompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "negative_keyword_decisions",
        strict: true,
        schema: createResponseSchema(batch.map((term) => term.itemId), rules.ruleIds)
      }
    },
    prompt_cache_key: `negative-keyword-sweeper:${rules.version}`
  };
  if (kimi.thinking) {
    request.thinking = { type: "enabled" };
    request.max_tokens = 32_768;
  } else {
    request.reasoning_effort = "low";
    request.max_completion_tokens = 50_000;
  }
  return request;
}

async function callKimi(baseUrl: string, apiKey: string, request: Record<string, unknown>): Promise<{
  payload: Record<string, any>;
  requestId: string | null;
  usage: LlmTokenUsage;
}> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= 4; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "user-agent": "google-ads-negative-keyword-sweeper-tool/0.1.0"
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(300_000)
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await wait(1000 * 2 ** attempt);
      continue;
    }
    const requestId = response.headers.get("x-request-id");
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch { /* handled below */ }
    if (!response.ok) {
      const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
      lastError = new Error(`HTTP ${response.status}: ${typeof error.type === "string" ? error.type : "UNKNOWN"}: ${typeof error.message === "string" ? error.message : "No message returned"}`);
      if (new Set([429, 500, 502, 503, 504]).has(response.status) && attempt < 4) {
        await wait(1000 * 2 ** attempt);
        continue;
      }
      throw lastError;
    }
    if (!isRecord(payload)) throw new Error("Kimi response body was not an object.");
    return { payload, requestId, usage: normalizeKimiUsage(payload.usage) };
  }
  throw lastError ?? new Error("Kimi retry loop ended unexpectedly.");
}

function extractKimiResponseText(payload: Record<string, any>): string {
  const choice = payload.choices?.[0];
  if (!isRecord(choice)) throw new Error("Kimi response had no choice.");
  const message = choice.message;
  if (!isRecord(message) || typeof message.content !== "string" || message.content.trim() === "") {
    throw new Error(`Kimi returned no final response content (${String(choice.finish_reason || "no content")}).`);
  }
  return message.content;
}

function normalizeKimiUsage(value: unknown): LlmTokenUsage {
  const usage = isRecord(value) ? value : {};
  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const completionDetails = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
  const inputTokens = tokenNumber(usage.prompt_tokens);
  const outputTokens = tokenNumber(usage.completion_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: tokenNumber(usage.total_tokens) || inputTokens + outputTokens,
    cachedInputTokens: tokenNumber(promptDetails.cached_tokens),
    thoughtTokens: tokenNumber(completionDetails.reasoning_tokens)
  };
}

interface KimiEnv {
  provider: "moonshot-kimi" | "kimi-code";
  apiKey: string;
  baseUrl: string;
  model: string;
  thinking: boolean;
}

async function loadKimiEnv(workspace: string): Promise<KimiEnv> {
  let fileValues: Record<string, string> = {};
  try {
    const source = await readFile(resolve(workspace, ".env"), "utf8");
    fileValues = Object.fromEntries(source.split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
  } catch { /* .env optional */ }
  const moonshotKey = process.env.MOONSHOT_API_KEY || fileValues.MOONSHOT_API_KEY;
  const codingKey = process.env.KIMI_API_KEY || fileValues.KIMI_API_KEY;
  const model = process.env.MOONSHOT_MODEL
    || fileValues.MOONSHOT_MODEL
    || process.env.KIMI_MODEL
    || fileValues.KIMI_MODEL
    || MOONSHOT_DEFAULT_MODEL;
  const isPlatform = model.startsWith("kimi-k2.") || model.startsWith("kimi-k3");
  const apiKey = isPlatform ? (moonshotKey || codingKey) : (codingKey || moonshotKey);
  if (!apiKey) {
    throw new Error("MOONSHOT_API_KEY is missing (set it in .env or the environment).");
  }
  const defaultBase = isPlatform ? MOONSHOT_PLATFORM_BASE_URL : KIMI_CODING_BASE_URL;
  const thinkingRaw = (process.env.MOONSHOT_THINKING || fileValues.MOONSHOT_THINKING || "enabled").toLowerCase();
  return {
    provider: isPlatform ? "moonshot-kimi" : "kimi-code",
    apiKey,
    baseUrl: (process.env.MOONSHOT_BASE_URL
      || fileValues.MOONSHOT_BASE_URL
      || process.env.KIMI_BASE_URL
      || fileValues.KIMI_BASE_URL
      || defaultBase).replace(/\/$/u, ""),
    model,
    thinking: isPlatform && thinkingRaw !== "disabled" && thinkingRaw !== "off" && thinkingRaw !== "false"
  };
}

function optionValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tokenNumber(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/gu, "");
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Sandbox Kimi classification failed");
  process.exitCode = 1;
});
