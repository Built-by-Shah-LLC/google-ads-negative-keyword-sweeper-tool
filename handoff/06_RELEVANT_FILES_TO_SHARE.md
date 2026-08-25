# 06 — Relevant files to share

Minimal set another engineer needs **in addition to this `handoff/` folder**. Prefer the copies under `handoff/source_code/` (account IDs and emails already replaced). Originals stay in the repo unchanged.

**Do not share** live Hub spreadsheet contents, Ads UI exports with customer PII, or unredacted CONFIG from a private paste until reviewed.

---

## Must share (runtime + rules)

| Original path | Why needed | Secrets? | Share unchanged? | Redaction |
|---|---|---|---|---|
| `scripts/built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js` | Canonical daily MCC script: CONFIG, rules, GAQL, mutateAll, email | Account IDs + recipient emails in CONFIG | **No** — use sanitized copy | Replace allowlist IDs with ACCOUNT_0N; emails with EMAIL_0N. Keep all rules/queries/comments. |
| `scripts/built-by-shah-mcc-standalone-backfill-negatives-sweeper-final-v1.1.0.js` | 90-day catch-up twin (queue/label/email differ) | Same class of CONFIG PII if filled | Sanitized copy | Same placeholders if present |
| `scripts/built-by-shah-mcc-standalone-backfill-negatives-sweeper-kc-today-v1.1.0.js` | Shows IGNORE_DONE_LABEL prefill pattern; same rule block | Prefill IDs + emails | Sanitized copy | Same |
| `scripts/built-by-shah-mcc-search-negatives-sweeper.js` | Hub Search path: spoke Remove, LSR, createNegativeKeyword, no campaign-name gate | Empty Hub URL in repo (not a secret) | Yes if URL still empty | If someone filled HUB_SPREADSHEET_URL, redact the spreadsheet ID |
| `scripts/built-by-shah-mcc-pmax-negatives-sweeper.js` | Hub PMax path; PMax createNegativeKeyword divergence | Same | Same as Search | Same |
| `scripts/sync-negative-sweeper-rule-blocks.js` | How siblings stay in sync | No | Yes | None |
| `scripts/test-negative-sweeper-contract.js` | Encodes current `shouldExclude` expectations (not business gold) | No | Yes | None |

## Must share (Sheets contract)

| Original path | Why needed | Secrets? | Share unchanged? | Redaction |
|---|---|---|---|---|
| `apps-script/add-negatives-audit-tab.gs` | Spoke Negatives Audit schema / Reviewed / Remove | Empty URL in repo | Yes | Redact if EXISTING_SPREADSHEET_URL filled |
| `apps-script/create-hub-workbook.gs` | Hub Negatives columns + Definitions (including ID mismatches) | No secrets in generator; sample shop names only | Yes | None required |
| `apps-script/create-body-shop-workbook.gs` | Spoke tab order, Negatives Audit, Daily Checklist copy | SETUP_CONFIG may contain live shop IDs if filled | Share **only if** SETUP_CONFIG is empty or sanitized | Redact ACCOUNT_ID, emails, spoke URLs in SETUP_CONFIG |
| `scripts/_engine-hub-spoke-contract.js` | Canonical Hub header names including Negatives * | No | Yes | None |

## Must share (operator + product rules)

| Original path | Why needed | Secrets? | Share unchanged? | Redaction |
|---|---|---|---|---|
| `.cursor/rules/negatives-sweeper-separate-from-engine.mdc` | Forbidden folds (Engine, DRY_RUN, bare trigger negatives) | No | Yes | None |
| `docs/Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md` | Official Rule IDs, Hub/spoke loop, aggressive-token warnings | No | Yes | None |
| `docs/Read this for the standalone MCC negatives sweeper - allowlist no Hub.md` | Allowlist ops, 7-day window, email/CSV, 50-account waves | Example IDs only | Yes | None |
| `docs/Open this in a browser - Standalone Negatives Sweeper explained.html` | Human-facing rule tables and keep/block examples | No | Yes | None |
| `docs/Open this in a browser to preview the Search Negatives Sweep email.html` | Email UX + sample PROTECTED row | Sample account names | Yes | None |
| `docs/Daily Negatives Sweeper Walkthrough.html` | Parallel Hub-oriented walkthrough | No | Yes | None |
| `docs/Open this when you are ready to go live - install checklist gotchas and how to smoke test.md` | Schedule, Preview vs Run, do not overlap products | No | Yes | None |
| `.cursor/rules/enterprise-hub-spoke-prd.mdc` | Engine ≠ negatives; Hub/Spoke architecture | No | Yes | None |

## Share if rebuilding with Hub (~70 shops) rather than standalone only

| Original path | Why needed | Secrets? | Share unchanged? | Redaction |
|---|---|---|---|---|
| `scripts/built-by-shah-mcc-engine.js` | Proof Engine must not mutate negatives; scheduling sibling | Hub URL if filled | Sanitize URL | Redact HUB_SPREADSHEET_URL |
| `README.md` | Install map | No | Yes | None |
| `docs/Start here - what does each of these guides do.md` | Doc index | No | Yes | None |

## Do not need for sweeper-only rebuild (optional context)

| Path | Why skip by default |
|---|---|
| `docs/Give this to Codex - full product brief to rebuild this system as a web app.md` | Web app v1 **forbids Ads writes including negatives** — contradicts this sweeper rebuild unless scoped carefully |
| Engine pacing / status-email docs | Different product |
| `apps-script/READY-TO-PASTE-Auto-Arena-Body-Shop.gs` | Spoke intake; contains live ACCOUNT_ID — **do not share unsanitized** |
| Shah walkthrough `.mp4` | Large; not transcribed; Hub/Engine tour not negatives-specific |
| Owner’s promised decision-audit CSV | **Not in repo** — request a **new** export with account IDs redacted if needed |

## Conversation sources (not files; cite only)

- This handoff request (conservative AI constraints, FP > FN)
- [Missed terms + body-work false adds](0715bce9-d644-49c4-a3b2-3ff03879dc87)
- [Rule expansion / free estimate / YEAR_TOKEN](97da38e7-2fc6-4d96-96e8-671461837f65)

Do not paste raw JSONL transcripts into an external vendor drop; they contain emails, account IDs, and full Ads logs. The handoff CSV already extracts labeled terms.
