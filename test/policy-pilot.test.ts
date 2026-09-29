import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewPolicyPilot, type PilotDecisionEvidence } from "../src/pilot/policy-pilot.js";

const baseline: PilotDecisionEvidence = { itemId: "item-1", customerId: "1234567890", searchTerm: "windshield repair", campaignId: "campaign-1", decision: "negative_exact", reason: "Glass only", ruleIds: ["POL-GLASS-TINT-NEGATIVE"], policyHash: "a".repeat(64) };
const policy: PilotDecisionEvidence = { ...baseline, decision: "keep", reason: "Approved windshield service", ruleIds: ["POL-APPROVED-WINDSHIELD-KEEP"], policyHash: "b".repeat(64) };

describe("policy pilot review", () => {
  it("requires review for every changed decision and stops on cross-account leakage", () => {
    const declaration = { customerId: "1234567890", policyRevision: "4", expectedOutcomes: ["windshield repair becomes KEEP"], baselinePolicyHash: "a".repeat(64), effectivePolicyHash: "b".repeat(64), baselineAccountRunId: "baseline-run", policyAccountRunId: "policy-run", mutationMode: "disabled" as const, candidateLimit: 10, persistenceVerified: true, artifactsVerified: true, tokenUsageReconciled: true };
    const pending = reviewPolicyPilot({ declaration, baseline: [baseline], policy: [policy], reviews: [] });
    assert.equal(pending.recommendation, "review_required");
    assert.equal(pending.unreviewedDeltaCount, 1);
    const leaked = reviewPolicyPilot({ declaration, baseline: [baseline], policy: [{ ...policy, customerId: "0987654321" }], reviews: [] });
    assert.equal(leaked.recommendation, "no_go");
    assert.ok(leaked.stopReasons.includes("Cross-account decision content was detected."));
  });
});
