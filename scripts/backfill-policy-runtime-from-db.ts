import { Client } from "pg";
import { loadEnvironment } from "../src/config/env.js";
import {
  mapPhraseProtectionRow,
  ruleSetFromStaticRow,
  type AccountRuleRow,
  type PhraseProtectionRow,
  type StaticRuleSetRow
} from "../src/config/db-policy.js";
import { compileAccountPolicy } from "../src/config/account-policy-compiler.js";
import { validatePhraseProtectionEntries } from "../src/config/phrase-protections.js";

/**
 * One-time D-052 bridge for policy rows that already live in PostgreSQL.
 * It creates the immutable authoring revision and enabled runtime projection
 * from those database rows only. It never reads repository policy files and
 * never contacts Google Ads or an LLM provider.
 *
 * Usage: npm run policy:backfill-db -- --customer 8500809656
 */

function requestedCustomer(argumentsList: string[]): string {
  if (argumentsList.length !== 2 || argumentsList[0] !== "--customer" || !/^\d{10}$/u.test(argumentsList[1] ?? "")) {
    throw new Error("Use --customer followed by one canonical ten-digit Google Ads customer ID.");
  }
  return argumentsList[1]!;
}

async function main(): Promise<void> {
  const customerId = requestedCustomer(process.argv.slice(2));
  const env = await loadEnvironment(process.cwd());
  const databaseUrl = env.POLICY_ADMIN_DATABASE_URL ?? env.DATABASE_URL;
  const organizationId = env.ORGANIZATION_ID;
  if (!databaseUrl || !organizationId) {
    throw new Error("POLICY_ADMIN_DATABASE_URL (or DATABASE_URL) and ORGANIZATION_ID are required.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);

    const owner = await client.query<{ id: string }>(`
      SELECT id::text FROM users
      WHERE organization_id = $1 AND role = 'owner_admin' AND status = 'active'
      ORDER BY created_at LIMIT 1
    `, [organizationId]);
    const actorId = owner.rows[0]?.id;
    if (!actorId) throw new Error("A live owner_admin user is required for audit attribution.");
    await client.query("SELECT set_config('app.actor_id', $1, true)", [actorId]);

    const account = await client.query<{ id: string; name: string }>(`
      SELECT id::text, client_name AS name FROM client_accounts
      WHERE organization_id = $1 AND google_customer_id = $2
        AND onboarding_status <> 'archived'
      LIMIT 1
    `, [organizationId, customerId]);
    const accountRow = account.rows[0];
    if (!accountRow) throw new Error(`No active Built Ads Manager account maps customer ${customerId}.`);

    const existingRuntime = await client.query<{ revision: string; effective_sha256: string }>(`
      SELECT revision, effective_sha256 FROM negative_keyword_account_policy_runtime
      WHERE organization_id = $1 AND account_id = $2::uuid AND active
    `, [organizationId, accountRow.id]);
    if (existingRuntime.rows[0]) {
      throw new Error(`Customer ${customerId} already has an enabled runtime revision; refusing to overwrite it.`);
    }

    const staticResult = await client.query<StaticRuleSetRow>(`
      SELECT rule_version, prompt_version, release_id, rules_markdown
      FROM negative_keyword_static_rule_sets
      WHERE organization_id = $1 AND active
      LIMIT 1
    `, [organizationId]);
    const staticRow = staticResult.rows[0];
    if (!staticRow) throw new Error("No active database static rule set exists.");
    const base = ruleSetFromStaticRow(staticRow);

    const allProtections = await client.query<PhraseProtectionRow>(`
      SELECT entry_id, phrase, customer_ids, rule_id, excused_evidence,
        account_id::text, policy_key, revision, policy_revision_id::text
      FROM negative_keyword_phrase_protections
      WHERE organization_id = $1 AND active
      ORDER BY entry_id
    `, [organizationId]);
    const baseProtections = allProtections.rows
      .filter((row) => row.account_id == null && row.customer_ids.length === 0)
      .map(mapPhraseProtectionRow);
    base.phraseProtections = validatePhraseProtectionEntries(baseProtections, base.ruleIds);

    const ruleResult = await client.query<AccountRuleRow>(`
      SELECT customer_id, policy_key, revision, rule_id, title, instruction,
        policy_revision_id::text
      FROM negative_keyword_account_rules
      WHERE organization_id = $1 AND customer_id = $2 AND active
      ORDER BY rule_id
    `, [organizationId, customerId]);
    if (ruleResult.rows.length === 0) {
      throw new Error(`Customer ${customerId} has no active database dynamic rules to backfill.`);
    }
    const policyKeys = new Set(ruleResult.rows.map((row) => row.policy_key));
    if (policyKeys.size !== 1) throw new Error("Legacy dynamic rules mix policy keys.");
    const policyKey = ruleResult.rows[0]!.policy_key;
    const accountProtections = validatePhraseProtectionEntries(
      allProtections.rows
        .filter((row) => row.account_id == null && row.customer_ids.includes(customerId))
        .map(mapPhraseProtectionRow),
      [...base.ruleIds, ...ruleResult.rows.map((row) => row.rule_id)]
    );

    const nextRevisionResult = await client.query<{ next_revision: string }>(`
      SELECT (COALESCE(max(revision_number), 0) + 1)::text AS next_revision
      FROM negative_keyword_account_policy_revisions
      WHERE organization_id = $1 AND account_id = $2::uuid
    `, [organizationId, accountRow.id]);
    const revision = nextRevisionResult.rows[0]?.next_revision ?? "1";
    const compiled = await compileAccountPolicy(base, customerId, {
      [customerId]: {
        policyKey,
        revision,
        customRules: ruleResult.rows.map((row) => ({
          id: row.rule_id,
          title: row.title,
          instruction: row.instruction
        })),
        phraseProtections: accountProtections
      }
    });
    if (!compiled.manifest) throw new Error("The database policy did not compile an effective manifest.");

    const inserted = await client.query<{ id: string }>(`
      INSERT INTO negative_keyword_account_policy_revisions (
        organization_id, account_id, policy_key, revision_number, status,
        content_sha256, created_by_user_id, approved_services,
        competitor_aliases, can_appear_as_competitor, change_reason,
        owner_user_id, base_rule_version, prompt_version, release_id,
        compiled_rules_markdown, compiled_phrase_protections, effective_sha256
      ) VALUES (
        $1, $2::uuid, $3, $4, 'active', $5, $6::uuid, ARRAY[]::text[],
        ARRAY[]::text[], false, $7, $6::uuid, $8, $9, $10, $11, $12::jsonb, $5
      ) RETURNING id::text
    `, [
      organizationId,
      accountRow.id,
      policyKey,
      revision,
      compiled.manifest.effectivePolicySha256,
      actorId,
      "Backfill existing database-owned policy into D-052 immutable authoring",
      base.version,
      base.promptVersion,
      base.releaseId ?? "",
      compiled.rules.markdown,
      JSON.stringify((compiled.rules.phraseProtections ?? []).map((entry) => ({
        entryId: entry.id,
        phrase: entry.phrase,
        ruleId: entry.ruleId,
        excusedEvidence: entry.excusedEvidence
      })))
    ]);
    const policyRevisionId = inserted.rows[0]?.id;
    if (!policyRevisionId) throw new Error("The immutable policy revision insert returned no ID.");

    for (const [index, row] of ruleResult.rows.entries()) {
      await client.query(`
        INSERT INTO negative_keyword_account_policy_revision_rules (
          organization_id, policy_revision_id, ordinal, rule_id, title, instruction
        ) VALUES ($1, $2::uuid, $3, $4, $5, $6)
      `, [organizationId, policyRevisionId, index + 1, row.rule_id, row.title, row.instruction]);
    }
    for (const [index, entry] of accountProtections.entries()) {
      await client.query(`
        INSERT INTO negative_keyword_account_policy_revision_phrase_protections (
          organization_id, policy_revision_id, ordinal, entry_id, phrase, rule_id, excused_evidence
        ) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7)
      `, [organizationId, policyRevisionId, index + 1, entry.id, entry.phrase, entry.ruleId, entry.excusedEvidence]);
    }

    await client.query(`
      UPDATE negative_keyword_account_rules
      SET policy_revision_id = $3::uuid, revision = $4, updated_at = now()
      WHERE organization_id = $1 AND customer_id = $2 AND active
    `, [organizationId, customerId, policyRevisionId, revision]);
    await client.query(`
      UPDATE negative_keyword_phrase_protections
      SET account_id = $3::uuid, policy_revision_id = $4::uuid,
        policy_key = $5, revision = $6, updated_at = now()
      WHERE organization_id = $1 AND account_id IS NULL
        AND customer_ids @> ARRAY[$2]::text[] AND active
    `, [organizationId, customerId, accountRow.id, policyRevisionId, policyKey, revision]);
    await client.query(`
      INSERT INTO negative_keyword_account_policy_runtime (
        organization_id, account_id, customer_id, policy_revision_id,
        policy_key, revision, approved_services, competitor_aliases,
        can_appear_as_competitor, effective_sha256, active
      ) VALUES (
        $1, $2::uuid, $3, $4::uuid, $5, $6,
        ARRAY[]::text[], ARRAY[]::text[], false, $7, true
      )
    `, [
      organizationId,
      accountRow.id,
      customerId,
      policyRevisionId,
      policyKey,
      revision,
      compiled.manifest.effectivePolicySha256
    ]);

    await client.query("COMMIT");
    console.log(JSON.stringify({
      status: "BACKFILLED",
      customerId,
      accountName: accountRow.name,
      policyKey,
      revision,
      ruleCount: ruleResult.rows.length,
      accountProtectionCount: accountProtections.length,
      effectivePolicySha256: compiled.manifest.effectivePolicySha256
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

await main();
