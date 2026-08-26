import type { AppConfig } from "../config/env.js";
import type { RuleSet } from "../types.js";
import { GoogleAdsClient } from "../google-ads/client.js";
import { fetchOrganizations } from "../google-ads/organizations.js";
import { GeminiKeywordClassifier } from "../llm/gemini-classifier.js";
import { RunArtifacts } from "../storage/run-artifacts.js";
import { createLimiter } from "../util/concurrency.js";
import { processOrganization } from "./process-organization.js";

export interface SweepOptions {
  rootDirectory: string;
  date: string | null;
  customerId: string | null;
  organizationLimit: number | null;
  allOrganizations: boolean;
}

export async function runSweeper(config: AppConfig, rules: RuleSet, options: SweepOptions): Promise<{
  runId: string;
  runDirectory: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
}> {
  const artifacts = new RunArtifacts(options.rootDirectory);
  const googleAds = new GoogleAdsClient(config.googleAds);
  const classifier = new GeminiKeywordClassifier(config.llm);
  const startedAt = new Date().toISOString();

  await artifacts.write("run-manifest.json", {
    runId: artifacts.runId,
    status: "RUNNING",
    startedAt,
    requestedDate: options.date,
    readOnly: true,
    ruleVersion: rules.version,
    llm: { provider: classifier.provider, model: classifier.model },
    limits: {
      googleFetchConcurrency: config.googleFetchConcurrency,
      llmConcurrency: config.llm.concurrency,
      llmBatchSize: config.llm.batchSize
    }
  });
  await artifacts.write("rules.json", rules);

  const discovered = await fetchOrganizations(googleAds, config.googleAds.loginCustomerId);
  let selected = discovered;
  if (options.customerId) {
    const customerId = options.customerId.replaceAll("-", "");
    selected = discovered.filter((organization) => organization.customerId === customerId);
    if (selected.length === 0) throw new Error(`Customer ${customerId} was not found as an enabled leaf account.`);
  } else if (!options.allOrganizations) {
    selected = discovered.slice(0, options.organizationLimit ?? 1);
  }

  await artifacts.write("organizations.json", { discovered, selected });
  const fetchLimit = createLimiter(config.googleFetchConcurrency);
  const llmLimit = createLimiter(config.llm.concurrency);
  const summaries = await Promise.all(selected.map((organization) => fetchLimit(() => processOrganization(
    organization,
    options.date,
    {
      googleAds,
      classifier,
      artifacts,
      rules,
      batchSize: config.llm.batchSize,
      llmLimit
    }
  ))));

  const failed = summaries.filter((summary) => summary.status === "FAILED").length;
  const partial = summaries.filter((summary) => summary.status === "PARTIAL").length;
  const status = failed === summaries.length && summaries.length > 0
    ? "FAILED"
    : failed > 0 || partial > 0
      ? "PARTIAL"
      : "SUCCEEDED";
  const summary = {
    runId: artifacts.runId,
    status,
    readOnly: true,
    startedAt,
    completedAt: new Date().toISOString(),
    organizationsDiscovered: discovered.length,
    organizationsSelected: selected.length,
    organizationStatusCounts: {
      succeeded: summaries.filter((item) => item.status === "SUCCEEDED").length,
      partial,
      failed
    },
    rawRows: summaries.reduce((sum, item) => sum + item.rawRowCount, 0),
    candidates: summaries.reduce((sum, item) => sum + item.candidateCount, 0),
    decisions: summaries.reduce((sum, item) => sum + item.decisionCount, 0),
    organizations: summaries
  };
  await artifacts.write("summary.json", summary);
  await artifacts.write("run-manifest.json", {
    runId: artifacts.runId,
    status,
    startedAt,
    completedAt: summary.completedAt,
    requestedDate: options.date,
    readOnly: true,
    ruleVersion: rules.version,
    llm: { provider: classifier.provider, model: classifier.model }
  });
  return { runId: artifacts.runId, runDirectory: artifacts.runDirectory, status };
}
