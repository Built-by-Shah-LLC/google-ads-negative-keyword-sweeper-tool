import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccountPolicies,
  mapPhraseProtectionRow,
  ruleSetFromStaticRow,
  type AccountRuleRow,
  type PhraseProtectionRow
} from "../src/config/db-policy.js";

const STATIC_MARKDOWN = [
  "# Rules",
  "",
  "Rule set version: `2026-09-18.1`",
  "",
  "Prompt version: `collision-classifier-v8`",
  "",
  "### `POL-COLLISION-KEEP` — Keep collision",
  "",
  "Keep collision demand.",
  "",
  "### `POL-FREE-NEGATIVE` — Free intent",
  "",
  "Negative free-service intent."
].join("\n");

test("maps an active static rule set row into a validated rule set", () => {
  const rules = ruleSetFromStaticRow({
    rule_version: "2026-09-18.1",
    prompt_version: "collision-classifier-v8",
    release_id: "release-1",
    rules_markdown: STATIC_MARKDOWN
  });
  assert.equal(rules.version, "2026-09-18.1");
  assert.equal(rules.promptVersion, "collision-classifier-v8");
  assert.equal(rules.releaseId, "release-1");
  assert.equal(rules.sourcePath, "db:negative_keyword_static_rule_sets");
  assert.deepEqual(rules.ruleIds, ["POL-COLLISION-KEEP", "POL-FREE-NEGATIVE"]);
});

test("rejects a static row whose columns disagree with its markdown", () => {
  assert.throws(() => ruleSetFromStaticRow({
    rule_version: "other-version",
    prompt_version: "collision-classifier-v8",
    release_id: "release-1",
    rules_markdown: STATIC_MARKDOWN
  }), /declares version/);
});

test("maps phrase protection rows into runtime entries", () => {
  const row: PhraseProtectionRow = {
    entry_id: "collision-service",
    phrase: "collision service",
    customer_ids: [],
    rule_id: "POL-FREE-NEGATIVE",
    excused_evidence: "service wording"
  };
  assert.deepEqual(mapPhraseProtectionRow(row), {
    id: "collision-service",
    phrase: "collision service",
    customerIds: [],
    ruleId: "POL-FREE-NEGATIVE",
    excusedEvidence: "service wording"
  });
});

const ruleRow: AccountRuleRow = {
  customer_id: "1234567890",
  policy_key: "test-policy",
  revision: "2026-09-18.1",
  rule_id: "POL-X-MOTORCYCLE-NEGATIVE",
  title: "No motorcycles",
  instruction: "Negative motorcycle demand."
};

test("groups dynamic rules and account protections by customer", () => {
  const policies = buildAccountPolicies(
    [ruleRow],
    [{
      entry_id: "moped-protection",
      phrase: "moped frame repair",
      customer_ids: ["1234567890"],
      rule_id: "POL-X-MOTORCYCLE-NEGATIVE",
      excused_evidence: "frame repair"
    }],
    ["POL-COLLISION-KEEP", "POL-FREE-NEGATIVE"]
  );
  const policy = policies["1234567890"];
  assert.ok(policy);
  assert.equal(policy.policyKey, "test-policy");
  assert.equal(policy.revision, "2026-09-18.1");
  assert.deepEqual(policy.customRules, [{
    id: "POL-X-MOTORCYCLE-NEGATIVE",
    title: "No motorcycles",
    instruction: "Negative motorcycle demand."
  }]);
  assert.equal(policy.phraseProtections.length, 1);
  assert.equal(policy.phraseProtections[0]?.id, "moped-protection");
});

test("creates a protection-only policy for accounts without dynamic rules", () => {
  const policies = buildAccountPolicies(
    [],
    [{
      entry_id: "base-plus",
      phrase: "collision service",
      customer_ids: ["9999999999"],
      rule_id: "POL-FREE-NEGATIVE",
      excused_evidence: "service wording"
    }],
    ["POL-COLLISION-KEEP", "POL-FREE-NEGATIVE"]
  );
  const policy = policies["9999999999"];
  assert.ok(policy);
  assert.deepEqual(policy.customRules, []);
  assert.equal(policy.phraseProtections.length, 1);
});

test("fails closed when one account mixes policy revisions", () => {
  assert.throws(() => buildAccountPolicies(
    [ruleRow, { ...ruleRow, rule_id: "POL-Y-GLASS-NEGATIVE", revision: "other" }],
    [],
    ["POL-COLLISION-KEEP"]
  ), /mix policy keys or revisions/);
});

test("fails closed when an account protection references an unknown rule", () => {
  assert.throws(() => buildAccountPolicies(
    [],
    [{
      entry_id: "bad",
      phrase: "anything",
      customer_ids: ["1234567890"],
      rule_id: "POL-DOES-NOT-EXIST-NEGATIVE",
      excused_evidence: "x"
    }],
    ["POL-COLLISION-KEEP"]
  ));
});
