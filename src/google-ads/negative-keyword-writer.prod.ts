import type { AppConfig } from "../config/env.js";
import { PipelineError } from "../observability/errors.js";
import { GoogleOAuthClient } from "./oauth.js";
import type {
  NegativeKeywordChunkResult,
  NegativeKeywordCreate,
  NegativeKeywordWriteResult,
  NegativeKeywordWriter
} from "./negative-keyword-writer.js";

const MUTATION_TIMEOUT_MS = 300_000;

export interface GoogleAdsMutationHttpResponse {
  ok: boolean;
  status: number;
  requestId: string | null;
  payload: unknown;
}

export interface GoogleAdsMutationHttpTransport {
  post(path: string, body: Record<string, unknown>): Promise<GoogleAdsMutationHttpResponse>;
}

/**
 * Production writer for campaign-level exact negatives.
 * Construction requires an explicit armed flag; the live transport is only used at runtime.
 */
export class ProductionNegativeKeywordWriter implements NegativeKeywordWriter {
  readonly mode = "production" as const;

  constructor(
    private readonly armed: boolean,
    private readonly transport: GoogleAdsMutationHttpTransport
  ) {}

  async writeChunk(
    customerId: string,
    operations: NegativeKeywordCreate[]
  ): Promise<NegativeKeywordChunkResult> {
    if (!this.armed) throw new Error("Production Google Ads mutation writer is not armed.");
    const cleanCustomerId = sanitizeId(customerId);
    if (operations.length < 1 || operations.length > 500) {
      throw new Error("Production Google Ads mutation chunks must contain between 1 and 500 operations.");
    }
    for (const operation of operations) {
      if (operation.customerId !== cleanCustomerId) {
        throw new Error("A production mutation operation crossed its customer boundary.");
      }
    }

    const path = campaignCriterionMutationPath(cleanCustomerId);
    const validation = await this.transport.post(path, campaignCriterionMutationRequest(cleanCustomerId, operations, true));
    assertMutationHttpSuccess(validation, cleanCustomerId, true);
    const validationErrors = parsePartialFailureErrors(validation.payload);
    if (validationErrors.unmapped.length > 0) {
      return {
        requestId: validation.requestId,
        results: operations.map((operation) => failed(operation, validationErrors.unmapped.join("; ")))
      };
    }

    const validOperations: NegativeKeywordCreate[] = [];
    const validOriginalIndexes: number[] = [];
    const output: Array<NegativeKeywordWriteResult | undefined> = new Array(operations.length);
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index]!;
      const errors = validationErrors.byOperation.get(index);
      if (errors && errors.length > 0) output[index] = failed(operation, errors.join("; "));
      else {
        validOperations.push(operation);
        validOriginalIndexes.push(index);
      }
    }
    if (validOperations.length === 0) {
      return { requestId: validation.requestId, results: output as NegativeKeywordWriteResult[] };
    }

    const mutation = await this.transport.post(path, campaignCriterionMutationRequest(cleanCustomerId, validOperations, false));
    assertMutationHttpSuccess(mutation, cleanCustomerId, false);
    const mutationErrors = parsePartialFailureErrors(mutation.payload);
    const results = responseResults(mutation.payload);
    if (mutationErrors.unmapped.length > 0 || results.length !== validOperations.length) {
      const message = mutationErrors.unmapped.length > 0
        ? mutationErrors.unmapped.join("; ")
        : "Google Ads returned an unexpected mutation result count.";
      for (const [filteredIndex, operation] of validOperations.entries()) {
        output[validOriginalIndexes[filteredIndex]!] = failed(operation, message);
      }
    } else {
      for (const [filteredIndex, operation] of validOperations.entries()) {
        const originalIndex = validOriginalIndexes[filteredIndex]!;
        const errors = mutationErrors.byOperation.get(filteredIndex);
        const resourceName = stringValue(results[filteredIndex]?.resourceName);
        output[originalIndex] = errors && errors.length > 0
          ? failed(operation, errors.join("; "))
          : resourceName
            ? { ...operation, status: "APPLIED", resourceName, error: null }
            : failed(operation, "Google Ads returned an empty result without a mapped partial-failure error.");
      }
    }
    return { requestId: mutation.requestId, results: output as NegativeKeywordWriteResult[] };
  }
}

export function createLiveProductionNegativeKeywordWriter(
  config: AppConfig["googleAds"],
  armed: boolean
): ProductionNegativeKeywordWriter {
  return new ProductionNegativeKeywordWriter(armed, new LiveGoogleAdsMutationTransport(config));
}

export function createLiveGoogleAdsMutationTransport(
  config: AppConfig["googleAds"]
): GoogleAdsMutationHttpTransport {
  return new LiveGoogleAdsMutationTransport(config);
}

class LiveGoogleAdsMutationTransport implements GoogleAdsMutationHttpTransport {
  private readonly oauth: GoogleOAuthClient;

  constructor(private readonly config: AppConfig["googleAds"]) {
    this.oauth = new GoogleOAuthClient(config.clientId, config.clientSecret, config.refreshToken);
  }

  async post(path: string, body: Record<string, unknown>): Promise<GoogleAdsMutationHttpResponse> {
    assertMutationPath(path);
    const token = await this.oauth.getAccessToken();
    let response: Response;
    try {
      response = await fetch(`https://googleads.googleapis.com/${this.config.apiVersion}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "developer-token": this.config.developerToken,
          "login-customer-id": this.config.loginCustomerId,
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(MUTATION_TIMEOUT_MS)
      });
    } catch (error) {
      throw new PipelineError("Google Ads mutation had an ambiguous network outcome; it was not retried.", {
        stage: "GOOGLE_ADS_MUTATION",
        code: "GOOGLE_ADS_MUTATION_AMBIGUOUS",
        provider: "google-ads",
        retryable: false,
        organizationId: customerIdFromPath(path)
      }, { cause: error });
    }
    const payload = await safeJson(response);
    return {
      ok: response.ok,
      status: response.status,
      requestId: response.headers.get("request-id"),
      payload
    };
  }
}

export function campaignCriterionMutationRequest(
  customerId: string,
  operations: NegativeKeywordCreate[],
  validateOnly: boolean
): Record<string, unknown> {
  return {
    operations: operations.map((operation) => ({
      create: {
        campaign: `customers/${customerId}/campaigns/${operation.campaignId}`,
        negative: true,
        keyword: {
          text: operation.negativeText,
          matchType: "EXACT"
        }
      }
    })),
    partialFailure: true,
    validateOnly,
    responseContentType: "RESOURCE_NAME_ONLY"
  };
}

export function assertMutationHttpSuccess(
  response: GoogleAdsMutationHttpResponse,
  customerId: string,
  validateOnly: boolean
): void {
  if (response.ok) return;
  throw new PipelineError(
    `Google Ads ${validateOnly ? "mutation validation" : "mutation"} failed with HTTP ${response.status}.`,
    {
      stage: "GOOGLE_ADS_MUTATION",
      code: validateOnly ? "GOOGLE_ADS_MUTATION_VALIDATION_HTTP_ERROR" : "GOOGLE_ADS_MUTATION_HTTP_ERROR",
      provider: "google-ads",
      statusCode: response.status,
      requestId: response.requestId,
      retryable: false,
      organizationId: customerId
    }
  );
}

export function parsePartialFailureErrors(payload: unknown): {
  byOperation: Map<number, string[]>;
  unmapped: string[];
} {
  const byOperation = new Map<number, string[]>();
  const unmapped: string[] = [];
  const root = recordValue(payload);
  const status = recordValue(root?.partialFailureError);
  if (!status) return { byOperation, unmapped };
  const details = Array.isArray(status.details) ? status.details : [];
  let found = false;
  for (const detailValue of details) {
    const detail = recordValue(detailValue);
    if (!detail || !Array.isArray(detail.errors)) continue;
    for (const errorValue of detail.errors) {
      const error = recordValue(errorValue);
      if (!error) continue;
      found = true;
      const message = stringValue(error.message) || "Google Ads rejected the operation.";
      const index = operationIndex(error.location);
      if (index === null) unmapped.push(message);
      else byOperation.set(index, [...(byOperation.get(index) ?? []), message]);
    }
  }
  if (!found) unmapped.push(stringValue(status.message) || "Google Ads returned an unreadable partial-failure response.");
  return { byOperation, unmapped };
}

export function campaignCriterionMutationPath(customerId: string): string {
  return `/customers/${sanitizeId(customerId)}/campaignCriteria:mutate`;
}

function operationIndex(locationValue: unknown): number | null {
  const location = recordValue(locationValue);
  const elements = Array.isArray(location?.fieldPathElements) ? location.fieldPathElements : [];
  for (const elementValue of elements) {
    const element = recordValue(elementValue);
    if (!element || element.fieldName !== "operations") continue;
    const index = Number(element.index);
    if (Number.isSafeInteger(index) && index >= 0) return index;
  }
  return null;
}

function responseResults(payload: unknown): Record<string, unknown>[] {
  const root = recordValue(payload);
  return Array.isArray(root?.results)
    ? root.results.map((item) => recordValue(item) ?? {})
    : [];
}

function failed(operation: NegativeKeywordCreate, error: string): NegativeKeywordWriteResult {
  return { ...operation, status: "FAILED", resourceName: null, error: error.slice(0, 500) };
}

function assertMutationPath(path: string): void {
  if (!/^\/customers\/\d+\/campaignCriteria:mutate$/u.test(path)) {
    throw new Error(`Blocked unexpected Google Ads mutation endpoint '${path}'.`);
  }
}

function sanitizeId(value: string): string {
  const clean = value.replaceAll("-", "");
  if (!/^\d+$/u.test(clean)) throw new Error("Google Ads customer ID must contain only digits.");
  return clean;
}

function customerIdFromPath(path: string): string {
  return /^\/customers\/(\d+)\//u.exec(path)?.[1] ?? "unknown";
}

function recordValue(value: unknown): Record<string, any> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
