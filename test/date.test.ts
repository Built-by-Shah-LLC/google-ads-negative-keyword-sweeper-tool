import assert from "node:assert/strict";
import test from "node:test";
import { lastTwoCompletedDatesInTimeZone, twoDayRangeEndingOn } from "../src/pipeline/process-organization.js";

test("uses the organization's last two completed local calendar days", () => {
  const now = new Date("2026-08-26T02:00:00Z");
  assert.deepEqual(lastTwoCompletedDatesInTimeZone("America/New_York", now), {
    startDate: "2026-08-23",
    endDate: "2026-08-24"
  });
  assert.deepEqual(lastTwoCompletedDatesInTimeZone("Asia/Tokyo", now), {
    startDate: "2026-08-24",
    endDate: "2026-08-25"
  });
});

test("treats an explicit date as the 48-hour window end date", () => {
  assert.deepEqual(twoDayRangeEndingOn("2026-08-25"), {
    startDate: "2026-08-24",
    endDate: "2026-08-25"
  });
});
