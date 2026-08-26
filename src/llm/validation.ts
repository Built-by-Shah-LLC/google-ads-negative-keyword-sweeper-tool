import type {
  ClassificationCandidate,
  ClassificationDecision,
  Decision,
  RuleSet
} from "../types.js";

const DECISIONS = new Set<Decision>(["KEEP", "HUMAN_REVIEW", "NEGATIVE_EXACT"]);

export function validateDecisions(
  value: unknown,
  candidates: ClassificationCandidate[],
  rules: RuleSet
): ClassificationDecision[] {
  const root = asRecord(value, "response");
  const rawDecisions = root.decisions;
  if (!Array.isArray(rawDecisions)) throw new Error("LLM response.decisions must be an array.");
  if (rawDecisions.length !== candidates.length) {
    throw new Error(`LLM returned ${rawDecisions.length} decisions for ${candidates.length} candidates.`);
  }

  const candidatesById = new Map(candidates.map((candidate) => [candidate.itemId, candidate]));
  const allowedRuleIds = new Set(rules.rules.map((rule) => rule.id));
  const seen = new Set<string>();
  const decisionsById = new Map<string, ClassificationDecision>();

  for (const [index, rawDecision] of rawDecisions.entries()) {
    const decisionObject = asRecord(rawDecision, `decisions[${index}]`);
    const itemId = requiredString(decisionObject.itemId, `decisions[${index}].itemId`);
    if (seen.has(itemId)) throw new Error(`LLM returned duplicate itemId '${itemId}'.`);
    seen.add(itemId);
    const candidate = candidatesById.get(itemId);
    if (!candidate) throw new Error(`LLM returned unknown itemId '${itemId}'.`);

    const decision = decisionObject.decision;
    if (typeof decision !== "string" || !DECISIONS.has(decision as Decision)) {
      throw new Error(`LLM returned an invalid decision for '${itemId}'.`);
    }
    const negativeText = decisionObject.negativeText;
    if (negativeText !== null && typeof negativeText !== "string") {
      throw new Error(`negativeText for '${itemId}' must be a string or null.`);
    }
    if (decision === "NEGATIVE_EXACT" && negativeText !== candidate.searchTerm) {
      throw new Error(`NEGATIVE_EXACT for '${itemId}' did not preserve the complete search term.`);
    }
    if (decision !== "NEGATIVE_EXACT" && negativeText !== null) {
      throw new Error(`${decision} for '${itemId}' must have null negativeText.`);
    }

    if (!Array.isArray(decisionObject.ruleIds) || decisionObject.ruleIds.length < 1) {
      throw new Error(`ruleIds for '${itemId}' must be a non-empty array.`);
    }
    const ruleIds = decisionObject.ruleIds.map((ruleId, ruleIndex) => {
      const parsed = requiredString(ruleId, `ruleIds[${ruleIndex}] for '${itemId}'`);
      if (!allowedRuleIds.has(parsed)) throw new Error(`LLM returned unknown rule ID '${parsed}'.`);
      return parsed;
    });
    if (new Set(ruleIds).size !== ruleIds.length) {
      throw new Error(`LLM returned duplicate rule IDs for '${itemId}'.`);
    }

    const confidence = decisionObject.confidence;
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error(`confidence for '${itemId}' must be between 0 and 1.`);
    }
    const reason = requiredString(decisionObject.reason, `reason for '${itemId}'`);
    if (reason.length > 500) throw new Error(`reason for '${itemId}' exceeds 500 characters.`);

    decisionsById.set(itemId, {
      itemId,
      decision: decision as Decision,
      negativeText,
      ruleIds,
      reason,
      confidence
    });
  }

  const missing = candidates.filter((candidate) => !seen.has(candidate.itemId));
  if (missing.length > 0) throw new Error(`LLM omitted ${missing.length} submitted item(s).`);
  return candidates.map((candidate) => decisionsById.get(candidate.itemId)!);
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string.`);
  return value;
}
