import assert from "node:assert/strict";
import test from "node:test";
import { loadRuleSet, parseRuleSet } from "../src/config/rule-set.js";

test("loads the authoritative Markdown rule set with unique rule IDs", async () => {
  const rules = await loadRuleSet(process.cwd());
  assert.equal(rules.sourcePath, "src/config/negative-keyword-rules.md");
  assert.match(rules.version, /^\d{4}-\d{2}-\d{2}\./u);
  assert.ok(rules.ruleIds.includes("POL-AMBIGUOUS-KEEP"));
  assert.equal(rules.ruleIds.includes("POL-UNDEFINED-KEEP"), false);
  assert.equal(rules.ruleIds.includes("POL-SPANISH-SERVICE-KEEP"), false);
  assert.ok(rules.ruleIds.includes("POL-FOREIGN-LANGUAGE-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-TOWING-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-PRICE-SHOPPER-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-INFORMATIONAL-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-NO-SERVICE-SIGNAL-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-CUSTOM-FABRICATION-NEGATIVE"));
  assert.equal(rules.ruleIds.includes("POL-COSMETIC-ONLY-NEGATIVE"), false);
  assert.equal(rules.ruleIds.includes("POL-PARTS-ONLY-NEGATIVE"), false);
  assert.equal(rules.ruleIds.includes("POL-GLASS-TINT-NEGATIVE"), false);
  assert.ok(rules.ruleIds.includes("POL-PAINT-COLOR-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-REVIEWS-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-HOURS-247-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-SMALL-SPEED-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-MOBILE-SERVICE-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-METAL-MATERIAL-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-INSPECTION-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-WEBSITE-NAV-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-DIY-HOWTO-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-OWN-BRAND-NEGATIVE"));
  assert.equal(rules.ruleIds.includes("POL-OWN-BRAND-KEEP"), false);
  assert.ok(rules.ruleIds.includes("POL-FULL-QUERY-EXACT"));
  assert.match(rules.markdown, /must cite at least one[\s\S]*`-NEGATIVE` rule/iu);
  assert.ok(rules.ruleIds.includes("POL-SALVAGE-JUNK-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-CAREERS-NEGATIVE"));
  assert.equal(new Set(rules.ruleIds).size, rules.ruleIds.length);
});

test("rejects duplicate Markdown rule IDs", () => {
  assert.throws(() => parseRuleSet(`
Rule set version: \`v1\`
Prompt version: \`p1\`
### \`RULE-A\`
### \`RULE-A\`
  `), /duplicate rule IDs/u);
});
