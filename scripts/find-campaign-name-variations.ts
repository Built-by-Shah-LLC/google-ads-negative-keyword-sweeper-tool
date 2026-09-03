/**
 * Read-only diagnostic: scans campaigns of every allowlisted account and reports
 * names that mention "shah" or "built" but do NOT match the current
 * case-insensitive "contains: built by shah" filter — i.e. variations we may
 * want to include.
 *
 * Usage: npx tsx scripts/find-campaign-name-variations.ts
 */
import { loadConfig } from "../src/config/env.js";
import { GoogleAdsClient } from "../src/google-ads/client.js";
import { fetchOrganizations, filterOrganizationsByAllowlist } from "../src/google-ads/organizations.js";

const config = await loadConfig(process.cwd());
const client = new GoogleAdsClient(config.googleAds);
const needle = (config.campaignNameContains ?? "Built by Shah").toLocaleLowerCase("en-US");

const discovered = await fetchOrganizations(client, config.googleAds.loginCustomerId);
const eligible = filterOrganizationsByAllowlist(discovered, config.accountAllowlist);

const variations = new Map<string, string[]>(); // campaign name -> accounts
for (const org of eligible) {
  try {
    const rows = await client.searchStream(org.customerId, `
      SELECT campaign.id, campaign.name, campaign.status
      FROM campaign
    `);
    for (const row of rows) {
      const name = String((row.campaign as Record<string, unknown> | undefined)?.name ?? "");
      const lower = name.toLocaleLowerCase("en-US");
      if (lower.includes(needle)) continue;
      if (!lower.includes("shah") && !lower.includes("built")) continue;
      const accounts = variations.get(name) ?? [];
      accounts.push(`${org.descriptiveName} (${org.customerId})`);
      variations.set(name, accounts);
    }
  } catch (error) {
    console.log(`ERROR ${org.descriptiveName} (${org.customerId}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`Current filter: case-insensitive contains "${config.campaignNameContains}".\n`);
if (variations.size === 0) {
  console.log("No near-miss variations found: every campaign mentioning 'shah' or 'built' already matches the current filter.");
} else {
  console.log(`Found ${variations.size} campaign name(s) that mention 'shah'/'built' but do NOT match the current filter:\n`);
  for (const [name, accounts] of [...variations.entries()].sort()) {
    console.log(`"${name}"`);
    for (const account of accounts) console.log(`    in ${account}`);
  }
}
