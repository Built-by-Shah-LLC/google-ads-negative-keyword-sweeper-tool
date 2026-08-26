import type { Organization, RuleSet } from "../types.js";
import type { GoogleAdsClient } from "../google-ads/client.js";
import { aggregateCandidates, fetchDailySearchTerms } from "../google-ads/search-terms.js";
import type { KeywordClassifier } from "../llm/classifier.js";
import type { RunArtifacts } from "../storage/run-artifacts.js";
import { createDecisionCsv } from "../storage/decision-csv.js";
import { chunksOf, type Limit } from "../util/concurrency.js";

export interface OrganizationSummary {
  customerId: string;
  descriptiveName: string;
  date: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  rawRowCount: number;
  candidateCount: number;
  decisionCount: number;
  failedBatchCount: number;
  decisions: Record<string, number>;
  error?: string;
}

interface ProcessOrganizationDependencies {
  googleAds: GoogleAdsClient;
  classifier: KeywordClassifier;
  artifacts: RunArtifacts;
  rules: RuleSet;
  batchSize: number;
  llmLimit: Limit;
}

export async function processOrganization(
  organization: Organization,
  requestedDate: string | null,
  dependencies: ProcessOrganizationDependencies
): Promise<OrganizationSummary> {
  const date = requestedDate || previousDateInTimeZone(organization.timeZone);
  const basePath = `organizations/${organization.customerId}`;
  try {
    const rows = await fetchDailySearchTerms(dependencies.googleAds, organization.customerId, date);
    await dependencies.artifacts.write(`${basePath}/fetch.json`, {
      organization,
      date,
      fetchedAt: new Date().toISOString(),
      rows
    });

    const candidates = aggregateCandidates(rows);
    await dependencies.artifacts.write(`${basePath}/candidates.json`, {
      organization,
      date,
      candidates
    });

    if (candidates.length === 0) {
      const summary = createSummary(organization, date, rows.length, 0, [], 0);
      await dependencies.artifacts.write(`${basePath}/decisions.json`, { decisions: [] });
      await dependencies.artifacts.writeText(
        `${basePath}/llm-decisions.csv`,
        createDecisionCsv(
          organization,
          date,
          candidates,
          [],
          dependencies.classifier.model,
          dependencies.rules.version
        )
      );
      await dependencies.artifacts.write(`${basePath}/summary.json`, summary);
      return summary;
    }

    const batches = chunksOf(candidates, dependencies.batchSize);
    const settled = await Promise.allSettled(batches.map((batch, index) => dependencies.llmLimit(async () => {
      const batchId = String(index + 1).padStart(4, "0");
      const context = {
        account: {
          customerId: organization.customerId,
          descriptiveName: organization.descriptiveName,
          timeZone: organization.timeZone
        },
        date,
        rules: dependencies.rules,
        searchTerms: batch
      };
      await dependencies.artifacts.write(`${basePath}/llm/batch-${batchId}-input.json`, {
        provider: dependencies.classifier.provider,
        model: dependencies.classifier.model,
        ...context
      });
      try {
        const result = await dependencies.classifier.classify(context);
        await dependencies.artifacts.write(`${basePath}/llm/batch-${batchId}-output.json`, {
          provider: dependencies.classifier.provider,
          model: dependencies.classifier.model,
          providerRequestId: result.validated.providerRequestId,
          usage: result.validated.usage,
          providerRequest: result.request,
          rawResponse: result.response,
          decisions: result.validated.decisions
        });
        return result.validated.decisions;
      } catch (error) {
        await dependencies.artifacts.write(`${basePath}/llm/batch-${batchId}-error.json`, {
          failedAt: new Date().toISOString(),
          error: errorMessage(error)
        });
        throw error;
      }
    })));

    const decisions = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const failedBatchCount = settled.filter((result) => result.status === "rejected").length;
    await dependencies.artifacts.write(`${basePath}/decisions.json`, {
      ruleVersion: dependencies.rules.version,
      provider: dependencies.classifier.provider,
      model: dependencies.classifier.model,
      decisions
    });
    await dependencies.artifacts.writeText(
      `${basePath}/llm-decisions.csv`,
      createDecisionCsv(
        organization,
        date,
        candidates,
        decisions,
        dependencies.classifier.model,
        dependencies.rules.version
      )
    );
    const summary = createSummary(
      organization,
      date,
      rows.length,
      candidates.length,
      decisions,
      failedBatchCount
    );
    await dependencies.artifacts.write(`${basePath}/summary.json`, summary);
    return summary;
  } catch (error) {
    const summary: OrganizationSummary = {
      customerId: organization.customerId,
      descriptiveName: organization.descriptiveName,
      date,
      status: "FAILED",
      rawRowCount: 0,
      candidateCount: 0,
      decisionCount: 0,
      failedBatchCount: 0,
      decisions: {},
      error: errorMessage(error)
    };
    await dependencies.artifacts.write(`${basePath}/summary.json`, summary);
    return summary;
  }
}

function createSummary(
  organization: Organization,
  date: string,
  rawRowCount: number,
  candidateCount: number,
  decisions: Array<{ decision: string }>,
  failedBatchCount: number
): OrganizationSummary {
  const counts: Record<string, number> = { KEEP: 0, HUMAN_REVIEW: 0, NEGATIVE_EXACT: 0 };
  for (const decision of decisions) counts[decision.decision] = (counts[decision.decision] || 0) + 1;
  return {
    customerId: organization.customerId,
    descriptiveName: organization.descriptiveName,
    date,
    status: candidateCount > 0 && decisions.length === 0
      ? "FAILED"
      : failedBatchCount > 0
        ? "PARTIAL"
        : "SUCCEEDED",
    rawRowCount,
    candidateCount,
    decisionCount: decisions.length,
    failedBatchCount,
    decisions: counts
  };
}

export function previousDateInTimeZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localMidnightUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  return new Date(localMidnightUtc - 86_400_000).toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
