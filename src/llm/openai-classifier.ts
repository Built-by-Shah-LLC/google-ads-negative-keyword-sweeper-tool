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

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const RESPONSES_URL = "https://api.openai.com/v1/responses";

export class OpenAIKeywordClassifier implements KeywordClassifier {
  readonly provider = "openai";
  readonly model: string;

  constructor(private readonly config: AppConfig["llm"]) {
    this.model = config.model;
  }

  async classify(context: ClassificationContext): Promise<ClassificationResult> {
    if (context.searchTerms.length === 0) throw new Error("Cannot classify an empty search-term batch.");
    const request = createRequest(this.model, context, createResponseSchema(
      context.searchTerms.map((term) => term.itemId),
      context.rules.ruleIds
    ));
    const attempts: LlmGenerationAttempt[] = [];
    let accumulatedUsage = emptyTokenUsage();
    let lastResponse: unknown = null;
    let lastError: Error | null = null;

    for (let validationAttempt = 1; validationAttempt <= 2; validationAttempt += 1) {
      let call: OpenAICallResult;
      try {
        call = await this.callOpenAI(request);
      } catch (error) {
        const requestError = error instanceof OpenAIRequestError ? error : null;
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
          `OpenAI request failed: ${errorMessage(error)}`,
          request,
          attempts,
          lastResponse,
          this.provider,
          { cause: error }
        );
      }

      lastResponse = call.payload;
      const usage = normalizeOpenAIUsage(call.payload.usage);
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
      `OpenAI returned invalid structured output twice: ${lastError?.message || "unknown error"}`,
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
    const request = createRequest(this.model, { ...context, searchTerms: [] }, createResponseSchema([], context.rules.ruleIds));
    const countRequest = {
      model: request.model,
      instructions: request.instructions,
      input: request.input,
      reasoning: request.reasoning,
      text: request.text
    };
    const call = await this.callEndpoint(`${RESPONSES_URL}/input_tokens`, countRequest, "LLM_FIXED_TOKEN_COUNT");
    if (!nonNegativeNumber(call.payload.input_tokens)) {
      throw new PipelineError("OpenAI input-token response omitted input_tokens.", {
        stage: "LLM_FIXED_TOKEN_COUNT",
        code: "LLM_COUNT_TOKENS_INVALID_RESPONSE",
        provider: this.provider,
        requestId: call.requestId,
        retryable: false
      });
    }
    return {
      totalTokens: call.payload.input_tokens,
      countedAt: new Date().toISOString(),
      definition: FIXED_INPUT_DEFINITION,
      model: this.model,
      providerRequestId: call.requestId,
      attemptCount: call.attempts.length,
      retryCount: call.attempts.filter((attempt) => attempt.outcome === "RETRYING").length
    };
  }

  private callOpenAI(request: Record<string, unknown>): Promise<OpenAICallResult> {
    return this.callEndpoint(RESPONSES_URL, request, "LLM_REQUEST");
  }

  private async callEndpoint(
    url: string,
    request: Record<string, unknown>,
    stage: "LLM_REQUEST" | "LLM_FIXED_TOKEN_COUNT"
  ): Promise<OpenAICallResult> {
    const attempts: LlmHttpAttempt[] = [];
    for (let attempt = 0; attempt <= 4; attempt += 1) {
      const startedAt = new Date().toISOString();
      const started = performance.now();
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(300_000)
        });
      } catch (error) {
        const retrying = attempt < 4;
        attempts.push(httpAttempt(attempt + 1, startedAt, started, null, null, retrying, errorMessage(error)));
        if (retrying) {
          await wait(backoffMs(attempt));
          continue;
        }
        throw new OpenAIRequestError("OpenAI network request failed.", attempts, null, { cause: asError(error) });
      }

      const payload = await readJsonSafely(response);
      const requestId = response.headers.get("x-request-id") || (isRecord(payload) && typeof payload.id === "string" ? payload.id : null);
      if (!response.ok || !isRecord(payload)) {
        const detail = safeErrorMessage(payload);
        const retrying = RETRYABLE_STATUS.has(response.status) && attempt < 4;
        attempts.push(httpAttempt(attempt + 1, startedAt, started, response.status, requestId, retrying, detail));
        if (retrying) {
          await wait(retryDelayMs(response, attempt));
          continue;
        }
        throw new OpenAIRequestError(
          `HTTP ${response.status}: ${detail}`,
          attempts,
          requestId,
          { cause: new PipelineError(detail, {
            stage,
            code: "LLM_HTTP_ERROR",
            provider: this.provider,
            statusCode: response.status,
            requestId,
            retryable: RETRYABLE_STATUS.has(response.status)
          }) }
        );
      }

      attempts.push(httpAttempt(attempt + 1, startedAt, started, response.status, requestId, false, null, "SUCCEEDED"));
      return { payload, requestId, attempts };
    }
    throw new OpenAIRequestError("OpenAI retry loop ended unexpectedly.", attempts, null);
  }
}

interface OpenAICallResult {
  payload: Record<string, any>;
  requestId: string | null;
  attempts: LlmHttpAttempt[];
}

class OpenAIRequestError extends Error {
  constructor(
    message: string,
    readonly attempts: LlmHttpAttempt[],
    readonly requestId: string | null,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "OpenAIRequestError";
  }
}

function createRequest(
  model: string,
  context: ClassificationContext,
  schema: Record<string, unknown>
): Record<string, unknown> {
  const prompt = buildClassifierPrompt(context);
  return {
    model,
    instructions: prompt.systemInstruction,
    input: prompt.userPrompt,
    reasoning: { effort: "low" },
    max_output_tokens: Math.min(65_536, 512 + Math.max(1, context.searchTerms.length) * 384),
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "negative_keyword_decisions",
        strict: true,
        schema
      }
    },
    store: false,
    prompt_cache_key: `negative-keyword-sweeper:${context.rules.version}`
  };
}

function extractResponseText(payload: Record<string, any>): string {
  const content = Array.isArray(payload.output)
    ? payload.output.flatMap((item: unknown) => isRecord(item) && Array.isArray(item.content) ? item.content : [])
    : [];
  const text = content
    .filter((item: unknown) => isRecord(item) && item.type === "output_text" && typeof item.text === "string")
    .map((item: Record<string, any>) => item.text)
    .join("");
  if (!text) {
    const detail = payload.error?.message || payload.incomplete_details?.reason || payload.status || "no output text";
    throw new Error(`OpenAI response had no output text (${detail}).`);
  }
  return text;
}

export function normalizeOpenAIUsage(value: unknown): LlmTokenUsage {
  const usage = isRecord(value) ? value : {};
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};
  const inputTokens = tokenNumber(usage.input_tokens);
  const outputTokens = tokenNumber(usage.output_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: tokenNumber(usage.total_tokens) || inputTokens + outputTokens,
    cachedInputTokens: tokenNumber(inputDetails.cached_tokens),
    thoughtTokens: tokenNumber(outputDetails.reasoning_tokens)
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
  const code = typeof error?.code === "string" ? error.code : "UNKNOWN";
  const message = typeof error?.message === "string" ? error.message : "No message returned";
  return `${code}: ${message}`;
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
