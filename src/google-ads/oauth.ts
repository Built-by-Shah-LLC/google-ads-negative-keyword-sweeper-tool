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

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token"
      })
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok || typeof payload.access_token !== "string") {
      throw new Error(`Google OAuth refresh failed with HTTP ${response.status}.`);
    }

    this.accessToken = payload.access_token;
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
    this.expiresAt = Date.now() + Math.max(60, expiresIn - 300) * 1000;
    return this.accessToken;
  }
}
