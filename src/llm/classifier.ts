import type {
  ClassificationCandidate,
  FixedInputTokenCount,
  LlmTokenUsage,
  RuleSet,
  ValidatedBatch
} from "../types.js";
import { PipelineError } from "../observability/errors.js";

export interface ClassificationContext {
  account: {
    customerId: string;
    descriptiveName: string;
    timeZone: string;
  };
  date: string;
  rules: RuleSet;
  searchTerms: ClassificationCandidate[];
}

export interface ClassificationResult {
  validated: ValidatedBatch;
  request: Record<string, unknown>;
  response: unknown;
  attempts: LlmGenerationAttempt[];
}

export interface LlmHttpAttempt {
  attempt: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  statusCode: number | null;
  requestId: string | null;
  outcome: "SUCCEEDED" | "RETRYING" | "FAILED";
  error: string | null;
}

export interface LlmGenerationAttempt {
  attempt: number;
  outcome: "VALIDATED" | "VALIDATION_FAILED" | "REQUEST_FAILED";
  providerRequestId: string | null;
  usage: LlmTokenUsage;
  validationError: string | null;
  httpAttempts: LlmHttpAttempt[];
  rawResponse: unknown;
}

export class ClassificationFailure extends PipelineError {
  constructor(
    message: string,
    readonly request: Record<string, unknown>,
    readonly attempts: LlmGenerationAttempt[],
    readonly lastResponse: unknown,
    options?: ErrorOptions
  ) {
    super(message, { stage: "LLM_CLASSIFICATION", code: "LLM_CLASSIFICATION_FAILED", provider: "google-gemini" }, options);
    this.name = "ClassificationFailure";
  }
}

export interface KeywordClassifier {
  readonly provider: string;
  readonly model: string;
  classify(context: ClassificationContext): Promise<ClassificationResult>;
  countFixedInputTokens(context: Omit<ClassificationContext, "searchTerms">): Promise<FixedInputTokenCount>;
}
