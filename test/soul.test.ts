import assert from "node:assert/strict";
import test from "node:test";
import { loadSoul, parseSoul } from "../src/config/soul.js";

test("loads the soul identity file with its version", async () => {
  const soul = await loadSoul(process.cwd());
  assert.equal(soul.sourcePath, "src/config/soul.md");
  assert.match(soul.version, /^\d{4}-\d{2}-\d{2}\./u);
  assert.match(soul.markdown, /Google Ads expert/iu);
  assert.match(soul.markdown, /auto body repair shops/iu);
  assert.match(soul.markdown, /negative keyword list/iu);
  assert.match(soul.markdown, /intent/iu);
});

test("rejects a soul file without a Soul version", () => {
  assert.throws(() => parseSoul("# Soul\n\nNo version here."), /missing a Soul version/iu);
});

test("rejects a soul file with no content beyond the version", () => {
  assert.throws(
    () => parseSoul("Soul version: `2026-09-01.1`\n"),
    /no content beyond the Soul version/iu
  );
});
