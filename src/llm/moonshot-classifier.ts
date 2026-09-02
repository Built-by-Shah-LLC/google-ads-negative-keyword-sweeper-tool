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

export class MoonshotKeywordClassifier implements KeywordClassifier {
  readonly provider: string;
  readonly model: string;

  constructor(private readonly config: AppConfig["llm"]) {
    this.provider = config.provider === "kimi-code" ? "kimi-code" : "moonshot-kimi";
    this.model = config.model;
  }

  async classify(context: ClassificationContext): Promise<ClassificationResult> {
    if (context.searchTerms.length === 0) throw new Error("Cannot classify an empty search-term batch.");
    const request = createRequest(this.config, context, createResponseSchema(
      context.searchTerms.map((term) => term.itemId),
      context.rules.ruleIds
    ));
    const attempts: LlmGenerationAttempt[] = [];
    let accumulatedUsage = emptyTokenUsage();
    let lastResponse: unknown = null;
    let lastError: Error | null = null;

    for (let validationAttempt = 1; validationAttempt <= 2; validationAttempt += 1) {
      let call: MoonshotCallResult;
      try {
        call = await this.callEndpoint("/chat/completions", request, "LLM_REQUEST");
      } catch (error) {
        const requestError = error instanceof MoonshotRequestError ? error : null;
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
          `Moonshot request failed: ${errorMessage(error)}`,
          request,
          attempts,
          lastResponse,
          this.provider,
          { cause: error }
        );
      }

      lastResponse = call.payload;
      const usage = normalizeMoonshotUsage(call.payload.usage);
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
      `Moonshot returned invalid structured output twice: ${lastError?.message || "unknown error"}`,
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
    const request = createRequest(this.config, { ...context, searchTerms: [] }, createResponseSchema([], context.rules.ruleIds));
    const countRequest = { model: request.model, messages: request.messages };
    const call = await this.callEndpoint(
      "/tokenizers/estimate-token-count",
      countRequest,
      "LLM_FIXED_TOKEN_COUNT"
    );
    const data = isRecord(call.payload.data) ? call.payload.data : {};
    if (!nonNegativeNumber(data.total_tokens)) {
      throw new PipelineError("Moonshot token estimate omitted data.total_tokens.", {
        stage: "LLM_FIXED_TOKEN_COUNT",
        code: "LLM_COUNT_TOKENS_INVALID_RESPONSE",
        provider: this.provider,
        requestId: call.requestId,
        retryable: false
      });
    }
    return {
      totalTokens: data.total_tokens,
      countedAt: new Date().toISOString(),
      definition: FIXED_INPUT_DEFINITION,
      model: this.model,
      providerRequestId: call.requestId,
      attemptCount: call.attempts.length,
      retryCount: call.attempts.filter((attempt) => attempt.outcome === "RETRYING").length
    };
  }

  private async callEndpoint(
    path: string,
    request: Record<string, unknown>,
    stage: "LLM_REQUEST" | "LLM_FIXED_TOKEN_COUNT"
  ): Promise<MoonshotCallResult> {
    const attempts: LlmHttpAttempt[] = [];
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const startedAt = new Date().toISOString();
      const started = performance.now();
      let response: Response;
      try {
        response = await fetch(`${this.config.baseUrl}${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            "content-type": "application/json",
            "user-agent": "google-ads-negative-keyword-sweeper-tool/0.1.0"
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(this.config.requestTimeoutMs)
        });
      } catch (error) {
        const retrying = attempt < this.config.maxRetries;
        const timedOut = isTimeoutError(error);
        attempts.push(httpAttempt(
          attempt + 1,
          startedAt,
          started,
          null,
          null,
          retrying,
          timedOut ? `Request timed out after ${this.config.requestTimeoutMs}ms` : errorMessage(error)
        ));
        if (retrying) {
          await wait(backoffMs(attempt));
          continue;
        }
        throw new MoonshotRequestError(
          timedOut
            ? `Moonshot request timed out after ${this.config.requestTimeoutMs}ms.`
            : "Moonshot network request failed.",
          attempts,
          null,
          { cause: asError(error) }
        );
      }

      const payload = await readJsonSafely(response);
      const requestId = response.headers.get("x-request-id")
        || response.headers.get("msh-request-id")
        || (isRecord(payload) && typeof payload.id === "string" ? payload.id : null);
      if (!response.ok || !isRecord(payload)) {
        const detail = safeErrorMessage(payload);
        const retrying = RETRYABLE_STATUS.has(response.status) && attempt < this.config.maxRetries;
        attempts.push(httpAttempt(attempt + 1, startedAt, started, response.status, requestId, retrying, detail));
        if (retrying) {
          await wait(retryDelayMs(response, attempt));
          continue;
        }
        throw new MoonshotRequestError(`HTTP ${response.status}: ${detail}`, attempts, requestId, {
          cause: new PipelineError(detail, {
            stage,
            code: "LLM_HTTP_ERROR",
            provider: this.provider,
            statusCode: response.status,
            requestId,
            retryable: RETRYABLE_STATUS.has(response.status)
          })
        });
      }

      attempts.push(httpAttempt(attempt + 1, startedAt, started, response.status, requestId, false, null, "SUCCEEDED"));
      return { payload, requestId, attempts };
    }
    throw new MoonshotRequestError("Moonshot retry loop ended unexpectedly.", attempts, null);
  }
}

interface MoonshotCallResult {
  payload: Record<string, any>;
  requestId: string | null;
  attempts: LlmHttpAttempt[];
}

class MoonshotRequestError extends Error {
  constructor(
    message: string,
    readonly attempts: LlmHttpAttempt[],
    readonly requestId: string | null,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "MoonshotRequestError";
  }
}

function createRequest(
  config: AppConfig["llm"],
  context: ClassificationContext,
  schema: Record<string, unknown>
): Record<string, unknown> {
  const prompt = buildClassifierPrompt(context);
  return {
    model: config.model,
    messages: [
      { role: "system", content: prompt.systemInstruction },
      { role: "user", content: prompt.userPrompt }
    ],
    max_completion_tokens: Math.min(65_536, 512 + Math.max(1, context.searchTerms.length) * 384),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "negative_keyword_decisions",
        strict: true,
        schema
      }
    },
    ...(config.provider === "kimi-code"
      ? { reasoning_effort: "low" }
      : { thinking: { type: "disabled" } })
  };
}

function extractResponseText(payload: Record<string, any>): string {
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : null;
  if (typeof message?.content !== "string" || message.content.trim() === "") {
    const detail = (isRecord(choice) && choice.finish_reason) || "no content";
    throw new Error(`Moonshot response had no output text (${String(detail)}).`);
  }
  return message.content;
}

export function normalizeMoonshotUsage(value: unknown): LlmTokenUsage {
  const usage = isRecord(value) ? value : {};
  const inputTokens = tokenNumber(usage.prompt_tokens);
  const outputTokens = tokenNumber(usage.completion_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: tokenNumber(usage.total_tokens) || inputTokens + outputTokens,
    cachedInputTokens: tokenNumber(usage.cached_tokens),
    thoughtTokens: tokenNumber(usage.reasoning_tokens)
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
  const code = typeof error?.code === "string" ? error.code : typeof error?.type === "string" ? error.type : "UNKNOWN";
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
