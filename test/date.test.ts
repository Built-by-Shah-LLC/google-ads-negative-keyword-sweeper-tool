import assert from "node:assert/strict";
import test from "node:test";
import { previousDateInTimeZone } from "../src/pipeline/process-organization.js";

test("uses the organization's local previous calendar day", () => {
  const now = new Date("2026-08-26T02:00:00Z");
  assert.equal(previousDateInTimeZone("America/New_York", now), "2026-08-24");
  assert.equal(previousDateInTimeZone("Asia/Tokyo", now), "2026-08-25");
});
