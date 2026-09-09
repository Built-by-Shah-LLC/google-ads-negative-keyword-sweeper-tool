import { createHash } from "node:crypto";
import { parsePhraseProtections } from "./phrase-protections.js";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { RuleSet } from "../types.js";

const VERSION_PATTERN = /^Rule set version:\s*`([^`]+)`\s*$/mu;
const PROMPT_VERSION_PATTERN = /^Prompt version:\s*`([^`]+)`\s*$/mu;
const RULE_HEADING_PATTERN = /^###\s+`([A-Z][A-Z0-9-]+)`(?:\s|$)/gmu;

export async function loadRuleSet(rootDirectory: string): Promise<RuleSet> {
  const absolutePath = resolve(rootDirectory, "src/config/negative-keyword-rules.md");
  const markdown = await readFile(absolutePath, "utf8");
  const directory = resolve(rootDirectory, "src/config");
  const protections = await readFile(resolve(directory, "phrase-protections.md"), "utf8");
  const release = JSON.parse(await readFile(resolve(directory, "rule-release.json"), "utf8"));
  const rules = parseRuleSet(markdown, relative(rootDirectory, absolutePath).replaceAll("\\", "/"));
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  if (typeof release.releaseId !== "string" || !release.releaseId.trim()) throw new Error("Missing rule release ID.");
  if (hash(markdown) !== release.rulesSha256 || hash(protections) !== release.protectionsSha256
      || rules.version !== release.releasedVersion) {
    throw new Error("Rule release integrity check failed. Review and approve the policy release before running.");
  }
  return { ...rules, releaseId: release.releaseId, phraseProtections: parsePhraseProtections(protections, rules.ruleIds) };
}

export function parseRuleSet(markdown: string, sourcePath = "negative-keyword-rules.md"): RuleSet {
  const version = VERSION_PATTERN.exec(markdown)?.[1];
  const promptVersion = PROMPT_VERSION_PATTERN.exec(markdown)?.[1];
  if (!version) throw new Error(`${sourcePath} is missing a Rule set version.`);
  if (!promptVersion) throw new Error(`${sourcePath} is missing a Prompt version.`);

  const ruleIds = [...markdown.matchAll(RULE_HEADING_PATTERN)].map((match) => match[1]!);
  if (ruleIds.length === 0) throw new Error(`${sourcePath} contains no rule headings.`);
  if (new Set(ruleIds).size !== ruleIds.length) throw new Error(`${sourcePath} contains duplicate rule IDs.`);

  return { version, promptVersion, sourcePath, markdown, ruleIds };
}
