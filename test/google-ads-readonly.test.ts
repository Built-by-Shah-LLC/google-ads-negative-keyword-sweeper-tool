import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReadOnlyGoogleAdsPath,
  assertReadOnlyGoogleAdsQuery
} from "../src/google-ads/client.js";

test("allows only the Google Ads searchStream endpoint", () => {
  assert.doesNotThrow(() =>
    assertReadOnlyGoogleAdsPath("/customers/1234567890/googleAds:searchStream")
  );
  assert.throws(() =>
    assertReadOnlyGoogleAdsPath("/customers/1234567890/campaignCriteria:mutate")
  , /Blocked non-read-only Google Ads endpoint/u);
  assert.throws(() =>
    assertReadOnlyGoogleAdsPath("/customers/1234567890/googleAds:mutate")
  , /Blocked non-read-only Google Ads endpoint/u);
});

test("allows only SELECT queries", () => {
  assert.doesNotThrow(() => assertReadOnlyGoogleAdsQuery("\n  SELECT campaign.id FROM campaign"));
  assert.throws(() => assertReadOnlyGoogleAdsQuery("MUTATE campaign"), /only SELECT is allowed/u);
  assert.throws(() => assertReadOnlyGoogleAdsQuery("DELETE FROM campaign"), /only SELECT is allowed/u);
});
