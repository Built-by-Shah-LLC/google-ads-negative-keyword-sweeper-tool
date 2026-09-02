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
  assert.ok(rules.ruleIds.includes("POL-COSMETIC-ONLY-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-PAINT-COLOR-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-REVIEWS-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-WEBSITE-NAV-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-DIY-HOWTO-NEGATIVE"));
  assert.ok(rules.ruleIds.includes("POL-OWN-BRAND-NEGATIVE"));
  assert.equal(rules.ruleIds.includes("POL-OWN-BRAND-KEEP"), false);
  assert.ok(rules.ruleIds.includes("POL-FULL-QUERY-EXACT"));
  assert.match(rules.markdown, /tow truck after accident/iu);
  assert.match(rules.markdown, /choque cerca de mi/iu);
  assert.match(rules.markdown, /car upholstery repair near me/iu);
  assert.match(rules.markdown, /free quote collision repair/iu);
  assert.match(rules.markdown, /what is collision repair/iu);
  assert.match(rules.markdown, /tesla collision center cincinnati/iu);
  assert.match(rules.markdown, /state farm repair shop near me/iu);
  assert.match(rules.markdown, /west chester auto body/iu);
  assert.match(rules.markdown, /auto body repair near me/iu);
  assert.match(rules.markdown, /auto repair and body shop/iu);
  assert.match(rules.markdown, /bmw body work repairs/iu);
  assert.match(rules.markdown, /pelham collision llc/iu);
  assert.match(rules.markdown, /new rochelle auto body inc/iu);
  assert.match(rules.markdown, /must cite at least one[\s\S]*`-NEGATIVE` rule/iu);
  assert.match(rules.markdown, /auto arena body shop near me/iu);
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
