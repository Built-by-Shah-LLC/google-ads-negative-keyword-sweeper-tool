import assert from "node:assert/strict";
import test from "node:test";
import type { RunReportEmailConfig } from "../src/config/env.js";
import { RunReportEmailService } from "../src/notifications/run-report-email.js";
import { createLogger } from "../src/observability/logger.js";
import type { RunReportAccountOverview } from "../src/storage/cipirian-keyword-analysis.js";

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
  const accountOverviews: RunReportAccountOverview[] = [{
    customerId: "1234567890",
    descriptiveName: "Example Collision <Shop>",
    status: "SUCCEEDED",
    startDate: "2026-09-16",
    endDate: "2026-09-16",
    rawRowCount: 12,
    candidateCount: 8,
    decisionCount: 8,
    keepCount: 5,
    negativeExactCount: 3,
    errorCount: 0,
    mutation: {
      mode: "disabled",
      status: "DISABLED",
      mockedCount: 0,
      validatedCount: 0,
      appliedCount: 0,
      verifiedCount: 0,
      googleAdsMutationPerformed: false
    },
    negativeKeywords: [{
      channel: "SEARCH",
      campaignName: "Collision & Repair",
      negativeText: "<free car>",
      ruleIds: ["POL-FREE"]
    }]
  }];
  const result = await service.send({
    runId: "run-1",
    status: "SUCCEEDED",
    completedAt: "2026-09-18T01:00:00.000Z",
    workbook: Buffer.from("xlsx"),
    filename: "report.xlsx",
    cipirianAnalysisWorkbook: Buffer.from("analysis-xlsx"),
    cipirianAnalysisFilename: "cipirian-keyword-analysis-run-1.xlsx",
    organizationCount: 1,
    inputTokens: 100,
    outputTokens: 20,
    accountOverviews
  });

  assert.equal(result.status, "SENT");
  assert.equal(result.messageId, "email-1");
  assert.equal(captured.url, "https://api.resend.com/emails");
  assert.equal(new Headers(captured.init?.headers).get("idempotency-key"), "negative-keyword-sweeper-run-1");
  assert.equal(captured.body?.attachments[0].filename, "report.xlsx");
  assert.equal(captured.body?.attachments[0].content, Buffer.from("xlsx").toString("base64"));
  assert.equal(captured.body?.attachments[1].filename, "cipirian-keyword-analysis-run-1.xlsx");
  assert.equal(captured.body?.attachments[1].content, Buffer.from("analysis-xlsx").toString("base64"));
  assert.match(String(captured.body?.html), /Search Negatives Sweep/u);
  assert.match(String(captured.body?.html), /Example Collision &lt;Shop&gt;/u);
  assert.match(String(captured.body?.html), /&lt;free car&gt;/u);
  assert.match(String(captured.body?.text), /Cipirian Keyword Analysis/u);
});
