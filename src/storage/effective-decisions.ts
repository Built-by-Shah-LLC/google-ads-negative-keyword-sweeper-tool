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
 * reporting. Final mutation-time conflicts are authoritative; when no final
 * guard result exists, read-only/skipped reports can still show protection
 * proven by the account snapshot fetched with the candidates.
 */
export function createEffectiveDecisions(
  candidates: ClassificationCandidate[],
  decisions: ClassificationDecision[],
  mutation?: NegativeKeywordMutationSummary
): EffectiveDecision[] {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.itemId, candidate]));
  const conflictsByItemId = new Map((mutation?.positiveKeywordConflicts ?? []).flatMap((conflict) =>
    conflict.sourceItemIds.map((itemId) => [itemId, conflict] as const)
  ));

  return decisions.map((decision) => {
    const finalConflict = conflictsByItemId.get(decision.itemId);
    if (decision.decision === "NEGATIVE_EXACT" && finalConflict) {
      return {
        ...decision,
        effectiveOutcome: "PROTECTED_BY_POSITIVE_KEYWORD",
        positiveKeywordProtectionSource: "FINAL_MUTATION_GUARD",
        positiveCriterionIds: finalConflict.positiveCriterionIds,
        positiveMatchTypes: finalConflict.positiveMatchTypes
      };
    }

    const candidate = candidatesById.get(decision.itemId);
    const finalGuardCompleted = mutation !== undefined
      && mutation.mode !== "disabled"
      && mutation.status !== "SKIPPED"
      && mutation.status !== "FAILED";
    if (
      decision.decision === "NEGATIVE_EXACT"
      && !finalGuardCompleted
      && candidate?.positiveKeywordContext?.activeSameCampaignExactMatch === true
    ) {
      return {
        ...decision,
        effectiveOutcome: "PROTECTED_BY_POSITIVE_KEYWORD",
        positiveKeywordProtectionSource: "INITIAL_ACCOUNT_SNAPSHOT",
        positiveCriterionIds: [],
        positiveMatchTypes: candidate.positiveKeywordContext.activeSameCampaignMatchTypes
      };
    }

    return {
      ...decision,
      effectiveOutcome: decision.decision,
      positiveKeywordProtectionSource: null,
      positiveCriterionIds: [],
      positiveMatchTypes: []
    };
  });
}
