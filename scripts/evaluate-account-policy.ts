import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { compileAccountPolicy } from "../src/config/account-policy-compiler.js";
import { loadConfig } from "../src/config/env.js";
import { loadRuleSet, parseRuleSet } from "../src/config/rule-set.js";
import { createKeywordClassifier } from "../src/llm/classifier-factory.js";
import { buildClassifierPrompt } from "../src/llm/prompt.js";
import type { ClassificationCandidate } from "../src/types.js";

// Live comparison of base-only versus compiled 3J account policy on synthetic
// terms. Explicit live opt-in; no Google Ads client, no mutation of any kind.
if (!process.argv.includes("--live")) {
  throw new Error("Use --live to run the configured paid LLM on synthetic account-policy terms.");
}

const CUSTOMER_ID = "8500809656";
const TERMS = [
  "windshield replacement near me",
  "windshield repair",
  "frame repair near me",
  "frame straightening shop",
  "cheap windshield replacement",
  "bumper replacement",
  "replacing rocker panels",
  "window tinting near me",
  "motorcycle collision repair"
];

const { llm } = await loadConfig();
const base = await loadRuleSet(process.cwd());
// Pre-split global policy from git HEAD: the last release where every rule was
// static. This is the honest before/after comparison for the pipeline change.
const preSplitMarkdown = execSync("git show HEAD:src/config/negative-keyword-rules.md", { encoding: "utf8" });
const preSplit = {
  ...parseRuleSet(preSplitMarkdown, "git:HEAD:src/config/negative-keyword-rules.md"),
  phraseProtections: base.phraseProtections ?? []
};
const threeJ = await compileAccountPolicy(base, process.cwd(), CUSTOMER_ID);
if (!threeJ.manifest) throw new Error("3J account policy did not compile.");

const dateRange = { startDate: "2026-09-15", endDate: "2026-09-15" };
const searchTerms: ClassificationCandidate[] = TERMS.map((term, i) => ({
  itemId: `term-${i + 1}`, customerId: CUSTOMER_ID, ...dateRange, channel: "SEARCH",
  campaignId: "synthetic", campaignName: "Account policy evaluation", adGroupId: null, adGroupName: null,
  searchTerm: term, targetingStatus: null, matchedKeyword: null, matchedKeywordMatchType: null,
  impressions: 0, clicks: 0, costMicros: 0, conversions: 0, conversionValue: 0
}));

const directory = resolve("runs", `account-policy-eval-${new Date().toISOString().replaceAll(":", "-")}`);
await mkdir(directory, { recursive: true });
const classifier = createKeywordClassifier({ ...llm, maxRetries: 0 });
const account = { customerId: CUSTOMER_ID, descriptiveName: "3J Collision Center", timeZone: "UTC" };

const conditions: Array<["pre-split-global" | "3j-effective", typeof base]> = [
  ["pre-split-global", preSplit],
  ["3j-effective", threeJ.rules]
];
const decisionsByCondition = new Map<string, Map<string, { decision: string; ruleIds: string[]; reason: string }>>();

for (const [condition, rules] of conditions) {
  const context = { account, dateRange, rules, searchTerms };
  await writeFile(resolve(directory, `${condition}-prompt.json`), JSON.stringify(buildClassifierPrompt(context), null, 2));
  console.log(`Classifying ${TERMS.length} synthetic terms with condition '${condition}' (${rules.ruleIds.length} rule IDs, ${rules.phraseProtections?.length ?? 0} protections)...`);
  const result = await classifier.classify(context);
  const byId = new Map(result.validated.decisions.map((decision) => [decision.itemId, decision]));
  decisionsByCondition.set(condition, new Map(
    TERMS.map((term, i) => [term, byId.get(`term-${i + 1}`)!])
  ));
  await writeFile(resolve(directory, `${condition}-result.json`), JSON.stringify({
    condition,
    provider: classifier.provider,
    model: classifier.model,
    usage: result.validated.usage,
    decisions: result.validated.decisions,
    attempts: result.attempts,
    response: result.response
  }, null, 2));
  console.log(`Condition '${condition}' completed: ${result.validated.decisions.length} decisions validated.`);
}

const rows = TERMS.map((term) => {
  const baseDecision = decisionsByCondition.get("pre-split-global")!.get(term)!;
  const accountDecision = decisionsByCondition.get("3j-effective")!.get(term)!;
  return {
    term,
    base: { decision: baseDecision.decision, ruleIds: baseDecision.ruleIds, reason: baseDecision.reason },
    account3J: { decision: accountDecision.decision, ruleIds: accountDecision.ruleIds, reason: accountDecision.reason },
    changed: baseDecision.decision !== accountDecision.decision
  };
});
await writeFile(resolve(directory, "comparison.json"), JSON.stringify({
  provider: classifier.provider,
  model: classifier.model,
  accountPolicy: threeJ.manifest,
  rows
}, null, 2));

console.log("\n=== pre-split global policy vs 3J effective policy ===");
for (const row of rows) {
  console.log(`${row.changed ? "CHANGED" : "same   "} | ${row.term}`);
  console.log(`  pre-split: ${row.base.decision} [${row.base.ruleIds.join("; ")}] — ${row.base.reason}`);
  console.log(`  3J  : ${row.account3J.decision} [${row.account3J.ruleIds.join("; ")}] — ${row.account3J.reason}`);
}
console.log(`\nArtifacts written to ${directory}`);
