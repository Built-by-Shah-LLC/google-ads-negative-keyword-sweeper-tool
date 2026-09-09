import { createHash } from "node:crypto";

const forbiddenKey = /authorization|api[-_]?key|token|secret|password|cookie|database[-_]?url/iu;

export interface BoundedJson {
  value: Record<string, unknown> | unknown[] | null;
  truncated: boolean;
  sha256: string;
}

export function boundedRedactedJson(value: unknown, maxBytes: number): BoundedJson {
  const redacted = redact(value);
  const serialized = stableStringify(redacted);
  const sha256 = createHash("sha256").update(serialized).digest("hex");
  if (Buffer.byteLength(serialized, "utf8") <= maxBytes) {
    return {
      value: jsonContainer(redacted),
      truncated: false,
      sha256,
    };
  }
  return {
    value: { truncated: true, originalSha256: sha256, originalBytes: Buffer.byteLength(serialized, "utf8") },
    truncated: true,
    sha256,
  };
}

export function safeDatabaseMessage(value: unknown, limit = 1000): string {
  const message = value instanceof Error ? value.message : String(value ?? "Unknown error");
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "[REDACTED_DATABASE_URL]")
    .replace(/bearer\s+[^\s]+/giu, "Bearer [REDACTED]")
    .slice(0, limit);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    result[key] = forbiddenKey.test(key) ? "[REDACTED]" : redact(child);
  }
  return result;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}

function jsonContainer(value: unknown): Record<string, unknown> | unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  return { value };
}
