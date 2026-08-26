import type { AppConfig } from "../config/env.js";
import { GoogleOAuthClient } from "./oauth.js";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class GoogleAdsClient {
  private readonly oauth: GoogleOAuthClient;

  constructor(private readonly config: AppConfig["googleAds"]) {
    this.oauth = new GoogleOAuthClient(config.clientId, config.clientSecret, config.refreshToken);
  }

  async searchStream(customerId: string, query: string): Promise<Record<string, unknown>[]> {
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
    let oauthRetried = false;
    for (let attempt = 0; attempt <= 4; attempt += 1) {
      const token = await this.oauth.getAccessToken();
      const response = await fetch(
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

      if (response.status === 401 && !oauthRetried) {
        oauthRetried = true;
        this.oauth.invalidate();
        continue;
      }
      if (RETRYABLE_STATUS.has(response.status) && attempt < 4) {
        await wait(retryDelayMs(response, attempt));
        continue;
      }
      if (!response.ok) {
        const requestId = response.headers.get("request-id");
        const detail = await safeErrorMessage(response);
        throw new Error(
          `Google Ads request failed with HTTP ${response.status}` +
          `${requestId ? ` (request ${requestId})` : ""}: ${detail}`
        );
      }
      return response.json();
    }
    throw new Error("Google Ads retry loop ended unexpectedly.");
  }
}

function sanitizeCustomerId(customerId: string): string {
  const clean = customerId.replaceAll("-", "");
  if (!/^\d+$/u.test(clean)) throw new Error("Google Ads customer ID must contain only digits.");
  return clean;
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
