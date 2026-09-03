import type { AppConfig } from "../config/env.js";
import { PipelineError } from "../observability/errors.js";
import { addTokenUsage, emptyTokenUsage } from "../observability/run-telemetry.js";
import type { FixedInputTokenCount, LlmTokenUsage, ValidatedBatch } from "../types.js";
import {
  ClassificationFailure,
  type ClassificationContext,
  type ClassificationResult,
  type KeywordClassifier,
  type LlmGenerationAttempt,
  type LlmHttpAttempt
} from "./classifier.js";
import { buildClassifierPrompt, createResponseSchema, FIXED_INPUT_DEFINITION } from "./prompt.js";
import { validateDecisions } from "./validation.js";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class GeminiKeywordClassifier implements KeywordClassifier {
  readonly provider = "google-gemini";
  readonly model: string;

  constructor(private readonly config: AppConfig["llm"]) {
    this.model = config.model;
  }

  async classify(context: ClassificationContext): Promise<ClassificationResult> {
    if (context.searchTerms.length === 0) throw new Error("Cannot classify an empty search-term batch.");
    const request = createRequest(context, createResponseSchema(
      context.searchTerms.map((term) => term.itemId),
      context.rules.ruleIds
    ));
    const attempts: LlmGenerationAttempt[] = [];
    let accumulatedUsage = emptyTokenUsage();
    let lastResponse: unknown = null;
    let lastError: Error | null = null;

    for (let validationAttempt = 1; validationAttempt <= 2; validationAttempt += 1) {
      let call: GeminiCallResult;
      try {
        call = await this.callEndpoint("generateContent", request, "LLM_REQUEST");
      } catch (error) {
        const requestError = error instanceof GeminiRequestError ? error : null;
        attempts.push({
          attempt: validationAttempt,
          outcome: "REQUEST_FAILED",
          providerRequestId: requestError?.requestId ?? null,
          usage: emptyTokenUsage(),
          validationError: errorMessage(error),
          httpAttempts: requestError?.attempts ?? [],
          rawResponse: null
        });
        throw new ClassificationFailure(
          `Gemini request failed: ${errorMessage(error)}`,
          request,
          attempts,
          lastResponse,
          this.provider,
          { cause: error }
        );
      }

      lastResponse = call.payload;
      const usage = normalizeGeminiUsage(call.payload.usageMetadata);
      accumulatedUsage = addTokenUsage(accumulatedUsage, usage);
      try {
        const parsed = JSON.parse(extractResponseText(call.payload)) as unknown;
        const decisions = validateDecisions(parsed, context.searchTerms, context.rules);
        attempts.push({
          attempt: validationAttempt,
          outcome: "VALIDATED",
          providerRequestId: call.requestId,
          usage,
          validationError: null,
          httpAttempts: call.attempts,
          rawResponse: call.payload
        });
        const validated: ValidatedBatch = {
          decisions,
          model: this.model,
          providerRequestId: call.requestId,
          usage: accumulatedUsage
        };
        return { validated, request, response: call.payload, attempts };
      } catch (error) {
        lastError = asError(error);
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

    throw new ClassificationFailure(
      `Gemini returned invalid structured output twice: ${lastError?.message || "unknown error"}`,
      request,
      attempts,
      lastResponse,
      this.provider,
      lastError ? { cause: lastError } : undefined
    );
  }

  async countFixedInputTokens(
    context: Omit<ClassificationContext, "searchTerms">
  ): Promise<FixedInputTokenCount> {
    const request = createRequest({ ...context, searchTerms: [] }, createResponseSchema([], context.rules.ruleIds));
    const countBody = { generateContentRequest: { model: `models/${this.model}`, ...request } };
    const call = await this.callEndpoint("countTokens", countBody, "LLM_FIXED_TOKEN_COUNT");
    if (!nonNegativeNumber(call.payload.totalTokens)) {
      throw new PipelineError("Gemini countTokens response omitted totalTokens.", {
        stage: "LLM_FIXED_TOKEN_COUNT",
        code: "LLM_COUNT_TOKENS_INVALID_RESPONSE",
        provider: this.provider,
        requestId: call.requestId,
        retryable: false
      });
    }
    return {
      totalTokens: call.payload.totalTokens,
      countedAt: new Date().toISOString(),
      definition: FIXED_INPUT_DEFINITION,
      model: this.model,
      providerRequestId: call.requestId,
      attemptCount: call.attempts.length,
      retryCount: call.attempts.filter((attempt) => attempt.outcome === "RETRYING").length
    };
  }

  private async callEndpoint(
    operation: "generateContent" | "countTokens",
    request: Record<string, unknown>,
    stage: "LLM_REQUEST" | "LLM_FIXED_TOKEN_COUNT"
  ): Promise<GeminiCallResult> {
    const attempts: LlmHttpAttempt[] = [];
    const url = `${this.config.baseUrl}/models/${encodeURIComponent(this.model)}:${operation}`;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const startedAt = new Date().toISOString();
      const started = performance.now();
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "x-goog-api-key": this.config.apiKey, "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(this.config.requestTimeoutMs)
        });
      } catch (error) {
        const retrying = attempt < this.config.maxRetries;
        const detail = isTimeoutError(error)
          ? `Request timed out after ${this.config.requestTimeoutMs}ms`
          : errorMessage(error);
        attempts.push(httpAttempt(attempt + 1, startedAt, started, null, null, retrying, detail));
        if (retrying) {
          await wait(backoffMs(attempt));
          continue;
        }
        throw new GeminiRequestError(
          isTimeoutError(error) ? `Gemini request timed out after ${this.config.requestTimeoutMs}ms.` : "Gemini network request failed.",
          attempts,
          null,
          { cause: asError(error) }
        );
      }

      const payload = await readJsonSafely(response);
      const requestId = response.headers.get("x-request-id") || response.headers.get("x-goog-request-id");
      if (!response.ok || !isRecord(payload)) {
        const detail = safeErrorMessage(payload);
        const permanentQuotaFailure = response.status === 429 && /prepayment credits are depleted/iu.test(detail);
        const retrying = RETRYABLE_STATUS.has(response.status) && attempt < this.config.maxRetries && !permanentQuotaFailure;
        attempts.push(httpAttempt(attempt + 1, startedAt, started, response.status, requestId, retrying, detail));
        if (retrying) {
          await wait(retryDelayMs(response, attempt));
          continue;
        }
        throw new GeminiRequestError(`HTTP ${response.status}: ${detail}`, attempts, requestId, {
          cause: new PipelineError(detail, {
            stage,
            code: "LLM_HTTP_ERROR",
            provider: this.provider,
            statusCode: response.status,
            requestId,
            retryable: RETRYABLE_STATUS.has(response.status) && !permanentQuotaFailure
          })
        });
      }
      attempts.push(httpAttempt(attempt + 1, startedAt, started, response.status, requestId, false, null, "SUCCEEDED"));
      return { payload, requestId, attempts };
    }
    throw new GeminiRequestError("Gemini retry loop ended unexpectedly.", attempts, null);
  }
}

interface GeminiCallResult {
  payload: Record<string, any>;
  requestId: string | null;
  attempts: LlmHttpAttempt[];
}

class GeminiRequestError extends Error {
  constructor(
    message: string,
    readonly attempts: LlmHttpAttempt[],
    readonly requestId: string | null,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "GeminiRequestError";
  }
}

function createRequest(context: ClassificationContext, responseSchema: Record<string, unknown>): Record<string, unknown> {
  const prompt = buildClassifierPrompt(context);
  return {
    systemInstruction: { parts: [{ text: prompt.systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: prompt.userPrompt }] }],
    generationConfig: {
      candidateCount: 1,
      temperature: 0,
      seed: 260826,
      maxOutputTokens: Math.min(65_536, 512 + Math.max(1, context.searchTerms.length) * 512),
      responseMimeType: "application/json",
      responseJsonSchema: responseSchema
    }
  };
}

function extractResponseText(payload: Record<string, any>): string {
  const candidate = payload.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) {
    const reason = candidate?.finishReason || payload.promptFeedback?.blockReason || "no candidate returned";
    throw new Error(`Gemini response had no content (${reason}).`);
  }
  const text = parts.map((part: unknown) => isRecord(part) && typeof part.text === "string" ? part.text : "").join("");
  if (!text) throw new Error("Gemini response contained no text.");
  return text;
}

export function normalizeGeminiUsage(value: unknown): LlmTokenUsage {
  const usage = isRecord(value) ? value : {};
  const inputTokens = tokenNumber(usage.promptTokenCount);
  const outputTokens = tokenNumber(usage.candidatesTokenCount);
  const thoughtTokens = tokenNumber(usage.thoughtsTokenCount);
  return {
    inputTokens,
    outputTokens,
    totalTokens: tokenNumber(usage.totalTokenCount) || inputTokens + outputTokens + thoughtTokens,
    cachedInputTokens: tokenNumber(usage.cachedContentTokenCount),
    thoughtTokens
  };
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

function safeErrorMessage(payload: unknown): string {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
  const code = typeof error?.status === "string" ? error.status : typeof error?.code === "string" ? error.code : "UNKNOWN";
  const message = typeof error?.message === "string" ? error.message : "No message returned";
  return `${code}: ${message}`;
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter && /^\d+(?:\.\d+)?$/u.test(retryAfter) ? Number(retryAfter) : 0;
  return Math.max(backoffMs(attempt), seconds * 1000) + Math.floor(Math.random() * 250);
}

function backoffMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
