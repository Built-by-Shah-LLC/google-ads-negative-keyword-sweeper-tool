import type {
  NegativeKeywordChunkResult,
  NegativeKeywordCreate,
  NegativeKeywordWriter
} from "./negative-keyword-writer.js";

/** Development-only writer. It never imports OAuth or calls fetch. */
export class DevelopmentNegativeKeywordWriter implements NegativeKeywordWriter {
  readonly mode = "development" as const;

  async writeChunk(
    customerId: string,
    operations: NegativeKeywordCreate[]
  ): Promise<NegativeKeywordChunkResult> {
    return {
      requestId: `mock-${operations[0]?.operationId ?? "empty"}`,
      results: operations.map((operation) => ({
        ...operation,
        status: "MOCKED" as const,
        resourceName: `mock://google-ads/customers/${customerId}/campaignCriteria/${operation.campaignId}~${operation.operationId}`,
        error: null
      }))
    };
  }
}
