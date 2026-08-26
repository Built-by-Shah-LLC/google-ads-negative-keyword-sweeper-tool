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

export interface ClassificationCandidate extends SearchTermRow {
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

export interface Rule {
  id: string;
  title: string;
  instruction: string;
  examples: string[];
}

export interface RuleSet {
  version: string;
  policy: string;
  rules: Rule[];
}

export interface ValidatedBatch {
  decisions: ClassificationDecision[];
  model: string;
  providerRequestId: string | null;
  usage: Record<string, unknown> | null;
}
