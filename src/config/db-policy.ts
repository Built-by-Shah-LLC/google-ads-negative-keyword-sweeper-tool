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
}

export interface AccountRuleRow {
  customer_id: string;
  policy_key: string;
  revision: string;
  rule_id: string;
  title: string;
  instruction: string;
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
        SELECT entry_id, phrase, customer_ids, rule_id, excused_evidence
        FROM negative_keyword_phrase_protections
        WHERE organization_id = $1 AND active
        ORDER BY entry_id
      `, [config.organizationId]);
      const protectionRows = protectionsResult.rows;
      const baseProtectionRows = protectionRows.filter((row) => row.customer_ids.length === 0);
      const accountProtectionRows = protectionRows.filter((row) => row.customer_ids.length > 0);
      rules.phraseProtections = validatePhraseProtectionEntries(
        baseProtectionRows.map(mapPhraseProtectionRow),
        rules.ruleIds
      );

      const accountRulesResult = await client.query<AccountRuleRow>(`
        SELECT customer_id, policy_key, revision, rule_id, title, instruction
        FROM negative_keyword_account_rules
        WHERE organization_id = $1 AND active
        ORDER BY customer_id, rule_id
      `, [config.organizationId]);

      return {
        rules,
        accountPolicies: buildAccountPolicies(
          accountRulesResult.rows,
          accountProtectionRows,
          rules.ruleIds
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
  baseRuleIds: string[]
): Record<string, AccountPolicyConfig> {
  const policies: Record<string, AccountPolicyConfig> = {};

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
    policies[customerId] = {
      policyKey: rows[0]!.policy_key,
      revision: rows[0]!.revision,
      customRules,
      phraseProtections: []
    };
  }

  const protectionsByCustomer = new Map<string, PhraseProtection[]>();
  for (const row of accountProtectionRows) {
    const entry = mapPhraseProtectionRow(row);
    for (const customerId of entry.customerIds) {
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
