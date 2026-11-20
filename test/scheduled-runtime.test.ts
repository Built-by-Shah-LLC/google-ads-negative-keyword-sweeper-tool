import assert from "node:assert/strict";
import test from "node:test";
import { Temporal } from "@js-temporal/polyfill";
import type { Pool } from "pg";
import { claimDueOccurrences, invokeOccurrence, isScheduledMutationAuthorized, normalizeScheduledReportingDate } from "../src/scheduled/runtime.js";

test("scheduled reporting dates are normalized when PostgreSQL returns a Date", () => {
  assert.equal(normalizeScheduledReportingDate(new Date("2026-10-20T00:00:00.000Z")), "2026-10-20");
  assert.equal(normalizeScheduledReportingDate("2026-10-20"), "2026-10-20");
  assert.equal(normalizeScheduledReportingDate("2026-10-20T00:00:00.000Z"), "2026-10-20");
  assert.throws(() => normalizeScheduledReportingDate("Tue Oct 20 2026"), /invalid reporting date/);
});

test("occurrence dispatch invokes the shared Cloud Run Job with only the occurrence id", async () => {
  const previousProject = process.env.GOOGLE_CLOUD_PROJECT;
  const previousRegion = process.env.CLOUD_RUN_REGION;
  const previousJob = process.env.SCHEDULED_SWEEPER_JOB_NAME;
  const previousFetch = globalThis.fetch;
  let observedUrl = "";
  let observedInit: RequestInit | undefined;
  try {
    process.env.GOOGLE_CLOUD_PROJECT = "example-project";
    process.env.CLOUD_RUN_REGION = "us-west1";
    process.env.SCHEDULED_SWEEPER_JOB_NAME = "negative-keyword-sweeper";
    globalThis.fetch = (async (url, init) => {
      observedUrl = String(url);
      observedInit = init;
      return new Response(JSON.stringify({ metadata: { name: "operations/dispatch-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    const occurrenceId = "00000000-0000-4000-8000-000000000123";
    assert.equal(await invokeOccurrence(occurrenceId, async () => "access-token"), "operations/dispatch-1");
    assert.equal(observedUrl, "https://us-west1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/example-project/jobs/negative-keyword-sweeper:run");
    assert.equal(observedInit?.method, "POST");
    assert.equal(new Headers(observedInit?.headers).get("authorization"), "Bearer access-token");
    assert.deepEqual(JSON.parse(String(observedInit?.body)), {
      overrides: { containerOverrides: [{ args: ["--occurrence-id", occurrenceId] }] }
    });
  } finally {
    if (previousProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT; else process.env.GOOGLE_CLOUD_PROJECT = previousProject;
    if (previousRegion === undefined) delete process.env.CLOUD_RUN_REGION; else process.env.CLOUD_RUN_REGION = previousRegion;
    if (previousJob === undefined) delete process.env.SCHEDULED_SWEEPER_JOB_NAME; else process.env.SCHEDULED_SWEEPER_JOB_NAME = previousJob;
    globalThis.fetch = previousFetch;
  }
});

test("scheduled mutation requires intent, the deployment switch, and every customer", () => {
  const allowed = new Set(["3629748374"]);
  assert.equal(isScheduledMutationAuthorized({ mutationRequested: true, deploymentEnabled: true, customerIds: ["362-974-8374"], allowedCustomerIds: allowed }), true);
  assert.equal(isScheduledMutationAuthorized({ mutationRequested: false, deploymentEnabled: true, customerIds: ["3629748374"], allowedCustomerIds: allowed }), false);
  assert.equal(isScheduledMutationAuthorized({ mutationRequested: true, deploymentEnabled: false, customerIds: ["3629748374"], allowedCustomerIds: allowed }), false);
  assert.equal(isScheduledMutationAuthorized({ mutationRequested: true, deploymentEnabled: true, customerIds: ["3629748374", "1111111111"], allowedCustomerIds: allowed }), false);
  assert.equal(isScheduledMutationAuthorized({ mutationRequested: true, deploymentEnabled: true, customerIds: [], allowedCustomerIds: allowed }), false);
});

test("only executable accounts enter occurrence snapshots and archive-only schedules keep their next run", async () => {
  const archived = { id: "account-archived", googleCustomerId: "2222222222", name: "Archived", archiveRevision: "1", archived: true };
  const active = { id: "account-active", googleCustomerId: "1111111111", name: "Active", archiveRevision: "2", archived: false };
  const inserts: unknown[][] = [];
  const updates: string[] = [];
  const row = {
    revision_id: "revision", next_run_at: new Date("2026-11-19T14:30:00.000Z"),
    frequency: "daily", local_time: "06:30:00", time_zone: "America/Los_Angeles",
    weekday: null, anchor_date: null, month_day: null, automatic_mutation_enabled: true,
    revision_snapshot: {}, recipients: [{ kind: "internal", userId: null, email: "synthetic@example.invalid" }],
  };
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const pool = { async connect() {
    return {
      async query(sql: string, values: unknown[] = []) {
        if (sql.includes("FROM keyword_sweep_schedules s JOIN")) return { rows: [
          { ...row, id: "mixed", accounts: [archived, active] },
          { ...row, id: "archive-only", accounts: [archived] },
        ] };
        if (sql.includes("INSERT INTO keyword_sweep_occurrences")) {
          inserts.push(values);
          return { rows: [{ id: String(values[1]), status: values[7] ? "skipped" : "queued" }] };
        }
        if (sql.includes("UPDATE keyword_sweep_schedules")) updates.push(sql);
        return { rows: [] };
      },
      release() {},
    };
  }} as unknown as Pool;
  const result = await claimDueOccurrences(pool, organizationId, Temporal.Instant.from("2026-11-19T15:00:00Z"));
  assert.deepEqual(result, ["mixed"]);
  assert.equal(inserts[0]?.[7], false);
  assert.deepEqual(JSON.parse(String(inserts[0]?.[5])).accounts, [
    { id: active.id, googleCustomerId: active.googleCustomerId, name: active.name, archiveRevision: "2" },
  ]);
  assert.deepEqual(JSON.parse(String(inserts[0]?.[5])).mutationScopeCustomerIds, ["2222222222", "1111111111"]);
  assert.equal(inserts[1]?.[7], true);
  assert.deepEqual(JSON.parse(String(inserts[1]?.[5])).accounts, []);
  assert.equal(updates.length, 2);
  assert.ok(updates.every((sql) => sql.includes("SET next_run_at")));
});
