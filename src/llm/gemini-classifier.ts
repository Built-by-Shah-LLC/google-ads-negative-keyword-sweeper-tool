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
import { validateDecisions } from "./validation.js";
import { buildClassifierPrompt, createResponseSchema, FIXED_INPUT_DEFINITION } from "./prompt.js";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

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
        call = await this.callGemini(request);
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
          { cause: error }
        );
      }

      lastResponse = call.payload;
      const usage = normalizeUsage(call.payload.usageMetadata);
      accumulatedUsage = addTokenUsage(accumulatedUsage, usage);
      try {
        const responseText = extractResponseText(call.payload);
        const parsed = JSON.parse(responseText) as unknown;
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

    throw new ClassificationFailure(
      `Gemini returned invalid structured output twice: ${lastError?.message || "unknown error"}`,
      request,
      attempts,
      lastResponse,
      lastError ? { cause: lastError } : undefined
    );
  }

  async countFixedInputTokens(
    context: Omit<ClassificationContext, "searchTerms">
  ): Promise<FixedInputTokenCount> {
    const request = createRequest({ ...context, searchTerms: [] }, createResponseSchema([], context.rules.ruleIds));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:countTokens`;
    for (let attempt = 0; attempt <= 4; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "x-goog-api-key": this.config.apiKey, "content-type": "application/json" },
          body: JSON.stringify({ generateContentRequest: { model: `models/${this.model}`, ...request } })
        });
      } catch (error) {
        if (attempt < 4) {
          await wait(backoffMs(attempt));
          continue;
        }
        throw new PipelineError("Gemini countTokens network request failed.", {
          stage: "LLM_FIXED_TOKEN_COUNT",
          code: "LLM_COUNT_TOKENS_NETWORK_ERROR",
          provider: this.provider,
          retryable: true,
          details: { attemptCount: attempt + 1 }
        }, { cause: asError(error) });
      }
      const payload = await readJsonSafely(response);
      const requestId = response.headers.get("x-request-id") || response.headers.get("x-goog-request-id");
      if (response.ok && isRecord(payload) && nonNegativeNumber(payload.totalTokens)) {
        return {
          totalTokens: payload.totalTokens,
          countedAt: new Date().toISOString(),
          definition: FIXED_INPUT_DEFINITION,
          model: this.model,
          providerRequestId: requestId,
          attemptCount: attempt + 1,
          retryCount: attempt
        };
      }
      const retrying = RETRYABLE_STATUS.has(response.status) && attempt < 4;
      if (retrying) {
        await wait(retryDelayMs(response, attempt, payload));
        continue;
      }
      throw new PipelineError(
        `Gemini countTokens failed with HTTP ${response.status}: ${safeErrorMessage(payload)}`,
        {
          stage: "LLM_FIXED_TOKEN_COUNT",
          code: "LLM_COUNT_TOKENS_FAILED",
          provider: this.provider,
          statusCode: response.status,
          requestId,
          retryable: RETRYABLE_STATUS.has(response.status),
          details: { attemptCount: attempt + 1 }
        }
      );
    }
    throw new Error("Gemini countTokens retry loop ended unexpectedly.");
  }

  private async callGemini(request: Record<string, unknown>): Promise<GeminiCallResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const attempts: LlmHttpAttempt[] = [];
    for (let attempt = 0; attempt <= 4; attempt += 1) {
      const startedAt = new Date().toISOString();
      const started = performance.now();
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "x-goog-api-key": this.config.apiKey, "content-type": "application/json" },
          body: JSON.stringify(request)
        });
      } catch (error) {
        const retrying = attempt < 4;
        attempts.push(httpAttempt(attempt + 1, startedAt, started, null, null, retrying, errorMessage(error)));
        if (retrying) {
          await wait(backoffMs(attempt));
          continue;
        }
        throw new GeminiRequestError("Gemini network request failed.", attempts, null, { cause: asError(error) });
      }

      const requestId = response.headers.get("x-request-id") || response.headers.get("x-goog-request-id");
      if (!response.ok) {
        const errorPayload = await readJsonSafely(response);
        const detail = safeErrorMessage(errorPayload);
        const permanentQuotaFailure = response.status === 429 && /prepayment credits are depleted/iu.test(detail);
        const retrying = RETRYABLE_STATUS.has(response.status) && attempt < 4 && !permanentQuotaFailure;
        attempts.push(httpAttempt(attempt + 1, startedAt, started, response.status, requestId, retrying, detail));
        if (retrying) {
          await wait(retryDelayMs(response, attempt, errorPayload));
          continue;
        }
        throw new GeminiRequestError(
          `HTTP ${response.status}: ${detail}`,
          attempts,
          requestId,
          {
            cause: new PipelineError(detail, {
              stage: "LLM_REQUEST",
              code: "LLM_HTTP_ERROR",
              provider: this.provider,
              statusCode: response.status,
              requestId,
              retryable: RETRYABLE_STATUS.has(response.status) && !permanentQuotaFailure
            })
          }
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        attempts.push(httpAttempt(attempt + 1, startedAt, started, response.status, requestId, false, "Invalid JSON response body"));
        throw new GeminiRequestError("Gemini returned an invalid JSON response body.", attempts, requestId, { cause: asError(error) });
      }
      if (!isRecord(payload)) {
        attempts.push(httpAttempt(attempt + 1, startedAt, started, response.status, requestId, false, "Response body was not an object"));
        throw new GeminiRequestError("Gemini response body was not an object.", attempts, requestId);
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
    contents: [{
      role: "user",
      parts: [{ text: prompt.userPrompt }]
    }],
    generationConfig: {
      candidateCount: 1,
      temperature: 0,
      seed: 260826,
      maxOutputTokens: Math.min(65536, 512 + Math.max(1, context.searchTerms.length) * 512),
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

export function normalizeUsage(value: unknown): LlmTokenUsage {
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

function retryDelayMs(response: Response, attempt: number, payload: unknown): number {
  const retryAfter = response.headers.get("retry-after");
  const retrySeconds = retryAfter && /^\d+$/u.test(retryAfter) ? Number(retryAfter) : 0;
  return Math.max(backoffMs(attempt), retrySeconds * 1000, extractRetryDelayMs(payload)) + Math.floor(Math.random() * 250);
}

function backoffMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}

function safeErrorMessage(payload: unknown): string {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
  const status = typeof error?.status === "string" ? error.status : "UNKNOWN";
  const message = typeof error?.message === "string" ? error.message : "No message returned";
  return `${status}: ${message}`;
}

function extractRetryDelayMs(payload: unknown): number {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
  const details = Array.isArray(error?.details) ? error.details : [];
  for (const detail of details) {
    if (!isRecord(detail) || typeof detail.retryDelay !== "string") continue;
    const match = /^(\d+(?:\.\d+)?)s$/u.exec(detail.retryDelay);
    if (match?.[1]) return Math.ceil(Number(match[1]) * 1000);
  }
  return 0;
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

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
