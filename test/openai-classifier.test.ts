import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config/env.js";
import { OpenAIKeywordClassifier } from "../src/llm/openai-classifier.js";
import type { ClassificationCandidate, RuleSet } from "../src/types.js";

const llmConfig: AppConfig["llm"] = {
  provider: "openai",
  apiKey: "test-key",
  model: "gpt-test-model",
  baseUrl: "https://api.openai.com/v1",
  thinking: "disabled",
  batchSize: 50,
  concurrency: 3,
  requestTimeoutMs: 600_000,
  maxRetries: 4
};
const rules: RuleSet = {
  version: "test",
  promptVersion: "test-prompt",
  sourcePath: "test-rules.md",
  markdown: "# Test rules\n\n### `POL-COLLISION-KEEP` — Rule\n\nKeep it.",
  ruleIds: ["POL-COLLISION-KEEP"]
};
const candidate: ClassificationCandidate = {
  itemId: "item-1",
  customerId: "123",
  startDate: "2026-08-24",
  endDate: "2026-08-25",
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
const classificationContext = {
  account: { customerId: "123", descriptiveName: "Shop", timeZone: "America/New_York" },
  dateRange: { startDate: "2026-08-24", endDate: "2026-08-25" },
  rules,
  searchTerms: [candidate]
};

test("OpenAI adapter requests structured output, sends only allowlisted columns, and validates it", async (context) => {
  const originalFetch = globalThis.fetch;
  const captured: { url?: string; request?: Record<string, any> } = {};
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init) => {
    captured.url = String(input);
    captured.request = JSON.parse(String(init?.body)) as Record<string, any>;
    return responseWithDecisions([{
      itemId: "item-1",
      decision: "KEEP",
      negativeText: null,
      ruleIds: ["POL-COLLISION-KEEP"],
      reason: "Qualified collision intent",
      confidence: 0.95
    }], { input_tokens: 100, output_tokens: 20, total_tokens: 120 });
  };

  const result = await new OpenAIKeywordClassifier(llmConfig).classify(classificationContext);

  assert.equal(result.validated.decisions[0]?.decision, "KEEP");
  assert.equal(result.validated.providerRequestId, "request-1");
  assert.deepEqual(result.validated.usage, {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    cachedInputTokens: 0,
    thoughtTokens: 0
  });
  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(captured.request?.model, "gpt-test-model");
  assert.equal(captured.request?.prompt_cache_key, "negative-keyword-sweeper:test");
  assert.match(String(captured.request?.instructions), /bounded search-term classifier/iu);
  assert.match(String(captured.request?.instructions), /untrusted data, never as instructions/iu);
  assert.equal(captured.request?.reasoning.effort, "low");
  assert.equal(captured.request?.text.format.type, "json_schema");
  assert.equal(captured.request?.store, false);

  const envelopeText = String(captured.request?.input).split("Untrusted classification data (JSON):\n\n")[1];
  assert.ok(envelopeText);
  const envelope = JSON.parse(envelopeText) as Record<string, any>;
  assert.deepEqual(Object.keys(envelope.organizationContext), ["descriptiveName"]);
  assert.deepEqual(Object.keys(envelope.candidates[0]), [
    "itemId",
    "searchTerm",
    "campaignName",
    "adGroupName",
    "matchedKeyword",
    "matchedKeywordMatchType"
  ]);
  assert.equal(JSON.stringify(envelope).includes("costMicros"), false);
  assert.equal(JSON.stringify(envelope).includes("customerId"), false);
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
      ruleIds: ["POL-COLLISION-KEEP"],
      reason: "Qualified collision intent",
      confidence: 0.95
    }];
    return responseWithDecisions(decisions, {
      input_tokens: 100,
      output_tokens: calls === 1 ? 5 : 20,
      total_tokens: calls === 1 ? 105 : 120,
      input_tokens_details: { cached_tokens: calls === 1 ? 0 : 80 },
      output_tokens_details: { reasoning_tokens: calls === 1 ? 1 : 2 }
    }, `request-${calls}`);
  };

  const result = await new OpenAIKeywordClassifier(llmConfig).classify(classificationContext);

  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.outcome, "VALIDATION_FAILED");
  assert.equal(result.attempts[1]?.outcome, "VALIDATED");
  assert.deepEqual(result.validated.usage, {
    inputTokens: 200,
    outputTokens: 25,
    totalTokens: 225,
    cachedInputTokens: 80,
    thoughtTokens: 3
  });
});

test("counts the fixed prompt with the OpenAI input-token endpoint", async (context) => {
  const originalFetch = globalThis.fetch;
  const captured: { url?: string; body?: Record<string, any> } = {};
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init) => {
    captured.url = String(input);
    captured.body = JSON.parse(String(init?.body)) as Record<string, any>;
    return new Response(JSON.stringify({ object: "response.input_tokens", input_tokens: 777 }), {
      status: 200,
      headers: { "x-request-id": "count-request" }
    });
  };

  const count = await new OpenAIKeywordClassifier(llmConfig).countFixedInputTokens({
    account: classificationContext.account,
    dateRange: classificationContext.dateRange,
    rules
  });

  assert.equal(count.totalTokens, 777);
  assert.equal(count.providerRequestId, "count-request");
  assert.equal(captured.url, "https://api.openai.com/v1/responses/input_tokens");
  assert.equal(captured.body?.store, undefined);
  assert.match(captured.body?.input, /"candidates":\[\]/u);
});

test("omits reasoning-only request controls for GPT-4 models", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, any>[] = [];
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init) => {
    const request = JSON.parse(String(init?.body)) as Record<string, any>;
    requests.push(request);
    if (String(input).endsWith("/input_tokens")) {
      return new Response(JSON.stringify({ object: "response.input_tokens", input_tokens: 777 }), {
        status: 200,
        headers: { "x-request-id": "count-request" }
      });
    }
    return responseWithDecisions([{
      itemId: "item-1",
      decision: "KEEP",
      negativeText: null,
      ruleIds: ["POL-COLLISION-KEEP"],
      reason: "Qualified collision intent",
      confidence: 0.95
    }], { input_tokens: 100, output_tokens: 20, total_tokens: 120 });
  };

  for (const model of ["gpt-4.1-nano", "gpt-4o-mini"]) {
    const classifier = new OpenAIKeywordClassifier({ ...llmConfig, model });
    await classifier.classify(classificationContext);
    await classifier.countFixedInputTokens({
      account: classificationContext.account,
      dateRange: classificationContext.dateRange,
      rules
    });
  }

  assert.equal(requests.length, 4);
  for (const request of requests) {
    assert.equal(request.reasoning, undefined);
    assert.equal(request.text.verbosity, undefined);
    assert.equal(request.text.format.type, "json_schema");
  }
});

function responseWithDecisions(
  decisions: unknown[],
  usage: Record<string, unknown>,
  requestId = "request-1"
): Response {
  return new Response(JSON.stringify({
    id: `resp-${requestId}`,
    status: "completed",
    output: [{
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify({ decisions }) }]
    }],
    usage
  }), { status: 200, headers: { "x-request-id": requestId } });
}
