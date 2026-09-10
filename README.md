# Google Ads AI Negative Keyword Sweeper

This repository contains the sanitized handoff, documentation, labeled examples, and legacy reference code for rebuilding a Google Ads MCC negative-keyword sweeper around AI intent classification.

## Current direction

The target system separates responsibilities:

- Google Ads JavaScript selects MCC accounts, retrieves GAQL data, sends structured context to an AI service, applies validated decisions, records results, and emails managers.
- The AI service decides whether each complete search term should be kept, reviewed, or added as a full-query exact campaign negative.
- Deterministic safeguards validate identity, response structure, exact-text integrity, and idempotency. They do not overrule the AI on business intent.
- Existing shared-list, phrase, or broad-negative coverage does not prevent adding an AI-approved exact negative directly to the campaign.
- The initial version uses automatically available Google Ads context and one agency-wide collision-repair policy; it does not require manually maintained per-account business profiles.

See [Architecture decisions](docs/ARCHITECTURE_DECISIONS.md) for the controlling product decisions.

## Repository contents

- `handoff/` — evidence-backed documentation and labeled search-term examples.
- `handoff/source_code/` — sanitized copies of the previous Google Ads and Apps Script implementation.
- `docs/` — current architecture decisions that supersede conflicting legacy behavior.
- `legacy-reference/` — original Cursor project Markdown, Cursor rules, negative-sweeper operator documents, walkthrough assets, and a sanitized copy of the related MCC Engine.

## Legacy-code status

The code under `handoff/source_code/` is reference material. It is not the required foundation for the new product and should not be deployed as the AI-assisted sweeper. Useful collection, MCC orchestration, mutation, and reporting mechanics may be retained when they remain the safest implementation.

The legacy deterministic rule engine, stemming, competitor seeds, city heuristics, and `shouldExclude` behavior are not authoritative business policy.

## TypeScript classification and mutation pipeline

The new application under `src/` is isolated from `legacy-reference/`. It currently performs only:

1. Discover enabled leaf organizations under the configured MCC.
2. Fetch Search and Performance Max reported search terms for the single calendar day 48 hours before execution in `RUN_TIME_ZONE` (a September 3 run processes September 1 for every organization).
3. Aggregate organization- and campaign-scoped candidates.
4. Send bounded organization-specific batches and the authoritative Markdown policy at `src/config/negative-keyword-rules.md` to the selected LLM provider. Moonshot/Kimi is primary; OpenAI, Gemini, and the prior Kimi coding endpoint remain available through `LLM_PROVIDER`.
5. Strictly validate the structured result and persist the complete run to the
   shared Built Ads Manager PostgreSQL database. Ignored files under `runs/`
   remain a diagnostic mirror; they are not the durable source of truth.
6. Optionally apply validated `NEGATIVE_EXACT` decisions as full-query campaign-level
   exact negatives through either the network-free development writer or the explicitly
   armed production writer.

Each selected organization still receives the backward-compatible spreadsheet-safe CSV at:

```text
runs/{run_id}/organizations/{customer_id}/llm-decisions.csv
```

Every run additionally creates one Excel workbook at `runs/{run_id}/negative-keyword-sweeper-{run_id}.xlsx`. It contains one worksheet per organization with run metadata, every KEEP and NEGATIVE_EXACT candidate, rule IDs, reasons, full rules, organization token totals, per-batch input/output token usage, batch counts, and related errors/timeouts. The workbook is sent through Resend after finalization when `RUN_REPORT_EMAIL_ENABLED=true`. CSV cannot contain worksheets, so `.xlsx` is used for the requested tabbed report. PostgreSQL remains the exact-fidelity source; spreadsheet cells that could execute as formulas are intentionally neutralized.

Each run also writes `telemetry.json` and a reconciled `token-usage.json`. Each organization
writes its own `token-usage.json`, `errors.json`, and `fixed-input-tokens.json`; every LLM
batch output/error artifact also contains that batch's token usage. Telemetry includes stage latency, retry attempts, safe error
categories, provider request IDs, and normalized input/output/total/cached/reasoning
token counts. Token totals include every generation that consumed tokens, including an
invalid first response followed by a successful validation retry. Organization and run
reports store a `reconciliation.reconciled` flag so discrepancies between batch, organization,
and run totals are visible instead of silently accepted.

“Fixed input tokens” means the provider-tokenized system instruction, complete Markdown
rules, organization/date envelope with zero candidates, and generic output schema. It
excludes candidate rows, batch-specific item ID enums, and output. This baseline is
counted with the selected provider's token-count endpoint for every selected organization and model;
it is not estimated from characters. With rule version `2026-09-01.1`, the selected model is
`gpt-5.6-luna`. Lower-priced models were evaluated, but they missed 38 of 72 labeled
negative cases; Luna remains the least expensive evaluated model that preserves acceptable
rule behavior. The recorded per-organization value is the source of truth because
organization text, rule revisions, schemas, and model tokenizers can change it.

The accepted LLM response contract is consistently camelCase:

```json
{
  "decisions": [{
    "itemId": "stable-input-id",
    "decision": "KEEP",
    "negativeText": null,
    "ruleIds": ["POL-AMBIGUOUS-KEEP"],
    "reason": "Short explanation",
    "confidence": 0.5
  }]
}
```

Unexpected properties, missing/duplicate/unknown IDs, invalid or decision-incompatible
rule IDs, rewritten exact negative text, non-finite confidence, and reasons over 240
characters are rejected.

### Google Ads mutation modes

Mutation is fail-closed and disabled by default:

- `GOOGLE_ADS_MUTATION_MODE=disabled` stops after classification and writes no mutation.
- `GOOGLE_ADS_MUTATION_MODE=development` runs the final stage with deterministic
  `mock://` results. This writer has no OAuth or HTTP dependency and cannot call Google Ads.
- `GOOGLE_ADS_MUTATION_MODE=validation` sends exactly one request with
  `validateOnly: true`; it records validation outcomes but cannot persist a Google Ads change.
- `GOOGLE_ADS_MUTATION_MODE=production` uses the Google Ads
  `campaignCriteria:mutate` endpoint. It requires
  `GOOGLE_ADS_PRODUCTION_MUTATION_CONFIRMATION=APPLY_EXACT_NEGATIVES_TO_LIVE_GOOGLE_ADS`
  and the per-invocation `--execute-production-google-ads-mutations` command flag.

Production operations are customer-scoped, deduplicated by campaign and normalized exact
text, limited to 500 per request, sent through `validateOnly` first, and read back after
mutation. Ambiguous outcomes are reconciled with a fresh read and are never blindly retried.
Incomplete or partial classification prevents the mutation stage for that organization.
Each organization writes `mutations/summary.json` as its mutation audit artifact.

Do not put the production confirmation in a development environment. Unit tests inject fake
production transports and never make a Google Ads mutation request.

Validate one eligible real-account campaign without persisting a Google Ads change:

```powershell
npm run mutation:validate -- --auto-select-one
```

The focused validator does not load the LLM or database configuration. It writes its audit to
`runs/validation-only-*/mutation-validation.json`. An explicit target can be supplied with
`--customer CUSTOMER_ID --campaign CAMPAIGN_ID`.

To perform one real write in a Google Ads test account only:

Create an ignored `.env.google-ads-test` containing the five `GOOGLE_ADS_*` credentials
from `.env.example`, using a test-manager login and a refresh token belonging to a user
who can access that separate test hierarchy. The command intentionally never falls back
to production `.env` credentials.

```powershell
npm run mutation:test-account -- `
  --auto-select-one `
  --confirmation WRITE_ONE_EXACT_NEGATIVE_TO_GOOGLE_TEST_ACCOUNT
```

Alternatively, use explicit `--customer TEST_CLIENT_ID --campaign TEST_CAMPAIGN_ID`.

The smoke command queries `customer.test_account` immediately before writing and refuses the
operation unless Google returns `true`. It creates one uniquely named exact negative, reads it
back, and requires one verified result. Never pass production account IDs to this command.

Install and check it:

```powershell
npm install
npm run check
npm test
```

Run the live OpenAI comparison over all 124 handoff examples when evaluation spend is
intentionally available:

```powershell
npm run eval:openai
npm run eval:openai -- --models gpt-5-nano --batch-size 10
```

It writes an ignored `runs/eval-*/report.json` with overall agreement, KEEP-side
accuracy, negative recall/precision, and false-positive/false-negative details. It never
connects to or mutates Google Ads.

The comparison evaluates `gpt-5-nano`, `gpt-5.4-nano`, `gpt-5.6-luna`, and `gpt-5.4-mini`, records
quality metrics and token usage, and estimates cost from the pricing snapshot in the
evaluation script. See [the recorded model evaluation](docs/OPENAI_MODEL_EVALUATION.md).

Configure the selected provider key in the ignored `.env`, then run one organization first. An explicit
`--date` is the exact account-local date to process:

```powershell
npm run sweep -- --date 2026-08-25 --organization-limit 1
npm run sweep -- --organization-limit 3 --candidate-limit-per-organization 10
```

Normal sweeps also require `PERSIST_RUNS_TO_DATABASE=true`, a dedicated
least-privilege sweeper `DATABASE_URL`, and the canonical Built Ads Manager
`ORGANIZATION_ID`. Every selected Google customer must already exist as an
active `client_accounts` row for that organization. The process fails closed
if durable persistence is unavailable; it never reports local artifacts as a
successful substitute.

Use a specific customer or deliberately select the entire MCC:

```powershell
npm run sweep -- --date 2026-08-25 --customer 1234567890
npm run sweep -- --date 2026-08-25 --all-organizations
```

If `--date` is omitted, the run uses one calendar date two days before the current date in
`RUN_TIME_ZONE`; that same date applies to every organization. Google Ads reports these rows
by date rather than hour, so a September 3 execution queries September 1 only. The model receives only organization name plus each
candidate's item ID, search term, campaign name, ad-group name, matched keyword, and
match type. Raw IDs, dates, status, channel, and performance metrics remain in local
audit artifacts and are not sent to the LLM.

The Cloud Run Job deployment in `scripts/deploy/deploy-gcloud.ps1` creates a daily Cloud
Scheduler trigger and runs with `--all-organizations`. See `docs/DEPLOYMENT.md`; only one
production scheduler should be enabled to avoid duplicate daily runs.

## Provider selection, run reports, and error email

`LLM_PROVIDER=moonshot` is the default and uses `MOONSHOT_API_KEY`,
`MOONSHOT_BASE_URL=https://api.moonshot.ai/v1`, and `MOONSHOT_MODEL=kimi-k2.6`.
Set `LLM_PROVIDER=openai`, `gemini`, or `kimi-code` to reactivate the corresponding
provider-specific environment variables without a code change. LLM calls use configurable
timeouts and retry budgets (`LLM_REQUEST_TIMEOUT_MS`, `LLM_MAX_ATTEMPTS`); exhausted
timeouts are recorded against the relevant organization and batch and appear in its worksheet.

Run workbooks are delivered by Resend using `RESEND_API_KEY`, `RUN_REPORT_EMAIL_TO`, and
`RUN_REPORT_EMAIL_FROM`. Delivery uses a run-scoped idempotency key and configurable retry
settings (`RESEND_REQUEST_TIMEOUT_MS`, `RESEND_MAX_ATTEMPTS`). Delivery status is written to
`report-email.json`; a delivery failure is logged and recorded without discarding the local workbook.

Runtime output uses structured Pino logging rather than direct `console.log` calls. Set
`LOG_LEVEL` to `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`.

### Live run progress

At the default `info` level, long sweeps continuously report their progress to the
terminal as structured JSON. The progress stream includes organization discovery and
selection, each organization's search-term fetch and candidate counts, fixed-input token
counting, and every LLM batch as it is queued, started, completed, or failed. An active
batch emits an `organization_batch_heartbeat` every 60 seconds until it finishes, so a
slow provider request never leaves the run silent for an extended period.

Batch completion records include the batch position/total, candidate and decision counts,
duration, generation and HTTP attempt counts, tokens, and rolling completed/failed/remaining
totals. Organization completion and whole-run progress are also logged. Organizations are
identified by their position and a stable hashed `organizationRef`; raw customer IDs,
search terms, prompts, and provider responses are not added to progress logs. Filter the
stream using the `progressEvent` field when following a multi-hour run.

Unhandled errors can send an SMTP email to the comma-separated recipients in
`ERROR_EMAIL_TO`. Copy the SMTP settings from `.env.example`, set
`ERROR_EMAIL_ENABLED=true`, and configure `ERROR_EMAIL_FROM`, `SMTP_HOST`, and the
appropriate port/security/credentials. Email-delivery failures are logged and never
replace the original pipeline failure.

Handled-error emails are disabled by default. They can later be enabled without code
changes by listing exact structured error codes in `ALERT_HANDLED_ERROR_CODES` or stages
in `ALERT_HANDLED_ERROR_STAGES`; `*` selects all handled errors. Duplicate handled errors
with the same code, stage, organization, batch, and message send only one email per
process run.

Files in `legacy-reference/` are provided for complete project context. When they conflict with `docs/ARCHITECTURE_DECISIONS.md`, the current architecture decisions control.

## Data handling

The handoff copies replace live Google Ads customer IDs and recipient emails with stable placeholders. Do not commit API keys, OAuth tokens, service credentials, or unsanitized client identifiers.
Database payloads recursively redact credential-shaped fields and are size
bounded before insertion. Rule snapshots, search-term facts, candidates,
decisions, model attempts, telemetry events, and errors are immutable; only
run/account/batch/report lifecycle records can advance.
