import { createHash } from "node:crypto";
import type { ClassificationCandidate, ClassificationDecision } from "../types.js";
import type { GoogleAdsClient } from "./client.js";

export type NegativeKeywordWriterMode = "development" | "validation" | "production";

export interface NegativeKeywordCreate {
  operationId: string;
  customerId: string;
  campaignId: string;
  negativeText: string;
  sourceItemIds: string[];
}

export interface NegativeKeywordWriteResult extends NegativeKeywordCreate {
  status: "MOCKED" | "VALIDATED" | "APPLIED" | "FAILED" | "UNKNOWN";
  resourceName: string | null;
  error: string | null;
}

export interface NegativeKeywordChunkResult {
  requestId: string | null;
  results: NegativeKeywordWriteResult[];
}

export interface NegativeKeywordWriter {
  readonly mode: NegativeKeywordWriterMode;
  writeChunk(customerId: string, operations: NegativeKeywordCreate[]): Promise<NegativeKeywordChunkResult>;
}

export interface NegativeKeywordMutationSummary {
  mode: "disabled" | NegativeKeywordWriterMode;
  status: "DISABLED" | "NO_CHANGES" | "SKIPPED" | "MOCKED" | "VALIDATED" | "APPLIED" | "PARTIAL" | "FAILED";
  proposedCount: number;
  duplicateDecisionCount: number;
  existingCount: number;
  attemptedCount: number;
  mockedCount: number;
  validatedCount: number;
  appliedCount: number;
  failedCount: number;
  unknownCount: number;
  verifiedCount: number;
  verificationError: string | null;
  outcomeAmbiguous: boolean;
  googleAdsMutationPerformed: boolean;
  chunks: Array<{
    chunkId: string;
    requestId: string | null;
    operationCount: number;
    results: NegativeKeywordWriteResult[];
  }>;
  skippedReason: string | null;
}

export function disabledMutationSummary(): NegativeKeywordMutationSummary {
  return {
    mode: "disabled",
    status: "DISABLED",
    proposedCount: 0,
    duplicateDecisionCount: 0,
    existingCount: 0,
    attemptedCount: 0,
    mockedCount: 0,
    validatedCount: 0,
    appliedCount: 0,
    failedCount: 0,
    unknownCount: 0,
    verifiedCount: 0,
    verificationError: null,
    outcomeAmbiguous: false,
    googleAdsMutationPerformed: false,
    chunks: [],
    skippedReason: null
  };
}

export function skippedMutationSummary(
  writer: NegativeKeywordWriter,
  reason: string
): NegativeKeywordMutationSummary {
  return {
    ...disabledMutationSummary(),
    mode: writer.mode,
    status: "SKIPPED",
    skippedReason: reason
  };
}

export async function applyNegativeExactDecisions(input: {
  googleAds: Pick<GoogleAdsClient, "searchStream">;
  writer: NegativeKeywordWriter;
  customerId: string;
  candidates: ClassificationCandidate[];
  decisions: ClassificationDecision[];
  chunkSize: number;
}): Promise<NegativeKeywordMutationSummary> {
  const customerId = sanitizeId(input.customerId, "customer ID");
  if (!Number.isSafeInteger(input.chunkSize) || input.chunkSize < 1 || input.chunkSize > 500) {
    throw new Error("Google Ads mutation chunk size must be between 1 and 500.");
  }

  const { operations, duplicateDecisionCount } = createNegativeKeywordOperations(
    customerId,
    input.candidates,
    input.decisions
  );
  if (operations.length === 0) {
    return {
      ...disabledMutationSummary(),
      mode: input.writer.mode,
      status: "NO_CHANGES",
      duplicateDecisionCount
    };
  }

  const existingBefore = await fetchExistingCampaignExactNegatives(input.googleAds, customerId);
  const pending = operations.filter((operation) => !existingBefore.has(operationKey(operation)));
  const existingCount = operations.length - pending.length;
  if (pending.length === 0) {
    return {
      ...disabledMutationSummary(),
      mode: input.writer.mode,
      status: "NO_CHANGES",
      proposedCount: operations.length,
      duplicateDecisionCount,
      existingCount
    };
  }

  const chunks: NegativeKeywordMutationSummary["chunks"] = [];
  for (let offset = 0; offset < pending.length; offset += input.chunkSize) {
    const operationsInChunk = pending.slice(offset, offset + input.chunkSize);
    const chunkId = String(chunks.length + 1).padStart(4, "0");
    try {
      const result = await input.writer.writeChunk(customerId, operationsInChunk);
      assertChunkResult(operationsInChunk, result.results);
      chunks.push({
        chunkId,
        requestId: result.requestId,
        operationCount: operationsInChunk.length,
        results: result.results
      });
    } catch (error) {
      chunks.push({
        chunkId,
        requestId: null,
        operationCount: operationsInChunk.length,
        results: operationsInChunk.map((operation) => ({
          ...operation,
          status: input.writer.mode === "production" ? "UNKNOWN" : "FAILED",
          resourceName: null,
          error: safeErrorMessage(error)
        }))
      });
    }
  }

  const results = chunks.flatMap((chunk) => chunk.results);
  const mockedCount = results.filter((result) => result.status === "MOCKED").length;
  const validatedCount = results.filter((result) => result.status === "VALIDATED").length;
  let verifiedCount = 0;
  let verificationError: string | null = null;
  if (input.writer.mode === "production") {
    try {
      const existingAfter = await fetchExistingCampaignExactNegatives(input.googleAds, customerId);
      for (const result of results) {
        if (existingAfter.has(operationKey(result))) {
          verifiedCount += 1;
          result.status = "APPLIED";
          result.error = null;
        } else if (result.status === "APPLIED" || result.status === "UNKNOWN") {
          result.status = "FAILED";
          result.error = "Google Ads did not return the exact campaign negative during post-mutation verification.";
          result.resourceName = null;
        }
      }
    } catch (error) {
      verificationError = safeErrorMessage(error);
    }
  }

  const appliedCount = results.filter((result) => result.status === "APPLIED").length;
  const failedCount = results.filter((result) => result.status === "FAILED").length;
  const unknownCount = results.filter((result) => result.status === "UNKNOWN").length;
  const status = input.writer.mode === "development"
    ? failedCount === 0 ? "MOCKED" : mockedCount > 0 ? "PARTIAL" : "FAILED"
    : input.writer.mode === "validation"
      ? failedCount === 0 ? "VALIDATED" : validatedCount > 0 ? "PARTIAL" : "FAILED"
      : unknownCount > 0 || appliedCount > verifiedCount
        ? "PARTIAL"
        : failedCount === 0 ? "APPLIED" : appliedCount > 0 ? "PARTIAL" : "FAILED";
  return {
    mode: input.writer.mode,
    status,
    proposedCount: operations.length,
    duplicateDecisionCount,
    existingCount,
    attemptedCount: pending.length,
    mockedCount,
    validatedCount,
    appliedCount,
    failedCount,
    unknownCount,
    verifiedCount,
    verificationError,
    outcomeAmbiguous: unknownCount > 0,
    googleAdsMutationPerformed: input.writer.mode === "production" && appliedCount > 0,
    chunks,
    skippedReason: null
  };
}

export function createNegativeKeywordOperations(
  customerId: string,
  candidates: ClassificationCandidate[],
  decisions: ClassificationDecision[]
): { operations: NegativeKeywordCreate[]; duplicateDecisionCount: number } {
  const cleanCustomerId = sanitizeId(customerId, "customer ID");
  const candidateById = new Map(candidates.map((candidate) => [candidate.itemId, candidate]));
  const unique = new Map<string, NegativeKeywordCreate>();
  let negativeDecisionCount = 0;

  for (const decision of decisions) {
    if (decision.decision !== "NEGATIVE_EXACT") continue;
    negativeDecisionCount += 1;
    const candidate = candidateById.get(decision.itemId);
    if (!candidate) throw new Error(`Negative decision '${decision.itemId}' has no matching candidate.`);
    if (sanitizeId(candidate.customerId, "candidate customer ID") !== cleanCustomerId) {
      throw new Error(`Negative decision '${decision.itemId}' belongs to a different Google Ads customer.`);
    }
    if (decision.negativeText !== candidate.searchTerm) {
      throw new Error(`Negative decision '${decision.itemId}' does not preserve the complete search term.`);
    }
    const campaignId = sanitizeId(candidate.campaignId, "campaign ID");
    const negativeText = candidate.searchTerm;
    if (negativeText.length === 0) throw new Error(`Negative decision '${decision.itemId}' has empty text.`);
    const key = operationKey({ campaignId, negativeText });
    const existing = unique.get(key);
    if (existing) {
      existing.sourceItemIds.push(decision.itemId);
      continue;
    }
    unique.set(key, {
      operationId: createHash("sha256")
        .update([cleanCustomerId, campaignId, normalizeKeywordText(negativeText)].join("\u0000"))
        .digest("hex")
        .slice(0, 24),
      customerId: cleanCustomerId,
      campaignId,
      negativeText,
      sourceItemIds: [decision.itemId]
    });
  }

  const operations = [...unique.values()].sort((left, right) => left.operationId.localeCompare(right.operationId));
  return { operations, duplicateDecisionCount: negativeDecisionCount - operations.length };
}

export async function fetchExistingCampaignExactNegatives(
  googleAds: Pick<GoogleAdsClient, "searchStream">,
  customerId: string
): Promise<Set<string>> {
  const cleanCustomerId = sanitizeId(customerId, "customer ID");
  const rows = await googleAds.searchStream(cleanCustomerId, `
    SELECT
      campaign.id,
      campaign_criterion.keyword.text,
      campaign_criterion.keyword.match_type,
      campaign_criterion.negative
    FROM campaign_criterion
    WHERE campaign_criterion.type = KEYWORD
      AND campaign_criterion.negative = TRUE
  `);
  const result = new Set<string>();
  for (const row of rows) {
    const campaign = recordValue(row.campaign);
    const criterion = recordValue(row.campaignCriterion);
    const keyword = recordValue(criterion?.keyword);
    const campaignId = stringValue(campaign?.id);
    const text = stringValue(keyword?.text);
    const matchType = stringValue(keyword?.matchType).toUpperCase();
    if (!/^\d+$/u.test(campaignId) || text.length === 0 || matchType !== "EXACT" || criterion?.negative !== true) continue;
    result.add(operationKey({ campaignId, negativeText: text }));
  }
  return result;
}

function assertChunkResult(
  expected: NegativeKeywordCreate[],
  actual: NegativeKeywordWriteResult[]
): void {
  if (actual.length !== expected.length) {
    throw new Error("Google Ads mutation writer returned a result count that does not match its input.");
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index]?.operationId !== expected[index]?.operationId) {
      throw new Error("Google Ads mutation writer returned results out of order.");
    }
  }
}

function operationKey(value: { campaignId: string; negativeText: string }): string {
  return `${value.campaignId}\u0000${normalizeKeywordText(value.negativeText)}`;
}

function normalizeKeywordText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function sanitizeId(value: string, label: string): string {
  const clean = value.replaceAll("-", "");
  if (!/^\d+$/u.test(clean)) throw new Error(`Google Ads ${label} must contain only digits.`);
  return clean;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}
