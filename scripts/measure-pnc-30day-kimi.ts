import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadRuleSet } from "../src/config/rule-set.js";
import { ClassificationFailure, type LlmGenerationAttempt, type LlmHttpAttempt } from "../src/llm/classifier.js";
import { buildClassifierPrompt, createResponseSchema } from "../src/llm/prompt.js";
import { parseClassifierPayload } from "../src/llm/parse-classifier-payload.js";
import { validateDecisions } from "../src/llm/validation.js";
import { createLogger } from "../src/observability/logger.js";
import { RunTelemetry, addTokenUsage, emptyTokenUsage } from "../src/observability/run-telemetry.js";
import { serializeError } from "../src/observability/errors.js";
import {
  createOrganizationTokenUsageReport,
  type BatchTokenUsage,
  type OrganizationSummary
} from "../src/pipeline/process-organization.js";
import { createRunTokenUsageReport } from "../src/pipeline/run-sweeper.js";
import { createDecisionCsv } from "../src/storage/decision-csv.js";
import { RunArtifacts } from "../src/storage/run-artifacts.js";
import { chunksOf, createLimiter } from "../src/util/concurrency.js";
import type {
  ClassificationCandidate,
  ClassificationDecision,
  DateRange,
  LlmTokenUsage,
  Organization,
  RuleSet
} from "../src/types.js";

// Provider-agnostic 30-day measurement, Kimi side.
// Exact model used by all previous production runs: "kimi-for-coding"
// (Kimi for Coding **subscription** endpoint, OpenAI-compatible chat/completions —
// this is NOT a pay-per-token model name like "k2.6"; the coding plan serves the
// alias "kimi-for-coding").
const KIMI_DEFAULT_BASE_URL = "https://api.kimi.com/coding/v1";
const KIMI_PLATFORM_BASE_URL = "https://api.moonshot.ai/v1";
const KIMI_DEFAULT_MODEL = "kimi-for-coding"; // exact subscription alias used by past production runs
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 600_000;
const DEFAULT_RANGE: DateRange = { startDate: "2026-08-02", endDate: "2026-08-31" };
// Same candidate set as the OpenAI run -> byte-identical prompts, true apples-to-apples.
const DEFAULT_CANDIDATES_SOURCE = "runs/measure-pnc-30day-openai-20260831T201535531Z/organizations/3825219066/candidates.json";
// OpenAI API-counted fixed input for the identical prompt prefix (Kimi has no count endpoint).
const FIXED_INPUT_REFERENCE_TOKENS = 3589;

const logger = createLogger();

interface KimiEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface KimiRunOptions {
  customerId: string;
  label: string;
  candidatesSource: string;
  batchSize: number;
  concurrency: number;
  thinking: "enabled" | "disabled" | null; // kimi-k2.x platform models (binary); null = use reasoning_effort
  reasoningEffort: "low" | "high"; // kimi-for-coding subscription alias / kimi-k3
}

async function main(): Promise<void> {
  const workspace = process.cwd();
  const args = process.argv.slice(2);
  const kimi = await loadKimiEnv(workspace, args);
  const defaultBatchSize = kimi.model.startsWith("kimi-k2.") ? "25" : "50";
  const run: KimiRunOptions = {
    customerId: optionValue(args, "--customer") ?? "3825219066",
    label: optionValue(args, "--label") ?? "pnc",
    candidatesSource: optionValue(args, "--candidates") ?? DEFAULT_CANDIDATES_SOURCE,
    batchSize: Number(optionValue(args, "--batch-size") ?? defaultBatchSize),
    concurrency: Number(optionValue(args, "--concurrency") ?? "3"),
    thinking: (optionValue(args, "--thinking") as "enabled" | "disabled" | null) ?? null,
    reasoningEffort: (optionValue(args, "--reasoning") as "low" | "high" | null) ?? "low"
  };
  if (!Number.isSafeInteger(run.batchSize) || run.batchSize < 1) throw new Error("--batch-size must be a positive integer.");
  const rules = await loadRuleSet(workspace);
  const dateRange = DEFAULT_RANGE;
  const telemetry = new RunTelemetry({ logger });
  const artifacts = new RunArtifacts(workspace, `measure-${run.label}-30day-kimi-${timestamp()}`,
    (error, relativePath) => telemetry.error(error, {
      stage: "ARTIFACT_WRITE", code: "ARTIFACT_WRITE_FAILED", retryable: true, details: { relativePath }
    }));
  const startedAt = new Date().toISOString();

  const source = JSON.parse(await readFile(resolve(workspace, run.candidatesSource), "utf8")) as {
    organization: Organization;
    dateRange: DateRange;
    candidates: ClassificationCandidate[];
  };
  const organization = source.organization;
  const limitRaw = optionValue(args, "--limit");
  const limit = limitRaw === null ? null : Number(limitRaw);
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }
  const candidates = limit === null ? source.candidates : source.candidates.slice(0, limit);
  if (organization.customerId !== run.customerId) {
    throw new Error(`Candidate source is for customer ${organization.customerId}, not ${run.customerId}.`);
  }
  dateRange.startDate = source.dateRange.startDate;
  dateRange.endDate = source.dateRange.endDate;

  const manifestBase = {
    runId: artifacts.runId,
    startedAt,
    purpose: `One-off 30-day token-usage measurement on Kimi (${kimi.model}), same candidate set as the OpenAI run`,
    requestedDateRange: { from: dateRange.startDate, to: dateRange.endDate },
    candidateSource: `${run.candidatesSource} (no Google Ads refetch; identical input for provider comparison)`,
    readOnly: true,
    googleAdsMutationPerformed: false,
    ruleSet: { version: rules.version, sourcePath: rules.sourcePath, promptVersion: rules.promptVersion },
    llm: { provider: "kimi", model: kimi.model, baseUrl: kimi.baseUrl, thinking: run.thinking, reasoningEffort: run.thinking ? null : run.reasoningEffort, exactModelString: kimi.model },
    limits: { googleFetchConcurrency: 0, llmConcurrency: run.concurrency, llmBatchSize: run.batchSize }
  };
  await artifacts.write("run-manifest.json", { ...manifestBase, status: "RUNNING" });
  await artifacts.writeText("rules.md", rules.markdown);
  await artifacts.write("organizations.json", { discovered: [organization], selected: [organization] });

  const basePath = `organizations/${organization.customerId}`;
  const errorContext = { organizationId: organization.customerId };
  await artifacts.write(`${basePath}/candidates.json`, { organization, dateRange, candidates, source: manifestBase.candidateSource });
  await artifacts.write(`${basePath}/fixed-input-tokens.json`, {
    status: "UNSUPPORTED_BY_PROVIDER",
    provider: "kimi",
    model: kimi.model,
    note: "Kimi for Coding exposes no input-token count endpoint. Reference value: the byte-identical prompt prefix measured via the OpenAI input_tokens endpoint.",
    estimatedFixedInputTokens: FIXED_INPUT_REFERENCE_TOKENS
  });

  const batches = chunksOf(candidates, run.batchSize);
  const llmLimit = createLimiter(run.concurrency);
  const decisions: ClassificationDecision[] = [];
  const batchTokenUsage: BatchTokenUsage[] = [];
  const rateLimitObservations: Array<Record<string, unknown>> = [];
  let organizationUsage = { ...emptyTokenUsage(), generationRequests: 0 };
  let abortRemaining = false;

  await Promise.allSettled(batches.map((batch, index) => llmLimit(async () => {
    if (abortRemaining) return;
    const batchId = String(index + 1).padStart(4, "0");
    const context = {
      account: { customerId: organization.customerId, descriptiveName: organization.descriptiveName, timeZone: organization.timeZone },
      dateRange,
      rules,
      searchTerms: batch
    };
    const prompt = buildClassifierPrompt(context);
    const request = createKimiRequest(kimi.model, prompt, batch, rules, run);
    await artifacts.write(`${basePath}/llm/batch-${batchId}-input.json`, {
      provider: "kimi",
      model: kimi.model,
      ruleVersion: rules.version,
      promptVersion: rules.promptVersion,
      fixedInputTokens: null,
      estimatedFixedInputTokens: FIXED_INPUT_REFERENCE_TOKENS,
      ...context
    });
    try {
      const result = await telemetry.track("LLM_CLASSIFICATION", {
        ...errorContext, batchId, provider: "kimi", details: { candidateCount: batch.length }
      }, () => classifyWithKimi(kimi, request, batch, rules));
      for (const attempt of result.attempts) telemetry.recordGeneration(attempt.usage);
      telemetry.recordBatch(true);
      organizationUsage = mergeUsage(organizationUsage, result.validated.usage, result.attempts.length);
      batchTokenUsage.push({ batchId, status: "VALIDATED", candidateCount: batch.length, generationRequests: result.attempts.length, ...result.validated.usage });
      decisions.push(...result.validated.decisions);
      if (result.rateLimitHeaders) rateLimitObservations.push({ batchId, ...result.rateLimitHeaders });
      await artifacts.write(`${basePath}/llm/batch-${batchId}-output.json`, {
        status: "VALIDATED",
        provider: "kimi",
        model: kimi.model,
        ruleVersion: rules.version,
        promptVersion: rules.promptVersion,
        providerRequestId: result.validated.providerRequestId,
        rateLimitHeaders: result.rateLimitHeaders,
        tokenUsage: result.validated.usage,
        attempts: result.attempts,
        providerRequest: result.request,
        rawResponse: result.response,
        decisions: result.validated.decisions
      });
    } catch (error) {
      const failure = error instanceof ClassificationFailure ? error : null;
      const attempts = failure?.attempts ?? [];
      const failedUsage = attempts.reduce((total, attempt) => addTokenUsage(total, attempt.usage), emptyTokenUsage());
      for (const attempt of attempts) telemetry.recordGeneration(attempt.usage);
      telemetry.recordBatch(false);
      organizationUsage = mergeUsage(organizationUsage, failedUsage, attempts.length);
      batchTokenUsage.push({ batchId, status: "FAILED", candidateCount: batch.length, generationRequests: attempts.length, ...failedUsage });
      abortRemaining = true;
      telemetry.error(error, { stage: "LLM_CLASSIFICATION", ...errorContext, batchId, provider: "kimi" });
      await artifacts.write(`${basePath}/llm/batch-${batchId}-error.json`, {
        status: "FAILED",
        failedAt: new Date().toISOString(),
        error: serializeError(error, { stage: "LLM_CLASSIFICATION", ...errorContext, batchId, provider: "kimi" }),
        attempts,
        tokenUsage: failedUsage,
        providerRequest: failure?.request ?? null,
        lastRawResponse: failure?.lastResponse ?? null
      });
    }
  })));

  batchTokenUsage.sort((left, right) => left.batchId.localeCompare(right.batchId));
  const failedBatchCount = batchTokenUsage.filter((item) => item.status === "FAILED").length;
  const decisionCounts: Record<string, number> = { KEEP: 0, NEGATIVE_EXACT: 0 };
  for (const decision of decisions) decisionCounts[decision.decision] = (decisionCounts[decision.decision] || 0) + 1;

  const summary: OrganizationSummary = {
    customerId: organization.customerId,
    descriptiveName: organization.descriptiveName,
    dateRange,
    status: candidates.length > 0 && decisions.length === 0
      ? "FAILED"
      : failedBatchCount > 0
        ? "PARTIAL"
        : "SUCCEEDED",
    rawRowCount: candidates.length,
    candidateCount: candidates.length,
    decisionCount: decisions.length,
    failedBatchCount,
    decisions: decisionCounts,
    tokenUsage: {
      ...organizationUsage,
      fixedInputTokens: null,
      fixedInputDefinition: "Kimi exposes no count endpoint; see fixed-input-tokens.json for the OpenAI-measured reference value."
    },
    batchTokenUsage,
    errorCount: telemetry.errorsForOrganization(organization.customerId).length
  };

  await artifacts.write(`${basePath}/decisions.json`, {
    contractVersion: "classification-output-v2",
    readOnly: true,
    googleAdsMutationPerformed: false,
    ruleVersion: rules.version,
    promptVersion: rules.promptVersion,
    provider: "kimi",
    model: kimi.model,
    tokenUsage: summary.tokenUsage,
    decisions
  });
  await artifacts.writeText(`${basePath}/llm-decisions.csv`,
    createDecisionCsv(organization, `${dateRange.startDate}..${dateRange.endDate}`, candidates, decisions, kimi.model, rules.version));
  await artifacts.write(`${basePath}/errors.json`, { errors: telemetry.errorsForOrganization(organization.customerId) });
  await artifacts.write(`${basePath}/token-usage.json`, createOrganizationTokenUsageReport("kimi", kimi.model, summary));
  await artifacts.write(`${basePath}/summary.json`, summary);

  const snapshot = telemetry.snapshot();
  const tokenUsageReport = createRunTokenUsageReport(snapshot.tokenUsage, [summary]);
  await artifacts.write("token-usage.json", tokenUsageReport);
  await artifacts.write("telemetry.json", snapshot);
  await artifacts.write("rate-limit-observations.json", rateLimitObservations);
  const completedAt = new Date().toISOString();
  await artifacts.write("summary.json", {
    runId: artifacts.runId,
    status: summary.status,
    readOnly: true,
    startedAt,
    completedAt,
    durationMs: Math.round(new Date(completedAt).getTime() - new Date(startedAt).getTime()),
    organizationsDiscovered: 1,
    organizationsSelected: 1,
    rawRows: candidates.length,
    candidates: candidates.length,
    decisions: decisions.length,
    tokenUsage: snapshot.tokenUsage,
    tokenUsageReconciled: tokenUsageReport.reconciliation.reconciled,
    errorCount: snapshot.errors.length,
    organizations: [summary]
  });
  await artifacts.write("run-manifest.json", {
    ...manifestBase,
    status: summary.status,
    completedAt,
    organizationsDiscovered: 1,
    organizationsSelected: 1,
    errorCount: snapshot.errors.length,
    fatalError: null
  });

  logger.info({
    runDirectory: artifacts.runDirectory,
    status: summary.status,
    candidates: candidates.length,
    decisions: decisions.length,
    decisionCounts,
    failedBatches: failedBatchCount,
    batches: batches.length,
    tokenUsage: snapshot.tokenUsage,
    rateLimitObservations: rateLimitObservations.length,
    reconciled: tokenUsageReport.reconciliation.reconciled
  }, "Kimi 30-day measurement run completed");
}

interface KimiClassifyResult {
  validated: { decisions: ClassificationDecision[]; usage: LlmTokenUsage; providerRequestId: string | null };
  request: Record<string, unknown>;
  response: unknown;
  attempts: LlmGenerationAttempt[];
  rateLimitHeaders: Record<string, string> | null;
}

async function classifyWithKimi(
  kimi: KimiEnv,
  request: Record<string, unknown>,
  batch: ClassificationCandidate[],
  rules: RuleSet
): Promise<KimiClassifyResult> {
  const attempts: LlmGenerationAttempt[] = [];
  let accumulatedUsage = emptyTokenUsage();
  let lastResponse: unknown = null;
  let lastError: Error | null = null;
  let lastRateLimitHeaders: Record<string, string> | null = null;

  for (let validationAttempt = 1; validationAttempt <= 2; validationAttempt += 1) {
    let call: { payload: Record<string, any>; requestId: string | null; attempts: LlmHttpAttempt[]; rateLimitHeaders: Record<string, string> | null };
    try {
      call = await callKimi(kimi, request);
    } catch (error) {
      attempts.push({
        attempt: validationAttempt,
        outcome: "REQUEST_FAILED",
        providerRequestId: null,
        usage: emptyTokenUsage(),
        validationError: errorMessage(error),
        httpAttempts: [],
        rawResponse: null
      });
      throw new ClassificationFailure(`Kimi request failed: ${errorMessage(error)}`, request, attempts, lastResponse, "kimi", { cause: error });
    }
    lastResponse = call.payload;
    lastRateLimitHeaders = call.rateLimitHeaders;
    const usage = normalizeKimiUsage(call.payload.usage);
    accumulatedUsage = addTokenUsage(accumulatedUsage, usage);
    try {
      const parsed = parseClassifierPayload(extractKimiResponseText(call.payload));
      const validatedDecisions = validateDecisions(parsed, batch, rules);
      attempts.push({
        attempt: validationAttempt,
        outcome: "VALIDATED",
        providerRequestId: call.requestId,
        usage,
        validationError: null,
        httpAttempts: call.attempts,
        rawResponse: call.payload
      });
      return {
        validated: { decisions: validatedDecisions, usage: accumulatedUsage, providerRequestId: call.requestId },
        request,
        response: call.payload,
        attempts,
        rateLimitHeaders: call.rateLimitHeaders
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempts.push({
        attempt: validationAttempt,
        outcome: "VALIDATION_FAILED",
        providerRequestId: call.requestId,
        usage,
        validationError: lastError.message,
        httpAttempts: call.attempts,
        rawResponse: call.payload
      });
    }
  }
  void lastRateLimitHeaders;
  throw new ClassificationFailure(
    `Kimi returned invalid structured output twice: ${lastError?.message || "unknown error"}`,
    request, attempts, lastResponse, "kimi", lastError ? { cause: lastError } : undefined
  );
}

function createKimiRequest(
  model: string,
  prompt: { systemInstruction: string; userPrompt: string },
  batch: ClassificationCandidate[],
  rules: RuleSet,
  run: KimiRunOptions
): Record<string, unknown> {
  const isPlatformK2 = model.startsWith("kimi-k2.");
  const request: Record<string, unknown> = {
    model,
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
  if (isPlatformK2) {
    // kimi-k2.x on api.moonshot.ai: binary thinking mode, max_tokens (default cap 32768).
    request.thinking = { type: run.thinking ?? "enabled" };
    request.max_tokens = 32768;
  } else {
    // kimi-for-coding subscription alias on api.kimi.com/coding: reasoning_effort gradations.
    request.reasoning_effort = run.reasoningEffort;
    request.max_completion_tokens = 50_000;
  }
  return request;
}

async function callKimi(kimi: KimiEnv, request: Record<string, unknown>): Promise<{
  payload: Record<string, any>;
  requestId: string | null;
  attempts: LlmHttpAttempt[];
  rateLimitHeaders: Record<string, string> | null;
}> {
  const url = `${kimi.baseUrl}/chat/completions`;
  const attempts: LlmHttpAttempt[] = [];
  for (let attempt = 0; attempt <= 4; attempt += 1) {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${kimi.apiKey}`,
          "content-type": "application/json",
          "user-agent": "google-ads-negative-keyword-sweeper-tool/0.1.0"
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      const retrying = attempt < 4;
      attempts.push(httpAttempt(attempt + 1, startedAt, started, null, null, retrying, errorMessage(error)));
      if (retrying) {
        await wait(backoffMs(attempt));
        continue;
      }
      throw new Error(`Kimi network request failed: ${errorMessage(error)}`);
    }

    const requestId = response.headers.get("x-request-id");
    const rateLimitHeaders = captureRateLimitHeaders(response.headers);
    if (!response.ok) {
      const detail = safeErrorMessage(await readJsonSafely(response));
      const retrying = RETRYABLE_STATUS.has(response.status) && attempt < 4;
      attempts.push(httpAttempt(attempt + 1, startedAt, started, response.status, requestId, retrying, detail));
      if (retrying) {
        await wait(retryDelayMs(response, attempt));
        continue;
      }
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }
    const payload = await readJsonSafely(response);
    if (!isRecord(payload)) {
      attempts.push(httpAttempt(attempt + 1, startedAt, started, response.status, requestId, false, "Response body was not an object"));
      throw new Error("Kimi response body was not an object.");
    }
    attempts.push(httpAttempt(attempt + 1, startedAt, started, response.status, requestId, false, null, "SUCCEEDED"));
    return { payload, requestId, attempts, rateLimitHeaders };
  }
  throw new Error("Kimi retry loop ended unexpectedly.");
}

function captureRateLimitHeaders(headers: Headers): Record<string, string> | null {
  const captured: Record<string, string> = {};
  headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower.includes("ratelimit") || lower.includes("rate-limit") || lower.startsWith("x-kimi") || lower === "retry-after") {
      captured[lower] = value;
    }
  });
  return Object.keys(captured).length > 0 ? captured : null;
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
  const inputTokens = tokenNumber(usage.prompt_tokens);
  const outputTokens = tokenNumber(usage.completion_tokens);
  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const completionDetails = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
  return {
    inputTokens,
    outputTokens,
    totalTokens: tokenNumber(usage.total_tokens) || inputTokens + outputTokens,
    cachedInputTokens: tokenNumber(promptDetails.cached_tokens),
    thoughtTokens: tokenNumber(completionDetails.reasoning_tokens)
  };
}

async function loadKimiEnv(workspace: string, args: string[] = []): Promise<KimiEnv> {
  let fileValues: Record<string, string> = {};
  try {
    const source = await readFile(resolve(workspace, ".env"), "utf8");
    fileValues = Object.fromEntries(source.split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
  } catch { /* .env optional */ }
  const model = optionValue(args, "--model") ?? process.env.KIMI_MODEL ?? fileValues.KIMI_MODEL ?? KIMI_DEFAULT_MODEL;
  const isPlatformModel = model.startsWith("kimi-k2.") || model.startsWith("kimi-k3");
  const defaultBase = isPlatformModel ? KIMI_PLATFORM_BASE_URL : KIMI_DEFAULT_BASE_URL;
  const baseUrl = (optionValue(args, "--base-url")
    ?? (isPlatformModel
      ? (process.env.MOONSHOT_BASE_URL || fileValues.MOONSHOT_BASE_URL || process.env.KIMI_BASE_URL || fileValues.KIMI_BASE_URL)
      : (process.env.KIMI_BASE_URL || fileValues.KIMI_BASE_URL))
    ?? defaultBase).replace(/\/$/u, "");
  const moonshotHost = /moonshot\.ai$/iu.test(new URL(baseUrl.includes("://") ? baseUrl : `https://${baseUrl}`).hostname);
  const apiKey = moonshotHost
    ? (process.env.MOONSHOT_API_KEY || fileValues.MOONSHOT_API_KEY)
    : (process.env.KIMI_API_KEY || fileValues.KIMI_API_KEY);
  if (!apiKey) {
    throw new Error(moonshotHost
      ? "MOONSHOT_API_KEY is missing (required for api.moonshot.ai)."
      : "KIMI_API_KEY is missing (set it in .env or the environment).");
  }
  return { apiKey, baseUrl, model };
}

function mergeUsage(current: { generationRequests: number } & LlmTokenUsage, usage: LlmTokenUsage, requests: number) {
  return { ...addTokenUsage(current, usage), generationRequests: current.generationRequests + requests };
}

function optionValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function httpAttempt(
  attempt: number,
  startedAt: string,
  started: number,
  statusCode: number | null,
  requestId: string | null,
  retrying: boolean,
  error: string | null,
  outcome?: LlmHttpAttempt["outcome"]
): LlmHttpAttempt {
  return {
    attempt,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Math.round((performance.now() - started) * 100) / 100,
    statusCode,
    requestId,
    outcome: outcome ?? (retrying ? "RETRYING" : "FAILED"),
    error
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function tokenNumber(value: unknown): number {
  return nonNegativeNumber(value) ? value : 0;
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter && /^\d+(?:\.\d+)?$/u.test(retryAfter) ? Number(retryAfter) : 0;
  return Math.max(backoffMs(attempt), seconds * 1000) + Math.floor(Math.random() * 250);
}

function backoffMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}

function safeErrorMessage(payload: unknown): string {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
  const type = typeof error?.type === "string" ? error.type : "UNKNOWN";
  const message = typeof error?.message === "string" ? error.message : "No message returned";
  return `${type}: ${message}`;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/gu, "");
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Kimi 30-day measurement run failed");
  process.exitCode = 1;
});
