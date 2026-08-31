export type Decision = "KEEP" | "NEGATIVE_EXACT";

export interface Organization {
  customerId: string;
  descriptiveName: string;
  timeZone: string;
  currencyCode: string;
}

export interface SearchTermRow {
  customerId: string;
  date: string;
  channel: "SEARCH" | "PERFORMANCE_MAX";
  campaignId: string;
  campaignName: string;
  adGroupId: string | null;
  adGroupName: string | null;
  searchTerm: string;
  targetingStatus: string | null;
  matchedKeyword: string | null;
  matchedKeywordMatchType: string | null;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  conversionValue: number;
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface ClassificationCandidate extends Omit<SearchTermRow, "date">, DateRange {
  itemId: string;
}

export interface ClassificationDecision {
  itemId: string;
  decision: Decision;
  negativeText: string | null;
  ruleIds: string[];
  reason: string;
  confidence: number;
}

export interface RuleSet {
  version: string;
  promptVersion: string;
  sourcePath: string;
  markdown: string;
  ruleIds: string[];
}

export interface Soul {
  version: string;
  sourcePath: string;
  markdown: string;
}

export interface LlmTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  thoughtTokens: number;
}

export interface FixedInputTokenCount {
  totalTokens: number;
  countedAt: string;
  definition: string;
  model: string;
  providerRequestId: string | null;
  attemptCount: number;
  retryCount: number;
}

export interface ValidatedBatch {
  decisions: ClassificationDecision[];
  model: string;
  providerRequestId: string | null;
  usage: LlmTokenUsage;
}
