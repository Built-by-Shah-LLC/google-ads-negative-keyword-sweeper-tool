import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadRuleSet } from "../src/config/rule-set.js";
import { parsePhraseProtections } from "../src/config/phrase-protections.js";

const rules = await loadRuleSet(process.cwd());
const release = JSON.parse(await readFile("src/config/rule-release.json", "utf8"));
const baseline = await readFile("src/config/stable/2026-09-04.3.md");
if (release.stableVersion !== "2026-09-04.3" || createHash("sha256").update(baseline).digest("hex") !== release.stableSha256) {
  throw new Error("Stable baseline integrity failure.");
}
const base = process.argv[2];
if (base) {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
  const previous = (path: string) => {
    const exists = git("ls-tree", base, "--", path).trim();
    return exists ? git("show", `${base}:${path}`) : null;
  };
  for (const path of ["src/config/stable/2026-09-04.3.md"]) {
    const old = previous(path);
    if (old !== null && old !== await readFile(path, "utf8")) throw new Error("Stable baseline is immutable.");
  }
  const path = "src/config/negative-keyword-rules.md";
  const old = previous(path);
  if (old !== null) {
    const current = await readFile(path, "utf8");
    const sections = (text: string) => new Map(text.split(/(?=^### `)/mu).map((block, index) => [index === 0 ? "preamble" : block.split("\n")[0]!, block]));
    const before = sections(old.replace(/^Rule set version:.*$/mu, "")), after = sections(current.replace(/^Rule set version:.*$/mu, ""));
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter((key) => before.get(key) !== after.get(key));
    const diff = git("diff", "--numstat", base, "--", path).trim().split(/\s+/u);
    const lines = diff.length >= 2 ? Number(diff[0]) + Number(diff[1]) : 0;
    if (changed.length > 1 || lines > 40) throw new Error("Release too large: maximum one rule section (or preamble) and 40 added/deleted lines per PR.");
    if (old !== current && old.match(/^Rule set version:.*$/mu)?.[0] === current.match(/^Rule set version:.*$/mu)?.[0]) {
      throw new Error("Policy changes require a new rule version.");
    }
  }
  const previousReleaseText = previous("src/config/rule-release.json");
  if (previousReleaseText) {
    const previousRelease = JSON.parse(previousReleaseText);
    if ((previousRelease.rulesSha256 !== release.rulesSha256 || previousRelease.protectionsSha256 !== release.protectionsSha256)
      && previousRelease.releaseId === release.releaseId) throw new Error("Policy bundle changes require a new releaseId.");
  }
  const protectionPath = "src/config/phrase-protections.md";
  const priorProtections = previous(protectionPath);
  const before = new Map((priorProtections ? parsePhraseProtections(priorProtections, rules.ruleIds) : []).map((entry) => [entry.id, JSON.stringify(entry)]));
  const after = new Map(parsePhraseProtections(await readFile(protectionPath, "utf8"), rules.ruleIds).map((entry) => [entry.id, JSON.stringify(entry)]));
  const changes = [...new Set([...before.keys(), ...after.keys()])].filter((id) => before.get(id) !== after.get(id));
  if (changes.length > 5) throw new Error("Release too large: maximum five phrase protection additions, edits, or removals per PR.");
}
console.log("Rule release integrity and requested change-budget checks passed.");
