# Multi-organization LLM negative-keyword sweeper plan

## Status and delivery boundary

This document is an architecture and delivery plan. It does not authorize or implement Google Ads negative-keyword mutations.

Implementation status as of 2026-08-26: the repository now contains a read-only TypeScript implementation through validated Gemini classification and local JSON run artifacts. Google Ads mutation remains unimplemented. A live Google read smoke test has passed; a live Gemini smoke test requires `GEMINI_API_KEY`.

The first delivery phase is read-only:

1. Discover every enabled client account under the Built by Shah MCC.
2. Fetch one completed local calendar day of reported search terms for every account.
3. Load an authoritative, versioned negative-keyword rule set.
4. Send the rules, account context, and reported terms to an LLM in bounded batches.
5. Validate the LLM classifications and write immutable per-run audit artifacts.
6. Produce an honest per-account and whole-run status summary.
7. Make no changes to Google Ads.

The later mutation phase will be separately designed, approved, and enabled.

## Terminology and candidate definition

The negative-keyword candidates are **reported search terms**: the words a person actually typed. They are not the configured keywords on which the advertiser bids.

Configured keywords and their match types are supporting context when Google provides them. Performance Max has no configured keywords and must use its campaign search-term reporting resource.

For each account and date, retain:

- Account ID, name, and timezone
- Channel: Search or Performance Max
- Campaign ID and name
- Ad-group ID and name when available
- Full, unmodified search term
- Search-term targeting status
- Matched configured keyword and match type when available
- Impressions
- Clicks
- Cost in micros
- Conversions
- Conversion value

Raw source rows are retained. Classification candidates are aggregated by:

```text
account + date + channel + campaign + normalized search term
```

The same term in two campaigns remains two candidates because future exact negatives are campaign-scoped.

## Architecture decision: asynchronous processing

Production daily sweeps will be asynchronous and backed by a managed durable queue. No application database will be introduced.

A synchronous HTTP request may:

1. Validate the requested run.
2. Create a sweep record.
3. Enqueue background work.
4. Return `202 Accepted` with a run ID.

It must not wait for every Google Ads request, every LLM call, or every retry.

Suggested API:

```text
POST /api/sweeps
{
  "date": "2026-08-25"
}

202 Accepted
{
  "run_id": "...",
  "status": "QUEUED"
}
```

Status is queried separately:

```text
GET /api/sweeps/{run_id}
GET /api/sweeps/{run_id}/organizations
```

A synchronous single-account diagnostic command may exist for development, but it is not the production orchestration model.

## End-to-end flow

```text
Scheduled or manual sweep request
              |
              v
Create sweep run and discover enabled MCC accounts
              |
              v
Create one durable account job per organization
              |
      bounded parallel workers
              |
              v
Fetch Search and PMax reported search terms
              |
              v
Write raw facts and aggregated candidates to per-run JSON artifacts
              |
              v
Snapshot the active rules and prompt version
              |
              v
Create bounded LLM classification batches
              |
              v
Validate decisions and write classification artifacts
              |
              v
Reconcile and finalize account runs
              |
              v
Finalize the whole sweep as success, partial, or failed

Future only:
validated NEGATIVE_EXACT decisions
              |
              v
separately authorized mutation queue and executor
```

## Background jobs

| Job | Responsibility |
|---|---|
| `PlanDailySweep` | Discover enabled leaf accounts and create one account run per organization. |
| `FetchAccountSearchTerms` | Determine the target account-local date, fetch Search and PMax terms, and write account-scoped raw-fact artifacts. |
| `PrepareClassificationBatches` | Aggregate candidates and split them into bounded LLM batches. |
| `ClassifySearchTermBatch` | Send rules, account context, and terms to the selected LLM provider. |
| `FinalizeAccountRun` | Confirm that every candidate has a validated decision or a recorded failure. |
| `FinalizeSweepRun` | Reconcile and summarize results across all organizations. |
| `ReconcileLateData` | Re-fetch a prior date to capture delayed Google reporting without duplicating records. |
| `ApplyNegativeDecisions` | Future only: apply separately validated and authorized Google Ads mutations. |

## Date and timezone handling

For a normal scheduled run:

- Each account uses its own Google Ads timezone.
- The target is the last completed local calendar day.
- The first fetch occurs after a configurable reporting-readiness time, initially 7:00 AM in the account timezone.
- A reconciliation fetch runs later because Google reporting and conversions can arrive late.
- Re-fetching the same account and date writes a reconciliation artifact and atomically rebuilds the deterministic candidate artifact rather than duplicating candidates.

For a manual historical run, the supplied date is interpreted as that calendar date in each account's own timezone.

An account returning zero reported terms is a successful zero-result account run, not an error.

## Concurrency and backpressure

Initial configurable limits:

- Google account-fetch concurrency: 5
- LLM request concurrency: 3
- LLM batch size: approximately 25-50 terms
- Google mutation concurrency: 3-5 organizations
- Google mutation chunk size: 500 operations from one organization
- Separate Google Ads and LLM rate limiters
- Adaptive backpressure on `429` responses

The application must not launch every organization or every LLM batch with one unbounded `Promise.all` or equivalent operation. The architecture must support hundreds of accounts without changing business logic.

LLM batches never mix organizations. Google mutation requests never mix organizations. Cross-organization parallelism is achieved by running several independent organization jobs at once, each with its own customer ID, inputs, outputs, retries, and audit artifacts.

## No-database storage and audit strategy

### Sources of truth

No application database will be used.

- Google Ads is the source of truth for negatives that were actually applied.
- The MCC is queried live at the start of each run to discover organizations.
- The versioned rule-set JSON file in source control is the source of truth for classification rules.
- Immutable per-run JSON artifacts provide diagnostic and audit history.
- A managed durable queue provides delivery, leases, and retry scheduling for background jobs.

The system must never depend on a Python or JavaScript variable surviving after a process exits.

### Run artifacts

Development can write artifacts under a Git-ignored local `runs/` directory. A deployed system should use encrypted object storage with retention and access controls. Object storage is not used as a relational database; it stores immutable evidence of each processing stage.

Suggested layout:

```text
runs/{run_id}/run-manifest.json
runs/{run_id}/organizations/{customer_id}/fetch.json
runs/{run_id}/organizations/{customer_id}/candidates.json
runs/{run_id}/organizations/{customer_id}/llm/batch-{batch_id}-input.json
runs/{run_id}/organizations/{customer_id}/llm/batch-{batch_id}-output.json
runs/{run_id}/organizations/{customer_id}/decisions.json
runs/{run_id}/organizations/{customer_id}/mutations/chunk-{chunk_id}.json
runs/{run_id}/organizations/{customer_id}/summary.json
runs/{run_id}/summary.json
```

Artifacts record:

- Run ID, customer ID, account-local target date, and timezone
- Rules and prompt versions
- Raw fetched rows and normalized candidates
- LLM inputs, raw responses, parsed decisions, and validation errors
- Google mutation operations, per-operation results, errors, and resource names
- Retry counts and Google/LLM request IDs
- Final organization and whole-run counts

Artifact writes must be atomic. Deterministic run, candidate, batch, and operation IDs prevent duplicate files and allow safe reconciliation. Costs remain integer micros.

### Idempotency without a database

Before creating negatives, query Google Ads for the organization's existing campaign-level exact negatives. Remove identical existing terms from the proposed operations.

If a mutation request times out or its outcome is ambiguous, query Google Ads again before retrying. Retry only operations still missing from Google. This makes Google Ads itself the final idempotency check.

The absence of a database is an accepted tradeoff: cross-run analytical querying and centralized transactional state will be limited. The managed queue, deterministic IDs, immutable artifacts, and live Google reconciliation are required compensating controls.

## Rule-set design

Do not send the LLM the entire historical Markdown handoff. The handoff intentionally documents contradictions and unresolved decisions.

Create one authoritative, versioned rule set. Example:

```json
{
  "version": "2026-08-26.1",
  "rules": [
    {
      "id": "POL-COLLISION-KEEP",
      "title": "Serious collision intent",
      "instruction": "Keep searches expressing collision, crash, accident, or frame-damage repair intent.",
      "examples_keep": [],
      "examples_negative": [],
      "exceptions": [],
      "enabled": true
    }
  ]
}
```

Every classification batch records:

- Complete rule-set snapshot and version
- Prompt version
- LLM provider and model
- Account context
- Submitted candidates
- Raw provider response
- Parsed and validated decisions
- Token usage and provider request ID when available

The rule set guides the LLM's semantic decision. It must not be duplicated as a conflicting deterministic word matcher in application code.

## LLM boundary and contract

The LLM component is a bounded classifier. It is not an autonomous agent with Google Ads mutation tools.

Example input shape:

```json
{
  "account": {},
  "date": "2026-08-25",
  "rules": [],
  "search_terms": []
}
```

Required output per candidate:

```json
{
  "item_id": "stable-input-id",
  "decision": "KEEP | HUMAN_REVIEW | NEGATIVE_EXACT",
  "negative_text": "full original search term or null",
  "rule_ids": ["..."],
  "reason": "short explanation",
  "confidence": 0.0
}
```

The provider integration is behind an adapter. The initial test adapter uses Gemini 3.1 Flash-Lite with a fixed seed, temperature zero, JSON Schema output, and a configurable model. These settings reduce variation but do not make a hosted LLM mathematically deterministic; deterministic application validation decides whether a response is accepted.

Search terms are untrusted data. The prompt must state that their text is data, never instructions. The model receives no mutation tools or application secrets.

### Deterministic response validation

Application validation enforces:

- Exactly one decision per submitted candidate
- No duplicate or unknown item IDs
- Only the allowed decision enum
- Matching account and campaign identity
- `NEGATIVE_EXACT` uses the full submitted term after approved normalization
- No missing candidate decisions

Invalid or incomplete output never produces a mutation.

## Error handling

| Failure | Handling |
|---|---|
| OAuth refresh rejected | Pause Google work, mark authentication blocked, and alert an operator. |
| Google `429` or `5xx` | Exponential backoff with jitter and `Retry-After` support. |
| Permanent GAQL/query error | Fail that account job without retrying indefinitely. |
| Organization disabled or unlinked | Mark skipped with an explicit reason. |
| No reported search terms | Mark successful with zero candidates. |
| LLM `429` or `5xx` | Retry through the LLM-specific queue with bounded attempts. |
| Malformed LLM response | Retry once, then fail validation; create no negative decision. |
| Missing decisions | Mark the batch incomplete; create no mutation. |
| Google partial mutation failure | Record each operation result; verify successes and retry only eligible missing operations. |
| Ambiguous mutation timeout | Re-query existing negatives before retrying; never blindly resend the whole chunk. |
| Worker crash | Let the job lease expire and resume safely on another worker. |
| One account fails | Continue processing every other organization. |
| Retry exhaustion | Move the job to a visible dead-letter state for operator action. |

All jobs are idempotent. Partial success is a normal, visible state and must not be presented as whole-run success.

## Observability and security

Record structured logs and metrics for:

- Run, account-run, and job IDs
- Counts fetched, classified, validated, failed, and skipped
- Google and LLM latency
- Retry counts and failure categories
- Google and LLM request IDs
- LLM token usage
- Queue age and dead-letter counts
- Artifact write failures and reconciliation mismatches

Secrets stay outside source control and never enter prompts or logs. Local development may use the Git-ignored `.env`; deployed environments use a secrets manager. Access tokens are short-lived and remain in process memory only. Refresh tokens are durable secrets, not application data.

## First-phase acceptance criteria

The read-only phase is complete when:

1. A sweep discovers every enabled organization under the MCC.
2. Every organization receives the correct target local date.
3. Search and Performance Max reported terms are fetched and written to account-scoped run artifacts.
4. The active rule-set snapshot is associated with the run.
5. Every non-empty account is sent to the LLM in bounded batches.
6. Structured decisions are validated and written to immutable classification artifacts.
7. Every account ends as `SUCCEEDED`, `PARTIAL`, `FAILED`, or `SKIPPED`.
8. The sweep summary reconciles fetched candidates against decisions.
9. No Google Ads mutation occurs.
10. A one-account smoke test is followed by a complete all-organization read-only run.

## Later mutation phase

The future mutation executor will be separate from the LLM classifier.

### Request boundary

Each Google Ads mutation request targets exactly one organization/customer ID. Operations from different organizations are never combined in one request.

Within one organization, a request may contain operations for multiple campaigns owned by that customer. Start with chunks of at most 500 operations, even though Google's platform limit is higher, because smaller chunks are easier to retry, verify, and audit.

Process 3-5 organizations concurrently with separate per-customer request streams and rate limiting. Each negative keyword remains one Google Ads API operation and counts separately against the developer-token quota.

### Mutation sequence per organization

1. Read only validated `NEGATIVE_EXACT` decisions from that organization's decision artifact.
2. Confirm term, account, campaign, date, rule version, and prompt identity.
3. Query Google Ads for current campaign-level exact negatives.
4. Skip identical exact negatives already stored on the same campaign.
5. Split the remaining creates into deterministic chunks of at most 500 operations.
6. During rollout, optionally send the chunk with `validateOnly: true` before the real request.
7. Send the real customer-scoped request with `partialFailure: true`.
8. Map every result or error back to its deterministic operation ID.
9. Re-query Google Ads to verify successful creates.
10. Write an immutable mutation artifact containing proposed, skipped, applied, failed, and verified operations plus Google request and resource IDs.

If a request times out after it may have reached Google, re-query first and retry only missing operations. Never retry the entire ambiguous chunk blindly.

Google Ads is the durable source of truth for applied negatives. Run artifacts are the audit trail; they do not override live Google state.

Before implementing this phase, the owner must confirm whether "add to the list" means the controlling architecture's campaign-level exact negative or a shared Google Ads negative-keyword list.

## Current repository storage reality

There is currently no database and no durable application-data layer in this repository.

The local helper `scripts/temporary_google_ads_fetch.py` currently:

1. Reads Google/OAuth credentials from `.env`.
2. Exchanges the stored refresh token for an access token.
3. Fetches the MCC hierarchy and a small keyword sample.
4. Holds returned Google Ads data in Python variables while the process runs.
5. Prints a small sample to the terminal.
6. Discards all fetched account and keyword data when the process exits.

Only the OAuth credentials and refresh token are persisted locally in `.env`. The access token is temporary and remains in memory. No search terms, metrics, organization snapshots, or LLM decisions are currently written to a database or data file.

The legacy reference products use Google Ads labels, email/CSV output, and in some variants Google Sheets for operational state and audits. Those are historical reference mechanisms, not an implementation of this no-database artifact plan.
