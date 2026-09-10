import assert from "node:assert/strict";
import test from "node:test";
import type { NegativeKeywordWriter } from "../src/google-ads/negative-keyword-writer.js";
import {
  runTestAccountMutationSmoke,
  TEST_ACCOUNT_MUTATION_CONFIRMATION
} from "../src/google-ads/test-account-mutation-smoke.js";

test("test-account smoke refuses a production account before calling the writer", async () => {
  let writes = 0;
  const writer: NegativeKeywordWriter = {
    mode: "production",
    async writeChunk() {
      writes += 1;
      throw new Error("must not write");
    }
  };
  await assert.rejects(() => runTestAccountMutationSmoke({
    googleAds: {
      async searchStream() {
        return [{ customer: { id: "1234567890", testAccount: false } }];
      }
    },
    writer,
    customerId: "1234567890",
    campaignId: "100",
    negativeText: "sweeper api test safe",
    confirmation: TEST_ACCOUNT_MUTATION_CONFIRMATION
  }), /did not identify the target as a test account/u);
  assert.equal(writes, 0);
});

test("test-account smoke applies and verifies exactly one negative after the live test flag check", async () => {
  let writeCount = 0;
  let negativeReads = 0;
  const negativeText = "sweeper api test safe";
  const googleAds = {
    async searchStream(_customerId: string, query: string) {
      if (/FROM customer\b/u.test(query)) {
        return [{ customer: { id: "1234567890", testAccount: true } }];
      }
      if (/FROM campaign\b/u.test(query) && !/campaign_criterion/u.test(query)) {
        return [{ campaign: { id: "100", status: "PAUSED" } }];
      }
      negativeReads += 1;
      return negativeReads === 1 ? [] : [{
        campaign: { id: "100" },
        campaignCriterion: { negative: true, keyword: { text: negativeText, matchType: "EXACT" } }
      }];
    }
  };
  const writer: NegativeKeywordWriter = {
    mode: "production",
    async writeChunk(customerId, operations) {
      writeCount += 1;
      assert.equal(customerId, "1234567890");
      assert.equal(operations.length, 1);
      return {
        requestId: "test-account-request",
        results: operations.map((operation) => ({
          ...operation,
          status: "APPLIED" as const,
          resourceName: "customers/1234567890/campaignCriteria/100~999",
          error: null
        }))
      };
    }
  };

  const summary = await runTestAccountMutationSmoke({
    googleAds,
    writer,
    customerId: "123-456-7890",
    campaignId: "100",
    negativeText,
    confirmation: TEST_ACCOUNT_MUTATION_CONFIRMATION
  });

  assert.equal(writeCount, 1);
  assert.equal(negativeReads, 2);
  assert.equal(summary.status, "APPLIED");
  assert.equal(summary.appliedCount, 1);
  assert.equal(summary.verifiedCount, 1);
});

test("test-account smoke requires its dedicated confirmation", async () => {
  await assert.rejects(() => runTestAccountMutationSmoke({
    googleAds: { async searchStream() { return []; } },
    writer: { mode: "production", async writeChunk() { throw new Error("must not write"); } },
    customerId: "1234567890",
    campaignId: "100",
    negativeText: "sweeper api test safe",
    confirmation: ""
  }), /exact confirmation/u);
});
