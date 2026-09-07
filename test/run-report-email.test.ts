import assert from "node:assert/strict";
import test from "node:test";
import type { RunReportEmailConfig } from "../src/config/env.js";
import { RunReportEmailService } from "../src/notifications/run-report-email.js";
import { createLogger } from "../src/observability/logger.js";

test("sends the run workbook through Resend with an idempotency key", async () => {
  const config: RunReportEmailConfig = {
    enabled: true,
    apiKey: "test-key",
    recipients: ["operator@example.com"],
    from: "Sweeper <onboarding@resend.dev>",
    subjectPrefix: "[Test]",
    requestTimeoutMs: 60_000,
    maxRetries: 0
  };
  let captured: { url?: string; init?: RequestInit; body?: Record<string, any> } = {};
  const fetchImplementation: typeof fetch = async (input, init) => {
    captured = {
      url: String(input),
      ...(init === undefined ? {} : { init }),
      body: JSON.parse(String(init?.body)) as Record<string, any>
    };
    return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
  };
  const service = new RunReportEmailService(config, createLogger({ level: "silent" }), fetchImplementation);
  const result = await service.send({
    runId: "run-1",
    status: "SUCCEEDED",
    workbook: Buffer.from("xlsx"),
    filename: "report.xlsx",
    organizationCount: 2,
    inputTokens: 100,
    outputTokens: 20
  });

  assert.equal(result.status, "SENT");
  assert.equal(result.messageId, "email-1");
  assert.equal(captured.url, "https://api.resend.com/emails");
  assert.equal(new Headers(captured.init?.headers).get("idempotency-key"), "negative-keyword-sweeper-run-1");
  assert.equal(captured.body?.attachments[0].filename, "report.xlsx");
  assert.equal(captured.body?.attachments[0].content, Buffer.from("xlsx").toString("base64"));
});
