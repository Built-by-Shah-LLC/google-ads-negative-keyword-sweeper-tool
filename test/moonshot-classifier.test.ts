import assert from "node:assert/strict";
import test from "node:test";
import type { Dispatcher } from "undici";
import type { AppConfig } from "../src/config/env.js";
import { ClassificationFailure } from "../src/llm/classifier.js";
import { MoonshotKeywordClassifier } from "../src/llm/moonshot-classifier.js";
import type { ClassificationCandidate, RuleSet } from "../src/types.js";

const config: AppConfig["llm"] = {
  provider: "moonshot",
  apiKey: "test-key",
  model: "kimi-k2.6",
  baseUrl: "https://api.moonshot.ai/v1",
  thinking: "enabled",
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

function fakeDispatcher(
  handler: (url: string, body: Record<string, any>) => { statusCode: number; headers?: Record<string, string>; payload: unknown }
): Dispatcher {
  return {
    request: async (opts: { origin: string; path: string; body: unknown }) => {
      const url = `${opts.origin}${opts.path}`;
      const body = JSON.parse(String(opts.body)) as Record<string, any>;
      const result = handler(url, body);
      return {
        statusCode: result.statusCode,
        headers: result.headers ?? {},
        body: { text: async () => JSON.stringify(result.payload) }
      };
    }
  } as unknown as Dispatcher;
}

test("Moonshot adapter uses structured output and normalizes per-request tokens", async () => {
  const requests: Array<{ url: string; body: Record<string, any> }> = [];
  const dispatcher = fakeDispatcher((url, body) => {
    requests.push({ url, body });
    if (url.endsWith("estimate-token-count")) {
      return {
        statusCode: 200,
        headers: { "x-request-id": "estimate-1" },
        payload: { data: { total_tokens: 777 } }
      };
    }
    return {
      statusCode: 200,
      headers: { "x-request-id": "request-1" },
      payload: {
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
      }
    };
  });

  const classifier = new MoonshotKeywordClassifier(config, dispatcher);
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
  assert.equal(requests[0]?.body.thinking.type, "enabled");
  assert.equal(requests[0]?.body.max_tokens, 32_768);
  assert.equal(requests[1]?.url, "https://api.moonshot.ai/v1/tokenizers/estimate-token-count");
});

test("Moonshot adapter accepts a fenced bare JSON array from thinking models", async () => {
  const dispatcher = fakeDispatcher(() => ({
    statusCode: 200,
    headers: { "x-request-id": "request-array" },
    payload: {
      id: "completion-array",
      choices: [{
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: "```json\n" + JSON.stringify([{
            itemId: "item-1",
            decision: "KEEP",
            negativeText: null,
            ruleIds: ["POL-COLLISION-KEEP"],
            reason: "Qualified collision intent",
            confidence: 0.99,
            extra: "ignore-me"
          }]) + "\n```"
        }
      }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 40,
        total_tokens: 140,
        prompt_tokens_details: { cached_tokens: 8 },
        completion_tokens_details: { reasoning_tokens: 25 }
      }
    }
  }));

  const classifier = new MoonshotKeywordClassifier(config, dispatcher);
  const result = await classifier.classify(context);
  assert.equal(result.validated.decisions[0]?.decision, "KEEP");
  assert.equal(result.validated.usage.cachedInputTokens, 8);
  assert.equal(result.validated.usage.thoughtTokens, 25);
});

test("Moonshot adapter records an exhausted timeout against the failed request", async () => {
  const dispatcher = {
    request: async () => {
      throw new DOMException("The operation timed out", "TimeoutError");
    }
  } as unknown as Dispatcher;
  const classifier = new MoonshotKeywordClassifier({ ...config, requestTimeoutMs: 1234 }, dispatcher);
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
