import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadGoogleAdsConnectionConfig } from "../src/config/env.js";
import { GoogleAdsClient } from "../src/google-ads/client.js";
import { createLiveProductionNegativeKeywordWriter } from "../src/google-ads/negative-keyword-writer.prod.js";
import {
  runTestAccountMutationSmoke,
  TEST_ACCOUNT_MUTATION_CONFIRMATION
} from "../src/google-ads/test-account-mutation-smoke.js";
import { RunArtifacts } from "../src/storage/run-artifacts.js";

interface Options {
  customerId?: string;
  campaignId?: string;
  autoSelectOne: boolean;
  confirmation: string;
}

async function main(): Promise<void> {
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const options = parseArguments(process.argv.slice(2));
  const config = await loadGoogleAdsConnectionConfig(rootDirectory, ".env.google-ads-test");
  const googleAdsConfig = config.googleAds;
  const googleAds = new GoogleAdsClient(googleAdsConfig);
  const writer = createLiveProductionNegativeKeywordWriter(googleAdsConfig, true);
  const target = options.autoSelectOne
    ? await selectOneTestTarget(googleAds, googleAdsConfig.loginCustomerId)
    : { customerId: options.customerId!, campaignId: options.campaignId! };
  const uniqueText = `sweeper api test ${new Date().toISOString().slice(0, 10)} ${randomUUID().slice(0, 8)}`;
  const artifacts = new RunArtifacts(rootDirectory, `test-account-mutation-${Date.now()}`);
  const startedAt = new Date().toISOString();
  await artifacts.write("mutation-smoke.json", {
    status: "STARTED",
    startedAt,
    customerId: target.customerId.replaceAll("-", ""),
    campaignId: target.campaignId.replaceAll("-", ""),
    negativeText: uniqueText
  });
  let summary: Awaited<ReturnType<typeof runTestAccountMutationSmoke>>;
  try {
    summary = await runTestAccountMutationSmoke({
      googleAds,
      writer,
      customerId: target.customerId,
      campaignId: target.campaignId,
      negativeText: uniqueText,
      confirmation: options.confirmation
    });
    await artifacts.write("mutation-smoke.json", {
      status: "COMPLETED",
      startedAt,
      completedAt: new Date().toISOString(),
      summary
    });
  } catch (error) {
    await artifacts.write("mutation-smoke.json", {
      status: "FAILED",
      startedAt,
      completedAt: new Date().toISOString(),
      customerId: target.customerId.replaceAll("-", ""),
      campaignId: target.campaignId.replaceAll("-", ""),
      negativeText: uniqueText,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
  process.stdout.write(JSON.stringify({
    status: summary.status,
    appliedCount: summary.appliedCount,
    verifiedCount: summary.verifiedCount,
    auditPath: resolve(artifacts.runDirectory, "mutation-smoke.json")
  }) + "\n");
}

function parseArguments(args: string[]): Options {
  const values = new Map<string, string>();
  let autoSelectOne = false;
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--auto-select-one") {
      autoSelectOne = true;
      continue;
    }
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("Every test-account option requires a value.");
    values.set(key, value);
    index += 1;
  }
  const customerId = values.get("--customer");
  const campaignId = values.get("--campaign");
  const confirmation = values.get("--confirmation");
  if (autoSelectOne && (customerId || campaignId)) {
    throw new Error("Use --auto-select-one or explicit --customer/--campaign, not both.");
  }
  if ((!autoSelectOne && (!customerId || !campaignId)) || !confirmation) {
    throw new Error(
      "Required: --auto-select-one (or --customer TEST_CUSTOMER --campaign TEST_CAMPAIGN) " +
      `--confirmation ${TEST_ACCOUNT_MUTATION_CONFIRMATION}`
    );
  }
  return {
    ...(customerId === undefined ? {} : { customerId }),
    ...(campaignId === undefined ? {} : { campaignId }),
    autoSelectOne,
    confirmation
  };
}

async function selectOneTestTarget(
  googleAds: GoogleAdsClient,
  loginCustomerId: string
): Promise<{ customerId: string; campaignId: string }> {
  const accounts = await googleAds.searchStream(loginCustomerId, `
    SELECT
      customer_client.id,
      customer_client.manager,
      customer_client.status,
      customer_client.test_account
    FROM customer_client
  `);
  const testCustomerIds = accounts
    .map((row) => recordValue(row.customerClient))
    .filter((item) => item?.manager !== true && item?.testAccount === true)
    .map((item) => String(item?.id ?? ""))
    .filter((id) => /^\d+$/u.test(id));
  for (const customerId of testCustomerIds) {
    const campaigns = await googleAds.searchStream(customerId, `
      SELECT
        campaign.id,
        campaign.status
      FROM campaign
      WHERE campaign.status != REMOVED
      ORDER BY campaign.id
    `);
    const campaign = campaigns.map((row) => recordValue(row.campaign))
      .find((item) => /^\d+$/u.test(String(item?.id ?? "")));
    if (campaign) return { customerId, campaignId: String(campaign.id) };
  }
  throw new Error("The isolated Google Ads test hierarchy has no test client with an active campaign.");
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
