import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config/env.js";
import { GeminiKeywordClassifier } from "../src/llm/gemini-classifier.js";
import type { ClassificationCandidate, RuleSet } from "../src/types.js";

const llmConfig: AppConfig["llm"] = {
  apiKey: "test-key",
  model: "gemini-test-model",
  batchSize: 30,
  concurrency: 3
};
const rules: RuleSet = {
  version: "test",
  policy: "test policy",
  rules: [{ id: "RULE-1", title: "Rule", instruction: "Keep it", examples: [] }]
};
const candidate: ClassificationCandidate = {
  itemId: "item-1",
  customerId: "123",
  date: "2026-08-25",
  channel: "SEARCH",
  campaignId: "456",
  campaignName: "Campaign",
  adGroupId: "789",
  adGroupName: "Ad group",
  searchTerm: "collision repair near me",
  targetingStatus: "NONE",
  matchedKeyword: "collision repair",
  matchedKeywordMatchType: "BROAD",
  impressions: 10,
  clicks: 2,
  costMicros: 500000,
  conversions: 1,
  conversionValue: 100
};

test("Gemini adapter requests deterministic structured output and validates it", async (context) => {
  const originalFetch = globalThis.fetch;
  const captured: { request?: Record<string, any> } = {};
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_input, init) => {
    captured.request = JSON.parse(String(init?.body)) as Record<string, any>;
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        decisions: [{
          itemId: "item-1",
          decision: "KEEP",
          negativeText: null,
          ruleIds: ["RULE-1"],
          reason: "Qualified collision intent",
          confidence: 0.95
        }]
      }) }] } }],
      usageMetadata: { totalTokenCount: 42 }
    }), { status: 200, headers: { "x-request-id": "request-1" } });
  };

  const classifier = new GeminiKeywordClassifier(llmConfig);
  const result = await classifier.classify({
    account: { customerId: "123", descriptiveName: "Shop", timeZone: "America/New_York" },
    date: "2026-08-25",
    rules,
    searchTerms: [candidate]
  });

  assert.equal(result.validated.decisions[0]?.decision, "KEEP");
  assert.equal(result.validated.providerRequestId, "request-1");
  assert.ok(captured.request);
  const sentRequest = captured.request;
  assert.equal(sentRequest.generationConfig.temperature, 0);
  assert.equal(sentRequest.generationConfig.seed, 260826);
  assert.equal(sentRequest.generationConfig.responseMimeType, "application/json");
  assert.equal(sentRequest.generationConfig.responseJsonSchema.properties.decisions.minItems, 1);
});
