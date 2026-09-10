import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadGoogleAdsConnectionConfig } from "../src/config/env.js";
import { GoogleAdsClient } from "../src/google-ads/client.js";
import { fetchOrganizations, filterOrganizationsByAllowlist } from "../src/google-ads/organizations.js";
import { createLiveValidationOnlyNegativeKeywordWriter } from "../src/google-ads/negative-keyword-writer.validation.js";
import type { NegativeKeywordCreate } from "../src/google-ads/negative-keyword-writer.js";
import { RunArtifacts } from "../src/storage/run-artifacts.js";

async function main(): Promise<void> {
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const options = parseArguments(process.argv.slice(2));
  const config = await loadGoogleAdsConnectionConfig(rootDirectory);
  const target = options.autoSelectOne
    ? await selectOneTarget(
      new GoogleAdsClient(config.googleAds),
      config.googleAds.loginCustomerId,
      config.accountAllowlist,
      config.campaignNameContains
    )
    : { customerId: digits(options.customerId!), campaignId: digits(options.campaignId!) };
  const customerId = target.customerId;
  const campaignId = target.campaignId;
  const negativeText = options.negativeText ?? `sweeper validation only ${new Date().toISOString().slice(0, 10)}`;
  const operation: NegativeKeywordCreate = {
    operationId: createHash("sha256").update([customerId, campaignId, negativeText].join("\u0000")).digest("hex").slice(0, 24),
    customerId,
    campaignId,
    negativeText,
    sourceItemIds: ["validation-only-smoke"]
  };
  const result = await createLiveValidationOnlyNegativeKeywordWriter(config.googleAds)
    .writeChunk(customerId, [operation]);
  const artifacts = new RunArtifacts(rootDirectory, `validation-only-${Date.now()}`);
  await artifacts.write("mutation-validation.json", {
    completedAt: new Date().toISOString(),
    validateOnly: true,
    googleAdsMutationPerformed: false,
    result
  });
  const failed = result.results.some((item) => item.status !== "VALIDATED");
  process.stdout.write(JSON.stringify({
    status: failed ? "FAILED" : "VALIDATED",
    requestId: result.requestId,
    googleAdsMutationPerformed: false,
    auditPath: resolve(artifacts.runDirectory, "mutation-validation.json")
  }) + "\n");
  if (failed) process.exitCode = 1;
}

function parseArguments(args: string[]): {
  customerId?: string;
  campaignId?: string;
  negativeText?: string;
  autoSelectOne: boolean;
} {
  const values = new Map<string, string>();
  let autoSelectOne = false;
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--auto-select-one") {
      autoSelectOne = true;
      continue;
    }
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("Every validation option requires a value.");
    values.set(key, value);
    index += 1;
  }
  const customerId = values.get("--customer");
  const campaignId = values.get("--campaign");
  const negativeText = values.get("--text");
  if (autoSelectOne && (customerId || campaignId)) {
    throw new Error("Use --auto-select-one or explicit --customer/--campaign, not both.");
  }
  if (!autoSelectOne && (!customerId || !campaignId)) {
    throw new Error("Required: --auto-select-one or --customer CUSTOMER_ID --campaign CAMPAIGN_ID");
  }
  return {
    ...(customerId === undefined ? {} : { customerId }),
    ...(campaignId === undefined ? {} : { campaignId }),
    ...(negativeText === undefined ? {} : { negativeText }),
    autoSelectOne
  };
}

async function selectOneTarget(
  googleAds: GoogleAdsClient,
  loginCustomerId: string,
  allowlist: string[],
  campaignNameContains: string | null
): Promise<{ customerId: string; campaignId: string }> {
  const organizations = filterOrganizationsByAllowlist(
    await fetchOrganizations(googleAds, loginCustomerId),
    allowlist
  );
  for (const organization of organizations) {
    const rows = await googleAds.searchStream(organization.customerId, `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status
      FROM campaign
      WHERE campaign.status != REMOVED
      ORDER BY campaign.id
    `);
    const campaign = rows.map((row) => recordValue(row.campaign)).find((item) => {
      const name = typeof item?.name === "string" ? item.name : "";
      return /^\d+$/u.test(String(item?.id ?? ""))
        && (campaignNameContains === null || name.toLocaleLowerCase("en-US").includes(campaignNameContains.toLocaleLowerCase("en-US")));
    });
    if (campaign) return { customerId: organization.customerId, campaignId: String(campaign.id) };
  }
  throw new Error("No eligible organization with a matching active campaign was found for validation.");
}

function digits(value: string): string {
  const clean = value.replaceAll("-", "");
  if (!/^\d+$/u.test(clean)) throw new Error("Google Ads IDs must contain only digits.");
  return clean;
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
