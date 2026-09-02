import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config/env.js";
import { ClassificationFailure } from "../src/llm/classifier.js";
import { MoonshotKeywordClassifier } from "../src/llm/moonshot-classifier.js";
import type { ClassificationCandidate, RuleSet } from "../src/types.js";

const config: AppConfig["llm"] = {
  provider: "moonshot",
  apiKey: "test-key",
  model: "kimi-k2.6",
  baseUrl: "https://api.moonshot.ai/v1",
  batchSize: 50,
  concurrency: 3,
  requestTimeoutMs: 600_000,
  maxRetries: 0
};
const rules: RuleSet = {
  version: "test-v1",
  promptVersion: "test-prompt-v1",
  sourcePath: "test-rules.md",
  markdown: "### `POL-COLLISION-KEEP` — Keep collision intent",
  ruleIds: ["POL-COLLISION-KEEP"]
};
const candidate: ClassificationCandidate = {
  itemId: "item-1",
  customerId: "123",
  startDate: "2026-09-01",
  endDate: "2026-09-01",
  channel: "SEARCH",
  campaignId: "456",
  campaignName: "Collision",
  adGroupId: "789",
  adGroupName: "Repair",
  searchTerm: "collision repair near me",
  targetingStatus: "NONE",
  matchedKeyword: "collision repair",
  matchedKeywordMatchType: "BROAD",
  impressions: 10,
  clicks: 2,
  costMicros: 1000,
  conversions: 1,
  conversionValue: 25
};
const context = {
  account: { customerId: "123", descriptiveName: "Shop", timeZone: "America/New_York" },
  dateRange: { startDate: "2026-09-01", endDate: "2026-09-01" },
  rules,
  searchTerms: [candidate]
};

test("Moonshot adapter uses structured output and normalizes per-request tokens", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, any> }> = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    requests.push({ url: String(input), body });
    if (String(input).endsWith("estimate-token-count")) {
      return new Response(JSON.stringify({ data: { total_tokens: 777 } }), {
        status: 200,
        headers: { "x-request-id": "estimate-1" }
      });
    }
    return new Response(JSON.stringify({
      id: "completion-1",
      choices: [{
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: JSON.stringify({ decisions: [{
            itemId: "item-1",
            decision: "KEEP",
            negativeText: null,
            ruleIds: ["POL-COLLISION-KEEP"],
            reason: "Qualified collision intent",
            confidence: 0.99
          }] })
        }
      }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cached_tokens: 8 }
    }), { status: 200, headers: { "x-request-id": "request-1" } });
  };

  const classifier = new MoonshotKeywordClassifier(config);
  const result = await classifier.classify(context);
  const fixed = await classifier.countFixedInputTokens({
    account: context.account,
    dateRange: context.dateRange,
    rules
  });

  assert.equal(classifier.provider, "moonshot-kimi");
  assert.equal(result.validated.decisions[0]?.decision, "KEEP");
  assert.deepEqual(result.validated.usage, {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    cachedInputTokens: 8,
    thoughtTokens: 0
  });
  assert.equal(fixed.totalTokens, 777);
  assert.equal(requests[0]?.url, "https://api.moonshot.ai/v1/chat/completions");
  assert.equal(requests[0]?.body.response_format.type, "json_schema");
  assert.equal(requests[0]?.body.thinking.type, "disabled");
  assert.equal(requests[1]?.url, "https://api.moonshot.ai/v1/tokenizers/estimate-token-count");
});

test("Moonshot adapter records an exhausted timeout against the failed request", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => {
    throw new DOMException("The operation timed out", "TimeoutError");
  };
  const classifier = new MoonshotKeywordClassifier({ ...config, requestTimeoutMs: 1234 });
  await assert.rejects(
    () => classifier.classify(context),
    (error: unknown) => {
      assert.ok(error instanceof ClassificationFailure);
      assert.match(error.message, /timed out after 1234ms/u);
      assert.equal(error.attempts[0]?.httpAttempts[0]?.outcome, "FAILED");
      assert.match(error.attempts[0]?.httpAttempts[0]?.error ?? "", /timed out after 1234ms/u);
      return true;
    }
  );
});
