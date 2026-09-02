import assert from "node:assert/strict";
import test from "node:test";
import { date48HoursBackInTimeZone, singleDateRange } from "../src/pipeline/process-organization.js";

test("uses the single organization-local calendar day 48 hours back", () => {
  const now = new Date("2026-08-26T02:00:00Z");
  assert.deepEqual(date48HoursBackInTimeZone("America/New_York", now), {
    startDate: "2026-08-23",
    endDate: "2026-08-23"
  });
  assert.deepEqual(date48HoursBackInTimeZone("Asia/Tokyo", now), {
    startDate: "2026-08-24",
    endDate: "2026-08-24"
  });
});

test("treats an explicit date as the exact processing date", () => {
  assert.deepEqual(singleDateRange("2026-08-25"), {
    startDate: "2026-08-25",
    endDate: "2026-08-25"
  });
});
