import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config/env.js";
import { loadPolicyFromDatabase } from "../src/config/db-policy.js";
import { compileAccountPolicy } from "../src/config/account-policy-compiler.js";
import { createKeywordClassifier } from "../src/llm/classifier-factory.js";
import type { ClassificationCandidate, ClassificationDecision, PositiveKeywordCriterion } from "../src/types.js";

/**
 * Live LLM smoke test for D-059 policy protection (phrase protections +
 * positive keyword inventory). Loads the REAL policy from the database and
 * the REAL 3J positive-keyword snapshot, classifies hand-crafted terms with
 * known correct outcomes through the configured provider (Moonshot Kimi),
 * and reports PASS/FAIL per case.
 *
 * No Google Ads API calls, no mutations, no emails. Read-only DB access.
 *
 *   npx tsx scripts/verify-policy-protection.ts
 */

const CUSTOMER_ID = "8500809656";
const ACCOUNT_NAME = "3J Collision Center";
const POSITIVES_SNAPSHOT =
  "runs/20260918T141254279Z-98557b07/organizations/8500809656/positive-keywords.json";

interface TestCase {
  term: string;
  expected: ClassificationDecision["decision"];
  exercises: string;
}

const CASES: TestCase[] = [
  {
    term: "collision repair",
    expected: "KEEP",
    exercises: "Exact match with ACTIVE positive keyword -> must KEEP (strongest protection)"
  },
  {
    term: "collision repair jobs hiring",
    expected: "NEGATIVE_EXACT",
    exercises: "Longer query containing an ACTIVE keyword + independent employment evidence -> keyword must NOT protect"
  },
  {
    term: "frame repair near me",
    expected: "KEEP",
    exercises: "3J phrase protection: frame repair excuses mechanical/parts evidence -> KEEP"
  },
  {
    term: "frame repair oil change",
    expected: "NEGATIVE_EXACT",
    exercises: "Protected phrase BUT independent mechanical evidence (oil change) outside the phrase -> still negative"
  },
  {
    term: "windshield replacement near me",
    expected: "KEEP",
    exercises: "3J phrase protection: windshield replacement excuses glass/parts evidence -> KEEP"
  },
  {
    term: "pizza delivery near me",
    expected: "NEGATIVE_EXACT",
    exercises: "Control: irrelevant term, no protection applies -> negative"
  }
];

async function main(): Promise<void> {
  const root = process.cwd();
  const config = await loadConfig(root);
  if (!config.persistence.enabled) throw new Error("PERSIST_RUNS_TO_DATABASE must be true.");
  console.log(`Provider: ${config.llm.provider} | Model: ${config.llm.model}`);

  // Real policy from the database (static + 3J account rules + protections).
  const policy = await loadPolicyFromDatabase(config.persistence);
  const accountPolicy = await compileAccountPolicy(policy.rules, CUSTOMER_ID, policy.accountPolicies);
  console.log(
    `Policy: ${policy.rules.version} | protections: base ${(policy.rules.phraseProtections ?? []).length} + 3J ${(accountPolicy.accountPhraseProtections ?? []).length}`
  );

  // Real positive-keyword inventory (snapshot from the verified E2E run).
  const snapshot = JSON.parse(await readFile(resolve(root, POSITIVES_SNAPSHOT), "utf8"));
  const positiveKeywords = snapshot.criteria as PositiveKeywordCriterion[];
  console.log(`Positive keywords: ${positiveKeywords.length} (${positiveKeywords.filter((k) => k.active).length} ACTIVE)`);

  const dateRange = { startDate: "2026-09-01", endDate: "2026-09-17" };
  const searchTerms: ClassificationCandidate[] = CASES.map((item, index) => ({
    itemId: `case-${index + 1}`,
    customerId: CUSTOMER_ID,
    ...dateRange,
    channel: "SEARCH",
    campaignId: "synthetic",
    campaignName: "Policy protection smoke test",
    adGroupId: null,
    adGroupName: null,
    searchTerm: item.term,
    targetingStatus: null,
    matchedKeyword: null,
    matchedKeywordMatchType: null,
    impressions: 0,
    clicks: 0,
    costMicros: 0,
    conversions: 0,
    conversionValue: 0
  }));

  const directory = resolve(root, "runs", `policy-verify-${new Date().toISOString().replaceAll(":", "-")}`);
  await mkdir(directory, { recursive: true });

  const classifier = createKeywordClassifier({ ...config.llm, maxRetries: 1 });
  const context = {
    account: { customerId: CUSTOMER_ID, descriptiveName: ACCOUNT_NAME, timeZone: "America/New_York" },
    dateRange,
    rules: accountPolicy.rules,
    searchTerms,
    positiveKeywords
  };

  console.log(`\nClassifying ${CASES.length} test terms...`);
  const result = await classifier.classify(context);
  await writeFile(resolve(directory, "response.json"), JSON.stringify(result.response, null, 2));

  const byId = new Map(result.validated.decisions.map((decision) => [decision.itemId, decision]));
  let failures = 0;
  const rows = CASES.map((item, index) => {
    const actual = byId.get(`case-${index + 1}`);
    const pass = actual?.decision === item.expected;
    if (!pass) failures += 1;
    return {
      term: item.term,
      exercises: item.exercises,
      expected: item.expected,
      actual: actual?.decision ?? "MISSING",
      pass,
      reason: actual?.reason ?? null,
      citedRules: actual?.ruleIds ?? null
    };
  });

  console.log("\n================ RESULTS ================");
  for (const row of rows) {
    console.log(`${row.pass ? "PASS" : "FAIL"}  "${row.term}"`);
    console.log(`      expected ${row.expected} | got ${row.actual}`);
    console.log(`      test: ${row.exercises}`);
    if (row.reason) console.log(`      llm reason: ${row.reason}`);
  }
  console.log("=========================================");
  console.log(`${rows.length - failures}/${rows.length} passed`);

  await writeFile(
    resolve(directory, "summary.json"),
    JSON.stringify(
      {
        provider: config.llm.provider,
        model: config.llm.model,
        ruleVersion: policy.rules.version,
        promptVersion: policy.rules.promptVersion,
        positiveKeywordCount: positiveKeywords.length,
        passed: rows.length - failures,
        total: rows.length,
        usage: result.validated.usage,
        rows
      },
      null,
      2
    )
  );
  console.log(`Artifacts: ${directory}`);

  if (failures > 0) process.exit(1);
}

await main();
