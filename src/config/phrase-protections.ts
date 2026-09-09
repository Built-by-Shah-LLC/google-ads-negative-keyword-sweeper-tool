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
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).sort().join() !== "customerIds,excusedEvidence,id,phrase,ruleId"
      || typeof entry.id !== "string" || !/^[a-z0-9-]{1,64}$/u.test(entry.id) || ids.has(entry.id)
      || typeof entry.phrase !== "string" || !normalizeTerm(entry.phrase) || entry.phrase.length > 200
      || typeof entry.ruleId !== "string" || !entry.ruleId.endsWith("-NEGATIVE") || !ruleIds.includes(entry.ruleId)
      || typeof entry.excusedEvidence !== "string" || !entry.excusedEvidence.trim() || entry.excusedEvidence.length > 500
      || !Array.isArray(entry.customerIds)
      || entry.customerIds.some((id: unknown) => typeof id !== "string" || !/^\d{10}$/u.test(id))) {
      throw new Error("Invalid or duplicate phrase protection entry.");
    }
    ids.add(entry.id);
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
