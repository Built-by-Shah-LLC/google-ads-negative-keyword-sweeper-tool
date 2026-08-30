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

## Read-only TypeScript classifier

The new application under `src/` is isolated from `legacy-reference/`. It currently performs only:

1. Discover enabled leaf organizations under the configured MCC.
2. Fetch Search and Performance Max reported search terms for the two most recent completed local calendar days (48 completed hours).
3. Aggregate organization- and campaign-scoped candidates.
4. Send bounded organization-specific batches plus the authoritative Markdown policy at `src/config/negative-keyword-rules.md` to OpenAI's Responses API.
5. Strictly validate the structured result and write ignored JSON artifacts under `runs/`.

Each selected organization also receives one spreadsheet-safe aggregate file at:

```text
runs/{run_id}/organizations/{customer_id}/llm-decisions.csv
```

The CSV contains candidate context and validated decisions from every LLM batch. JSON remains the exact-fidelity source artifact; CSV cells that could execute as spreadsheet formulas are intentionally neutralized.

Each run also writes `telemetry.json`, and each organization writes `errors.json` and
`fixed-input-tokens.json`. Telemetry includes stage latency, retry attempts, safe error
categories, provider request IDs, and normalized OpenAI input/output/total/cached/reasoning
token counts. Token totals include every generation that consumed tokens, including an
invalid first response followed by a successful validation retry.

“Fixed input tokens” means the provider-tokenized system instruction, complete Markdown
rules, organization/date envelope with zero candidates, and generic output schema. It
excludes candidate rows, batch-specific item ID enums, and output. This baseline is
counted with the OpenAI Responses input-token endpoint for every selected organization and model;
it is not estimated from characters. With rule version `2026-08-27.1`, model
`gpt-5.6-luna`. The recorded per-organization value is the source of truth because
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

Unexpected properties, missing/duplicate/unknown IDs, invalid rule IDs, rewritten exact
negative text, non-finite confidence, and reasons over 240 characters are rejected.

It contains no Google Ads mutation code.

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
```

It writes an ignored `runs/eval-*/report.json` with overall agreement, KEEP-side
accuracy, negative recall/precision, and false-positive/false-negative details. It never
connects to or mutates Google Ads.

The comparison evaluates `gpt-5-nano`, `gpt-5.4-nano`, `gpt-5.6-luna`, and `gpt-5.4-mini`, records
quality metrics and token usage, and estimates cost from the pricing snapshot in the
evaluation script. See [the recorded model evaluation](docs/OPENAI_MODEL_EVALUATION.md).

Add an OpenAI key to the ignored `.env`, then run one organization first. An explicit
`--date` is the end date of a two-day completed window:

```powershell
npm run sweep -- --date 2026-08-25 --organization-limit 1
```

Use a specific customer or deliberately select the entire MCC:

```powershell
npm run sweep -- --date 2026-08-25 --customer 1234567890
npm run sweep -- --date 2026-08-25 --all-organizations
```

If `--date` is omitted, each organization uses its own two most recent completed local
calendar days. Google Ads reports these rows by date rather than hour, so the window is
two complete account-local dates. The model receives only organization name plus each
candidate's item ID, search term, campaign name, ad-group name, matched keyword, and
match type. Raw IDs, dates, status, channel, and performance metrics remain in local
audit artifacts and are not sent to the LLM.

The Cloud Run Job deployment in `scripts/deploy/deploy-gcloud.ps1` creates a daily Cloud
Scheduler trigger and runs with `--all-organizations`. See `docs/DEPLOYMENT.md`; only one
production scheduler should be enabled to avoid duplicate daily runs.

## Terminal logs and error email

Runtime output uses structured Pino logging rather than direct `console.log` calls. Set
`LOG_LEVEL` to `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`.

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
