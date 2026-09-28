import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { loadConfig, loadEnvironment } from "../src/config/env.js";
import { ACCOUNT_POLICIES } from "../src/config/account-policies.js";
import { parsePhraseProtections } from "../src/config/phrase-protections.js";
import { loadRuleSet } from "../src/config/rule-set.js";
import type { PhraseProtection } from "../src/types.js";
import { compileAccountPolicy } from "../src/config/account-policy-compiler.js";

/**
 * Import the repository's file-based sweeper policy into the database tables
 * created by Built Ads Manager migrations through 0021 (negative_keyword_static_rule_sets,
 * negative_keyword_account_rules, negative_keyword_phrase_protections).
 *
 * Runtime sweeps read policy exclusively from the database; this seeder is
 * the maintenance path for policy changes. It is idempotent: existing rows
 * are updated in place, new versions inserted, rows absent from the files are
 * deactivated (never deleted), and exactly one static rule set is left active.
 *
 * Requires a privileged database identity (migration/seed role). By default
 * DATABASE_URL from .env is used; set POLICY_ADMIN_DATABASE_URL to override.
 *
 * Usage:
 *   npm run policy:seed
 *   POLICY_ADMIN_DATABASE_URL=postgresql://... npm run policy:seed
 */

interface AccountSeed {
  customerId: string;
  policyKey: string;
  revision: string;
  customRules: Array<{ id: string; title: string; instruction: string }>;
  protections: PhraseProtection[];
}

async function main(): Promise<void> {
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const config = await loadConfig(rootDirectory);
  if (!config.persistence.enabled) {
    throw new Error("PERSIST_RUNS_TO_DATABASE must be true to seed policy into the database.");
  }
  const organizationId = config.persistence.organizationId;
  // loadConfig does not mutate process.env; read POLICY_ADMIN_DATABASE_URL from
  // the same merged .env view (shell env still takes precedence).
  const env = await loadEnvironment(rootDirectory);
  const adminUrl = env.POLICY_ADMIN_DATABASE_URL ?? config.persistence.databaseUrl;

  const base = await loadRuleSet(rootDirectory);
  for (const entry of base.phraseProtections ?? []) {
    if (!/^[A-Z][A-Z0-9-]+$/u.test(entry.id)) {
      throw new Error(`Base phrase protection '${entry.id}' must already use its canonical uppercase database ID.`);
    }
  }
  const accountSeeds: AccountSeed[] = [];
  for (const [customerId, seed] of Object.entries(ACCOUNT_POLICIES)) {
    const markdown = await readFile(resolve(rootDirectory, seed.phraseProtectionsFile), "utf8");
    const ruleIds = [...base.ruleIds, ...seed.customRules.map((rule) => rule.id)];
    const protections = parsePhraseProtections(markdown, ruleIds);
    for (const entry of protections) {
      if (!/^[A-Z][A-Z0-9-]+$/u.test(entry.id)) {
        throw new Error(`Phrase protection '${entry.id}' must already use its canonical uppercase database ID.`);
      }
      if (entry.customerIds.length > 0 && !entry.customerIds.includes(customerId)) {
        throw new Error(
          `Phrase protection '${entry.id}' in ${seed.phraseProtectionsFile} is scoped to other accounts; ` +
          `an account file must use customerIds [] or include ${customerId}.`
        );
      }
    }
    accountSeeds.push({
      customerId,
      policyKey: seed.policyKey,
      revision: seed.revision,
      customRules: seed.customRules,
      protections
    });
  }

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  let staticRuleSets = 0;
  let accountRules = 0;
  let phraseProtections = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);

    // Static rule set: upsert the file version, then make it the only active one.
    const contentSha256 = createHash("sha256").update(base.markdown).digest("hex");
    await client.query(`
      INSERT INTO negative_keyword_static_rule_sets (
        organization_id, rule_version, prompt_version, release_id,
        rules_markdown, content_sha256, active
      ) VALUES ($1, $2, $3, $4, $5, $6, false)
      ON CONFLICT (organization_id, rule_version) DO UPDATE
        SET prompt_version = EXCLUDED.prompt_version,
            release_id = EXCLUDED.release_id,
            rules_markdown = EXCLUDED.rules_markdown,
            content_sha256 = EXCLUDED.content_sha256,
            updated_at = now()
    `, [organizationId, base.version, base.promptVersion, base.releaseId ?? "", base.markdown, contentSha256]);
    await client.query(`
      UPDATE negative_keyword_static_rule_sets
      SET active = (rule_version = $2), updated_at = now()
      WHERE organization_id = $1 AND active <> (rule_version = $2)
    `, [organizationId, base.version]);
    staticRuleSets = 1;

    const actorResult = await client.query<{ id: string }>(`
      SELECT id::text FROM users
      WHERE organization_id = $1 AND role = 'owner_admin' AND status = 'active'
      ORDER BY created_at LIMIT 1
    `, [organizationId]);
    const actorId = actorResult.rows[0]?.id;
    if (!actorId) throw new Error("Policy seed requires one active Built Ads Manager owner for audit attribution.");

    // Import each file policy as an immutable authoring revision, then rebuild
    // the one enabled runtime projection consumed by the Sweeper.
    for (const account of accountSeeds) {
      const accountResult = await client.query<{ id: string }>(`
        SELECT id::text FROM client_accounts
        WHERE organization_id = $1 AND google_customer_id = $2 AND onboarding_status <> 'archived'
        LIMIT 1
      `, [organizationId, account.customerId]);
      const accountId = accountResult.rows[0]?.id;
      if (!accountId) throw new Error(`Seed customer ${account.customerId} is not an active Built Ads Manager account.`);
      const activeResult = await client.query<{ id: string; revision_number: string; effective_sha256: string | null }>(`
        SELECT id::text, revision_number::text, effective_sha256
        FROM negative_keyword_account_policy_revisions
        WHERE organization_id = $1 AND account_id = $2::uuid AND status = 'active'
        LIMIT 1 FOR UPDATE
      `, [organizationId, accountId]);
      const compileRevision = async (revision: string) => {
        const compiled = await compileAccountPolicy(base, account.customerId, {
          [account.customerId]: {
            policyKey: account.policyKey,
            revision,
            customRules: account.customRules,
            phraseProtections: account.protections
          }
        });
        if (!compiled.manifest) throw new Error(`Seed policy ${account.policyKey} did not compile an effective manifest.`);
        return compiled;
      };
      let effective = activeResult.rows[0] ? await compileRevision(activeResult.rows[0].revision_number) : null;
      let policyRevisionId = activeResult.rows[0] && activeResult.rows[0].effective_sha256 === effective?.manifest?.effectivePolicySha256
        ? activeResult.rows[0].id
        : null;
      if (policyRevisionId === null) {
        const nextResult = await client.query<{ next_revision: string }>(`
          SELECT (COALESCE(max(revision_number), 0) + 1)::text AS next_revision
          FROM negative_keyword_account_policy_revisions
          WHERE organization_id = $1 AND account_id = $2::uuid
        `, [organizationId, accountId]);
        const nextRevision = nextResult.rows[0]?.next_revision ?? "1";
        effective = await compileRevision(nextRevision);
        if (activeResult.rows[0]) {
          await client.query(`UPDATE negative_keyword_account_policy_revisions SET status = 'superseded' WHERE organization_id = $1 AND id = $2::uuid`, [organizationId, activeResult.rows[0].id]);
        }
        const inserted = await client.query<{ id: string }>(`
          INSERT INTO negative_keyword_account_policy_revisions (
            organization_id, account_id, policy_key, revision_number, status,
            content_sha256, created_by_user_id, approved_services,
            competitor_aliases, can_appear_as_competitor, change_reason,
            owner_user_id, base_rule_version, prompt_version, release_id,
            compiled_rules_markdown, compiled_phrase_protections, effective_sha256
          ) VALUES ($1, $2::uuid, $3, $4, 'active', $5, $6::uuid, ARRAY[]::text[],
            ARRAY[]::text[], false, $7, $6::uuid, $8, $9, $10, $11, $12::jsonb, $5)
          RETURNING id::text
        `, [organizationId, accountId, account.policyKey, nextRevision, effective.manifest!.effectivePolicySha256, actorId, `Import reviewed seed revision ${account.revision}`, base.version, base.promptVersion, base.releaseId ?? "", effective.rules.markdown, JSON.stringify((effective.rules.phraseProtections ?? []).map((entry) => ({ entryId: entry.id, phrase: entry.phrase, ruleId: entry.ruleId, excusedEvidence: entry.excusedEvidence })))]);
        policyRevisionId = inserted.rows[0]?.id ?? null;
        if (!policyRevisionId) throw new Error(`Failed to create authoring revision for ${account.customerId}.`);
        for (const [index, rule] of account.customRules.entries()) {
          await client.query(`INSERT INTO negative_keyword_account_policy_revision_rules (organization_id, policy_revision_id, ordinal, rule_id, title, instruction) VALUES ($1, $2::uuid, $3, $4, $5, $6)`, [organizationId, policyRevisionId, index + 1, rule.id, rule.title, rule.instruction]);
        }
        for (const [index, entry] of account.protections.entries()) {
          await client.query(`INSERT INTO negative_keyword_account_policy_revision_phrase_protections (organization_id, policy_revision_id, ordinal, entry_id, phrase, rule_id, excused_evidence) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7)`, [organizationId, policyRevisionId, index + 1, entry.id, entry.phrase, entry.ruleId, entry.excusedEvidence]);
        }
      }
      if (!effective?.manifest) throw new Error(`Seed policy ${account.policyKey} has no compiled database revision.`);
      const runtimeRevision = effective.manifest.revision;
      for (const rule of account.customRules) {
        await client.query(`
          INSERT INTO negative_keyword_account_rules (
            organization_id, customer_id, policy_key, revision,
            rule_id, title, instruction, active, policy_revision_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8::uuid)
          ON CONFLICT (organization_id, customer_id, rule_id) DO UPDATE
            SET policy_key = EXCLUDED.policy_key,
                revision = EXCLUDED.revision,
                title = EXCLUDED.title,
                instruction = EXCLUDED.instruction,
                active = true, policy_revision_id = EXCLUDED.policy_revision_id,
                updated_at = now()
        `, [organizationId, account.customerId, account.policyKey, runtimeRevision,
          rule.id, rule.title, rule.instruction, policyRevisionId]);
        accountRules += 1;
      }
      const ruleIds = account.customRules.map((rule) => rule.id);
      await client.query(`
        UPDATE negative_keyword_account_rules
        SET active = false, updated_at = now()
        WHERE organization_id = $1 AND customer_id = $2 AND active
          AND NOT (rule_id = ANY($3::text[]))
      `, [organizationId, account.customerId, ruleIds.length > 0 ? ruleIds : [""]]);
      await client.query(`
        INSERT INTO negative_keyword_account_policy_runtime (
          organization_id, account_id, customer_id, policy_revision_id,
          policy_key, revision, approved_services, competitor_aliases,
          can_appear_as_competitor, effective_sha256, active
        ) VALUES ($1, $2::uuid, $3, $4::uuid, $5, $6, ARRAY[]::text[], ARRAY[]::text[], false, $7, true)
        ON CONFLICT (organization_id, account_id) DO UPDATE SET
          customer_id = EXCLUDED.customer_id, policy_revision_id = EXCLUDED.policy_revision_id,
          policy_key = EXCLUDED.policy_key, revision = EXCLUDED.revision,
          effective_sha256 = EXCLUDED.effective_sha256, active = true, updated_at = now()
      `, [organizationId, accountId, account.customerId, policyRevisionId, account.policyKey, runtimeRevision, effective.manifest.effectivePolicySha256]);
    }

    // Phrase protections: agency-wide base entries plus per-account entries.
    const runtimeRows = await client.query<{ account_id: string; customer_id: string; policy_revision_id: string; policy_key: string; revision: string }>(`
      SELECT account_id::text, customer_id, policy_revision_id::text, policy_key, revision
      FROM negative_keyword_account_policy_runtime WHERE organization_id = $1 AND active
    `, [organizationId]);
    const runtimeByCustomer = new Map(runtimeRows.rows.map((row) => [row.customer_id, row]));
    const allProtections: Array<{ entry: PhraseProtection; customerId: string | null }> = [
      ...(base.phraseProtections ?? []).map((entry) => ({ entry, customerId: null })),
      ...accountSeeds.flatMap((account) => account.protections.map((entry) => ({ entry, customerId: account.customerId })))
    ];
    await client.query(`
      UPDATE negative_keyword_phrase_protections
      SET active = false, updated_at = now()
      WHERE organization_id = $1 AND active
        AND (account_id IS NULL OR customer_ids && $2::text[])
    `, [organizationId, accountSeeds.map((account) => account.customerId)]);
    for (const { entry, customerId } of allProtections) {
      const runtime = customerId === null ? null : runtimeByCustomer.get(customerId);
      if (customerId !== null && !runtime) throw new Error(`No enabled runtime revision exists for ${customerId}.`);
      const entryId = entry.id;
      await client.query(`
        INSERT INTO negative_keyword_phrase_protections (
          organization_id, entry_id, phrase, customer_ids,
          rule_id, excused_evidence, active, account_id,
          policy_revision_id, policy_key, revision
        ) VALUES ($1, $2, $3, $4, $5, $6, true, $7::uuid, $8::uuid, $9, $10)
        ON CONFLICT (organization_id, account_id, entry_id) DO UPDATE
          SET phrase = EXCLUDED.phrase,
              customer_ids = EXCLUDED.customer_ids,
              rule_id = EXCLUDED.rule_id,
              excused_evidence = EXCLUDED.excused_evidence,
              active = true, account_id = EXCLUDED.account_id,
              policy_revision_id = EXCLUDED.policy_revision_id,
              policy_key = EXCLUDED.policy_key, revision = EXCLUDED.revision,
              updated_at = now()
      `, [organizationId, entryId, entry.phrase, customerId === null ? [] : [customerId], entry.ruleId, entry.excusedEvidence, runtime?.account_id ?? null, runtime?.policy_revision_id ?? null, runtime?.policy_key ?? null, runtime?.revision ?? null]);
      phraseProtections += 1;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  console.log(JSON.stringify({
    status: "SEEDED",
    organizationId,
    staticRuleSets,
    staticRuleVersion: base.version,
    promptVersion: base.promptVersion,
    accounts: accountSeeds.map((account) => ({
      customerId: account.customerId,
      policyKey: account.policyKey,
      revision: account.revision,
      customRules: account.customRules.length,
      phraseProtections: account.protections.length
    })),
    accountRules,
    phraseProtections
  }, null, 2));
}

await main();
