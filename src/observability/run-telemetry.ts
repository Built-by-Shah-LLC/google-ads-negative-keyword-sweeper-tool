import type { LlmTokenUsage } from "../types.js";
import { serializeError, type ErrorContext, type SerializedError } from "./errors.js";
import type { Logger } from "./logger.js";

export interface TelemetryEvent {
  stage: string;
  status: "SUCCEEDED" | "FAILED" | "RETRYING" | "SKIPPED";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  organizationId?: string;
  batchId?: string;
  provider?: string;
  requestId?: string | null;
  attempt?: number;
  statusCode?: number;
  details?: Record<string, unknown>;
}

export interface TokenTotals extends LlmTokenUsage {
  generationRequests: number;
  successfulBatches: number;
  failedBatches: number;
  fixedInputTokens: number;
  organizationsCounted: number;
}

const EMPTY_TOKENS: TokenTotals = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  thoughtTokens: 0,
  generationRequests: 0,
  successfulBatches: 0,
  failedBatches: 0,
  fixedInputTokens: 0,
  organizationsCounted: 0
};

export class RunTelemetry {
  private readonly events: TelemetryEvent[] = [];
  private readonly errors: SerializedError[] = [];
  private readonly tokens: TokenTotals = { ...EMPTY_TOKENS };

  constructor(private readonly options: {
    logger?: Logger;
    onError?: (error: SerializedError) => void;
  } = {}) {}

  async track<T>(
    stage: string,
    context: Omit<ErrorContext, "stage">,
    operation: () => Promise<T>
  ): Promise<T> {
    const startedAt = new Date().toISOString();
    const start = performance.now();
    try {
      const result = await operation();
      this.event({
        stage,
        status: "SUCCEEDED",
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: elapsed(start),
        ...eventContext(context)
      });
      return result;
    } catch (error) {
      this.event({
        stage,
        status: "FAILED",
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: elapsed(start),
        ...eventContext(context)
      });
      this.error(error, { stage, ...context });
      throw error;
    }
  }

  event(event: TelemetryEvent): void {
    this.events.push(event);
    const logFields = { telemetryEvent: event };
    if (event.status === "FAILED") this.options.logger?.warn(logFields, "Pipeline stage failed");
    else if (event.status === "RETRYING") this.options.logger?.warn(logFields, "Pipeline operation will retry");
    else if (event.status === "SKIPPED") this.options.logger?.info(logFields, "Pipeline operation skipped");
    else this.options.logger?.debug(logFields, "Pipeline stage succeeded");
  }

  error(error: unknown, context: ErrorContext): SerializedError {
    const serialized = serializeError(error, context);
    this.errors.push(serialized);
    this.options.logger?.error({ pipelineError: serialized }, "Pipeline error recorded");
    this.options.onError?.(serialized);
    return serialized;
  }

  recordGeneration(usage: LlmTokenUsage): void {
    this.tokens.generationRequests += 1;
    this.tokens.inputTokens += usage.inputTokens;
    this.tokens.outputTokens += usage.outputTokens;
    this.tokens.totalTokens += usage.totalTokens;
    this.tokens.cachedInputTokens += usage.cachedInputTokens;
    this.tokens.thoughtTokens += usage.thoughtTokens;
  }

  recordBatch(success: boolean): void {
    if (success) this.tokens.successfulBatches += 1;
    else this.tokens.failedBatches += 1;
  }

  recordFixedInput(tokens: number): void {
    this.tokens.fixedInputTokens += tokens;
    this.tokens.organizationsCounted += 1;
  }

  errorsForOrganization(organizationId: string): SerializedError[] {
    return this.errors.filter((error) => error.organizationId === organizationId);
  }

  snapshot(): {
    generatedAt: string;
    tokenUsage: TokenTotals;
    events: TelemetryEvent[];
    errors: SerializedError[];
  } {
    return {
      generatedAt: new Date().toISOString(),
      tokenUsage: { ...this.tokens },
      events: [...this.events],
      errors: [...this.errors]
    };
  }
}

function elapsed(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}

function eventContext(context: Omit<ErrorContext, "stage">): Partial<TelemetryEvent> {
  const result: Partial<TelemetryEvent> = {};
  if (context.organizationId !== undefined) result.organizationId = context.organizationId;
  if (context.batchId !== undefined) result.batchId = context.batchId;
  if (context.provider !== undefined) result.provider = context.provider;
  if (context.requestId !== undefined) result.requestId = context.requestId;
  if (context.statusCode !== undefined) result.statusCode = context.statusCode;
  if (context.details !== undefined) result.details = context.details;
  return result;
}

export function emptyTokenUsage(): LlmTokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, thoughtTokens: 0 };
}

export function addTokenUsage(left: LlmTokenUsage, right: LlmTokenUsage): LlmTokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    thoughtTokens: left.thoughtTokens + right.thoughtTokens
  };
}
