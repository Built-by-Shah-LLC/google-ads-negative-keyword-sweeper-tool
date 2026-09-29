import type { NegativeKeywordMutationSummary } from "../google-ads/negative-keyword-writer.js";
import type { ClassificationCandidate, ClassificationDecision, Decision } from "../types.js";

export type EffectiveDecisionOutcome = Decision | "PROTECTED_BY_POSITIVE_KEYWORD";
export type PositiveKeywordProtectionSource = "FINAL_MUTATION_GUARD" | "INITIAL_ACCOUNT_SNAPSHOT";

export interface EffectiveDecision extends ClassificationDecision {
  effectiveOutcome: EffectiveDecisionOutcome;
  positiveKeywordProtectionSource: PositiveKeywordProtectionSource | null;
  positiveCriterionIds: string[];
  positiveMatchTypes: string[];
}

/**
 * Keeps the LLM decision intact while adding the operational outcome used for
 * reporting. Positive-keyword protection is classification-time policy now:
 * the classifier sees the account's positive keyword inventory and is
 * instructed to KEEP exact active positives, so no post-LLM guard rewrites
 * outcomes here. The protection fields remain for report/DB contract
 * compatibility and are always empty.
 */
export function createEffectiveDecisions(
  candidates: ClassificationCandidate[],
  decisions: ClassificationDecision[],
  mutation?: NegativeKeywordMutationSummary
): EffectiveDecision[] {
  void candidates;
  void mutation;
  return decisions.map((decision) => ({
    ...decision,
    effectiveOutcome: decision.decision,
    positiveKeywordProtectionSource: null,
    positiveCriterionIds: [],
    positiveMatchTypes: []
  }));
}
