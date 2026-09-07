/**
 * Read-only diagnostic: for every allowlisted account, lists campaigns and how many
 * contain the configured CAMPAIGN_NAME_CONTAINS text (default "Built by Shah").
 * Also reports allowlist entries that matched no discovered account.
 *
 * Usage: npx tsx scripts/check-built-by-shah-campaigns.ts
 */
import { loadConfig } from "../src/config/env.js";
import { GoogleAdsClient } from "../src/google-ads/client.js";
import { fetchOrganizations, filterOrganizationsByAllowlist } from "../src/google-ads/organizations.js";

const config = await loadConfig(process.cwd());
const client = new GoogleAdsClient(config.googleAds);
const needle = (config.campaignNameContains ?? "Built by Shah").toLocaleLowerCase("en-US");

const discovered = await fetchOrganizations(client, config.googleAds.loginCustomerId);
const eligible = filterOrganizationsByAllowlist(discovered, config.accountAllowlist);

const matchedIds = new Set(eligible.map((org) => org.customerId));
const matchedNames = new Set(eligible.map((org) => org.descriptiveName.toLocaleLowerCase("en-US")));
const unmatchedEntries = config.accountAllowlist.filter((entry) => {
  const digits = entry.replace(/[\s-]/gu, "");
  if (/^\d+$/u.test(digits)) return !matchedIds.has(digits);
  return ![...matchedNames].some((name) => name.includes(entry.toLocaleLowerCase("en-US")));
});

console.log(`Discovered ${discovered.length} enabled leaf accounts under MCC ${config.googleAds.loginCustomerId}.`);
console.log(`Allowlist entries: ${config.accountAllowlist.length}; matched accounts: ${eligible.length}.`);
if (unmatchedEntries.length > 0) {
  console.log(`Allowlist entries matching NO discovered account (${unmatchedEntries.length}):`);
  for (const entry of unmatchedEntries) console.log(`  - ${entry}`);
}
console.log("");

let accountsWithMatch = 0;
for (const org of eligible) {
  try {
    const rows = await client.searchStream(org.customerId, `
      SELECT campaign.id, campaign.name, campaign.status
      FROM campaign
    `);
    const names = rows.map((row) => String((row.campaign as Record<string, unknown> | undefined)?.name ?? ""));
    const matching = names.filter((name) => name.toLocaleLowerCase("en-US").includes(needle));
    if (matching.length > 0) accountsWithMatch += 1;
    const flag = matching.length > 0 ? "MATCH" : "no match";
    console.log(`${flag.padEnd(8)} ${org.descriptiveName} (${org.customerId}): ${matching.length}/${names.length} campaigns contain "${config.campaignNameContains}"`);
    for (const name of matching) console.log(`         -> ${name}`);
  } catch (error) {
    console.log(`ERROR    ${org.descriptiveName} (${org.customerId}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("");
console.log(`Accounts with at least one matching campaign: ${accountsWithMatch}/${eligible.length}`);
