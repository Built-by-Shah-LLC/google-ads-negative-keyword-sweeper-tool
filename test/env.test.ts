import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, loadOperationalConfig } from "../src/config/env.js";

test("loads the OpenAI key override and economical model defaults", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sweeper-openai-config-"));
  try {
    await writeFile(join(directory, ".env"), [
      "GOOGLE_ADS_DEVELOPER_TOKEN=developer",
      "GOOGLE_ADS_LOGIN_CUSTOMER_ID=123-456-7890",
      "GOOGLE_ADS_CLIENT_ID=client",
      "GOOGLE_ADS_CLIENT_SECRET=secret",
      "GOOGLE_ADS_REFRESH_TOKEN=refresh",
      "LLM_MODEL=retired-provider-model"
    ].join("\n"), "utf8");
    await writeFile(join(directory, ".env.openai"), [
      "OPENAI_API_KEY=openai-test-key",
      "OPENAI_MODEL=gpt-5.6-luna"
    ].join("\n"), "utf8");

    const config = await loadConfig(directory);
    assert.equal(config.llm.apiKey, "openai-test-key");
    assert.equal(config.llm.model, "gpt-5.6-luna");
    assert.equal(config.llm.batchSize, 50);
    assert.equal(config.googleAds.loginCustomerId, "1234567890");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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
