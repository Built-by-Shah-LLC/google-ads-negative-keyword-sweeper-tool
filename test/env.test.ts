import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadOperationalConfig } from "../src/config/env.js";

test("loads enabled SMTP alerts and handled-error selectors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sweeper-alert-config-"));
  try {
    await writeFile(join(directory, ".env"), [
      "LOG_LEVEL=debug",
      "ERROR_EMAIL_ENABLED=true",
      "ERROR_EMAIL_TO=first@example.com, second@example.com",
      "ERROR_EMAIL_FROM=sweeper@example.com",
      "SMTP_HOST=smtp.example.com",
      "SMTP_PORT=465",
      "SMTP_SECURE=true",
      "SMTP_USER=user",
      "SMTP_PASSWORD=secret",
      "ALERT_HANDLED_ERROR_CODES=CODE_A,CODE_B",
      "ALERT_HANDLED_ERROR_STAGES=STAGE_A"
    ].join("\n"), "utf8");

    const config = await loadOperationalConfig(directory);
    assert.equal(config.logging.level, "debug");
    assert.equal(config.emailAlerts.enabled, true);
    if (!config.emailAlerts.enabled) return;
    assert.deepEqual(config.emailAlerts.recipients, ["first@example.com", "second@example.com"]);
    assert.deepEqual(config.emailAlerts.handledErrorCodes, ["CODE_A", "CODE_B"]);
    assert.deepEqual(config.emailAlerts.handledErrorStages, ["STAGE_A"]);
    assert.equal(config.emailAlerts.smtp.secure, true);
    assert.equal(config.emailAlerts.smtp.port, 465);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects incomplete enabled email configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sweeper-alert-config-"));
  try {
    await writeFile(join(directory, ".env"), "ERROR_EMAIL_ENABLED=true\nERROR_EMAIL_TO=operator@example.com\n", "utf8");
    await assert.rejects(() => loadOperationalConfig(directory), /ERROR_EMAIL_FROM, SMTP_HOST/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
