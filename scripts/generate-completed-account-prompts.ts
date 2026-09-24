import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { ACCOUNT_POLICIES } from "../src/config/account-policies.js";
import { compileAccountPolicy, type AccountPolicyConfig } from "../src/config/account-policy-compiler.js";
import { loadConfig, loadEnvironment } from "../src/config/env.js";
import { parsePhraseProtections } from "../src/config/phrase-protections.js";
import { loadRuleSet } from "../src/config/rule-set.js";
import { GoogleAdsClient } from "../src/google-ads/client.js";
import { fetchPositiveKeywords } from "../src/google-ads/positive-keywords.js";
import { buildClassifierPrompt } from "../src/llm/prompt.js";
import type { PositiveKeywordCriterion } from "../src/types.js";

/**
 * Generate the company-level fixed LLM prompt for every completed 30-day
 * company. This does not run an LLM,
 * mutate Google Ads, start a sweep, persist rows, or send email.
 *
 * By default, positive keywords are read live from Google Ads. During an auth
 * outage, --allow-historical-fallback reconstructs the observed subset from
 * immutable search-term facts in PostgreSQL and labels the output prominently.
 *
 * Usage:
 *   npm run policy:render-completed-prompts
 *   npm run policy:render-completed-prompts -- --allow-historical-fallback
 */

const outputDirectory = resolve("docs", "company-llm-prompts");
const allowHistoricalFallback = process.argv.includes("--allow-historical-fallback");

interface CompletionState {
  version: number;
  completed: Record<string, { completedAt: string; source: string }>;
}

interface AccountIdentity {
  customerId: string;
  name: string;
  timeZone: string;
}

interface HistoricalKeywordRow {
  campaign_id: string;
  campaign_name: string;
  ad_group_id: string | null;
  ad_group_name: string | null;
  matched_keyword_text: string;
  matched_keyword_match_type: string | null;
  fetched_at: string;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const completionState = JSON.parse(
    await readFile(resolve(root, "data", "sweep-30day-state.json"), "utf8")
  ) as CompletionState;
  const completedIds = Object.keys(completionState.completed);
  if (completedIds.length !== 15) {
    throw new Error(`Expected 15 completed companies, found ${completedIds.length}.`);
  }

  const config = await loadConfig(root);
  const env = await loadEnvironment(root);
  if (!config.persistence.enabled) {
    throw new Error("PERSIST_RUNS_TO_DATABASE must be true so account identity and fallback evidence can be read.");
  }
  const databaseUrl = env.POLICY_ADMIN_DATABASE_URL ?? config.persistence.databaseUrl;
  const organizationId = config.persistence.organizationId;
  const identities = await loadAccountIdentities(
    databaseUrl,
    organizationId,
    completedIds
  );
  const base = await loadRuleSet(root);
  const policies = await loadSeedPolicies(root, base.ruleIds, completedIds);
  const googleAds = new GoogleAdsClient(config.googleAds);

  await mkdir(outputDirectory, { recursive: true });
  const manifest: Array<Record<string, unknown>> = [];
  let liveGoogleAdsAvailable = true;
  for (const customerId of completedIds) {
    const identity = identities.get(customerId);
    if (!identity) throw new Error(`No active client account mapping found for ${customerId}.`);
    const policy = await compileAccountPolicy(base, customerId, policies);
    if (!policy.manifest) throw new Error(`No account policy seed found for ${customerId}.`);

    let positiveKeywords: PositiveKeywordCriterion[];
    let positiveSource = "live-google-ads";
    let sourceWarning: string | null = null;
    try {
      if (!liveGoogleAdsAvailable) throw new Error("Live Google Ads was unavailable earlier in this generation run.");
      positiveKeywords = await fetchPositiveKeywords(googleAds, customerId);
    } catch (error) {
      if (!allowHistoricalFallback) throw error;
      liveGoogleAdsAvailable = false;
      positiveKeywords = await loadHistoricalObservedKeywords(
        databaseUrl,
        organizationId,
        customerId
      );
      positiveSource = "historical-observed-search-term-facts";
      sourceWarning =
        "LIVE GOOGLE ADS AUTHENTICATION WAS UNAVAILABLE. This inventory contains only positive " +
        "keywords observed in retained search-term facts and can omit zero-impression, paused, " +
        "or newly added criteria. Regenerate without --allow-historical-fallback before production use.";
    }

    const prompt = buildClassifierPrompt({
      account: {
        customerId,
        descriptiveName: identity.name,
        timeZone: identity.timeZone
      },
      dateRange: { startDate: "1970-01-01", endDate: "1970-01-01" },
      rules: policy.rules,
      searchTerms: [],
      positiveKeywords
    });
    const outputPath = resolve(outputDirectory, `${customerId}-${policy.manifest.policyKey}.md`);
    await writeFile(outputPath, renderMarkdown({
      identity,
      generatedAt: new Date().toISOString(),
      positiveSource,
      sourceWarning,
      positiveKeywords,
      policyManifest: policy.manifest,
      systemInstruction: prompt.systemInstruction,
      userPrompt: prompt.userPrompt
    }), "utf8");
    manifest.push({
      customerId,
      name: identity.name,
      file: outputPath.replace(`${root}\\`, "").replaceAll("\\", "/"),
      policyKey: policy.manifest.policyKey,
      revision: policy.manifest.revision,
      dynamicRules: policy.manifest.dynamicRuleIds.length,
      accountPhraseProtections: policy.manifest.accountPhraseProtectionCount,
      positiveKeywords: positiveKeywords.length,
      positiveSource,
      requiresLiveRefresh: sourceWarning !== null
    });
    console.log(`${customerId} ${identity.name}: ${positiveKeywords.length} positive keywords (${positiveSource})`);
  }

  await writeFile(
    resolve(outputDirectory, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), accounts: manifest }, null, 2) + "\n",
    "utf8"
  );
}

async function loadSeedPolicies(
  root: string,
  baseRuleIds: string[],
  customerIds: string[]
): Promise<Record<string, AccountPolicyConfig>> {
  const policies: Record<string, AccountPolicyConfig> = {};
  for (const customerId of customerIds) {
    const seed = ACCOUNT_POLICIES[customerId];
    if (!seed) throw new Error(`Missing account policy seed for ${customerId}.`);
    const markdown = await readFile(resolve(root, seed.phraseProtectionsFile), "utf8");
    policies[customerId] = {
      policyKey: seed.policyKey,
      revision: seed.revision,
      customRules: seed.customRules,
      phraseProtections: parsePhraseProtections(markdown, [
        ...baseRuleIds,
        ...seed.customRules.map((rule) => rule.id)
      ])
    };
  }
  return policies;
}

async function loadAccountIdentities(
  databaseUrl: string,
  organizationId: string,
  customerIds: string[]
): Promise<Map<string, AccountIdentity>> {
  const client = new Client({ connectionString: databaseUrl, application_name: "prompt-generator-read-only" });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
    const result = await client.query<{
      google_customer_id: string;
      google_account_name: string;
      account_time_zone: string;
    }>(`
      SELECT google_customer_id, google_account_name, account_time_zone
      FROM client_accounts
      WHERE organization_id = $1
        AND trim(google_customer_id) = ANY($2::text[])
        AND onboarding_status <> 'archived'
    `, [organizationId, customerIds]);
    await client.query("ROLLBACK");
    return new Map(result.rows.map((row) => [row.google_customer_id.trim(), {
      customerId: row.google_customer_id.trim(),
      name: row.google_account_name,
      timeZone: row.account_time_zone
    }]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function loadHistoricalObservedKeywords(
  databaseUrl: string,
  organizationId: string,
  customerId: string
): Promise<PositiveKeywordCriterion[]> {
  const client = new Client({ connectionString: databaseUrl, application_name: "prompt-generator-fallback-read-only" });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
    const result = await client.query<HistoricalKeywordRow>(`
      SELECT DISTINCT ON (
        fact.campaign_id, coalesce(fact.ad_group_id, ''), lower(fact.matched_keyword_text),
        coalesce(fact.matched_keyword_match_type, '')
      )
        fact.campaign_id,
        fact.campaign_name,
        fact.ad_group_id,
        fact.ad_group_name,
        fact.matched_keyword_text,
        fact.matched_keyword_match_type,
        fact.fetched_at::text
      FROM negative_keyword_search_term_facts fact
      JOIN negative_keyword_sweep_account_runs account_run
        ON account_run.organization_id = fact.organization_id
       AND account_run.id = fact.sweep_account_run_id
      WHERE fact.organization_id = $1
        AND trim(account_run.google_customer_id) = $2
        AND fact.matched_keyword_text IS NOT NULL
        AND length(trim(fact.matched_keyword_text)) > 0
      ORDER BY
        fact.campaign_id, coalesce(fact.ad_group_id, ''), lower(fact.matched_keyword_text),
        coalesce(fact.matched_keyword_match_type, ''), fact.fetched_at DESC
    `, [organizationId, customerId]);
    await client.query("ROLLBACK");
    return result.rows.map((row, index) => ({
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      campaignStatus: "ENABLED_AT_OBSERVATION",
      adGroupId: row.ad_group_id ?? "0",
      adGroupName: row.ad_group_name ?? "",
      adGroupStatus: "ENABLED_AT_OBSERVATION",
      criterionId: String(index + 1),
      criterionStatus: "ENABLED_AT_OBSERVATION",
      keywordText: row.matched_keyword_text,
      normalizedKeywordText: row.matched_keyword_text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US"),
      matchType: row.matched_keyword_match_type ?? "UNKNOWN",
      active: true
    }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

function renderMarkdown(input: {
  identity: AccountIdentity;
  generatedAt: string;
  positiveSource: string;
  sourceWarning: string | null;
  positiveKeywords: PositiveKeywordCriterion[];
  policyManifest: NonNullable<Awaited<ReturnType<typeof compileAccountPolicy>>["manifest"]>;
  systemInstruction: string;
  userPrompt: string;
}): string {
  const warning = input.sourceWarning === null
    ? ""
    : `\n> [!WARNING]\n> ${input.sourceWarning}\n`;
  return [
    `# ${input.identity.name} — LLM fixed prompt context`,
    "",
    `- Google Ads customer ID: \`${input.identity.customerId}\``,
    `- Generated at: \`${input.generatedAt}\``,
    `- Policy: \`${input.policyManifest.policyKey}\` revision \`${input.policyManifest.revision}\``,
    `- Base rule version: \`${input.policyManifest.baseRuleVersion}\``,
    `- Dynamic rules: ${input.policyManifest.dynamicRuleIds.length}`,
    `- Account phrase protections: ${input.policyManifest.accountPhraseProtectionCount}`,
    `- Positive keywords: ${input.positiveKeywords.length}`,
    `- Positive-keyword source: \`${input.positiveSource}\``,
    warning,
    "This is the exact company-level fixed context produced by the shared prompt builder.",
    "The candidate list and per-item matched-protection map are intentionally empty here;",
    "the runtime fills those two variable sections separately for every LLM batch.",
    "",
    "## System instruction",
    "",
    input.systemInstruction,
    "",
    "## User prompt",
    "",
    input.userPrompt,
    ""
  ].join("\n");
}

await main();
