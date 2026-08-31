import type { AppConfig } from "../config/env.js";
import { PipelineError } from "../observability/errors.js";
import type { RunTelemetry } from "../observability/run-telemetry.js";
import { GoogleOAuthClient } from "./oauth.js";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class GoogleAdsClient {
  private readonly oauth: GoogleOAuthClient;

  constructor(
    private readonly config: AppConfig["googleAds"],
    private readonly telemetry?: RunTelemetry
  ) {
    this.oauth = new GoogleOAuthClient(config.clientId, config.clientSecret, config.refreshToken);
  }

  async searchStream(customerId: string, query: string): Promise<Record<string, unknown>[]> {
    assertReadOnlyGoogleAdsQuery(query);
    const payload = await this.request(
      `/customers/${sanitizeCustomerId(customerId)}/googleAds:searchStream`,
      { query }
    );
    const batches = Array.isArray(payload) ? payload : [payload];
    const results: Record<string, unknown>[] = [];
    for (const batch of batches) {
      if (!isRecord(batch) || !Array.isArray(batch.results)) continue;
      for (const row of batch.results) {
        if (isRecord(row)) results.push(row);
      }
    }
    return results;
  }

  private async request(path: string, body: Record<string, unknown>): Promise<unknown> {
    assertReadOnlyGoogleAdsPath(path);
    let oauthRetried = false;
    for (let attempt = 0; attempt <= 4; attempt += 1) {
      const startedAt = new Date().toISOString();
      const started = performance.now();
      const token = await this.oauth.getAccessToken();
      let response: Response;
      try {
        response = await fetch(
          `https://googleads.googleapis.com/${this.config.apiVersion}${path}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "developer-token": this.config.developerToken,
              "login-customer-id": this.config.loginCustomerId,
              "content-type": "application/json"
            },
            body: JSON.stringify(body)
          }
        );
      } catch (error) {
        const retrying = attempt < 4;
        this.recordAttempt(path, attempt + 1, startedAt, started, null, null, retrying ? "RETRYING" : "FAILED", {
          error: error instanceof Error ? error.message : String(error)
        });
        if (retrying) {
          await wait(1000 * 2 ** attempt);
          continue;
        }
        throw new PipelineError("Google Ads network request failed.", {
          stage: "GOOGLE_ADS_REQUEST",
          code: "GOOGLE_ADS_NETWORK_ERROR",
          provider: "google-ads",
          retryable: true,
          organizationId: customerIdFromPath(path)
        }, { cause: error });
      }

      if (response.status === 401 && !oauthRetried) {
        this.recordAttempt(path, attempt + 1, startedAt, started, response.status, response.headers.get("request-id"), "RETRYING", {
          reason: "access_token_rejected"
        });
        oauthRetried = true;
        this.oauth.invalidate();
        continue;
      }
      if (RETRYABLE_STATUS.has(response.status) && attempt < 4) {
        this.recordAttempt(path, attempt + 1, startedAt, started, response.status, response.headers.get("request-id"), "RETRYING");
        await wait(retryDelayMs(response, attempt));
        continue;
      }
      if (!response.ok) {
        const requestId = response.headers.get("request-id");
        const detail = await safeErrorMessage(response);
        this.recordAttempt(path, attempt + 1, startedAt, started, response.status, requestId, "FAILED", { error: detail });
        throw new PipelineError(
          `Google Ads request failed with HTTP ${response.status}` +
          `${requestId ? ` (request ${requestId})` : ""}: ${detail}`,
          {
            stage: "GOOGLE_ADS_REQUEST",
            code: "GOOGLE_ADS_HTTP_ERROR",
            provider: "google-ads",
            statusCode: response.status,
            requestId,
            retryable: RETRYABLE_STATUS.has(response.status),
            organizationId: customerIdFromPath(path)
          }
        );
      }
      try {
        const payload = await response.json();
        this.recordAttempt(path, attempt + 1, startedAt, started, response.status, response.headers.get("request-id"), "SUCCEEDED");
        return payload;
      } catch (error) {
        const requestId = response.headers.get("request-id");
        this.recordAttempt(path, attempt + 1, startedAt, started, response.status, requestId, "FAILED", {
          error: "Invalid JSON response body"
        });
        throw new PipelineError("Google Ads returned an invalid JSON response body.", {
          stage: "GOOGLE_ADS_REQUEST",
          code: "GOOGLE_ADS_INVALID_RESPONSE",
          provider: "google-ads",
          statusCode: response.status,
          requestId,
          retryable: false,
          organizationId: customerIdFromPath(path)
        }, { cause: error });
      }
    }
    throw new Error("Google Ads retry loop ended unexpectedly.");
  }

  private recordAttempt(
    path: string,
    attempt: number,
    startedAt: string,
    started: number,
    statusCode: number | null,
    requestId: string | null,
    status: "SUCCEEDED" | "FAILED" | "RETRYING",
    details?: Record<string, unknown>
  ): void {
    this.telemetry?.event({
      stage: "GOOGLE_ADS_HTTP_REQUEST",
      status,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      organizationId: customerIdFromPath(path),
      provider: "google-ads",
      requestId,
      attempt,
      ...(statusCode === null ? {} : { statusCode }),
      ...(details === undefined ? {} : { details })
    });
  }
}

export function assertReadOnlyGoogleAdsPath(path: string): void {
  if (!/^\/customers\/\d+\/googleAds:searchStream$/u.test(path)) {
    throw new Error(`Blocked non-read-only Google Ads endpoint '${path}'.`);
  }
}

export function assertReadOnlyGoogleAdsQuery(query: string): void {
  const normalized = query.trimStart();
  if (!/^SELECT\b/iu.test(normalized)) {
    throw new Error("Blocked non-read-only Google Ads query: only SELECT is allowed.");
  }
}

function sanitizeCustomerId(customerId: string): string {
  const clean = customerId.replaceAll("-", "");
  if (!/^\d+$/u.test(clean)) throw new Error("Google Ads customer ID must contain only digits.");
  return clean;
}

function customerIdFromPath(path: string): string {
  return /^\/customers\/(\d+)\//u.exec(path)?.[1] ?? "unknown";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const retrySeconds = retryAfter && /^\d+$/u.test(retryAfter) ? Number(retryAfter) : 0;
  const exponential = 1000 * 2 ** attempt;
  return Math.max(exponential, retrySeconds * 1000) + Math.floor(Math.random() * 250);
}

async function safeErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as unknown;
    const root = Array.isArray(payload) ? payload[0] : payload;
    const error = isRecord(root) && isRecord(root.error) ? root.error : null;
    const status = typeof error?.status === "string" ? error.status : "UNKNOWN";
    const message = typeof error?.message === "string" ? error.message : "No message returned";
    const details = Array.isArray(error?.details) ? error.details : [];
    const googleAdsFailure = details.find((detail) => isRecord(detail) && Array.isArray(detail.errors));
    const firstFailure = isRecord(googleAdsFailure) && Array.isArray(googleAdsFailure.errors)
      ? googleAdsFailure.errors.find(isRecord)
      : null;
    const failureMessage = firstFailure && typeof firstFailure.message === "string"
      ? ` ${firstFailure.message}`
      : "";
    return `${status}: ${message}${failureMessage}`;
  } catch {
    return "No JSON error detail returned";
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
