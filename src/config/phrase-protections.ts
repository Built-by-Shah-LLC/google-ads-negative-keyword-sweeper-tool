import type { PhraseProtection } from "../types.js";

export function normalizeTerm(term: string): string {
  return (term.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).join(" ");
}

export function parsePhraseProtections(markdown: string, ruleIds: string[]): PhraseProtection[] {
  const blocks = [...markdown.matchAll(/^```json\s*\n([\s\S]*?)^```\s*$/gmu)];
  if (blocks.length !== 1) throw new Error("Phrase protections require exactly one JSON block.");
  const entries: unknown = JSON.parse(blocks[0]![1]!);
  if (!Array.isArray(entries)) throw new Error("Phrase protections must be an array.");
  const ids = new Set<string>();
  for (const entry of entries) {
    const values = entry as Record<string, unknown>;
    const forceKeep = values?.forceKeep === true;
    const expectedKeys = forceKeep
      ? "customerIds,excusedEvidence,forceKeep,id,phrase,ruleId"
      : "customerIds,excusedEvidence,id,phrase,ruleId";
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(values).sort().join() !== expectedKeys
      || typeof values.id !== "string" || !/^[a-z0-9-]{1,64}$/u.test(values.id) || ids.has(values.id)
      || typeof values.phrase !== "string" || !normalizeTerm(values.phrase) || values.phrase.length > 200
      || typeof values.ruleId !== "string" || !ruleIds.includes(values.ruleId)
      || typeof values.excusedEvidence !== "string" || !values.excusedEvidence.trim() || values.excusedEvidence.length > 500
      || !Array.isArray(values.customerIds)
      || values.customerIds.some((id: unknown) => typeof id !== "string" || !/^\d{10}$/u.test(id))
      || (forceKeep
        ? (!values.ruleId.endsWith("-KEEP") || values.customerIds.length === 0)
        : !values.ruleId.endsWith("-NEGATIVE"))) {
      throw new Error("Invalid or duplicate phrase protection entry.");
    }
    ids.add(values.id);
  }
  return entries as PhraseProtection[];
}

/** Select exceptions only. The LLM must still classify the entire unchanged query. */
export function matchingPhraseProtections(
  searchTerm: string,
  customerId: string,
  entries: PhraseProtection[] = []
): PhraseProtection[] {
  const query = ` ${normalizeTerm(searchTerm)} `;
  return entries.filter((entry) => (!entry.customerIds.length || entry.customerIds.includes(customerId))
    && query.includes(` ${normalizeTerm(entry.phrase)} `));
}

/** Explicit, account-scoped emergency KEEPs. These are never sent to the LLM. */
export function matchingForcedKeepProtections(
  searchTerm: string,
  customerId: string,
  entries: PhraseProtection[] = []
): PhraseProtection[] {
  return matchingPhraseProtections(searchTerm, customerId, entries)
    .filter((entry) => entry.forceKeep === true);
}
