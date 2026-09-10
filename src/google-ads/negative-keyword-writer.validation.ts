import type { AppConfig } from "../config/env.js";
import {
  assertMutationHttpSuccess,
  campaignCriterionMutationPath,
  campaignCriterionMutationRequest,
  createLiveGoogleAdsMutationTransport,
  parsePartialFailureErrors,
  type GoogleAdsMutationHttpTransport
} from "./negative-keyword-writer.prod.js";
import type {
  NegativeKeywordChunkResult,
  NegativeKeywordCreate,
  NegativeKeywordWriteResult,
  NegativeKeywordWriter
} from "./negative-keyword-writer.js";

/**
 * Sends exactly one validateOnly request. This class has no branch that can
 * construct or send a request with validateOnly=false.
 */
export class ValidationOnlyNegativeKeywordWriter implements NegativeKeywordWriter {
  readonly mode = "validation" as const;

  constructor(private readonly transport: GoogleAdsMutationHttpTransport) {}

  async writeChunk(
    customerId: string,
    operations: NegativeKeywordCreate[]
  ): Promise<NegativeKeywordChunkResult> {
    if (operations.length < 1 || operations.length > 500) {
      throw new Error("Google Ads validation chunks must contain between 1 and 500 operations.");
    }
    const path = campaignCriterionMutationPath(customerId);
    const response = await this.transport.post(
      path,
      campaignCriterionMutationRequest(customerId, operations, true)
    );
    assertMutationHttpSuccess(response, customerId.replaceAll("-", ""), true);
    const errors = parsePartialFailureErrors(response.payload);
    if (errors.unmapped.length > 0) {
      return {
        requestId: response.requestId,
        results: operations.map((operation) => failed(operation, errors.unmapped.join("; ")))
      };
    }
    return {
      requestId: response.requestId,
      results: operations.map((operation, index): NegativeKeywordWriteResult => {
        const operationErrors = errors.byOperation.get(index);
        return operationErrors && operationErrors.length > 0
          ? failed(operation, operationErrors.join("; "))
          : { ...operation, status: "VALIDATED", resourceName: null, error: null };
      })
    };
  }
}

export function createLiveValidationOnlyNegativeKeywordWriter(
  config: AppConfig["googleAds"]
): ValidationOnlyNegativeKeywordWriter {
  return new ValidationOnlyNegativeKeywordWriter(createLiveGoogleAdsMutationTransport(config));
}

function failed(operation: NegativeKeywordCreate, error: string): NegativeKeywordWriteResult {
  return { ...operation, status: "FAILED", resourceName: null, error: error.slice(0, 500) };
}
