#!/usr/bin/env python3
"""Authenticate once, reuse OAuth offline access, and run Google Ads API checks."""

from __future__ import annotations

import json
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


API_VERSION = "v25"
REDIRECT_URI = "http://127.0.0.1:8765/"
ADS_SCOPE = "https://www.googleapis.com/auth/adwords"


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def save_env_value(path: Path, key: str, value: str) -> None:
    """Atomically update one .env value without printing the secret."""
    lines = path.read_text(encoding="utf-8").splitlines()
    replacement = f"{key}={value}"
    updated = False
    for index, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[index] = replacement
            updated = True
            break
    if not updated:
        lines.append(replacement)

    temporary_path = path.with_name(f"{path.name}.tmp")
    temporary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    temporary_path.replace(path)


def post_form(url: str, values: dict[str, str]) -> dict:
    body = urllib.parse.urlencode(values).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    return read_json(request)


def read_json(request: urllib.request.Request) -> dict | list:
    retry_delays = (1, 2, 4, 8)
    for attempt in range(len(retry_delays) + 1):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            transient = error.code in (429, 500, 502, 503, 504)
            if transient and attempt < len(retry_delays):
                retry_after = error.headers.get("Retry-After")
                delay = retry_delays[attempt]
                if retry_after and retry_after.isdigit():
                    delay = max(delay, int(retry_after))
                print(
                    f"Transient HTTP {error.code}; retrying in {delay} second(s)...",
                    file=sys.stderr,
                    flush=True,
                )
                time.sleep(delay)
                continue
            raise RuntimeError(f"HTTP {error.code}: {detail}") from error
    raise RuntimeError("HTTP request retry loop ended unexpectedly.")


def authorize_offline(client_id: str, client_secret: str) -> tuple[str, str]:
    state = secrets.token_urlsafe(24)
    callback: dict[str, str] = {}

    class CallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - required server method name
            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            callback["state"] = params.get("state", [""])[0]
            callback["code"] = params.get("code", [""])[0]
            callback["error"] = params.get("error", [""])[0]
            message = (
                "Authorization received. You can close this tab and return to Codex."
                if callback["code"]
                else "Authorization was not completed. You can close this tab."
            )
            payload = message.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    query = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": REDIRECT_URI,
            "response_type": "code",
            "scope": ADS_SCOPE,
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
    )
    authorization_url = f"https://accounts.google.com/o/oauth2/v2/auth?{query}"

    server = HTTPServer(("127.0.0.1", 8765), CallbackHandler)
    server.timeout = 300
    print("Opening Google authorization in your browser...", flush=True)
    print(authorization_url, flush=True)
    webbrowser.open(authorization_url)
    server.handle_request()
    server.server_close()

    if not callback:
        raise RuntimeError("Timed out waiting for Google authorization.")
    if callback.get("error"):
        raise RuntimeError(f"Google authorization failed: {callback['error']}")
    if callback.get("state") != state or not callback.get("code"):
        raise RuntimeError("OAuth callback was missing a valid code or state.")

    token_response = post_form(
        "https://oauth2.googleapis.com/token",
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": callback["code"],
            "grant_type": "authorization_code",
            "redirect_uri": REDIRECT_URI,
        },
    )
    access_token = token_response.get("access_token")
    if not access_token:
        raise RuntimeError("Google did not return an access token.")
    refresh_token = token_response.get("refresh_token")
    if not refresh_token:
        raise RuntimeError(
            "Google did not return a refresh token. Revoke this app's existing "
            "Google Account access and authorize again with prompt=consent."
        )
    return access_token, refresh_token


def refresh_access_token(
    client_id: str, client_secret: str, refresh_token: str
) -> str:
    token_response = post_form(
        "https://oauth2.googleapis.com/token",
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
    )
    access_token = token_response.get("access_token")
    if not access_token:
        raise RuntimeError("Google did not return an access token from the refresh grant.")
    return access_token


def google_ads_request(
    url: str,
    access_token: str,
    developer_token: str,
    login_customer_id: str | None = None,
    query: str | None = None,
) -> dict | list:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "developer-token": developer_token,
        "Content-Type": "application/json",
    }
    if login_customer_id:
        headers["login-customer-id"] = login_customer_id
    data = None if query is None else json.dumps({"query": query}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers=headers,
        method="GET" if data is None else "POST",
    )
    return read_json(request)


def stream_results(payload: dict | list) -> list[dict]:
    batches = payload if isinstance(payload, list) else [payload]
    return [row for batch in batches for row in batch.get("results", [])]


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    env_path = repo_root / ".env"
    env = load_env(env_path)
    required = (
        "GOOGLE_ADS_DEVELOPER_TOKEN",
        "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
        "GOOGLE_ADS_CLIENT_ID",
        "GOOGLE_ADS_CLIENT_SECRET",
    )
    missing = [name for name in required if not env.get(name)]
    if missing:
        raise RuntimeError("Missing required configuration: " + ", ".join(missing))

    client_id = env["GOOGLE_ADS_CLIENT_ID"]
    client_secret = env["GOOGLE_ADS_CLIENT_SECRET"]
    refresh_token = env.get("GOOGLE_ADS_REFRESH_TOKEN", "")
    if refresh_token:
        access_token = refresh_access_token(client_id, client_secret, refresh_token)
        print("OAuth access token refreshed without browser authorization.")
    else:
        access_token, refresh_token = authorize_offline(client_id, client_secret)
        save_env_value(env_path, "GOOGLE_ADS_REFRESH_TOKEN", refresh_token)
        print("OAuth refresh token stored securely in the ignored .env file.")
    developer_token = env["GOOGLE_ADS_DEVELOPER_TOKEN"]
    manager_id = env["GOOGLE_ADS_LOGIN_CUSTOMER_ID"].replace("-", "")

    accessible = google_ads_request(
        f"https://googleads.googleapis.com/{API_VERSION}/customers:listAccessibleCustomers",
        access_token,
        developer_token,
    )
    accessible_names = accessible.get("resourceNames", [])
    print(f"OAuth/API check passed. Directly accessible customers: {len(accessible_names)}")

    hierarchy_query = """
        SELECT
          customer_client.id,
          customer_client.descriptive_name,
          customer_client.manager,
          customer_client.level,
          customer_client.status
        FROM customer_client
        ORDER BY customer_client.level, customer_client.descriptive_name
    """
    hierarchy = stream_results(
        google_ads_request(
            f"https://googleads.googleapis.com/{API_VERSION}/customers/{manager_id}/googleAds:searchStream",
            access_token,
            developer_token,
            manager_id,
            hierarchy_query,
        )
    )
    clients = [
        row["customerClient"]
        for row in hierarchy
        if not row.get("customerClient", {}).get("manager", False)
        and row.get("customerClient", {}).get("status") == "ENABLED"
    ]
    print(f"Enabled non-manager client accounts under MCC: {len(clients)}")
    if not clients:
        print("No enabled client account was available for the read-only data sample.")
        return 0

    sample_client = clients[0]
    customer_id = str(sample_client["id"])
    print(
        "Testing read-only keyword data for: "
        f"{sample_client.get('descriptiveName', '(unnamed)')} ({customer_id})"
    )
    keyword_query = """
        SELECT
          campaign.name,
          ad_group.name,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          ad_group_criterion.status,
          metrics.impressions,
          metrics.clicks,
          segments.date
        FROM keyword_view
        WHERE segments.date DURING LAST_7_DAYS
          AND ad_group_criterion.status != 'REMOVED'
        LIMIT 10
    """
    keyword_rows = stream_results(
        google_ads_request(
            f"https://googleads.googleapis.com/{API_VERSION}/customers/{customer_id}/googleAds:searchStream",
            access_token,
            developer_token,
            manager_id,
            keyword_query,
        )
    )
    print(f"Keyword rows returned in sample (limit 10): {len(keyword_rows)}")
    for row in keyword_rows[:5]:
        criterion = row.get("adGroupCriterion", {})
        keyword = criterion.get("keyword", {})
        print(
            "  - "
            f"{keyword.get('text', '(missing)')} | "
            f"{keyword.get('matchType', 'UNKNOWN')} | "
            f"{criterion.get('status', 'UNKNOWN')}"
        )

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # keep credentials out of diagnostics
        print(f"Temporary fetch failed: {error}", file=sys.stderr)
        raise SystemExit(1)
