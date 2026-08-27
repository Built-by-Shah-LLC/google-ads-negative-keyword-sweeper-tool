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
  promptVersion: "test-prompt",
  sourcePath: "test-rules.md",
  markdown: "# Test rules\n\n### `RULE-1` — Rule\n\nKeep it.",
  ruleIds: ["RULE-1"]
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
  assert.deepEqual(result.validated.usage, {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 42,
    cachedInputTokens: 0,
    thoughtTokens: 0
  });
  assert.equal(result.attempts.length, 1);
  assert.ok(captured.request);
  const sentRequest = captured.request;
  assert.equal(sentRequest.generationConfig.temperature, 0);
  assert.equal(sentRequest.generationConfig.seed, 260826);
  assert.equal(sentRequest.generationConfig.responseMimeType, "application/json");
  assert.equal(sentRequest.generationConfig.responseJsonSchema.properties.decisions.minItems, 1);
  assert.match(sentRequest.contents[0].parts[0].text, /Test rules/u);
});

test("counts tokens from an invalid generation before a successful validation retry", async (context) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => {
    calls += 1;
    const decisions = calls === 1 ? [] : [{
      itemId: "item-1",
      decision: "KEEP",
      negativeText: null,
      ruleIds: ["RULE-1"],
      reason: "Qualified collision intent",
      confidence: 0.95
    }];
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ decisions }) }] } }],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: calls === 1 ? 5 : 20,
        totalTokenCount: calls === 1 ? 105 : 120
      }
    }), { status: 200, headers: { "x-request-id": `request-${calls}` } });
  };

  const result = await new GeminiKeywordClassifier(llmConfig).classify({
    account: { customerId: "123", descriptiveName: "Shop", timeZone: "America/New_York" },
    date: "2026-08-25",
    rules,
    searchTerms: [candidate]
  });

  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.outcome, "VALIDATION_FAILED");
  assert.equal(result.attempts[1]?.outcome, "VALIDATED");
  assert.deepEqual(result.validated.usage, {
    inputTokens: 200,
    outputTokens: 25,
    totalTokens: 225,
    cachedInputTokens: 0,
    thoughtTokens: 0
  });
});

test("counts the fixed organization prompt with Gemini countTokens", async (context) => {
  const originalFetch = globalThis.fetch;
  const captured: { body?: Record<string, any> } = {};
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_input, init) => {
    captured.body = JSON.parse(String(init?.body)) as Record<string, any>;
    return new Response(JSON.stringify({ totalTokens: 777 }), {
      status: 200,
      headers: { "x-request-id": "count-request" }
    });
  };

  const count = await new GeminiKeywordClassifier(llmConfig).countFixedInputTokens({
    account: { customerId: "123", descriptiveName: "Shop", timeZone: "America/New_York" },
    date: "2026-08-25",
    rules
  });

  assert.equal(count.totalTokens, 777);
  assert.equal(count.providerRequestId, "count-request");
  assert.equal(count.attemptCount, 1);
  assert.deepEqual(captured.body?.generateContentRequest.contents[0].parts.length, 1);
  assert.match(captured.body?.generateContentRequest.contents[0].parts[0].text, /"candidates":\[\]/u);
});
