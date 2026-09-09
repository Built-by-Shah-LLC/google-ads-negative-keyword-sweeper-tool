import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { GoogleAdsClient } from "../src/google-ads/client.js";
import { ClassificationFailure, type ClassificationContext, type KeywordClassifier } from "../src/llm/classifier.js";
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
  const progressLogs: Array<{
    level: "info" | "warn";
    fields: Record<string, unknown>;
    message: string;
  }> = [];
  const progressLogger = {
    info(fields: Record<string, unknown>, message: string) {
      progressLogs.push({ level: "info", fields, message });
    },
    warn(fields: Record<string, unknown>, message: string) {
      progressLogs.push({ level: "warn", fields, message });
    }
  };
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
      await new Promise((resolve) => setTimeout(resolve, 20));
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
    llmLimit: async (task) => task(),
    logger: progressLogger,
    batchHeartbeatMs: 5
  });

  assert.equal(summary.status, "SUCCEEDED");
  assert.deepEqual(summary.dateRange, { startDate: "2026-08-25", endDate: "2026-08-25" });
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
  assert.ok(queries.every((query) => query.includes("segments.date BETWEEN '2026-08-25' AND '2026-08-25'")));
  const events = progressLogs.map((entry) => entry.fields.progressEvent);
  assert.equal(events.filter((event) => event === "organization_batch_queued").length, 2);
  assert.equal(events.filter((event) => event === "organization_batch_started").length, 2);
  assert.equal(events.filter((event) => event === "organization_batch_completed").length, 2);
  assert.ok(events.filter((event) => event === "organization_batch_heartbeat").length >= 2);
  assert.equal(events.at(-1), "organization_completed");
  assert.ok(progressLogs.every((entry) => !Object.hasOwn(entry.fields, "customerId")));
  assert.ok(progressLogs.every((entry) => !JSON.stringify(entry.fields).includes("collision repair near me")));
});

test("logs an explicit failed outcome for every failed organization batch", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "negative-sweeper-log-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const logs: Array<{ level: "info" | "warn"; fields: Record<string, unknown> }> = [];
  const logger = {
    info(fields: Record<string, unknown>) { logs.push({ level: "info", fields }); },
    warn(fields: Record<string, unknown>) { logs.push({ level: "warn", fields }); }
  };
  const googleAds = {
    async searchStream(_customerId: string, query: string): Promise<Record<string, unknown>[]> {
      if (query.includes("campaign_search_term_view")) return [];
      return [{
        campaign: { id: "456", name: "Campaign" },
        adGroup: { id: "789", name: "Ad group" },
        searchTermView: { searchTerm: "sample query", status: "NONE" },
        segments: { date: "2026-08-25", keyword: { info: { text: "sample", matchType: "BROAD" } } },
        metrics: { impressions: 1, clicks: 0, costMicros: 0, conversions: 0, conversionsValue: 0 }
      }];
    }
  } as unknown as GoogleAdsClient;
  const classifier: KeywordClassifier = {
    provider: "test-provider",
    model: "test-model",
    async countFixedInputTokens() {
      return {
        totalTokens: 10,
        countedAt: new Date().toISOString(),
        definition: "test",
        model: "test-model",
        providerRequestId: null,
        attemptCount: 1,
        retryCount: 0
      };
    },
    async classify() {
      throw new ClassificationFailure(
        "Test classification failure",
        {},
        [],
        null,
        "test-provider"
      );
    }
  };

  const summary = await processOrganization({
    customerId: "123",
    descriptiveName: "Test",
    timeZone: "UTC",
    currencyCode: "USD"
  }, "2026-08-25", {
    googleAds,
    classifier,
    artifacts: new RunArtifacts(root, "failed-log-test"),
    telemetry: new RunTelemetry(),
    rules,
    batchSize: 50,
    llmLimit: async (task) => task(),
    logger
  });

  assert.equal(summary.status, "FAILED");
  assert.ok(logs.find((entry) => entry.fields.progressEvent === "organization_batch_queued"));
  const failed = logs.find((entry) => entry.fields.progressEvent === "organization_batch_failed");
  assert.ok(failed);
  assert.equal(failed.level, "warn");
  assert.equal(failed.fields.batchPosition, 1);
  assert.equal(failed.fields.batchTotal, 1);
  assert.equal(failed.fields.batchesCompleted, 1);
  assert.equal(failed.fields.batchesRemaining, 0);
  assert.equal(failed.fields.errorCode, "LLM_CLASSIFICATION_FAILED");
  const completed = logs.find((entry) => entry.fields.progressEvent === "organization_completed");
  assert.equal(completed?.fields.organizationStatus, "FAILED");
});


for (const failProvider of [false, true]) {
  test(`all phrase matches reach the LLM; no manufactured KEEP (provider failure: ${failProvider})`, async (context) => {
    const root = await mkdtemp(join(tmpdir(), "phrase-pipeline-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    const artifacts = new RunArtifacts(root, "phrase-run");
    const terms = ["collision service near me", "mobile collision service", "steve collision experts"];
    const googleAds = {
      async searchStream(_customerId: string, query: string) {
        if (query.includes("campaign_search_term_view")) return [];
        return terms.map((searchTerm) => ({
          campaign: { id: "456", name: "Campaign" }, adGroup: { id: "789", name: "Group" },
          searchTermView: { searchTerm, status: "NONE" }, segments: { date: "2026-08-25" },
          metrics: { impressions: 1, clicks: 1, costMicros: 1000, conversions: 0, conversionsValue: 0 }
        }));
      }
    } as unknown as GoogleAdsClient;
    let submittedTerms: string[] = [];
    let countCalls = 0;
    const classifier: KeywordClassifier = {
      provider: "test", model: "test",
      async countFixedInputTokens() {
        countCalls++;
        return { totalTokens: 1, countedAt: new Date().toISOString(), definition: "test", model: "test", providerRequestId: null, attemptCount: 1, retryCount: 0 };
      },
      async classify(context) {
        submittedTerms = context.searchTerms.map((item) => item.searchTerm);
        if (failProvider) throw new Error("Simulated provider failure");
        // Deliberately mock NEGATIVE for every item, even the positive example:
        // this proves the pipeline preserves model decisions instead of forcing KEEP.
        return {
          validated: { decisions: context.searchTerms.map((item) => ({ itemId: item.itemId, decision: "NEGATIVE_EXACT" as const, negativeText: item.searchTerm, ruleIds: ["POL-COMPETITOR-NEGATIVE"], reason: "Mock outcome", confidence: 0.9 })), model: "test", providerRequestId: null, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: 0, thoughtTokens: 0 } },
          request: {}, response: {}, attempts: []
        };
      }
    };
    const summary = await processOrganization({ customerId: "1234567890", descriptiveName: "Shop", timeZone: "UTC", currencyCode: "USD" }, "2026-08-25", {
      googleAds, classifier, artifacts, telemetry: new RunTelemetry(), batchSize: 10, llmLimit: async (fn) => fn(),
      rules: { ...rules, phraseProtections: [
        { id: "service", phrase: "collision service", ruleId: "POL-MECHANICAL-ONLY-NEGATIVE", customerIds: [], excusedEvidence: "Only service describing collision repair" },
        { id: "experts", phrase: "collision experts", ruleId: "POL-COMPETITOR-NEGATIVE", customerIds: [], excusedEvidence: "Only experts describing expertise" }
      ] }
    });
    assert.deepEqual([...submittedTerms].sort(), [...terms].sort());
    assert.equal(countCalls, 1);
    assert.equal(summary.status, failProvider ? "FAILED" : "SUCCEEDED");
    assert.equal(summary.decisions.KEEP, 0);
    assert.equal(summary.decisions.NEGATIVE_EXACT, failProvider ? 0 : 3);
  });
}
