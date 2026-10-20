import assert from "node:assert/strict";
import test from "node:test";
import { validateRecoveryIntents } from "../src/volume-recovery/classifier.js";

const valid = { itemId: "a", negativeText: "paint job", decision: "NEGATIVE", category: "BODYWORK-NEGATIVE", competitorLikelihood: "unlikely", confidence: 0.9, reason: "Vehicle painting service." };
test("recovery intent rejects coerced field shapes and whitespace-only reasons", () => {
  for (const invalid of [
    { category: ["BODYWORK-NEGATIVE"] },
    { competitorLikelihood: ["likely"] },
    { reason: " \n\t " }
  ]) assert.throws(() => validateRecoveryIntents({ items: [{ ...valid, ...invalid }] }, [{ itemId: "a", negativeText: valid.negativeText }], ["BODYWORK-NEGATIVE"]), JSON.stringify(invalid));
});
