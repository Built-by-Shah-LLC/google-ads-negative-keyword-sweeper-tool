export interface ErrorContext {
  stage: string;
  code?: string;
  retryable?: boolean;
  provider?: string;
  statusCode?: number;
  requestId?: string | null;
  organizationId?: string;
  batchId?: string;
  details?: Record<string, unknown>;
}

export interface SerializedError extends ErrorContext {
  name: string;
  message: string;
  occurredAt: string;
  stack?: string;
  cause?: SerializedError;
}

export class PipelineError extends Error {
  readonly context: ErrorContext;

  constructor(message: string, context: ErrorContext, options?: ErrorOptions) {
    super(message, options);
    this.name = "PipelineError";
    this.context = context;
  }
}

export function serializeError(error: unknown, fallback: ErrorContext): SerializedError {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const ownContext = error instanceof PipelineError ? error.context : {};
  const merged: ErrorContext = { ...fallback, ...ownContext };
  const result: SerializedError = {
    name: normalized.name,
    message: normalized.message,
    occurredAt: new Date().toISOString(),
    stage: merged.stage
  };
  if (merged.code !== undefined) result.code = merged.code;
  if (merged.retryable !== undefined) result.retryable = merged.retryable;
  if (merged.provider !== undefined) result.provider = merged.provider;
  if (merged.statusCode !== undefined) result.statusCode = merged.statusCode;
  if (merged.requestId !== undefined) result.requestId = merged.requestId;
  if (merged.organizationId !== undefined) result.organizationId = merged.organizationId;
  if (merged.batchId !== undefined) result.batchId = merged.batchId;
  if (merged.details !== undefined) result.details = merged.details;
  if (normalized.stack) result.stack = normalized.stack;
  if (normalized.cause !== undefined) {
    result.cause = serializeError(normalized.cause, { stage: merged.stage });
  }
  return result;
}
