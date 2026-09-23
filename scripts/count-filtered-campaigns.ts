/**
 * Read-only diagnostic: counts campaigns that pass the daily sweep status
 * policy for every company in config/sweep-accounts.json. This does not fetch
 * search terms, invoke an LLM, write reports, or perform mutations.
 *
 * Usage: npx tsx scripts/count-filtered-campaigns.ts
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadGoogleAdsConnectionConfig } from "../src/config/env.js";
import { fetchCampaignsPassingSweepFilter } from "../src/google-ads/campaign-filter.js";
import { GoogleAdsClient } from "../src/google-ads/client.js";

interface SweepAccount {
  customerId: string;
  name: string;
}

const rootDirectory = process.cwd();
const connection = await loadGoogleAdsConnectionConfig(rootDirectory);
const googleAds = new GoogleAdsClient(connection.googleAds);
const accounts = JSON.parse(
  await readFile(resolve(rootDirectory, "config/sweep-accounts.json"), "utf8")
) as SweepAccount[];

for (const account of accounts) {
  try {
    const passing = await fetchCampaignsPassingSweepFilter(googleAds, account.customerId);
    const eligible = passing.filter((campaign) => campaign.campaignPrimaryStatus === "ELIGIBLE").length;
    const limited = passing.filter((campaign) => campaign.campaignPrimaryStatus === "LIMITED").length;
    process.stdout.write(`${JSON.stringify({
      customerId: account.customerId,
      company: account.name,
      campaignCount: passing.length,
      eligibleCount: eligible,
      approvedLimitedCount: limited
    })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      customerId: account.customerId,
      company: account.name,
      error: error instanceof Error ? error.message : String(error)
    })}\n`);
  }
}
