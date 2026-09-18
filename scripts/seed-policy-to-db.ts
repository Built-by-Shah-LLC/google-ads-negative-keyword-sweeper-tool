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

/**
 * Import the repository's file-based sweeper policy into the database tables
 * created by migration 0024 (negative_keyword_static_rule_sets,
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
  const accountSeeds: AccountSeed[] = [];
  for (const [customerId, seed] of Object.entries(ACCOUNT_POLICIES)) {
    const markdown = await readFile(resolve(rootDirectory, seed.phraseProtectionsFile), "utf8");
    const ruleIds = [...base.ruleIds, ...seed.customRules.map((rule) => rule.id)];
    const protections = parsePhraseProtections(markdown, ruleIds);
    for (const entry of protections) {
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

    // Dynamic account rules: upsert each rule, deactivate rules no longer present.
    for (const account of accountSeeds) {
      for (const rule of account.customRules) {
        await client.query(`
          INSERT INTO negative_keyword_account_rules (
            organization_id, customer_id, policy_key, revision,
            rule_id, title, instruction, active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
          ON CONFLICT (organization_id, customer_id, rule_id) DO UPDATE
            SET policy_key = EXCLUDED.policy_key,
                revision = EXCLUDED.revision,
                title = EXCLUDED.title,
                instruction = EXCLUDED.instruction,
                active = true,
                updated_at = now()
        `, [organizationId, account.customerId, account.policyKey, account.revision,
          rule.id, rule.title, rule.instruction]);
        accountRules += 1;
      }
      const ruleIds = account.customRules.map((rule) => rule.id);
      await client.query(`
        UPDATE negative_keyword_account_rules
        SET active = false, updated_at = now()
        WHERE organization_id = $1 AND customer_id = $2 AND active
          AND NOT (rule_id = ANY($3::text[]))
      `, [organizationId, account.customerId, ruleIds.length > 0 ? ruleIds : [""]]);
    }

    // Phrase protections: agency-wide base entries plus per-account entries.
    const allProtections: Array<{ entry: PhraseProtection }> = [
      ...(base.phraseProtections ?? []).map((entry) => ({ entry })),
      ...accountSeeds.flatMap((account) => account.protections.map((entry) => ({ entry })))
    ];
    const allEntryIds: string[] = [];
    for (const { entry } of allProtections) {
      allEntryIds.push(entry.id);
      await client.query(`
        INSERT INTO negative_keyword_phrase_protections (
          organization_id, entry_id, phrase, customer_ids,
          rule_id, excused_evidence, active
        ) VALUES ($1, $2, $3, $4, $5, $6, true)
        ON CONFLICT (organization_id, entry_id) DO UPDATE
          SET phrase = EXCLUDED.phrase,
              customer_ids = EXCLUDED.customer_ids,
              rule_id = EXCLUDED.rule_id,
              excused_evidence = EXCLUDED.excused_evidence,
              active = true,
              updated_at = now()
      `, [organizationId, entry.id, entry.phrase, entry.customerIds, entry.ruleId, entry.excusedEvidence]);
      phraseProtections += 1;
    }
    await client.query(`
      UPDATE negative_keyword_phrase_protections
      SET active = false, updated_at = now()
      WHERE organization_id = $1 AND active
        AND NOT (entry_id = ANY($2::text[]))
    `, [organizationId, allEntryIds.length > 0 ? allEntryIds : [""]]);

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
