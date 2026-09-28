import { Pool, type PoolClient } from "pg";
import type { PhraseProtection, RuleSet } from "../types.js";
import type { DatabasePersistenceConfig } from "./env.js";
import type { AccountPolicyConfig, AccountRuleDefinition } from "./account-policy-compiler.js";
import { validatePhraseProtectionEntries } from "./phrase-protections.js";
import { parseRuleSet } from "./rule-set.js";

/** Source label recorded on rule sets loaded from the database. */
export const STATIC_RULE_SET_SOURCE = "db:negative_keyword_static_rule_sets";

export interface DatabasePolicy {
  /** Agency-wide static rules plus agency-wide phrase protections. */
  rules: RuleSet;
  /** Dynamic per-account policy, keyed by canonical ten-digit customer ID. */
  accountPolicies: Record<string, AccountPolicyConfig>;
}

export interface StaticRuleSetRow {
  rule_version: string;
  prompt_version: string;
  release_id: string;
  rules_markdown: string;
}

export interface PhraseProtectionRow {
  entry_id: string;
  phrase: string;
  customer_ids: string[];
  rule_id: string;
  excused_evidence: string;
  account_id?: string | null;
  policy_key?: string | null;
  revision?: string | null;
  policy_revision_id?: string | null;
}

export interface AccountRuleRow {
  customer_id: string;
  policy_key: string;
  revision: string;
  rule_id: string;
  title: string;
  instruction: string;
  policy_revision_id?: string | null;
}

export interface RuntimePolicyRow {
  account_id: string;
  customer_id: string;
  policy_revision_id: string;
  policy_key: string;
  revision: string;
  approved_services: string[];
  competitor_aliases: string[];
  can_appear_as_competitor: boolean;
  effective_sha256: string;
}

/**
 * Load the complete sweeper policy from the database: the active static rule
 * set, agency-wide phrase protections (customer_ids = '{}'), dynamic account
 * rules, and account-scoped phrase protections. Fails closed when no active
 * static rule set exists or any row is malformed.
 */
export async function loadPolicyFromDatabase(
  config: Extract<DatabasePersistenceConfig, { enabled: true }>
): Promise<DatabasePolicy> {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    application_name: "negative-keyword-sweeper-policy"
  });
  try {
    return await withOrganization(pool, config.organizationId, async (client) => {
      const staticResult = await client.query<StaticRuleSetRow>(`
        SELECT rule_version, prompt_version, release_id, rules_markdown
        FROM negative_keyword_static_rule_sets
        WHERE organization_id = $1 AND active
        LIMIT 1
      `, [config.organizationId]);
      const staticRow = staticResult.rows[0];
      if (staticRow === undefined) {
        throw new Error(
          "No active static rule set found in negative_keyword_static_rule_sets; " +
          "seed the policy into the database before running the sweeper."
        );
      }
      const rules = ruleSetFromStaticRow(staticRow);

      const protectionsResult = await client.query<PhraseProtectionRow>(`
        SELECT entry_id, phrase, customer_ids, rule_id, excused_evidence,
          account_id::text, policy_key, revision, policy_revision_id::text
        FROM negative_keyword_phrase_protections
        WHERE organization_id = $1 AND active
        ORDER BY entry_id
      `, [config.organizationId]);
      const protectionRows = protectionsResult.rows;
      const baseProtectionRows = protectionRows.filter((row) => row.account_id == null && row.customer_ids.length === 0);
      const accountProtectionRows = protectionRows.filter((row) => row.account_id != null);
      rules.phraseProtections = validatePhraseProtectionEntries(
        baseProtectionRows.map(mapPhraseProtectionRow),
        rules.ruleIds
      );

      const accountRulesResult = await client.query<AccountRuleRow>(`
        SELECT rule.customer_id, rule.policy_key, rule.revision, rule.rule_id,
          rule.title, rule.instruction, rule.policy_revision_id::text
        FROM negative_keyword_account_rules rule
        JOIN negative_keyword_account_policy_runtime runtime
          ON runtime.organization_id = rule.organization_id
          AND runtime.policy_revision_id = rule.policy_revision_id
          AND runtime.customer_id = rule.customer_id
        WHERE rule.organization_id = $1 AND rule.active AND runtime.active
        ORDER BY customer_id, rule_id
      `, [config.organizationId]);
      const runtimeResult = await client.query<RuntimePolicyRow>(`
        SELECT account_id::text, customer_id, policy_revision_id::text,
          policy_key, revision, approved_services, competitor_aliases,
          can_appear_as_competitor, effective_sha256
        FROM negative_keyword_account_policy_runtime
        WHERE organization_id = $1 AND active
        ORDER BY customer_id
      `, [config.organizationId]);

      return {
        rules,
        accountPolicies: buildAccountPolicies(
          accountRulesResult.rows,
          accountProtectionRows,
          rules.ruleIds,
          runtimeResult.rows
        )
      };
    });
  } finally {
    await pool.end();
  }
}

export function ruleSetFromStaticRow(row: StaticRuleSetRow): RuleSet {
  const parsed = parseRuleSet(row.rules_markdown, STATIC_RULE_SET_SOURCE);
  if (parsed.version !== row.rule_version || parsed.promptVersion !== row.prompt_version) {
    throw new Error(
      `Active static rule set row declares version '${row.rule_version}' / prompt '${row.prompt_version}' ` +
      `but its markdown declares '${parsed.version}' / '${parsed.promptVersion}'.`
    );
  }
  return { ...parsed, releaseId: row.release_id };
}

export function mapPhraseProtectionRow(row: PhraseProtectionRow): PhraseProtection {
  return {
    id: row.entry_id,
    phrase: row.phrase,
    customerIds: [...row.customer_ids],
    ruleId: row.rule_id,
    excusedEvidence: row.excused_evidence
  };
}

/**
 * Group dynamic rules and account-scoped protections by customer ID into
 * runtime account policies. Exported for unit tests; performs no I/O.
 */
export function buildAccountPolicies(
  ruleRows: AccountRuleRow[],
  accountProtectionRows: PhraseProtectionRow[],
  baseRuleIds: string[],
  runtimeRows: RuntimePolicyRow[] = []
): Record<string, AccountPolicyConfig> {
  const policies: Record<string, AccountPolicyConfig> = {};
  const runtimeByCustomer = new Map(runtimeRows.map((row) => [row.customer_id, row]));

  // Preserve enabled revisions even when they intentionally compile to only
  // the shared base policy (for example, an opt-in-only source account).
  // Otherwise the manifest would silently lose the dashboard revision/hash.
  for (const runtime of runtimeRows) {
    policies[runtime.customer_id] = {
      policyKey: runtime.policy_key,
      revision: runtime.revision,
      customRules: [],
      phraseProtections: [],
      approvedServices: runtime.approved_services,
      competitorAliases: runtime.competitor_aliases,
      canAppearAsCompetitor: runtime.can_appear_as_competitor,
      expectedEffectivePolicySha256: runtime.effective_sha256
    };
  }

  const rulesByCustomer = new Map<string, AccountRuleRow[]>();
  for (const row of ruleRows) {
    const rows = rulesByCustomer.get(row.customer_id) ?? [];
    rows.push(row);
    rulesByCustomer.set(row.customer_id, rows);
  }
  for (const [customerId, rows] of rulesByCustomer) {
    const policyKeys = new Set(rows.map((row) => row.policy_key));
    const revisions = new Set(rows.map((row) => row.revision));
    if (policyKeys.size !== 1 || revisions.size !== 1) {
      throw new Error(
        `Active account rules for customer ${customerId} mix policy keys or revisions; ` +
        "reseed one consistent policy revision per account."
      );
    }
    const customRules: AccountRuleDefinition[] = rows.map((row) => ({
      id: row.rule_id,
      title: row.title,
      instruction: row.instruction
    }));
    const runtime = runtimeByCustomer.get(customerId);
    if (runtimeRows.length > 0 && (runtime === undefined || rows.some((row) => row.policy_revision_id !== runtime.policy_revision_id))) {
      throw new Error(`Active account rules for customer ${customerId} do not belong to its enabled runtime revision.`);
    }
    policies[customerId] = {
      policyKey: rows[0]!.policy_key,
      revision: rows[0]!.revision,
      customRules,
      phraseProtections: [],
      approvedServices: runtime?.approved_services ?? [],
      competitorAliases: runtime?.competitor_aliases ?? [],
      canAppearAsCompetitor: runtime?.can_appear_as_competitor ?? false,
      ...(runtime === undefined ? {} : { expectedEffectivePolicySha256: runtime.effective_sha256 })
    };
  }

  const protectionsByCustomer = new Map<string, PhraseProtection[]>();
  for (const row of accountProtectionRows) {
    const runtime = row.account_id ? [...runtimeByCustomer.values()].find((candidate) => candidate.account_id === row.account_id) : undefined;
    if (runtimeRows.length > 0 && (runtime === undefined || row.policy_revision_id !== runtime.policy_revision_id || row.policy_key !== runtime.policy_key || row.revision !== runtime.revision)) {
      throw new Error(`Active phrase protection '${row.entry_id}' does not belong to one enabled runtime policy revision.`);
    }
    const entry = mapPhraseProtectionRow(row);
    for (const customerId of runtime ? [runtime.customer_id] : entry.customerIds) {
      const entries = protectionsByCustomer.get(customerId) ?? [];
      entries.push({ ...entry, customerIds: [...entry.customerIds] });
      protectionsByCustomer.set(customerId, entries);
    }
  }
  for (const [customerId, entries] of protectionsByCustomer) {
    const policy = policies[customerId] ?? {
      policyKey: `customer-${customerId}`,
      revision: "1",
      customRules: [],
      phraseProtections: []
    };
    const ruleIds = [...baseRuleIds, ...policy.customRules.map((rule) => rule.id)];
    policy.phraseProtections = validatePhraseProtectionEntries(entries, ruleIds);
    policies[customerId] = policy;
  }

  return policies;
}

async function withOrganization<T>(
  pool: Pool,
  organizationId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
