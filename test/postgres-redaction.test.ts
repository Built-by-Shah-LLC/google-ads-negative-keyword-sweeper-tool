import assert from "node:assert/strict";
import test from "node:test";
import { boundedRedactedJson, safeDatabaseMessage } from "../src/storage/postgres/redaction.js";

test("redacts credentials recursively before database storage", () => {
  const result = boundedRedactedJson({
    authorization: "Bearer secret",
    nested: { apiKey: "key", refresh_token: "refresh", safe: "visible" },
  }, 10_000);
  assert.deepEqual(result.value, {
    authorization: "[REDACTED]",
    nested: { apiKey: "[REDACTED]", refresh_token: "[REDACTED]", safe: "visible" },
  });
  assert.equal(result.truncated, false);
});

test("bounds oversized payloads and scrubs database URLs from errors", () => {
  const result = boundedRedactedJson({ payload: "x".repeat(1_000) }, 100);
  assert.equal(result.truncated, true);
  assert.equal((result.value as Record<string, unknown>).truncated, true);
  assert.equal(
    safeDatabaseMessage("failed postgresql://user:pass@host/db using Bearer abc123"),
    "failed [REDACTED_DATABASE_URL] using Bearer [REDACTED]",
  );
});
