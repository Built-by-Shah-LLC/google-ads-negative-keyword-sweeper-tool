import assert from "node:assert/strict";
import test from "node:test";
import type { Transporter } from "nodemailer";
import type { EmailAlertConfig } from "../src/config/env.js";
import { EmailAlertService } from "../src/notifications/email-alerts.js";
import { serializeError } from "../src/observability/errors.js";
import { createLogger } from "../src/observability/logger.js";

const config: EmailAlertConfig = {
  enabled: true,
  recipients: ["operator@example.com"],
  from: "sweeper@example.com",
  subjectPrefix: "[Test Sweeper]",
  handledErrorCodes: ["SELECTED_ERROR"],
  handledErrorStages: [],
  smtp: { host: "smtp.example.com", port: 587, secure: false }
};

test("emails every unhandled error and only selected handled errors", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const transporter = {
    sendMail: async (message: Record<string, unknown>) => {
      sent.push(message);
      return { messageId: `message-${sent.length}` };
    },
    close: () => undefined
  } as unknown as Transporter;
  const alerts = new EmailAlertService(config, createLogger({ level: "silent" }), transporter);
  const selected = serializeError(new Error("selected"), {
    stage: "LLM_CLASSIFICATION",
    code: "SELECTED_ERROR",
    organizationId: "123",
    batchId: "batch-1"
  });
  const ignored = serializeError(new Error("ignored"), {
    stage: "GOOGLE_ADS_REQUEST",
    code: "IGNORED_ERROR"
  });

  alerts.notifyHandled(ignored);
  alerts.notifyHandled(selected, { runId: "run-1" });
  alerts.notifyHandled(selected, { runId: "run-1" });
  await alerts.flush();
  assert.equal(sent.length, 1, "matching handled errors are sent once per fingerprint");

  await alerts.notifyUnhandled(ignored, { runId: "run-1" });
  assert.equal(sent.length, 2, "unhandled errors are always sent when alerts are enabled");
  assert.match(String(sent[1]?.subject), /UNHANDLED: IGNORED_ERROR/u);
  assert.match(String(sent[1]?.text), /Run ID: run-1/u);
  alerts.close();
});
