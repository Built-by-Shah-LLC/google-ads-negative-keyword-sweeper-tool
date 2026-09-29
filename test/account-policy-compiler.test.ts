import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { compileAccountPolicy, type AccountPolicyConfig } from "../src/config/account-policy-compiler.js";
import { ACCOUNT_POLICIES } from "../src/config/account-policies.js";
import { parsePhraseProtections } from "../src/config/phrase-protections.js";
import { loadRuleSet } from "../src/config/rule-set.js";
import type { PhraseProtection } from "../src/types.js";

const THREE_J = "8500809656";
const COMPLETED_ACCOUNT_IDS = [
  "8402372674", "2305040084", "9459997727", "6304919700", "1130534333",
  "8820051592", "3666014313", "7990574090", "6592667815", "8791302016",
  "7289311819", "1618289856", "3419276158", "4007102747"
];

async function threeJPolicy(): Promise<Record<string, AccountPolicyConfig>> {
  const base = await loadRuleSet(process.cwd());
  const seed = ACCOUNT_POLICIES[THREE_J]!;
  const markdown = await readFile(resolve(process.cwd(), seed.phraseProtectionsFile), "utf8");
  const phraseProtections = parsePhraseProtections(markdown, [
    ...base.ruleIds,
    ...seed.customRules.map((rule) => rule.id)
  ]);
  return {
    [THREE_J]: {
      policyKey: seed.policyKey,
      revision: seed.revision,
      customRules: seed.customRules,
      phraseProtections
    }
  };
}

function protection(overrides: Partial<PhraseProtection>): PhraseProtection {
  return {
    id: "test-entry",
    phrase: "frame repair",
    customerIds: [],
    ruleId: "POL-MECHANICAL-ONLY-NEGATIVE",
    excusedEvidence: "x",
    ...overrides
  };
}

test("base-only account returns the unchanged base bundle", async () => {
  const base = await loadRuleSet(process.cwd());
  const result = await compileAccountPolicy(base, "1234567890", {});
  assert.equal(result.manifest, null);
  assert.equal(result.accountPhraseProtections, null);
  assert.equal(result.rules, base);
});

test("3J policy compiles dynamic rules and account phrase protections", async () => {
  const base = await loadRuleSet(process.cwd());
  const policies = await threeJPolicy();
  const result = await compileAccountPolicy(base, THREE_J, policies);
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
  const again = await compileAccountPolicy(base, THREE_J, policies);
  assert.equal(again.manifest!.effectivePolicySha256, result.manifest.effectivePolicySha256);
  assert.equal(again.rules.markdown, result.rules.markdown);
});

test("all fourteen additional completed companies compile an explicit dynamic policy", async () => {
  const base = await loadRuleSet(process.cwd());
  for (const customerId of COMPLETED_ACCOUNT_IDS) {
    const seed = ACCOUNT_POLICIES[customerId];
    assert.ok(seed, `missing policy seed for ${customerId}`);
    const protections = parsePhraseProtections(
      await readFile(resolve(process.cwd(), seed.phraseProtectionsFile), "utf8"),
      [...base.ruleIds, ...seed.customRules.map((rule) => rule.id)]
    );
    const result = await compileAccountPolicy(base, customerId, {
      [customerId]: {
        policyKey: seed.policyKey,
        revision: seed.revision,
        customRules: seed.customRules,
        phraseProtections: protections
      }
    });
    assert.ok(result.manifest, `policy did not compile for ${customerId}`);
    assert.ok(result.manifest.dynamicRuleIds.includes("POL-PARTS-ONLY-NEGATIVE"));
    assert.ok(result.manifest.dynamicRuleIds.includes("POL-GLASS-TINT-NEGATIVE"));
    assert.ok(result.manifest.dynamicRuleIds.includes("POL-COSMETIC-ONLY-NEGATIVE"));
    if (customerId === "1130534333") {
      assert.equal(result.manifest.dynamicRuleIds.length, 4);
      assert.equal(result.manifest.accountPhraseProtectionCount, 3);
    } else {
      assert.equal(result.manifest.dynamicRuleIds.length, 3);
      assert.equal(result.manifest.accountPhraseProtectionCount, 0);
    }
  }
});

test("rejects a malformed customer ID", async () => {
  const base = await loadRuleSet(process.cwd());
  await assert.rejects(() => compileAccountPolicy(base, "850-080-9656", {}), /ten-digit/u);
});

test("rejects a dynamic rule colliding with a base rule ID", async () => {
  const base = await loadRuleSet(process.cwd());
  const policies: Record<string, AccountPolicyConfig> = {
    "1234567890": {
      policyKey: "bad",
      revision: "1",
      customRules: [{ id: base.ruleIds[0]!, title: "collision", instruction: "collision" }],
      phraseProtections: []
    }
  };
  await assert.rejects(() => compileAccountPolicy(base, "1234567890", policies), /collides/u);
});

test("rejects a dynamic rule ID without a decision suffix", async () => {
  const base = await loadRuleSet(process.cwd());
  const policies: Record<string, AccountPolicyConfig> = {
    "1234567890": {
      policyKey: "bad",
      revision: "1",
      customRules: [{ id: "POL-X-AMBIGUOUS", title: "t", instruction: "i" }],
      phraseProtections: []
    }
  };
  await assert.rejects(() => compileAccountPolicy(base, "1234567890", policies), /-KEEP or -NEGATIVE/u);
});

test("rejects an account protection referencing an unknown rule", async () => {
  const base = await loadRuleSet(process.cwd());
  const policies: Record<string, AccountPolicyConfig> = {
    "1234567890": {
      policyKey: "bad",
      revision: "1",
      customRules: [],
      phraseProtections: [protection({ id: "bad-entry", ruleId: "POL-DOES-NOT-EXIST-NEGATIVE" })]
    }
  };
  await assert.rejects(() => compileAccountPolicy(base, "1234567890", policies));
});

test("rejects an account protection scoped to a different account", async () => {
  const base = await loadRuleSet(process.cwd());
  const policies: Record<string, AccountPolicyConfig> = {
    "1234567890": {
      policyKey: "bad",
      revision: "1",
      customRules: [],
      phraseProtections: [protection({ id: "other-account", customerIds: ["9999999999"] })]
    }
  };
  await assert.rejects(() => compileAccountPolicy(base, "1234567890", policies), /scoped to other accounts/u);
});

test("account protections may reference dynamic negative rules of the same account", async () => {
  const base = await loadRuleSet(process.cwd());
  const policies: Record<string, AccountPolicyConfig> = {
    "1234567890": {
      policyKey: "x",
      revision: "1",
      customRules: [{ id: "POL-X-MOTORCYCLE-NEGATIVE", title: "t", instruction: "i" }],
      phraseProtections: [protection({
        id: "custom-rule-protection",
        phrase: "moped frame repair",
        ruleId: "POL-X-MOTORCYCLE-NEGATIVE"
      })]
    }
  };
  const result = await compileAccountPolicy(base, "1234567890", policies);
  assert.equal(result.manifest!.accountPhraseProtectionCount, 1);
  assert.ok(result.rules.phraseProtections!.some((entry) => entry.id === "custom-rule-protection"));
});
