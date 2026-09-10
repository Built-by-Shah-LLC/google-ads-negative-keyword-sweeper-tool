import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchingPhraseProtections, parsePhraseProtections } from "../src/config/phrase-protections.js";
import { loadRuleSet } from "../src/config/rule-set.js";

const entry = { id: "service", phrase: "collision service", ruleId: "POL-MECHANICAL-ONLY-NEGATIVE", customerIds: [], excusedEvidence: "Only service describing collision repair" };
const ruleIds = [entry.ruleId];
test("phrase selection covers locations and boundaries; it does not assert model decisions", async () => {
  const rules = await loadRuleSet(process.cwd());
  const cases = JSON.parse(await readFile("test/fixtures/phrase-protection-cases.json", "utf8"));
  for (const item of cases) {
    assert.deepEqual(matchingPhraseProtections(item.term, "1234567890", rules.phraseProtections).map((entry) => entry.id), item.protections, item.term);
  }
  for (const term of ["precollision service", "experts collision", "collision best service", "collision serviceship", "precollision services", "autobody service", "auto service body", "bodyshop service", "auto body serviceman"]) {
    assert.deepEqual(matchingPhraseProtections(term, "1234567890", rules.phraseProtections), []);
  }
  assert.equal(matchingPhraseProtections("ＣＯＬＬＩＳＩＯＮ\tservice!", "1234567890", [entry]).length, 1);
});
test("account scope limits phrase selection", () => {
  const entries = [{ ...entry, customerIds: ["1234567890"] }];
  assert.equal(matchingPhraseProtections("collision service nyc", "1234567890", entries).length, 1);
  assert.deepEqual(matchingPhraseProtections("collision service nyc", "9999999999", entries), []);
});
test("malformed, duplicate, broad-rule, legacy and unknown-rule entries fail closed", () => {
  const parse = (value: unknown) => parsePhraseProtections('```json\n' + JSON.stringify(value) + '\n```', ruleIds);
  assert.deepEqual(parse([]), []);
  assert.deepEqual(parse([entry]), [entry]);
  for (const value of [[entry, entry], [{ ...entry, phrase: "!!!" }], [{ ...entry, excusedEvidence: "" }], [{ ...entry, customerIds: ["123"] }], [{ ...entry, typo: true }], [{ ...entry, ruleId: "POL-UNKNOWN-NEGATIVE" }], [{ ...entry, ruleId: "POL-COLLISION-KEEP" }], [{ id: "legacy", term: "collision service", match: "exact", customerIds: [], reason: "Approved" }]]) {
    assert.throws(() => parse(value));
  }
  assert.throws(() => parsePhraseProtections("no block", ruleIds));
});
test("policy and protection edits fail integrity verification, stable snapshot stays original", async (t) => {
  const rules = await loadRuleSet(process.cwd());
  assert.equal(rules.phraseProtections?.length, 7);
  const root = await mkdtemp(join(tmpdir(), "rule-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src"));
  await cp("src/config", join(root, "src/config"), { recursive: true });
  await loadRuleSet(root);
  for (const name of ["negative-keyword-rules.md", "phrase-protections.md"]) {
    const path = join(root, "src/config", name);
    const original = await readFile(path, "utf8");
    await writeFile(path, original + "\nUnapproved policy change\n");
    await assert.rejects(loadRuleSet(root), /integrity/);
    await writeFile(path, original);
  }
  assert.match(await readFile("src/config/stable/2026-09-04.3.md", "utf8"), /Prompt version: `collision-classifier-v6`/);
});
