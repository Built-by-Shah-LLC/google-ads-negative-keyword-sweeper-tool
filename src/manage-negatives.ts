import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadGoogleAdsConnectionConfig } from "./config/env.js";
import { GoogleAdsClient } from "./google-ads/client.js";
import { createLiveGoogleAdsMutationTransport } from "./google-ads/negative-keyword-writer.prod.js";
import {
  NegativeCriteriaManager,
  type NegativeCriteriaManagementSummary,
  type NegativeMatchType,
  type NegativeScope
} from "./google-ads/negative-criteria-manager.js";

const USAGE = `Manage Google Ads negative keywords directly against the live API.

Usage:
  npm run negatives:manage -- --customer <id> --scope campaign|account [options]

Required:
  --customer <10-digit customer id>   Target account (dashes allowed).
  --scope campaign|account            campaign = campaign-level negatives,
                                      account = customer-level negatives.

Options:
  --campaign-id <id>                  Required when --scope campaign.
  --add "text"                        Negative keyword to add (repeatable).
  --remove "text"                     Negative keyword to remove (repeatable); the
                                      existing criterion is looked up via GAQL first.
  --match-type EXACT|PHRASE           Match type for --add/--remove (default EXACT).
                                      BROAD is never allowed (the API forbids it at
                                      account level anyway).
  --validate-only                     Stop after validateOnly=true requests.
  --confirm-live                      Required to run real mutations. Without it the
                                      tool only validates and changes nothing.
  --help                              Show this message.

Environment is loaded from the repo .env exactly like the other tools
(GOOGLE_ADS_DEVELOPER_TOKEN / LOGIN_CUSTOMER_ID / CLIENT_ID / CLIENT_SECRET /
REFRESH_TOKEN, optional GOOGLE_ADS_API_VERSION).`;

interface CliOptions {
  customerId: string;
  scope: NegativeScope;
  campaignId: string | null;
  add: string[];
  remove: string[];
  matchType: NegativeMatchType;
  validateOnly: boolean;
  confirmLive: boolean;
}

async function main(): Promise<void> {
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const options = parseArguments(process.argv.slice(2));
  const config = await loadGoogleAdsConnectionConfig(rootDirectory);

  const dryRun = options.validateOnly || !options.confirmLive;
  if (!options.confirmLive && !options.validateOnly) {
    process.stdout.write(
      "No --confirm-live flag: running in validate-only mode. No Google Ads mutation will be applied.\n"
    );
  }

  const googleAds = new GoogleAdsClient(config.googleAds);
  const manager = new NegativeCriteriaManager(
    createLiveGoogleAdsMutationTransport(config.googleAds),
    (customerId, query) => googleAds.searchStream(customerId, query)
  );

  const summary = await manager.run({
    customerId: options.customerId,
    scope: options.scope,
    ...(options.campaignId === null ? {} : { campaignId: options.campaignId }),
    add: options.add,
    remove: options.remove,
    matchType: options.matchType,
    dryRun
  });
  printSummary(summary);
  if (summary.failedCount > 0) process.exitCode = 1;
}

function printSummary(summary: NegativeCriteriaManagementSummary): void {
  const lines = [
    "",
    `Negative-keyword management ${summary.dryRun ? "(VALIDATE-ONLY, nothing applied)" : "(LIVE)"}`,
    `  customer:  ${summary.customerId}`,
    `  scope:     ${summary.scope}${summary.campaignId ? ` (campaign ${summary.campaignId})` : ""}`,
    `  matchType: ${summary.matchType}`,
    `  validated: ${summary.validatedCount}  applied: ${summary.appliedCount}  failed: ${summary.failedCount}`,
    `  googleAdsMutationPerformed: ${summary.googleAdsMutationPerformed}`,
    ...(summary.requestIds.length > 0 ? [`  requestIds: ${summary.requestIds.join(", ")}`] : []),
    ""
  ];
  for (const result of summary.results) {
    const detail = result.status === "FAILED"
      ? `error: ${result.error ?? "unknown"}`
      : result.resourceName
        ? result.resourceName
        : "ok";
    lines.push(`  [${result.status}] ${result.action} ${result.matchType} "${result.text}" -> ${detail}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}

function parseArguments(args: string[]): CliOptions {
  const add: string[] = [];
  const remove: string[] = [];
  let customerId: string | null = null;
  let scope: NegativeScope | null = null;
  let campaignId: string | null = null;
  let matchType: NegativeMatchType = "EXACT";
  let validateOnly = false;
  let confirmLive = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(USAGE + "\n");
      process.exit(0);
    }
    if (argument === "--validate-only") {
      validateOnly = true;
      continue;
    }
    if (argument === "--confirm-live") {
      confirmLive = true;
      continue;
    }
    if (argument === "--customer" || argument === "--scope" || argument === "--campaign-id"
      || argument === "--match-type" || argument === "--add" || argument === "--remove") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--customer") {
        if (!/^[\d-]+$/u.test(value)) throw new Error("--customer must be a Google Ads customer ID.");
        customerId = value;
      } else if (argument === "--scope") {
        const normalized = value.trim().toLowerCase();
        if (normalized !== "campaign" && normalized !== "account") {
          throw new Error("--scope must be campaign or account.");
        }
        scope = normalized;
      } else if (argument === "--campaign-id") {
        if (!/^[\d-]+$/u.test(value)) throw new Error("--campaign-id must be a Google Ads campaign ID.");
        campaignId = value;
      } else if (argument === "--match-type") {
        const normalized = value.trim().toUpperCase();
        if (normalized !== "EXACT" && normalized !== "PHRASE") {
          throw new Error("--match-type must be EXACT or PHRASE (BROAD is not supported).");
        }
        matchType = normalized;
      } else if (argument === "--add") {
        add.push(value);
      } else {
        remove.push(value);
      }
      continue;
    }
    throw new Error(`Unknown argument '${argument}'.\n\n${USAGE}`);
  }

  if (!customerId) throw new Error("--customer is required.\n\n" + USAGE);
  if (!scope) throw new Error("--scope is required.\n\n" + USAGE);
  if (scope === "campaign" && !campaignId) {
    throw new Error("--campaign-id is required when --scope campaign.");
  }
  if (scope === "account" && campaignId) {
    throw new Error("--campaign-id is only valid with --scope campaign.");
  }
  if (add.length === 0 && remove.length === 0) {
    throw new Error("Provide at least one --add or --remove value.");
  }
  return { customerId, scope, campaignId, add, remove, matchType, validateOnly, confirmLive };
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
