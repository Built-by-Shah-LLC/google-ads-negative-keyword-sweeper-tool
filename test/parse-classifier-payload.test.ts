import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClassifierPayload, parseClassifierPayload } from "../src/llm/parse-classifier-payload.js";

const decision = {
  itemId: "item-1",
  decision: "KEEP",
  negativeText: null,
  ruleIds: ["POL-COLLISION-KEEP"],
  reason: "Qualified collision intent",
  confidence: 0.99
};

test("accepts the production object envelope", () => {
  assert.deepEqual(parseClassifierPayload(JSON.stringify({ decisions: [decision] })), {
    decisions: [decision]
  });
});

test("wraps a bare JSON array as decisions", () => {
  assert.deepEqual(parseClassifierPayload(JSON.stringify([decision])), {
    decisions: [decision]
  });
});

test("strips markdown fences around a bare array", () => {
  const text = "```json\n" + JSON.stringify([decision], null, 2) + "\n```";
  assert.deepEqual(parseClassifierPayload(text), { decisions: [decision] });
});

test("strips an unclosed markdown fence", () => {
  const text = "```json\n" + JSON.stringify({ decisions: [decision] });
  assert.deepEqual(parseClassifierPayload(text), { decisions: [decision] });
});

test("drops unexpected decision fields before validation", () => {
  const messy = [{ ...decision, mutation: "do-not-accept", extra: true }];
  assert.deepEqual(normalizeClassifierPayload(messy), { decisions: [decision] });
});

test("extracts JSON buried in prose", () => {
  const text = "Here is the classification result:\n" + JSON.stringify({ decisions: [decision] }) + "\nThanks.";
  assert.deepEqual(parseClassifierPayload(text), { decisions: [decision] });
});

test("promotes a singular ruleId string into ruleIds", () => {
  const text = JSON.stringify([{
    itemId: "item-1",
    decision: "KEEP",
    negativeText: null,
    ruleId: "POL-COLLISION-KEEP",
    reason: "Qualified collision intent",
    confidence: 0.99
  }]);
  assert.deepEqual(parseClassifierPayload(text), { decisions: [decision] });
});
