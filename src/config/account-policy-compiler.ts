import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PhraseProtection, RuleSet } from "../types.js";
import { ACCOUNT_POLICIES, type AccountPolicyConfig } from "./account-policies.js";
import { parsePhraseProtections } from "./phrase-protections.js";
import { parseRuleSet } from "./rule-set.js";

const CUSTOMER_ID_PATTERN = /^\d{10}$/u;
const RULE_ID_PATTERN = /^[A-Z][A-Z0-9-]+$/u;

export interface AccountPolicyManifest {
  customerId: string;
  policyKey: string;
  revision: string;
  baseRuleVersion: string;
  basePromptVersion: string;
  baseReleaseId: string | null;
  dynamicRuleIds: string[];
  accountPhraseProtectionCount: number;
  phraseProtectionsSourcePath: string;
  effectivePolicySha256: string;
}

export interface EffectiveAccountPolicy {
  /** The exact policy bundle this account is classified with. */
  rules: RuleSet;
  /** The exact per-company phrase-protection markdown sent to the LLM; null for base-only. */
  accountPhraseProtectionsMarkdown: string | null;
  /** Null when the account has no configured policy and runs base-only. */
  manifest: AccountPolicyManifest | null;
}

/**
 * Compile the effective policy for one account: base rules plus the account's
 * dynamic rules, and base phrase protections plus the account's per-company
 * phrase-protection file. Accounts without a configured policy compile to the
 * unchanged base bundle.
 *
 * Fails closed on any misconfiguration; nothing here calls an LLM or Google Ads.
 */
export async function compileAccountPolicy(
  base: RuleSet,
  rootDirectory: string,
  customerId: string,
  policies: Record<string, AccountPolicyConfig> = ACCOUNT_POLICIES
): Promise<EffectiveAccountPolicy> {
  if (!CUSTOMER_ID_PATTERN.test(customerId)) {
    throw new Error(`Account policy compilation requires a canonical ten-digit customer ID, got '${customerId}'.`);
  }
  const config = policies[customerId];
  if (!config) return { rules: base, accountPhraseProtectionsMarkdown: null, manifest: null };

  validateCustomRules(config, base.ruleIds);
  const markdown = renderEffectiveRulesMarkdown(base, config);
  // Re-parse the combined document so heading extraction and duplicate detection
  // run on exactly what will be sent to the LLM.
  const parsed = parseRuleSet(markdown, `account-policy:${config.policyKey}`);

  const protectionsPath = resolve(rootDirectory, config.phraseProtectionsFile);
  const protectionsMarkdown = await readFile(protectionsPath, "utf8");
  const accountProtections = parsePhraseProtections(protectionsMarkdown, parsed.ruleIds);
  for (const entry of accountProtections) {
    if (entry.customerIds.length > 0 && !entry.customerIds.includes(customerId)) {
      throw new Error(
        `Phrase protection '${entry.id}' in ${config.phraseProtectionsFile} is scoped to other accounts; ` +
        `an account file must use customerIds [] or include ${customerId}.`
      );
    }
  }

  const phraseProtections: PhraseProtection[] = [
    ...(base.phraseProtections ?? []),
    ...accountProtections
  ];
  const protectionIds = new Set<string>();
  for (const entry of phraseProtections) {
    if (protectionIds.has(entry.id)) {
      throw new Error(`Duplicate phrase protection ID '${entry.id}' across base and account policy.`);
    }
    protectionIds.add(entry.id);
  }

  const effectivePolicySha256 = createHash("sha256")
    .update(markdown)
    .update("\n")
    .update(protectionsMarkdown)
    .digest("hex");

  const rules: RuleSet = {
    ...base,
    sourcePath: `${base.sourcePath}+${config.phraseProtectionsFile}`,
    markdown,
    ruleIds: parsed.ruleIds,
    phraseProtections
  };
  return {
    rules,
    accountPhraseProtectionsMarkdown: protectionsMarkdown,
    manifest: {
      customerId,
      policyKey: config.policyKey,
      revision: config.revision,
      baseRuleVersion: base.version,
      basePromptVersion: base.promptVersion,
      baseReleaseId: base.releaseId ?? null,
      dynamicRuleIds: config.customRules.map((rule) => rule.id),
      accountPhraseProtectionCount: accountProtections.length,
      phraseProtectionsSourcePath: config.phraseProtectionsFile,
      effectivePolicySha256
    }
  };
}

function validateCustomRules(config: AccountPolicyConfig, baseRuleIds: string[]): void {
  const baseIds = new Set(baseRuleIds);
  const seen = new Set<string>();
  for (const rule of config.customRules) {
    if (!RULE_ID_PATTERN.test(rule.id) || !(rule.id.endsWith("-KEEP") || rule.id.endsWith("-NEGATIVE"))) {
      throw new Error(
        `Account rule '${rule.id}' in policy '${config.policyKey}' must be uppercase and end in -KEEP or -NEGATIVE.`
      );
    }
    if (baseIds.has(rule.id) || seen.has(rule.id)) {
      throw new Error(`Account rule '${rule.id}' in policy '${config.policyKey}' collides with an existing rule ID.`);
    }
    if (!rule.title.trim() || !rule.instruction.trim()) {
      throw new Error(`Account rule '${rule.id}' in policy '${config.policyKey}' needs a title and an instruction.`);
    }
    seen.add(rule.id);
  }
}

function renderEffectiveRulesMarkdown(base: RuleSet, config: AccountPolicyConfig): string {
  const sections = config.customRules.map((rule) =>
    `### \`${rule.id}\` — ${rule.title}\n\n${rule.instruction.trim()}\n`
  );
  return [
    base.markdown.trimEnd(),
    "",
    "---",
    "",
    `## Account-specific rules (policy: ${config.policyKey}, revision: ${config.revision})`,
    "",
    "These rules apply to this account only, in addition to every base rule above.",
    "",
    ...sections
  ].join("\n");
}
