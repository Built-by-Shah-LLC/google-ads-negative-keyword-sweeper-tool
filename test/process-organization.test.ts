import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { GoogleAdsClient } from "../src/google-ads/client.js";
import type { ClassificationContext, KeywordClassifier } from "../src/llm/classifier.js";
import { RunTelemetry } from "../src/observability/run-telemetry.js";
import { processOrganization } from "../src/pipeline/process-organization.js";
import { RunArtifacts } from "../src/storage/run-artifacts.js";
import type { RuleSet } from "../src/types.js";

const rules: RuleSet = {
  version: "test-v1",
  promptVersion: "test-prompt-v1",
  sourcePath: "test-rules.md",
  markdown: "### `POL-COLLISION-KEEP` — Keep collision",
  ruleIds: ["POL-COLLISION-KEEP"]
};

test("writes reconciled organization telemetry and token artifacts", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "negative-sweeper-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const telemetry = new RunTelemetry();
  const artifacts = new RunArtifacts(root, "test-run");
  const queries: string[] = [];
  const googleAds = {
    async searchStream(_customerId: string, query: string): Promise<Record<string, unknown>[]> {
      queries.push(query);
      if (query.includes("campaign_search_term_view")) return [];
      return [{
        campaign: { id: "456", name: "Collision campaign" },
        adGroup: { id: "789", name: "Body shop" },
        searchTermView: { searchTerm: "collision repair near me", status: "NONE" },
        segments: { date: "2026-08-25", keyword: { info: { text: "collision repair", matchType: "BROAD" } } },
        metrics: { impressions: 4, clicks: 1, costMicros: 1000, conversions: 1, conversionsValue: 10 }
      }, {
        campaign: { id: "456", name: "Collision campaign" },
        adGroup: { id: "789", name: "Body shop" },
        searchTermView: { searchTerm: "auto body repair near me", status: "NONE" },
        segments: { date: "2026-08-25", keyword: { info: { text: "body repair", matchType: "BROAD" } } },
        metrics: { impressions: 3, clicks: 1, costMicros: 900, conversions: 0, conversionsValue: 0 }
      }];
    }
  } as unknown as GoogleAdsClient;
  const classifier: KeywordClassifier = {
    provider: "test-provider",
    model: "test-model",
    async countFixedInputTokens() {
      return {
        totalTokens: 321,
        countedAt: new Date().toISOString(),
        definition: "test fixed baseline",
        model: "test-model",
        providerRequestId: "count-1",
        attemptCount: 1,
        retryCount: 0
      };
    },
    async classify(classificationContext: ClassificationContext) {
      const candidate = classificationContext.searchTerms[0]!;
      return {
        validated: {
          decisions: [{
            itemId: candidate.itemId,
            decision: "KEEP",
            negativeText: null,
            ruleIds: ["POL-COLLISION-KEEP"],
            reason: "Collision service intent",
            confidence: 0.99
          }],
          model: "test-model",
          providerRequestId: "generate-1",
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            cachedInputTokens: 0,
            thoughtTokens: 0
          }
        },
        request: { safe: true },
        response: { safe: true },
        attempts: [{
          attempt: 1,
          outcome: "VALIDATED",
          providerRequestId: "generate-1",
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            cachedInputTokens: 0,
            thoughtTokens: 0
          },
          validationError: null,
          httpAttempts: [],
          rawResponse: { safe: true }
        }]
      };
    }
  };

  const summary = await processOrganization({
    customerId: "123",
    descriptiveName: "Test Collision",
    timeZone: "America/New_York",
    currencyCode: "USD"
  }, "2026-08-25", {
    googleAds,
    classifier,
    artifacts,
    telemetry,
    rules,
    batchSize: 1,
    llmLimit: async (task) => task()
  });

  assert.equal(summary.status, "SUCCEEDED");
  assert.deepEqual(summary.dateRange, { startDate: "2026-08-24", endDate: "2026-08-25" });
  assert.equal(summary.decisionCount, 2);
  assert.equal(summary.tokenUsage.fixedInputTokens, 321);
  assert.equal(summary.tokenUsage.inputTokens, 200);
  assert.equal(summary.batchTokenUsage.length, 2);
  const fixed = JSON.parse(await readFile(join(artifacts.runDirectory, "organizations/123/fixed-input-tokens.json"), "utf8"));
  assert.equal(fixed.fixedInput.totalTokens, 321);
  const output = JSON.parse(await readFile(join(artifacts.runDirectory, "organizations/123/llm/batch-0001-output.json"), "utf8"));
  assert.equal(output.status, "VALIDATED");
  assert.equal(output.tokenUsage.outputTokens, 20);
  const secondOutput = JSON.parse(await readFile(join(artifacts.runDirectory, "organizations/123/llm/batch-0002-output.json"), "utf8"));
  assert.equal(secondOutput.tokenUsage.outputTokens, 20);
  const usage = JSON.parse(await readFile(join(artifacts.runDirectory, "organizations/123/token-usage.json"), "utf8"));
  assert.equal(usage.reconciliation.reconciled, true);
  assert.equal(usage.batches.length, 2);
  assert.equal(usage.reconciliation.batchTotals.totalTokens, 240);
  const errors = JSON.parse(await readFile(join(artifacts.runDirectory, "organizations/123/errors.json"), "utf8"));
  assert.deepEqual(errors.errors, []);
  assert.equal(queries.length, 2);
  assert.ok(queries.every((query) => query.includes("segments.date BETWEEN '2026-08-24' AND '2026-08-25'")));
});
