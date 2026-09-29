import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildClassifierPrompt } from "../src/llm/prompt.js";

/**
 * Renders the exact LLM prompt (system instruction + user prompt) for a
 * persisted batch input artifact from a previous run.
 *
 * Usage:
 *   npx tsx scripts/render-llm-prompt-from-run.ts <batch-input.json> [output.md]
 */

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: npx tsx scripts/render-llm-prompt-from-run.ts <batch-input.json> [output.md]");
  process.exit(1);
}

const batch = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
const { systemInstruction, userPrompt } = buildClassifierPrompt({
  account: batch.account,
  dateRange: batch.dateRange,
  rules: batch.rules,
  searchTerms: batch.searchTerms,
  positiveKeywords: batch.positiveKeywords
});

const outputPath = resolve(
  process.argv[3] ?? inputPath.replace(/\.json$/u, ".prompt.md")
);
writeFileSync(
  outputPath,
  [
    `# Rendered LLM prompt`,
    ``,
    `- Source batch input: ${inputPath}`,
    `- Provider/model: ${batch.provider} / ${batch.model}`,
    `- Rule version: ${batch.ruleVersion} | Prompt version: ${batch.promptVersion}`,
    `- Candidates in batch: ${batch.searchTerms.length} | Positive keywords: ${batch.positiveKeywords?.length ?? 0}`,
    ``,
    `========================================`,
    `SYSTEM INSTRUCTION`,
    `========================================`,
    ``,
    systemInstruction,
    ``,
    `========================================`,
    `USER PROMPT`,
    `========================================`,
    ``,
    userPrompt,
    ``
  ].join("\n"),
  "utf8"
);
console.log(`Wrote ${outputPath} (${systemInstruction.length + userPrompt.length} chars total)`);
