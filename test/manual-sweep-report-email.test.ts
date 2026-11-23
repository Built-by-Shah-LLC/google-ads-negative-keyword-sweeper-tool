import assert from "node:assert/strict";
import test from "node:test";
import { manualSweepReportSender } from "../src/notifications/manual-sweep-report-email.js";
import type { RunReportMessage } from "../src/notifications/run-report-email.js";

const requestId = "00000000-0000-4000-8000-00000000000b";
const email = "reviewer@example.test";
const environment = {
  RESEND_API_KEY: "fixture-key",
  MANUAL_SWEEP_REPORT_FROM: "reports@example.test",
  MANUAL_SWEEP_REPORT_ALLOWLIST: email,
  RUN_REPORT_EMAIL_TO: "legacy@example.test",
};
const report: RunReportMessage = {
  runId: "fixture-run",
  status: "SUCCEEDED",
  completedAt: "2026-11-20T00:00:00Z",
  organizationCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  accountOverviews: [],
  workbook: Buffer.from("example"),
  filename: "report.xlsx",
  cipirianAnalysisWorkbook: Buffer.from("example"),
  cipirianAnalysisFilename: "analysis.xlsx",
};

test("manual email sends to exactly the selected allowlisted recipient", async () => {
  const calls: RequestInit[] = [];
  const sender = manualSweepReportSender(requestId, environment, async (_url, init) => {
    if (init) calls.push(init);
    return Response.json({ id: "fixture" });
  });
  assert.equal(await sender.send(report, "legacy@example.test", "user-a"), "failed");
  assert.equal(await sender.send(report, email, "user-b"), "sent");
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  const body = JSON.parse(String(call.body)) as { to: string[]; attachments: { filename: string }[] };
  assert.deepEqual(body.to, [email]);
  assert.deepEqual(body.attachments.map(({ filename }) => filename), ["analysis.xlsx"]);
  assert.equal(new Headers(call.headers).get("idempotency-key"), `manual-sweep-${requestId}-user-b`);
  assert.ok(call.signal);
});

test("manual email treats unknown provider outcomes as uncertain with one attempt", async () => {
  for (const simulate of [
    () => new Response(null, { status: 409 }),
    () => new Response(null, { status: 503 }),
    () => Response.json({}),
    () => { throw new Error("timeout"); },
  ]) {
    let attempts = 0;
    const sender = manualSweepReportSender(requestId, environment, async () => {
      attempts++;
      return simulate();
    });
    assert.equal(await sender.send(report, email, "user-b"), "uncertain");
    assert.equal(attempts, 1);
  }
});
