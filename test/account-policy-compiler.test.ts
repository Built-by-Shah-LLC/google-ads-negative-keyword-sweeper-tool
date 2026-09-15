import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileAccountPolicy } from "../src/config/account-policy-compiler.js";
import type { AccountPolicyConfig } from "../src/config/account-policies.js";
import { loadRuleSet } from "../src/config/rule-set.js";

const THREE_J = "8500809656";

function protectionsMarkdown(entries: unknown[]): string {
  return `# test protections\n\n\`\`\`json\n${JSON.stringify(entries, null, 2)}\n\`\`\`\n`;
}

async function tempRoot(markdown: string): Promise<{ root: string; file: string }> {
  const root = await mkdtemp(join(tmpdir(), "account-policy-"));
  await mkdir(join(root, "accounts"), { recursive: true });
  await writeFile(join(root, "accounts", "protections.md"), markdown, "utf8");
  return { root, file: "accounts/protections.md" };
}

test("base-only account returns the unchanged base bundle", async () => {
  const base = await loadRuleSet(process.cwd());
  const result = await compileAccountPolicy(base, process.cwd(), "1234567890");
  assert.equal(result.manifest, null);
  assert.equal(result.accountPhraseProtectionsMarkdown, null);
  assert.equal(result.rules, base);
});

test("3J policy compiles dynamic rules and account phrase protections", async () => {
  const base = await loadRuleSet(process.cwd());
  const result = await compileAccountPolicy(base, process.cwd(), THREE_J);
  assert.ok(result.manifest);
  assert.equal(result.manifest.policyKey, "3j-collision-center");
  assert.deepEqual(result.manifest.dynamicRuleIds, [
    "POL-PARTS-ONLY-NEGATIVE",
    "POL-GLASS-TINT-NEGATIVE",
    "POL-COSMETIC-ONLY-NEGATIVE",
    "POL-3J-WINDSHIELD-KEEP",
    "POL-3J-FRAME-REPAIR-KEEP",
    "POL-3J-MOTORCYCLE-NEGATIVE"
  ]);
  // The moved rules must no longer be in the static base, only in the effective bundle.
  assert.ok(!base.ruleIds.includes("POL-PARTS-ONLY-NEGATIVE"));
  assert.ok(!base.ruleIds.includes("POL-GLASS-TINT-NEGATIVE"));
  assert.ok(!base.ruleIds.includes("POL-COSMETIC-ONLY-NEGATIVE"));
  for (const id of result.manifest.dynamicRuleIds) {
    assert.ok(result.rules.ruleIds.includes(id), `${id} must be in the effective rule IDs`);
  }
  // Base rules and base protections are preserved.
  for (const id of base.ruleIds) assert.ok(result.rules.ruleIds.includes(id));
  assert.equal(
    result.rules.phraseProtections!.length,
    (base.phraseProtections ?? []).length + result.manifest.accountPhraseProtectionCount
  );
  assert.ok(result.manifest.accountPhraseProtectionCount > 0);
  assert.match(result.manifest.effectivePolicySha256, /^[0-9a-f]{64}$/u);
  // The effective markdown contains the account section and the version preamble.
  assert.match(result.rules.markdown, /Account-specific rules \(policy: 3j-collision-center/u);
  assert.match(result.rules.markdown, /Rule set version:/u);
  // The moved rule bodies are preserved verbatim in the effective bundle.
  assert.match(result.rules.markdown, /car upholstery repair near me/iu);
  assert.match(result.rules.markdown, /fill holes in car body/iu);
  assert.match(result.rules.markdown, /Safelite/iu);
  // Deterministic: compiling again yields the same hash.
  const again = await compileAccountPolicy(base, process.cwd(), THREE_J);
  assert.equal(again.manifest!.effectivePolicySha256, result.manifest.effectivePolicySha256);
  assert.equal(again.rules.markdown, result.rules.markdown);
});

test("rejects a malformed customer ID", async () => {
  const base = await loadRuleSet(process.cwd());
  await assert.rejects(() => compileAccountPolicy(base, process.cwd(), "850-080-9656"), /ten-digit/u);
});

test("rejects a dynamic rule colliding with a base rule ID", async () => {
  const base = await loadRuleSet(process.cwd());
  const { root, file } = await tempRoot(protectionsMarkdown([]));
  const policies: Record<string, AccountPolicyConfig> = {
    "1234567890": {
      policyKey: "bad",
      revision: "1",
      customRules: [{ id: base.ruleIds[0]!, title: "collision", instruction: "collision" }],
      phraseProtectionsFile: file
    }
  };
  await assert.rejects(() => compileAccountPolicy(base, root, "1234567890", policies), /collides/u);
});

test("rejects a dynamic rule ID without a decision suffix", async () => {
  const base = await loadRuleSet(process.cwd());
  const { root, file } = await tempRoot(protectionsMarkdown([]));
  const policies: Record<string, AccountPolicyConfig> = {
    "1234567890": {
      policyKey: "bad",
      revision: "1",
      customRules: [{ id: "POL-X-AMBIGUOUS", title: "t", instruction: "i" }],
      phraseProtectionsFile: file
    }
  };
  await assert.rejects(() => compileAccountPolicy(base, root, "1234567890", policies), /-KEEP or -NEGATIVE/u);
});

test("rejects an account protection referencing an unknown rule", async () => {
  const base = await loadRuleSet(process.cwd());
  const { root, file } = await tempRoot(protectionsMarkdown([{
    id: "bad-entry",
    phrase: "frame repair",
    customerIds: ["1234567890"],
    ruleId: "POL-DOES-NOT-EXIST-NEGATIVE",
    excusedEvidence: "x"
  }]));
  const policies: Record<string, AccountPolicyConfig> = {
    "1234567890": { policyKey: "bad", revision: "1", customRules: [], phraseProtectionsFile: file }
  };
  await assert.rejects(() => compileAccountPolicy(base, root, "1234567890", policies));
});

test("rejects an account protection scoped to a different account", async () => {
  const base = await loadRuleSet(process.cwd());
  const { root, file } = await tempRoot(protectionsMarkdown([{
    id: "other-account",
    phrase: "frame repair",
    customerIds: ["9999999999"],
    ruleId: "POL-MECHANICAL-ONLY-NEGATIVE",
    excusedEvidence: "x"
  }]));
  const policies: Record<string, AccountPolicyConfig> = {
    "1234567890": { policyKey: "bad", revision: "1", customRules: [], phraseProtectionsFile: file }
  };
  await assert.rejects(() => compileAccountPolicy(base, root, "1234567890", policies), /scoped to other accounts/u);
});

test("account protections may reference dynamic negative rules of the same account", async () => {
  const base = await loadRuleSet(process.cwd());
  const { root, file } = await tempRoot(protectionsMarkdown([{
    id: "custom-rule-protection",
    phrase: "moped frame repair",
    customerIds: [],
    ruleId: "POL-X-MOTORCYCLE-NEGATIVE",
    excusedEvidence: "x"
  }]));
  const policies: Record<string, AccountPolicyConfig> = {
    "1234567890": {
      policyKey: "x",
      revision: "1",
      customRules: [{ id: "POL-X-MOTORCYCLE-NEGATIVE", title: "t", instruction: "i" }],
      phraseProtectionsFile: file
    }
  };
  const result = await compileAccountPolicy(base, root, "1234567890", policies);
  assert.equal(result.manifest!.accountPhraseProtectionCount, 1);
  assert.ok(result.rules.phraseProtections!.some((entry) => entry.id === "custom-rule-protection"));
});
