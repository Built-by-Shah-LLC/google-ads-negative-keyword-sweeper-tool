import type { ClassificationResult, LlmGenerationAttempt } from "../llm/classifier.js";
import type { SerializedError } from "../observability/errors.js";
import type { TelemetryEvent, TokenTotals } from "../observability/run-telemetry.js";
import type {
  ClassificationCandidate,
  DateRange,
  FixedInputTokenCount,
  Organization,
  RuleSet,
  SearchTermRow,
} from "../types.js";

export interface SweepRunStart {
  runId: string;
  executionKey: string | null;
  startedAt: string;
  requestedDate: string;
  requestedDateSource: "COMMAND_LINE" | "AUTOMATIC_48_HOURS_BACK";
  processingTimeZone: string;
  rules: RuleSet;
  provider: string;
  model: string;
  campaignNameContains: string | null;
  accountSelectionMode: "all" | "allowlist" | "customer" | "limited";
  accountAllowlistEntryCount: number;
  googleFetchConcurrency: number;
  llmConcurrency: number;
  llmBatchSize: number;
  candidateLimitPerAccount: number | null;
}

export interface SweepAccountInputs {
  organization: Organization;
  dateRange: DateRange;
  startedAt: string;
  fetchedAt: string;
  rows: SearchTermRow[];
  scopedRowCount: number;
  availableCandidateCount: number;
  candidates: ClassificationCandidate[];
  batchSize: number;
  rules: RuleSet;
  provider: string;
  model: string;
  fixedInput: FixedInputTokenCount | null;
}

export interface SweepAccountSummaryRecord {
  customerId: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  completedAt: string;
  rawRowCount: number;
  candidateCount: number;
  decisionCount: number;
  failedBatchCount: number;
  keepCount: number;
  negativeExactCount: number;
  errorCount: number;
  error?: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    thoughtTokens: number;
    generationRequests: number;
    fixedInputTokens: number | null;
    fixedInputDefinition: string | null;
  };
}

export interface SweepRunFinish {
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  completedAt: string;
  organizationsDiscovered: number;
  organizationsEligible: number;
  organizationsSelected: number;
  accountSummaries: SweepAccountSummaryRecord[];
  tokenUsage: TokenTotals;
  tokenUsageReconciled: boolean;
  events: TelemetryEvent[];
  errors: SerializedError[];
  fatalError: string | null;
  reportDelivery: {
    status: "SENT" | "DISABLED" | "NOT_CONFIGURED" | "FAILED";
    messageId: string | null;
    attemptCount: number;
    sentAt: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  };
}

export interface SweepPersistence {
  startRun(input: SweepRunStart): Promise<void>;
  recordDiscovery(discovered: number, eligible: number, selected: number): Promise<void>;
  prepareAccount(input: SweepAccountInputs): Promise<void>;
  markBatchRunning(customerId: string, batchKey: string, startedAt: string): Promise<void>;
  recordBatchSuccess(
    customerId: string,
    batchKey: string,
    result: ClassificationResult,
    decidedAt: string,
  ): Promise<void>;
  recordBatchFailure(
    customerId: string,
    batchKey: string,
    request: Record<string, unknown> | null,
    attempts: LlmGenerationAttempt[],
    lastResponse: unknown,
    error: SerializedError,
    completedAt: string,
  ): Promise<void>;
  finishAccount(summary: SweepAccountSummaryRecord): Promise<void>;
  finishRun(input: SweepRunFinish): Promise<void>;
  close(): Promise<void>;
}

export class DisabledSweepPersistence implements SweepPersistence {
  async startRun(): Promise<void> {}
  async recordDiscovery(): Promise<void> {}
  async prepareAccount(): Promise<void> {}
  async markBatchRunning(): Promise<void> {}
  async recordBatchSuccess(): Promise<void> {}
  async recordBatchFailure(): Promise<void> {}
  async finishAccount(): Promise<void> {}
  async finishRun(): Promise<void> {}
  async close(): Promise<void> {}
}
