import { createHash } from "node:crypto";
import type { PhraseProtection, RuleSet } from "../types.js";
import { validatePhraseProtectionEntries } from "./phrase-protections.js";
import { parseRuleSet } from "./rule-set.js";

const CUSTOMER_ID_PATTERN = /^\d{10}$/u;
const RULE_ID_PATTERN = /^[A-Z][A-Z0-9-]+$/u;

/** Where the effective policy configuration lives; loaded from the database at runtime. */
export const ACCOUNT_POLICY_SOURCE = "db:negative_keyword_account_rules";
export const PHRASE_PROTECTIONS_SOURCE = "db:negative_keyword_phrase_protections";

export interface AccountRuleDefinition {
  /** Uppercase, unique within the effective bundle, must end in -KEEP or -NEGATIVE. */
  id: string;
  /** Short title rendered after the rule heading. */
  title: string;
  /** Markdown body of the rule, sent to the LLM verbatim. */
  instruction: string;
}

/**
 * Runtime per-account policy loaded from the database (dynamic rules plus
 * parsed per-company phrase protections). Seed scripts build the same shape
 * from the repository's file-based policy when importing it into the DB.
 */
export interface AccountPolicyConfig {
  /** Stable policy identity used in artifacts; not the mutable descriptive name. */
  policyKey: string;
  /** Bump on every change to this account entry. */
  revision: string;
  /** Dynamic account-specific rules appended after the base rules. */
  customRules: AccountRuleDefinition[];
  /** Parsed per-company phrase protections for this account. */
  phraseProtections: PhraseProtection[];
}

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
  /** The exact per-company phrase protections sent to the LLM; null for base-only. */
  accountPhraseProtections: PhraseProtection[] | null;
  /** Null when the account has no configured policy and runs base-only. */
  manifest: AccountPolicyManifest | null;
}

/**
 * Compile the effective policy for one account: base rules plus the account's
 * dynamic rules, and base phrase protections plus the account's per-company
 * phrase protections. Accounts without a configured policy compile to the
 * unchanged base bundle.
 *
 * Fails closed on any misconfiguration; nothing here calls an LLM, Google Ads,
 * the filesystem, or the database.
 */
export async function compileAccountPolicy(
  base: RuleSet,
  customerId: string,
  policies: Record<string, AccountPolicyConfig>
): Promise<EffectiveAccountPolicy> {
  if (!CUSTOMER_ID_PATTERN.test(customerId)) {
    throw new Error(`Account policy compilation requires a canonical ten-digit customer ID, got '${customerId}'.`);
  }
  const config = policies[customerId];
  if (!config) return { rules: base, accountPhraseProtections: null, manifest: null };

  validateCustomRules(config, base.ruleIds);
  const markdown = renderEffectiveRulesMarkdown(base, config);
  // Re-parse the combined document so heading extraction and duplicate detection
  // run on exactly what will be sent to the LLM.
  const parsed = parseRuleSet(markdown, `account-policy:${config.policyKey}`);

  const accountProtections = validatePhraseProtectionEntries(config.phraseProtections, parsed.ruleIds);
  for (const entry of accountProtections) {
    if (entry.customerIds.length > 0 && !entry.customerIds.includes(customerId)) {
      throw new Error(
        `Phrase protection '${entry.id}' in policy '${config.policyKey}' is scoped to other accounts; ` +
        `an account policy must use customerIds [] or include ${customerId}.`
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
    .update(canonicalProtectionsJson(accountProtections))
    .digest("hex");

  const rules: RuleSet = {
    ...base,
    sourcePath: `${base.sourcePath}+${PHRASE_PROTECTIONS_SOURCE}`,
    markdown,
    ruleIds: parsed.ruleIds,
    phraseProtections
  };
  return {
    rules,
    accountPhraseProtections: accountProtections,
    manifest: {
      customerId,
      policyKey: config.policyKey,
      revision: config.revision,
      baseRuleVersion: base.version,
      basePromptVersion: base.promptVersion,
      baseReleaseId: base.releaseId ?? null,
      dynamicRuleIds: config.customRules.map((rule) => rule.id),
      accountPhraseProtectionCount: accountProtections.length,
      phraseProtectionsSourcePath: PHRASE_PROTECTIONS_SOURCE,
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

/** Deterministic serialization used only for the effective-policy content hash. */
function canonicalProtectionsJson(entries: PhraseProtection[]): string {
  return JSON.stringify(entries.map((entry) => ({
    id: entry.id,
    phrase: entry.phrase,
    customerIds: [...entry.customerIds].sort(),
    ruleId: entry.ruleId,
    excusedEvidence: entry.excusedEvidence
  })));
}
