// Contract v1 is mirrored in Keyword Sweeper and Built Ads Manager; no provider payload crosses this boundary.
export const VOLUME_RECOVERY_CONTRACT_VERSION = 1;
export type RecoveryStatus = "pending" | "running" | "succeeded" | "partial" | "failed";
export type RecoveryAction = "retain" | "review" | "consider";
export type RecoveryRecommendation = "retain" | "manual_review" | "potential_pilot" | "insufficient_evidence";
export type RecoveryChannel = "SEARCH" | "PERFORMANCE_MAX";
export type RecoveryScope = "campaign" | "ad_group" | "account" | "shared_list" | "brand";
export type RecoveryConversionKind = "qualified_lead" | "raw_lead" | "revenue" | "ignore";
export interface RecoveryPolicy {
  version: 1;
  categoryActions: Record<string, RecoveryAction>;
  conversionActions: Record<string, RecoveryConversionKind>;
}
export const EMPTY_RECOVERY_POLICY: RecoveryPolicy = {
  version: 1,
  categoryActions: {},
  conversionActions: {}
};
export interface RecoveryCoverage {
  source: string;
  available: boolean;
  detail: string;
}
export interface RecoveryMetrics {
  impressions: string | null;
  clicks: string | null;
  cost: string | null;
  conversionEvents: string | null;
  conversionValue: string | null;
  cpa: string | null;
}
export interface RecoveryScore {
  quality: string;
  efficiency: string;
  proof: string;
  demand: string;
  recency: string;
  total: string;
  unavailable: string[];
}
export interface RecoveryItem {
  id: string;
  negativeText: string;
  kind: "keyword" | "brand";
  scope: RecoveryScope;
  matchType: "EXACT" | "PHRASE" | "BROAD" | null;
  campaignId: string | null;
  campaignName: string | null;
  channel: RecoveryChannel | null;
  adGroupName: string | null;
  affectedCampaignCount: number;
  remainingBlockers: number;
  blockerCoverageComplete: boolean;
  provenance: "legacy_unattributed";
  category: string | null;
  competitorLikelihood: "likely" | "unlikely" | "unknown";
  semanticConfidence: number | null;
  evidenceConfidence: "high" | "medium" | "low";
  valueClass: "A" | "B" | "C" | "D" | "E";
  recommendation: RecoveryRecommendation;
  explanation: string;
  metrics: RecoveryMetrics;
  score: RecoveryScore | null;
  conversionBasis: string;
  conversionActions: {
    resourceId: string;
    name: string;
    kind: RecoveryConversionKind;
    events: string | null;
    value: string | null;
  }[];
  evidenceStart: string | null;
  evidenceEnd: string | null;
  querySamples: string[];
}
export interface RecoveryRun {
  id: string;
  status: RecoveryStatus;
  stage: string;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  heartbeatAt: string | null;
  stale: boolean;
  startDate: string | null;
  endDate: string | null;
  currencyCode: string;
  readiness: "green" | "amber" | "red" | null;
  readinessReasons: string[];
  coverage: RecoveryCoverage[];
  itemCount: number;
  error: string | null;
  readOnly: true;
}
export interface RecoveryWorkspace {
  accountId: string;
  enabled: boolean;
  revision: number;
  policy: RecoveryPolicy;
  canStart: boolean;
  latestRun: RecoveryRun | null;
  history: RecoveryRun[];
}
export interface RecoveryReport {
  run: RecoveryRun;
  items: RecoveryItem[];
  nextCursor: string | null;
}
export interface SaveRecoveryInput {
  accountId: string;
  enabled: boolean;
  expectedRevision: number;
  policy: RecoveryPolicy;
  idempotencyKey: string;
}
export interface StartRecoveryInput {
  accountId: string;
  idempotencyKey: string;
  retryRunId?: string;
}
export function recoveryRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}
export function validateRecoveryPolicy(value: unknown): RecoveryPolicy {
  const row = recoveryRecord(value);
  if (Object.keys(row).some(key => !["version", "categoryActions", "conversionActions"].includes(key)) || row.version !== 1) throw new Error("Unsupported recovery policy.");
  const categories = recoveryRecord(row.categoryActions);
  const actions = recoveryRecord(row.conversionActions);
  if (Object.keys(categories).length > 100 || Object.keys(actions).length > 100) throw new Error("Recovery policy is too large.");
  for (const [key, action] of Object.entries(categories)) {
    if (!/^[A-Z][A-Z0-9-]{1,99}$/.test(key) || !["retain", "review", "consider"].includes(String(action))) throw new Error("Invalid recovery category.");
  }
  for (const [key, kind] of Object.entries(actions)) {
    if (!/^customers\/[0-9]+\/conversionActions\/[0-9]+$/.test(key) || !["qualified_lead", "raw_lead", "revenue", "ignore"].includes(String(kind))) throw new Error("Invalid conversion-action interpretation.");
  }
  return {
    version: 1,
    categoryActions: {
      ...categories
    } as RecoveryPolicy["categoryActions"],
    conversionActions: {
      ...actions
    } as RecoveryPolicy["conversionActions"]
  };
}
export function canonicalRecoveryJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalRecoveryJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalRecoveryJson((value as Record<string, unknown>)[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
export function parseRecoveryItem(value: unknown): RecoveryItem {
  const row = recoveryRecord(value);
  const text = (key: string, max: number, nullable = false): string | null => {
    const field = row[key];
    if (nullable && field === null) return null;
    if (typeof field !== "string" || field.length > max) throw new Error("Invalid recovery report text.");
    return field;
  };
  const choice = <T extends string,>(key: string, options: readonly T[], nullable = false): T | null => {
    const field = row[key];
    if (nullable && field === null) return null;
    if (!options.includes(field as T)) throw new Error("Invalid recovery report classification.");
    return field as T;
  };
  const count = (key: string): number => {
    const field = row[key];
    if (!Number.isSafeInteger(field) || field as number < 0) throw new Error("Invalid recovery count.");
    return field as number;
  };
  const metrics = recoveryRecord(row.metrics);
  const decimal = (field: unknown): string | null => {
    if (field === null) return null;
    if (typeof field !== "string" || !/^[0-9]{1,30}(?:\.[0-9]{1,12})?$/.test(field)) throw new Error("Invalid recovery decimal.");
    return field;
  };
  const score = row.score === null ? null : recoveryRecord(row.score);
  const scoreDecimal = (field: unknown): string => {
    const parsed = decimal(field);
    if (parsed === null || Number(parsed) > 100) throw new Error("Invalid recovery score.");
    return parsed;
  };
  if (score !== null && (!Array.isArray(score.unavailable) || score.unavailable.some(x => typeof x !== "string" || x.length > 100))) throw new Error("Invalid recovery score.");
  if (row.provenance !== "legacy_unattributed" || typeof row.blockerCoverageComplete !== "boolean") throw new Error("Invalid recovery provenance.");
  if (row.semanticConfidence !== null && (typeof row.semanticConfidence !== "number" || !Number.isFinite(row.semanticConfidence) || row.semanticConfidence < 0 || row.semanticConfidence > 1)) throw new Error("Invalid recovery confidence.");
  if (!Array.isArray(row.querySamples) || row.querySamples.length > 10 || row.querySamples.some(x => typeof x !== "string" || x.length > 500)) throw new Error("Invalid recovery samples.");
  if (!Array.isArray(row.conversionActions) || row.conversionActions.length > 100) throw new Error("Invalid conversion breakdown.");
  const conversionActions = row.conversionActions.map(value => {
    const action = recoveryRecord(value);
    if (typeof action.resourceId !== "string" || !/^customers\/[0-9]+\/conversionActions\/[0-9]+$/.test(action.resourceId) || typeof action.name !== "string" || action.name.length > 500 || !["qualified_lead", "raw_lead", "revenue", "ignore"].includes(String(action.kind))) throw new Error("Invalid conversion breakdown.");
    return {
      resourceId: action.resourceId,
      name: action.name,
      kind: action.kind as RecoveryConversionKind,
      events: decimal(action.events),
      value: decimal(action.value)
    };
  });
  return {
    id: text("id", 100)!,
    negativeText: text("negativeText", 500)!,
    kind: choice("kind", ["keyword", "brand"])!,
    scope: choice("scope", ["campaign", "ad_group", "account", "shared_list", "brand"])!,
    matchType: choice("matchType", ["EXACT", "PHRASE", "BROAD"], true),
    campaignId: text("campaignId", 100, true),
    campaignName: text("campaignName", 500, true),
    channel: choice("channel", ["SEARCH", "PERFORMANCE_MAX"], true),
    adGroupName: text("adGroupName", 500, true),
    affectedCampaignCount: count("affectedCampaignCount"),
    remainingBlockers: count("remainingBlockers"),
    blockerCoverageComplete: row.blockerCoverageComplete,
    provenance: "legacy_unattributed",
    category: text("category", 100, true),
    competitorLikelihood: choice("competitorLikelihood", ["likely", "unlikely", "unknown"])!,
    semanticConfidence: row.semanticConfidence as number | null,
    evidenceConfidence: choice("evidenceConfidence", ["high", "medium", "low"])!,
    valueClass: choice("valueClass", ["A", "B", "C", "D", "E"])!,
    recommendation: choice("recommendation", ["retain", "manual_review", "potential_pilot", "insufficient_evidence"])!,
    explanation: text("explanation", 1000)!,
    metrics: {
      impressions: decimal(metrics.impressions),
      clicks: decimal(metrics.clicks),
      cost: decimal(metrics.cost),
      conversionEvents: decimal(metrics.conversionEvents),
      conversionValue: decimal(metrics.conversionValue),
      cpa: decimal(metrics.cpa)
    },
    score: score === null ? null : {
      quality: scoreDecimal(score.quality),
      efficiency: scoreDecimal(score.efficiency),
      proof: scoreDecimal(score.proof),
      demand: scoreDecimal(score.demand),
      recency: scoreDecimal(score.recency),
      total: scoreDecimal(score.total),
      unavailable: score.unavailable as string[]
    },
    conversionBasis: text("conversionBasis", 500)!,
    conversionActions,
    evidenceStart: text("evidenceStart", 10, true),
    evidenceEnd: text("evidenceEnd", 10, true),
    querySamples: [...row.querySamples] as string[]
  };
}
