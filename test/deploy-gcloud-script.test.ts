import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Cloud Scheduler receives valid JSON on Windows and updates headers idempotently", async () => {
  const script = await readFile(new URL("../scripts/deploy/deploy-gcloud.ps1", import.meta.url), "utf8");

  const payload = script.match(/\$schedulerBody\s*=\s*'([^']+)'/)?.[1];
  assert.ok(payload, "Scheduler payload must be supplied through the JSON file");
  assert.deepEqual(JSON.parse(payload), {
    overrides: { containerOverrides: [{ args: ["--schedule-coordinator"] }] },
  });
  assert.match(script, /--message-body-from-file/);
  assert.doesNotMatch(script, /"--message-body", \$schedulerBody/);
  assert.match(script, /IndexOf\(\$schedulerArgs, "--headers"\).*"--update-headers"/);
  assert.match(script, /Remove-Item -LiteralPath \$schedulerBodyPath/);
});

test("manual Cloud Run deployment disables fixed reports and alerts and leaves failed executions terminal", async () => {
  const script = await readFile(new URL("../scripts/deploy/deploy-manual-sweeper-gcloud.ps1", import.meta.url), "utf8");

  assert.match(script, /\$plainEnvPairs \+= "RUN_REPORT_EMAIL_ENABLED=false"/);
  assert.match(script, /\$plainEnvPairs \+= "ERROR_EMAIL_ENABLED=false"/);
  assert.doesNotMatch(script, /"(?:RUN_REPORT_EMAIL_ENABLED|RUN_REPORT_EMAIL_TO|ERROR_EMAIL_ENABLED|ERROR_EMAIL_TO)"/);
  assert.match(script, /"--max-retries", "0"/);
});
