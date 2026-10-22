import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Cloud Scheduler receives valid JSON on Windows and updates headers idempotently", async () => {
  const script = await readFile(new URL("../scripts/deploy/deploy-gcloud.ps1", import.meta.url), "utf8");

  assert.match(
    script,
    /\$schedulerBody = '\{"overrides":\{"containerOverrides":\[\{"args":\["--schedule-coordinator"\]\}\]\}\}'/,
  );
  assert.match(script, /--message-body-from-file/);
  assert.doesNotMatch(script, /"--message-body", \$schedulerBody/);
  assert.match(script, /IndexOf\(\$schedulerArgs, "--headers"\).*"--update-headers"/);
  assert.match(script, /Remove-Item -LiteralPath \$schedulerBodyPath/);
});
