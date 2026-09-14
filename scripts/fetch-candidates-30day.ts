import { loadConfig } from "../src/config/env.js";
import { GoogleAdsClient } from "../src/google-ads/client.js";
import { fetchOrganizations } from "../src/google-ads/organizations.js";
import { aggregateCandidates, fetchSearchTermsForDateRange } from "../src/google-ads/search-terms.js";
import { createLogger } from "../src/observability/logger.js";
import { RunTelemetry } from "../src/observability/run-telemetry.js";
import { RunArtifacts } from "../src/storage/run-artifacts.js";
import type { DateRange } from "../src/types.js";

// Fetch-only companion to scripts/measure-pnc-30day-kimi.ts.
// Writes organizations/{customerId}/candidates.json in the exact shape the
// Kimi/Moonshot measurement script consumes, so classification runs reuse the
// untouched, tested classifier path with no Google Ads refetch.
const logger = createLogger();
const DEFAULT_RANGE: DateRange = { startDate: "2026-08-09", endDate: "2026-09-07" };

async function main(): Promise<void> {
  const workspace = process.cwd();
  const args = process.argv.slice(2);
  const customerId = optionValue(args, "--customer");
  const label = optionValue(args, "--label");
  if (!customerId || !/^\d{10}$/u.test(customerId)) {
    throw new Error("--customer <ten-digit customer id> is required.");
  }
  if (!label || !/^[a-z0-9-]+$/iu.test(label)) {
    throw new Error("--label <slug> is required (letters, digits, dashes).");
  }
  const dateRange: DateRange = {
    startDate: optionValue(args, "--from") ?? DEFAULT_RANGE.startDate,
    endDate: optionValue(args, "--to") ?? DEFAULT_RANGE.endDate
  };

  const config = await loadConfig(workspace);
  const telemetry = new RunTelemetry({ logger });
  const artifacts = new RunArtifacts(workspace, `fetch-${label}-30day-${timestamp()}`,
    (error, relativePath) => telemetry.error(error, {
      stage: "ARTIFACT_WRITE", code: "ARTIFACT_WRITE_FAILED", retryable: true, details: { relativePath }
    }));
  const googleAds = new GoogleAdsClient(config.googleAds, telemetry);
  const startedAt = new Date().toISOString();

  await artifacts.write("run-manifest.json", {
    runId: artifacts.runId,
    startedAt,
    status: "RUNNING",
    purpose: "Fetch-only 30-day candidate harvest; classification happens in the separate Moonshot measurement run.",
    requestedDateRange: { from: dateRange.startDate, to: dateRange.endDate },
    readOnly: true,
    googleAdsMutationPerformed: false
  });

  const organization = await telemetry.track("ORGANIZATION_DISCOVERY", {}, async () => {
    const discovered = await fetchOrganizations(googleAds, config.googleAds.loginCustomerId);
    const found = discovered.find((item) => item.customerId === customerId);
    if (!found) throw new Error(`Customer ${customerId} was not found as an enabled leaf account.`);
    return found;
  });
  await artifacts.write("organizations.json", { discovered: [organization], selected: [organization] });

  const basePath = `organizations/${organization.customerId}`;
  const rows = await telemetry.track("GOOGLE_SEARCH_TERM_FETCH", { organizationId: organization.customerId }, () =>
    fetchSearchTermsForDateRange(googleAds, organization.customerId, dateRange)
  );
  await artifacts.write(`${basePath}/fetch.json`, { organization, dateRange, fetchedAt: new Date().toISOString(), rows });

  const candidates = aggregateCandidates(rows);
  await artifacts.write(`${basePath}/candidates.json`, { organization, dateRange, candidates });

  const completedAt = new Date().toISOString();
  await artifacts.write("summary.json", {
    runId: artifacts.runId,
    status: "SUCCEEDED",
    readOnly: true,
    startedAt,
    completedAt,
    rawRows: rows.length,
    candidates: candidates.length,
    errorCount: telemetry.snapshot().errors.length
  });
  await artifacts.write("run-manifest.json", {
    runId: artifacts.runId,
    startedAt,
    completedAt,
    status: "SUCCEEDED",
    purpose: "Fetch-only 30-day candidate harvest; classification happens in the separate Moonshot measurement run.",
    requestedDateRange: { from: dateRange.startDate, to: dateRange.endDate },
    readOnly: true,
    googleAdsMutationPerformed: false,
    rawRows: rows.length,
    candidates: candidates.length,
    fatalError: null
  });
  await artifacts.write("telemetry.json", telemetry.snapshot());

  logger.info({
    runDirectory: artifacts.runDirectory,
    customerId: organization.customerId,
    dateRange,
    rawRows: rows.length,
    candidates: candidates.length
  }, "Fetch-only 30-day candidate harvest completed");
}

function optionValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/gu, "");
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Fetch-only 30-day candidate harvest failed");
  process.exitCode = 1;
});
