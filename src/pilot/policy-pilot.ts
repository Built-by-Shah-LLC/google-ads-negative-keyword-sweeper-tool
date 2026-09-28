import { createHash } from "node:crypto";

export type PilotDeltaClassification = "expected" | "defect" | "policy_clarification" | "model_concern";
export interface PilotDecisionEvidence { itemId: string; customerId: string; searchTerm: string; campaignId: string; decision: string; reason: string; ruleIds: string[]; policyHash: string; }
export interface PilotAccountDeclaration { customerId: string; policyRevision: string; expectedOutcomes: string[]; baselinePolicyHash: string; effectivePolicyHash: string; baselineAccountRunId: string; policyAccountRunId: string; mutationMode: "disabled"; candidateLimit: number; persistenceVerified: boolean; artifactsVerified: boolean; tokenUsageReconciled: boolean; }
export interface PilotRunDeclaration { pilotId: string; phase: "baseline" | "policy"; requestedDate: string; customerId: string; candidateLimit: number; mutationMode: "disabled"; approver: string; policyRevision: string; effectivePolicyHash: string; }
export interface PilotDeltaReview { deltaId: string; classification: PilotDeltaClassification; note: string; }
export interface PilotDelta { deltaId: string; customerId: string; itemId: string; searchTerm: string; campaignId: string; before: Pick<PilotDecisionEvidence, "decision" | "reason" | "ruleIds"> | null; after: Pick<PilotDecisionEvidence, "decision" | "reason" | "ruleIds"> | null; review: PilotDeltaReview | null; }
export interface PolicyPilotReview { customerId: string; policyRevision: string; baselineAccountRunId: string; policyAccountRunId: string; baselineCount: number; policyCount: number; deltas: PilotDelta[]; unreviewedDeltaCount: number; stopReasons: string[]; recommendation: "go" | "no_go" | "review_required"; }

function cleanCustomerId(value: string): string {
  const cleaned = value.replaceAll("-", "");
  if (!/^\d{10}$/u.test(cleaned)) throw new Error(`Pilot customer ID '${value}' is not canonical.`);
  return cleaned;
}
function deltaId(customerId: string, itemId: string): string { return createHash("sha256").update(`${customerId}\u0000${itemId}`).digest("hex").slice(0, 24); }
function decisionShape(decision: PilotDecisionEvidence) { return { decision: decision.decision, reason: decision.reason, ruleIds: [...decision.ruleIds].sort() }; }

export function reviewPolicyPilot(input: { declaration: PilotAccountDeclaration; baseline: readonly PilotDecisionEvidence[]; policy: readonly PilotDecisionEvidence[]; reviews: readonly PilotDeltaReview[]; }): PolicyPilotReview {
  const customerId = cleanCustomerId(input.declaration.customerId);
  if (input.declaration.mutationMode !== "disabled") throw new Error("Pilot review refuses evidence that did not declare mutation mode disabled.");
  if (!Number.isSafeInteger(input.declaration.candidateLimit) || input.declaration.candidateLimit < 1) throw new Error("Pilot candidate limit must be a positive integer.");
  if (!input.declaration.policyRevision.trim() || !input.declaration.baselineAccountRunId.trim() || !input.declaration.policyAccountRunId.trim()) throw new Error("Pilot revision and both durable account-run IDs are required.");
  if (!/^[0-9a-f]{64}$/u.test(input.declaration.baselinePolicyHash) || !/^[0-9a-f]{64}$/u.test(input.declaration.effectivePolicyHash)) throw new Error("Pilot policy hashes must be lowercase SHA-256 values.");
  if (input.declaration.expectedOutcomes.length === 0 || input.declaration.expectedOutcomes.some((outcome) => !outcome.trim())) throw new Error("Pilot expected outcomes must be declared before review.");
  const classifications = new Set<PilotDeltaClassification>(["expected", "defect", "policy_clarification", "model_concern"]);
  const reviewIds = new Set<string>();
  for (const review of input.reviews) {
    if (!/^[0-9a-f]{24}$/u.test(review.deltaId) || !classifications.has(review.classification) || !review.note.trim()) throw new Error("Every pilot delta review needs a valid delta ID, classification, and note.");
    if (reviewIds.has(review.deltaId)) throw new Error(`Pilot delta '${review.deltaId}' was reviewed more than once.`);
    reviewIds.add(review.deltaId);
  }
  const stopReasons: string[] = [];
  if (!input.declaration.persistenceVerified) stopReasons.push("Durable database persistence has not been verified for both runs.");
  if (!input.declaration.artifactsVerified) stopReasons.push("Required pilot artifacts have not been verified for both runs.");
  if (!input.declaration.tokenUsageReconciled) stopReasons.push("Pilot token usage has not reconciled.");
  const combined = [...input.baseline, ...input.policy];
  if (combined.some((decision) => cleanCustomerId(decision.customerId) !== customerId)) stopReasons.push("Cross-account decision content was detected.");
  if (input.baseline.some((decision) => decision.policyHash !== input.declaration.baselinePolicyHash)) stopReasons.push("Baseline evidence contains an unexpected policy hash.");
  if (input.policy.some((decision) => decision.policyHash !== input.declaration.effectivePolicyHash)) stopReasons.push("Policy evidence contains an unexpected effective-policy hash.");
  if (input.baseline.length > input.declaration.candidateLimit || input.policy.length > input.declaration.candidateLimit) stopReasons.push("Observed decision count exceeds the declared bounded candidate limit.");
  if (input.baseline.length !== input.policy.length) stopReasons.push("Baseline and policy decision counts differ for the fixed candidate set.");
  if (new Set(input.baseline.map((decision) => decision.itemId)).size !== input.baseline.length || new Set(input.policy.map((decision) => decision.itemId)).size !== input.policy.length) stopReasons.push("Duplicate decision item IDs were detected.");
  const reviews = new Map(input.reviews.map((review) => [review.deltaId, review]));
  const baseline = new Map(input.baseline.map((decision) => [decision.itemId, decision]));
  const policy = new Map(input.policy.map((decision) => [decision.itemId, decision]));
  const deltas: PilotDelta[] = [];
  for (const itemId of [...new Set([...baseline.keys(), ...policy.keys()])].sort()) {
    const before = baseline.get(itemId) ?? null;
    const after = policy.get(itemId) ?? null;
    if (before !== null && after !== null && JSON.stringify(decisionShape(before)) === JSON.stringify(decisionShape(after))) continue;
    const id = deltaId(customerId, itemId);
    deltas.push({ deltaId: id, customerId, itemId, searchTerm: after?.searchTerm ?? before?.searchTerm ?? "", campaignId: after?.campaignId ?? before?.campaignId ?? "", before: before === null ? null : decisionShape(before), after: after === null ? null : decisionShape(after), review: reviews.get(id) ?? null });
  }
  const unreviewedDeltaCount = deltas.filter((delta) => delta.review === null).length;
  if (input.reviews.some((review) => !deltas.some((delta) => delta.deltaId === review.deltaId))) stopReasons.push("A review references a delta that is not present in this comparison.");
  const concerning = deltas.some((delta) => delta.review?.classification === "defect" || delta.review?.classification === "model_concern");
  return { customerId, policyRevision: input.declaration.policyRevision, baselineAccountRunId: input.declaration.baselineAccountRunId, policyAccountRunId: input.declaration.policyAccountRunId, baselineCount: input.baseline.length, policyCount: input.policy.length, deltas, unreviewedDeltaCount, stopReasons, recommendation: stopReasons.length > 0 || concerning ? "no_go" : unreviewedDeltaCount > 0 ? "review_required" : "go" };
}
