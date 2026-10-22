import test from "node:test";
import assert from "node:assert/strict";
import { Temporal } from "@js-temporal/polyfill";
import { nextScheduledInstant } from "../src/scheduled/recurrence.js";

test("scheduled recurrence keeps Pacific wall time and clamps short months",()=>{
  const daily={frequency:"daily",localTime:"06:30",timeZone:"America/Los_Angeles",weekday:null,anchorDate:null,monthDay:null} as const;
  assert.equal(nextScheduledInstant(daily,Temporal.Instant.from("2026-03-07T15:00:00Z")).toString(),"2026-03-08T13:30:00Z");
  assert.equal(nextScheduledInstant({...daily,frequency:"monthly",monthDay:31},Temporal.Instant.from("2027-02-01T00:00:00Z")).toString(),"2027-02-28T14:30:00Z");
});
