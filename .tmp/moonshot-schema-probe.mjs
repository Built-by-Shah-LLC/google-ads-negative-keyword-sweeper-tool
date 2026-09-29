// Moonshot structured-output probe (temporary diagnostic; not part of the pipeline).
// Tests which response_format variant kimi-k2.6 actually honors.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/u)
    .filter((line) => /^[A-Z_]+=.*/u.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^["']|["']$/gu, "")])
);
const apiKey = env.MOONSHOT_API_KEY;
const baseUrl = (env.MOONSHOT_BASE_URL || "https://api.moonshot.ai/v1").replace(/\/$/u, "");
const model = env.MOONSHOT_MODEL || "kimi-k2.6";

const itemIds = ["item-001", "item-002"];
const ruleIds = ["POL-FULL-QUERY-EXACT", "POL-GENERIC-KEEP"];

function schemaVariant(style) {
  const negativeText =
    style === "anyOf"
      ? { anyOf: [{ type: "string" }, { type: "null" }] }
      : { type: ["string", "null"] };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      decisions: {
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            itemId: { type: "string", enum: itemIds },
            decision: { type: "string", enum: ["KEEP", "NEGATIVE_EXACT"] },
            negativeText,
            ruleIds: { type: "array", items: { type: "string", enum: ruleIds } },
            reason: { type: "string" },
            confidence: { type: "number" }
          },
          required: ["itemId", "decision", "negativeText", "ruleIds", "reason", "confidence"]
        }
      }
    },
    required: ["decisions"]
  };
}

const userPrompt = [
  "Classify each search term for an auto-body shop's Google Ads campaign.",
  "Decide KEEP or NEGATIVE_EXACT for every item. KEEP decisions must cite POL-GENERIC-KEEP;",
  "NEGATIVE_EXACT decisions must cite POL-FULL-QUERY-EXACT and set negativeText to the exact search term.",
  "Items:",
  JSON.stringify([
    { itemId: "item-001", searchTerm: "auto body shop near me" },
    { itemId: "item-002", searchTerm: "diy car painting at home" }
  ])
].join("\n");

async function probe(label, { style, thinking, useFormat }) {
  const request = {
    model,
    messages: [
      { role: "system", content: "You are a strict JSON classifier. Return only the requested JSON object." },
      { role: "user", content: userPrompt }
    ],
    ...(useFormat
      ? { response_format: { type: "json_schema", json_schema: { name: "negative_keyword_decisions", strict: true, schema: schemaVariant(style) } } }
      : {}),
    ...(thinking === null ? {} : { thinking: { type: thinking } }),
    max_tokens: 32768
  };
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  const payload = await response.json();
  if (!response.ok) {
    console.log(`${label}: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 300)}`);
    return;
  }
  const text = payload.choices?.[0]?.message?.content ?? "";
  let verdict;
  try {
    const parsed = JSON.parse(text);
    const d = parsed.decisions?.[0] ?? {};
    const missing = ["itemId", "decision", "negativeText", "ruleIds", "reason", "confidence"].filter((f) => !(f in d));
    verdict = missing.length === 0 ? "CONFORMANT" : `MISSING: ${missing.join(",")}`;
  } catch {
    verdict = `UNPARSEABLE (${text.slice(0, 120)})`;
  }
  console.log(`${label}: ${verdict}`);
}

console.log(`model=${model} baseUrl=${baseUrl}`);
await probe("A anyOf            thinking=disabled", { style: "anyOf", thinking: "disabled", useFormat: true });
await probe("B anyOf            thinking=enabled ", { style: "anyOf", thinking: "enabled", useFormat: true });
await probe("C type-union       thinking=disabled", { style: "union", thinking: "disabled", useFormat: true });
await probe("D anyOf            thinking=omitted ", { style: "anyOf", thinking: null, useFormat: true });
