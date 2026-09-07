const DECISION_KEYS = ["itemId", "decision", "negativeText", "ruleIds", "reason", "confidence"] as const;

export function parseClassifierPayload(text: string): unknown {
  const jsonText = extractJsonText(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const balanced = extractBalancedJson(jsonText);
    if (balanced === jsonText) {
      throw new Error(`Classifier output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      parsed = JSON.parse(balanced);
    } catch (inner) {
      throw new Error(`Classifier output was not valid JSON: ${inner instanceof Error ? inner.message : String(inner)}`);
    }
  }
  return normalizeClassifierPayload(parsed);
}

export function normalizeClassifierPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return { decisions: value.map(pickDecisionFields) };
  }
  if (isRecord(value) && Array.isArray(value.decisions)) {
    return { decisions: value.decisions.map(pickDecisionFields) };
  }
  return value;
}

function pickDecisionFields(item: unknown): unknown {
  if (!isRecord(item)) return item;
  const source: Record<string, unknown> = { ...item };
  if (!("itemId" in source) && typeof source.item_id === "string") source.itemId = source.item_id;
  if (!("negativeText" in source) && "negative_text" in source) source.negativeText = source.negative_text;
  if (!("ruleIds" in source)) {
    if ("ruleId" in source) {
      source.ruleIds = Array.isArray(source.ruleId) ? source.ruleId : [source.ruleId];
    } else if (Array.isArray(source.rules)) {
      source.ruleIds = source.rules;
    } else if (Array.isArray(source.rule_ids)) {
      source.ruleIds = source.rule_ids;
    }
  }
  const picked: Record<string, unknown> = {};
  for (const key of DECISION_KEYS) {
    if (key in source) picked[key] = source[key];
  }
  return picked;
}

function extractJsonText(text: string): string {
  let trimmed = text.replace(/^\uFEFF/u, "").trim();
  if (trimmed === "") throw new Error("Classifier output was empty.");
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```\s*$/u, "").trim();
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (starts.length === 0) throw new Error("Classifier output did not contain JSON.");
  return trimmed.slice(Math.min(...starts)).trim();
}

function extractBalancedJson(source: string): string {
  const start = source.search(/[\[{]/u);
  if (start < 0) return source;
  const text = source.slice(start);
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }
    if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (stack.pop() !== expected) return source;
      if (stack.length === 0) return text.slice(0, index + 1);
    }
  }
  return source;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
