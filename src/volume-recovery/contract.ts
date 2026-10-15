// Contract v1 is mirrored in Keyword Sweeper and Built Ads Manager; no provider payload crosses this boundary.
export const VOLUME_RECOVERY_CONTRACT_VERSION = 1;
// Leaves room for PostgreSQL jsonb's added whitespace below the existing 128 KiB row constraint.
export const RECOVERY_ITEM_MAX_BYTES = 65536;
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
  // Optional for existing v1 policies. Targets apply to this action only, never an entire funnel.
  valueTargets?: Record<string, { interpretation: "revenue" | "business_value"; targetRoas: string }>;
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
  roas?: string | null;
}
export interface RecoveryAttachment {
  campaignId: string;
  campaignName: string | null;
  channel: string | null;
  status: string | null;
}
export interface RecoveryExclusionDetails {
  resourceId: string;
  listResourceId: string | null;
  listName: string | null;
  attachmentResourceIds: string[];
  campaigns: RecoveryAttachment[];
  detailsComplete: boolean;
  brandMembers: { entityId: string; name: string; status: string }[];
}
export interface RecoveryBlocker {
  resourceId: string;
  text: string;
  kind: "keyword" | "brand";
  scope: RecoveryScope;
  matchType: "EXACT" | "PHRASE" | "BROAD" | null;
  listResourceId: string | null;
  listName: string | null;
  adGroupId: string | null;
  adGroupName: string | null;
  affectedCampaignCount: number;
  certainty: "known" | "possible";
  basis: "observed_query" | "candidate_text";
  querySamples: string[];
}
export interface RecoveryPeriod {
  startDate: string;
  endDate: string;
  impressions: string | null;
  clicks: string | null;
  cost: string | null;
  conversions: string | null;
  conversionValue: string | null;
}
export interface RecoveryCampaignContext {
  collectedAt: string;
  timeZone: string;
  servingStatus: string | null;
  primaryStatus: string | null;
  primaryStatusReasons: string[];
  budget: { resourceId: string; amount: string | null; period: string; shared: boolean | null } | null;
  bidding: { strategyResourceId: string | null; type: string; status: string | null; targetCpa: string | null; targetRoas: string | null; source: "campaign" | "portfolio" } | null;
  goals: { level: string; customGoalResourceId: string | null; biddableGoals: string[]; actionResourceIds: string[] } | null;
  recent: RecoveryPeriod;
  previous: RecoveryPeriod;
  changesStartDate: string;
  changesEndDate: string;
  changes: { resourceId: string; at: string; resourceType: string; operation: string; fields: string[] }[];
  limitations: string[];
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
  exclusion?: RecoveryExclusionDetails;
  blockers?: RecoveryBlocker[];
  possibleBlockers?: number;
  detailsTruncated?: boolean;
  context?: RecoveryCampaignContext | null;
  ranking?: { basis: "qualified_events" | "value_roas" | "raw_events" | "demand"; selectedAction: string | null; valueMeaning: "revenue" | "business_value" | "unconfirmed"; targetCpa: string | null; targetRoas: string | null; targetSource: "account_policy" | "google_single_action_goal" | "unavailable"; recentEvidence: boolean; completedConversionWeeks: number; scoringVersion: 1; rounding: "half_up" };
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
  if (Object.keys(row).some(key => !["version", "categoryActions", "conversionActions", "valueTargets"].includes(key)) || row.version !== 1) throw new Error("Unsupported recovery policy.");
  const categories = recoveryRecord(row.categoryActions);
  const actions = recoveryRecord(row.conversionActions);
  if (Object.keys(categories).length > 100 || Object.keys(actions).length > 100) throw new Error("Recovery policy is too large.");
  for (const [key, action] of Object.entries(categories)) {
    if (!/^[A-Z][A-Z0-9-]{1,99}$/.test(key) || !["retain", "review", "consider"].includes(String(action))) throw new Error("Invalid recovery category.");
  }
  for (const [key, kind] of Object.entries(actions)) {
    if (key.length > 100 || !/^customers\/[0-9]+\/conversionActions\/[0-9]+$/.test(key) || !["qualified_lead", "raw_lead", "revenue", "ignore"].includes(String(kind))) throw new Error("Invalid conversion-action interpretation.");
  }
  const targets = row.valueTargets === undefined ? undefined : recoveryRecord(row.valueTargets);
  if (targets && Object.keys(targets).length > 100) throw new Error("Recovery value targets are too large.");
  const valueTargets: NonNullable<RecoveryPolicy["valueTargets"]> = {};
  for (const [key, value] of Object.entries(targets ?? {})) {
    const target = recoveryRecord(value);
    if (key.length > 100 || !/^customers\/[0-9]+\/conversionActions\/[0-9]+$/.test(key) || Object.keys(target).some(field => !["interpretation", "targetRoas"].includes(field)) || !["revenue", "business_value"].includes(String(target.interpretation)) || typeof target.targetRoas !== "string" || !/^[0-9]{1,6}(?:\.[0-9]{1,6})?$/.test(target.targetRoas) || !/[1-9]/.test(target.targetRoas)) throw new Error("Invalid action-specific value target.");
    valueTargets[key] = { interpretation: target.interpretation as "revenue" | "business_value", targetRoas: target.targetRoas };
  }
  const validated: RecoveryPolicy = {
    version: 1,
    categoryActions: {
      ...categories
    } as RecoveryPolicy["categoryActions"],
    ...(targets === undefined ? {} : { valueTargets }),
    conversionActions: {
      ...actions
    } as RecoveryPolicy["conversionActions"]
  };
  if (new TextEncoder().encode(JSON.stringify(validated)).length > 30000) throw new Error("Recovery policy exceeds its storage bound.");
  return validated;
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
  if (row.detailsTruncated !== undefined && typeof row.detailsTruncated !== "boolean") throw new Error("Invalid recovery detail coverage.");
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
  const item: RecoveryItem = {
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
    ...(row.exclusion === undefined ? {} : { exclusion: parseRecoveryExclusion(row.exclusion) }),
    ...(row.blockers === undefined ? {} : { blockers: boundedArray(row.blockers, 200).map(parseRecoveryBlocker), possibleBlockers: boundedCount(row.possibleBlockers) }),
    ...(row.detailsTruncated === undefined ? {} : { detailsTruncated: row.detailsTruncated as boolean }),
    ...(row.context === undefined ? {} : { context: row.context === null ? null : parseRecoveryContext(row.context) }),
    ...(row.ranking === undefined ? {} : { ranking: parseRecoveryRanking(row.ranking) }),
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
      cpa: decimal(metrics.cpa),
      ...(metrics.roas === undefined ? {} : { roas: decimal(metrics.roas) })
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
  const hasDetail = row.exclusion !== undefined || row.blockers !== undefined || row.context !== undefined || row.ranking !== undefined;
  // Existing v1 reports used the original database bound; new detailed items use the smaller write bound.
  if (new TextEncoder().encode(JSON.stringify(item)).length > (hasDetail ? RECOVERY_ITEM_MAX_BYTES : 131072)) throw new Error("Recovery report detail exceeds its storage bound.");
  return item;
}

// These projections deliberately never copy arbitrary provider JSON into a retained report or UI.
function boundedText(value: unknown, max = 500): string {
  if (typeof value !== "string" || value.length > max)
    throw new Error("Invalid recovery detail text.");
  return value;
}
function nullableText(value: unknown, max = 500): string | null { return value === null ? null : boundedText(value, max); }
function boundedArray(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error("Invalid recovery detail list.");
  return value;
}
function boundedCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error("Invalid recovery detail count.");
  return value as number;
}
function detailChoice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T))
    throw new Error("Invalid recovery detail classification.");
  return value as T;
}
function detailDecimal(value: unknown): string | null {
  if (value === null)
    return null;
  const text = boundedText(value, 43);
  if (!/^[0-9]{1,30}(?:\.[0-9]{1,12})?$/.test(text))
    throw new Error("Invalid recovery detail decimal.");
  return text;
}
function textList(value: unknown, max: number, length = 500): string[] { return boundedArray(value, max).map(item => boundedText(item, length)); }
function parseRecoveryExclusion(value: unknown): RecoveryExclusionDetails {
  const row = recoveryRecord(value);
  if (typeof row.detailsComplete !== "boolean")
    throw new Error("Invalid recovery attachment coverage.");
  return { resourceId: boundedText(row.resourceId), listResourceId: nullableText(row.listResourceId), listName: nullableText(row.listName), detailsComplete: row.detailsComplete,
    attachmentResourceIds: textList(row.attachmentResourceIds, 200),
    campaigns: boundedArray(row.campaigns, 200).map(value => { const c = recoveryRecord(value); return { campaignId: boundedText(c.campaignId, 100), campaignName: nullableText(c.campaignName), channel: nullableText(c.channel, 100), status: nullableText(c.status, 100) }; }),
    brandMembers: boundedArray(row.brandMembers, 100).map(value => { const b = recoveryRecord(value); return { entityId: boundedText(b.entityId), name: boundedText(b.name), status: boundedText(b.status, 100) }; }) };
}
function parseRecoveryBlocker(value: unknown): RecoveryBlocker {
  const row = recoveryRecord(value);
  return { resourceId: boundedText(row.resourceId), text: boundedText(row.text), kind: detailChoice(row.kind, ["keyword", "brand"]), scope: detailChoice(row.scope, ["campaign", "ad_group", "account", "shared_list", "brand"]), matchType: row.matchType === null ? null : detailChoice(row.matchType, ["EXACT", "PHRASE", "BROAD"] as const), listResourceId: nullableText(row.listResourceId), listName: nullableText(row.listName), adGroupId: nullableText(row.adGroupId, 100), adGroupName: nullableText(row.adGroupName), affectedCampaignCount: boundedCount(row.affectedCampaignCount), certainty: detailChoice(row.certainty, ["known", "possible"]), basis: detailChoice(row.basis, ["observed_query", "candidate_text"]), querySamples: textList(row.querySamples, 3) };
}
function parseRecoveryRanking(value: unknown): NonNullable<RecoveryItem["ranking"]> {
  const row = recoveryRecord(value);
  if (typeof row.recentEvidence !== "boolean" || row.scoringVersion !== 1 || row.rounding !== "half_up")
    throw new Error("Invalid recovery scoring inputs.");
  return { basis: detailChoice(row.basis, ["qualified_events", "value_roas", "raw_events", "demand"]), selectedAction: nullableText(row.selectedAction), valueMeaning: detailChoice(row.valueMeaning, ["revenue", "business_value", "unconfirmed"]), targetCpa: detailDecimal(row.targetCpa), targetRoas: detailDecimal(row.targetRoas), targetSource: detailChoice(row.targetSource, ["account_policy", "google_single_action_goal", "unavailable"]), recentEvidence: row.recentEvidence, completedConversionWeeks: boundedCount(row.completedConversionWeeks), scoringVersion: 1, rounding: "half_up" };
}
export function parseRecoveryContext(value: unknown): RecoveryCampaignContext {
  const row = recoveryRecord(value);
  const period = (value: unknown): RecoveryPeriod => { const p = recoveryRecord(value); return { startDate: boundedText(p.startDate, 10), endDate: boundedText(p.endDate, 10), impressions: detailDecimal(p.impressions), clicks: detailDecimal(p.clicks), cost: detailDecimal(p.cost), conversions: detailDecimal(p.conversions), conversionValue: detailDecimal(p.conversionValue) }; };
  const budget = row.budget === null ? null : recoveryRecord(row.budget);
  const bidding = row.bidding === null ? null : recoveryRecord(row.bidding);
  const goals = row.goals === null ? null : recoveryRecord(row.goals);
  if (budget && budget.shared !== null && typeof budget.shared !== "boolean")
    throw new Error("Invalid recovery budget.");
  return { collectedAt: boundedText(row.collectedAt, 40), timeZone: boundedText(row.timeZone, 100), servingStatus: nullableText(row.servingStatus, 100), primaryStatus: nullableText(row.primaryStatus, 100), primaryStatusReasons: textList(row.primaryStatusReasons, 100, 100),
    budget: budget ? { resourceId: boundedText(budget.resourceId), amount: detailDecimal(budget.amount), period: boundedText(budget.period, 100), shared: budget.shared as boolean | null } : null,
    bidding: bidding ? { strategyResourceId: nullableText(bidding.strategyResourceId), type: boundedText(bidding.type, 100), status: nullableText(bidding.status, 100), targetCpa: detailDecimal(bidding.targetCpa), targetRoas: detailDecimal(bidding.targetRoas), source: detailChoice(bidding.source, ["campaign", "portfolio"]) } : null,
    goals: goals ? { level: boundedText(goals.level, 100), customGoalResourceId: nullableText(goals.customGoalResourceId), biddableGoals: textList(goals.biddableGoals, 100, 200), actionResourceIds: textList(goals.actionResourceIds, 100) } : null,
    recent: period(row.recent), previous: period(row.previous), changesStartDate: boundedText(row.changesStartDate, 10), changesEndDate: boundedText(row.changesEndDate, 10),
    changes: boundedArray(row.changes, 20).map(value => { const c = recoveryRecord(value); return { resourceId: boundedText(c.resourceId), at: boundedText(c.at, 40), resourceType: boundedText(c.resourceType, 100), operation: boundedText(c.operation, 100), fields: textList(c.fields, 100, 200) }; }), limitations: textList(row.limitations, 30) };
}
