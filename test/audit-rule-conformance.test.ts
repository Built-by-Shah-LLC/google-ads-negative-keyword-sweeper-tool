import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Subprocess conformance test for the rust/restoration always-win detector
// (release 2026-09-15.1, POL-WRONG-VEHICLE-NEGATIVE). The audit script runs
// main() on import and exports nothing, so it is exercised end-to-end via
// child_process against a self-cleaning fixture run directory. The fixture
// field shapes mirror real runs (e.g.
// runs/measure-akins-30day-kimi-20260915T111810721Z/organizations/8402372674/).

const CUSTOMER_ID = "1234567890";
const RUN_DIR = "runs/.tmp-audit-rust-restoration";

const NEGATIVE_TERMS = [
  "rust repair",
  "rusted quarter panel",
  "rustproofing a car",
  "car rust repair near me",
  "car restorations near me",
  "carrestoration",
  "headlight restoration",
  "carrustrepair"
] as const;

const BLOCKLIST_TERMS = ["trust auto body", "crust", "entrust", "thruster"] as const;

function candidate(itemId: string, searchTerm: string, index: number) {
  return {
    customerId: CUSTOMER_ID,
    channel: "SEARCH",
    campaignId: "1",
    campaignName: "Fixture Campaign",
    adGroupId: null,
    adGroupName: null,
    searchTerm,
    targetingStatus: "NONE",
    matchedKeyword: null,
    matchedKeywordMatchType: null,
    impressions: index + 1,
    clicks: 0,
    costMicros: 0,
    conversions: 0,
    conversionValue: 0,
    itemId,
    startDate: "2026-08-16",
    endDate: "2026-09-15"
  };
}

test("rust/restoration always-win check conforms on negative terms and ignores blocklist tokens", async (t) => {
  const base = resolve(RUN_DIR, "organizations", CUSTOMER_ID);
  await mkdir(base, { recursive: true });
  t.after(() => rm(resolve(RUN_DIR), { recursive: true, force: true }));

  const terms = [...NEGATIVE_TERMS, ...BLOCKLIST_TERMS];
  await writeFile(resolve(base, "candidates.json"), JSON.stringify({
    organization: {
      customerId: CUSTOMER_ID,
      descriptiveName: "Fixture Collision",
      timeZone: "America/New_York",
      currencyCode: "USD"
    },
    dateRange: { startDate: "2026-08-16", endDate: "2026-09-15" },
    candidates: terms.map((term, index) => candidate(`item-${String(index + 1).padStart(2, "0")}`, term, index))
  }));
  await writeFile(resolve(base, "decisions.json"), JSON.stringify({
    contractVersion: "classification-output-v2",
    readOnly: true,
    googleAdsMutationPerformed: false,
    ruleVersion: "2026-09-15.1",
    promptVersion: "collision-classifier-v7",
    provider: "kimi",
    model: "kimi-k2.6",
    tokenUsage: {
      inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0,
      thoughtTokens: 0, generationRequests: 1, fixedInputTokens: null
    },
    decisions: terms.map((term, index) => {
      const itemId = `item-${String(index + 1).padStart(2, "0")}`;
      const negative = index < NEGATIVE_TERMS.length;
      return {
        itemId,
        decision: negative ? "NEGATIVE_EXACT" : "KEEP",
        negativeText: negative ? term : null,
        ruleIds: negative ? ["POL-WRONG-VEHICLE-NEGATIVE"] : ["POL-BODYWORK-KEEP"],
        reason: negative
          ? "Rust / restoration demand is an always-win negative."
          : "Blocklist token is not rust/restoration evidence; no negative signals.",
        confidence: 0.9
      };
    })
  }));

  const outPath = resolve(RUN_DIR, "report.md");
  execFileSync(process.execPath, [
    "--import", import.meta.resolve("tsx"),
    resolve("scripts/audit-rule-conformance.ts"),
    "--account", `fixture:${CUSTOMER_ID}:${RUN_DIR}`,
    "--out", outPath
  ], { stdio: "pipe" });

  const report = await readFile(outPath, "utf8");

  // 1. The rust-restoration check is present in the token-lock conformance table.
  const row = report.match(/^\| Rust \/ restoration demand \(always-win, any wording\) \| POL-WRONG-VEHICLE-NEGATIVE \| NEGATIVE_EXACT \| (\d+) \| (\d+) \| ([^|]*)\|$/mu);
  assert.ok(row, "rust/restoration check row missing from conformance table");

  // 2. All 8 rust/restoration terms matched and all 8 are conformant, i.e.
  //    none is reported as a violation under this check. A conformant count
  //    equal to the matched count also proves no mismatch table
  //    ("#### Rust / restoration demand ... mismatched") was emitted.
  assert.equal(row![1], String(NEGATIVE_TERMS.length), "rust/restoration check should match exactly the 8 negative terms");
  assert.equal(row![2], String(NEGATIVE_TERMS.length), "all 8 negative terms should conform (no violations)");
  assert.equal(row![3]!.trim(), "100%");
  assert.ok(!report.includes("#### Rust / restoration demand"), "rust/restoration mismatch section should not exist");

  // 3. None of the 4 blocklist terms was matched by the rust/restoration
  //    check at all — the matched count above equals the negative-term count
  //    exactly, and no blocklist term may appear in any hard-lock mismatch row.
  const mismatchSection = report.split("### Hard-lock mismatches")[1] ?? "";
  for (const term of BLOCKLIST_TERMS) {
    assert.ok(!mismatchSection.split("\n").some((line) => line.startsWith("| ") && line.includes(`| ${term} |`)),
      `blocklist term "${term}" must never appear in a hard-lock mismatch row`);
  }
});
