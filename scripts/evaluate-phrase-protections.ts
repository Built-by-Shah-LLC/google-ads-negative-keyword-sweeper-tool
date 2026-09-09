import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { loadConfig } from "../src/config/env.js";
import { loadRuleSet, parseRuleSet } from "../src/config/rule-set.js";
import { createKeywordClassifier } from "../src/llm/classifier-factory.js";
import { buildClassifierPrompt } from "../src/llm/prompt.js";
import type { ClassificationCandidate, Decision } from "../src/types.js";

// Explicit live opt-in; only synthetic fixture terms are sent. No Google Ads client.
if (!process.argv.includes("--live")) throw new Error("Use --live to run the configured paid LLM on synthetic regression fixtures.");
const { llm } = await loadConfig();
const candidateRules = await loadRuleSet(process.cwd());
const stableRules = parseRuleSet(await readFile("src/config/stable/2026-09-04.3.md", "utf8"), "src/config/stable/2026-09-04.3.md");
const fixtureText = await readFile("test/fixtures/phrase-protection-cases.json", "utf8");
const cases = JSON.parse(fixtureText) as Array<{ term: string; expected: Decision; category: string }>;
const dateRange = { startDate: "2026-09-01", endDate: "2026-09-01" };
const searchTerms: ClassificationCandidate[] = cases.map((item, i) => ({
  itemId: `case-${i + 1}`, customerId: "1234567890", ...dateRange, channel: "SEARCH",
  campaignId: "synthetic", campaignName: "Regression fixture", adGroupId: null, adGroupName: null,
  searchTerm: item.term, targetingStatus: null, matchedKeyword: null, matchedKeywordMatchType: null,
  impressions: 0, clicks: 0, costMicros: 0, conversions: 0, conversionValue: 0
}));
const directory = resolve("runs", `phrase-protection-eval-${new Date().toISOString().replaceAll(":", "-")}`);
await mkdir(directory, { recursive: true });
const classifier = createKeywordClassifier({ ...llm, maxRetries: 0, requestTimeoutMs: llm.requestTimeoutMs });
const metadata = {
  provider: llm.provider, model: llm.model, thinking: llm.thinking, requestTimeoutMs: llm.requestTimeoutMs, releaseId: candidateRules.releaseId,
  ruleVersion: candidateRules.version, promptVersion: candidateRules.promptVersion,
  fixtureSha256: createHash("sha256").update(fixtureText).digest("hex"),
  methodology: "Two repetitions per condition, synthetic terms, same configured model and current prompt scaffold. Stable condition uses immutable stable Markdown without protections; this is not an exact replay of the historical prompt. Fixture agreement is not production accuracy. No Google Ads access or deployment."
};
await writeFile(resolve(directory, "metadata.json"), JSON.stringify(metadata, null, 2));
console.log(JSON.stringify({ directory, ...metadata }));
const summaries: unknown[] = [];
let evaluationFailed = false;
for (let repeat = 1; repeat <= 2; repeat++) {
  for (const [condition, rules] of [["candidate", candidateRules], ["stable", stableRules]] as const) {
    const context = { account: { customerId: "1234567890", descriptiveName: "Synthetic Test Shop", timeZone: "UTC" }, dateRange, rules, searchTerms };
    const prefix = `${condition}-${repeat}`;
    await writeFile(resolve(directory, `${prefix}-prompt.json`), JSON.stringify(buildClassifierPrompt(context), null, 2));
    console.log(`Starting ${prefix}`);
    try {
      const result = await classifier.classify(context);
      const byId = new Map(result.validated.decisions.map((decision) => [decision.itemId, decision]));
      const rows = cases.map((item, i) => ({ ...item, actual: byId.get(`case-${i + 1}`)!, pass: byId.get(`case-${i + 1}`)!.decision === item.expected }));
      const summary = { condition, repeat, passed: rows.filter((row) => row.pass).length, total: rows.length, usage: result.validated.usage, rows };
      await writeFile(resolve(directory, `${prefix}-result.json`), JSON.stringify({ ...summary, attempts: result.attempts, response: result.response }, null, 2));
      if (condition === "candidate" && summary.passed !== summary.total) evaluationFailed = true;
      summaries.push(summary);
      console.log(JSON.stringify({ condition, repeat, passed: summary.passed, total: summary.total }));
    } catch (error) {
      evaluationFailed = true;
      const summary = { condition, repeat, failed: true, error: error instanceof Error ? error.message : "Unknown failure" };
      summaries.push(summary);
      console.log(JSON.stringify(summary));
    }
    await writeFile(resolve(directory, "summary.json"), JSON.stringify({ ...metadata, results: summaries }, null, 2));
  }
}

if (evaluationFailed) process.exitCode = 1;
