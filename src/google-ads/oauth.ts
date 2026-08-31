import { PipelineError } from "../observability/errors.js";

export class GoogleOAuthClient {
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshToken: string
  ) {}

  invalidate(): void {
    this.accessToken = null;
    this.expiresAt = 0;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt) return this.accessToken;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: this.refreshToken,
            grant_type: "refresh_token"
          })
        });
      } catch (error) {
        if (attempt < 2) {
          await wait(1000 * 2 ** attempt);
          continue;
        }
        throw new PipelineError("Google OAuth refresh network request failed.", {
          stage: "GOOGLE_OAUTH_REFRESH",
          code: "GOOGLE_OAUTH_NETWORK_ERROR",
          provider: "google-oauth",
          retryable: true,
          details: { attemptCount: attempt + 1 }
        }, { cause: error });
      }
      const payload = await readJsonSafely(response);
      if (response.ok && typeof payload.access_token === "string") {
        this.accessToken = payload.access_token;
        const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
        this.expiresAt = Date.now() + Math.max(60, expiresIn - 300) * 1000;
        return this.accessToken;
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < 2) {
        await wait(1000 * 2 ** attempt);
        continue;
      }
      throw new PipelineError(`Google OAuth refresh failed with HTTP ${response.status}.`, {
        stage: "GOOGLE_OAUTH_REFRESH",
        code: "GOOGLE_OAUTH_REFRESH_FAILED",
        provider: "google-oauth",
        statusCode: response.status,
        retryable,
        details: { attemptCount: attempt + 1 }
      });
    }
    throw new Error("Google OAuth retry loop ended unexpectedly.");
  }
}

async function readJsonSafely(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload = await response.json() as unknown;
    return typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
