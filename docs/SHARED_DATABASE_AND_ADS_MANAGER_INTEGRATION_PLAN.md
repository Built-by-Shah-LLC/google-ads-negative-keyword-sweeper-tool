# Shared Database and Built Ads Manager Integration Plan

**Status:** implementation plan; no application code or cloud resources changed  
**Prepared:** 2026-09-07  
**Primary writer:** `google-ads-negative-keyword-sweeper-tool`  
**Schema and UI owner:** `Built-by-Shah-LLC/built-ads-manager`

## 1. Objective

Make the Built Ads Manager PostgreSQL database the durable system of record for every negative-keyword sweeper run and all run-related account, campaign, ad-group, search-term, classification, model-usage, delivery, telemetry, and error data. Then expose that data in Built Ads Manager as secure, readable, filterable operational and account-level views.

The result must:

- retain the sweeper's read-only Google Ads behavior;
- link every processed Google Ads account to the existing Built Ads Manager `client_accounts` record;
- preserve campaign/ad-group/search-term context and exact performance facts used for each decision;
- persist partial and failed work honestly, including batch attempts and safe error detail;
- make retries idempotent and prevent duplicate rows;
- keep organization isolation and role/account authorization intact;
- support historical import of existing `runs/` artifacts;
- make PostgreSQL, not JSON/CSV/XLSX files, the source of truth;
- provide account-manager views for decisions and owner-only views for run health;
- never expose provider secrets, credentials, raw internal errors, or unrestricted model payloads in the browser.

## 2. Confirmed Current State

### 2.1 Shared database used by Built Ads Manager

Built Ads Manager uses **Google Cloud SQL for PostgreSQL 16**, not Supabase. The current Dev instance is documented as private-IP-only in `us-west1`, with database name `built_ads_manager`. Runtime connection strings are injected from Google Secret Manager as `DATABASE_URL`.

Relevant Built Ads Manager sources:

- `docs/what-we-use.md` — Cloud SQL, Secret Manager, Cloud Run, and environment ownership.
- `docs/architecture.md` — Cloud SQL is the system of record; all tenant records use row-level security.
- `packages/db/migrations/0001_initial_schema.sql` — existing organizations, accounts, campaigns, keywords, sync runs, facts, RLS, and audit foundations.
- `packages/db/src/database.ts` — transaction-scoped `app.organization_id` and `app.actor_id` context.
- `apps/web` and `packages/api` — authenticated, server-authorized read boundaries and UI mapping.

Built Ads Manager already contains useful parent records:

- `organizations`
- `advertising_data_connections`
- `client_accounts`, uniquely identified by `(organization_id, google_customer_id)`
- `campaign_daily_metrics`
- `ad_group_daily_metrics`
- `keyword_daily_metrics`
- `sync_runs`, `sync_account_runs`, and operational error/run-history infrastructure

The existing `sync_runs` tables describe the Built Ads Manager fact-ingestion worker. They should **not** be overloaded with sweeper-specific LLM, candidate, and decision semantics. The integration should add a related but separate sweeper run aggregate.

### 2.2 Current sweeper persistence

The sweeper currently writes Git-ignored artifacts beneath `runs/{run_id}`. In Cloud Run Jobs this filesystem is ephemeral unless a bucket is mounted. Current artifacts include:

- run manifest and final summary;
- discovered, eligible, and selected Google Ads accounts;
- the complete rules Markdown snapshot;
- per-account raw Search and Performance Max search-term facts;
- candidate-selection metadata and aggregated candidates;
- per-batch model input, model output, retry attempts, validation failures, raw responses, and provider request IDs;
- validated KEEP and NEGATIVE_EXACT decisions with reason, confidence, and rule IDs;
- run/account/batch token usage and reconciliation results;
- structured telemetry events and errors;
- run-report delivery outcome;
- derived CSV and XLSX reports.

Current source locations:

- `src/pipeline/run-sweeper.ts`
- `src/pipeline/process-organization.ts`
- `src/storage/run-artifacts.ts`
- `src/observability/run-telemetry.ts`
- `src/google-ads/search-terms.ts`
- `src/types.ts`

### 2.3 Existing deployment mismatch to resolve

The sweeper deployment currently defaults to a standalone Cloud Run Job in `us-central1` and has no database/VPC configuration. Built Ads Manager Dev uses a private Cloud SQL path in `us-west1`. The sweeper cannot reach that database safely until its job, service identity, region/network egress, database login, and secret binding are deliberately integrated with the Built Ads Manager environment.

### 2.4 Product-scope gate

Built Ads Manager's binding `docs/product/scope-ledger.md` currently says:

> Negative-keyword logging | Future only | No schema, API, UI, or Google Ads write capability.

Therefore implementation must start with an explicit founder-approved decision and scope-ledger update admitting:

1. durable read-only negative-keyword sweep logging;
2. an account-level decision/history view;
3. owner-only sweep run health/history;
4. no Google Ads mutation, rerun, or backfill controls.

This plan does not interpret the request as permission to add Google Ads write access. The system remains observation/classification-only.

## 3. Target Architecture

```text
Cloud Scheduler
      |
      v
Negative Keyword Sweeper Cloud Run Job
      |-- read-only GAQL --> Google Ads API
      |-- classification --> selected LLM provider
      |
      +-- RLS-scoped transactions --> Shared Cloud SQL PostgreSQL
                                         |
                                         +-- Built Ads Manager server API
                                                   |
                                                   +-- Account sweep history
                                                   +-- Owner run health/history
```

PostgreSQL is the durable source. Local JSON/CSV/XLSX output may remain temporarily as rollout diagnostics, but it must not be required by the web app or used to reconstruct normal production state.

## 4. Ownership Across the Two Repositories

| Responsibility | Repository | Reason |
| --- | --- | --- |
| Versioned PostgreSQL migration | `built-ads-manager` | It owns the shared schema and migration history. |
| Database grants and environment scripts | `built-ads-manager` | It owns Cloud SQL roles, private networking, and Secret Manager bindings. |
| Sweeper persistence types/repository | `google-ads-negative-keyword-sweeper-tool` | It owns the run lifecycle and data being written. |
| Historical artifact importer | `google-ads-negative-keyword-sweeper-tool` | It understands legacy artifact versions and validation rules. |
| Serialized browser contracts | `built-ads-manager/packages/domain` | The browser must not consume database rows or provider response shapes. |
| Authorized query repositories/APIs | `built-ads-manager/packages/api` | Server authorization and RLS are already enforced there. |
| UI pages/components | `built-ads-manager/apps/web` | It owns authenticated product presentation. |
| Canonical UI composition updates | `built-ads-manager/design-system` | The product has one approved visual system. |
| Cloud rollout/runbooks | Both | Each service documents its own runtime while Built Ads Manager owns the shared data environment. |

Do not place the shared schema only in the sweeper repository. That would create two migration authorities for one production database.

## 5. Proposed Data Model

Use the next available Built Ads Manager migration number at implementation time (currently expected to be `0018_negative_keyword_sweeps.sql`). Names below are proposed and may be shortened consistently during implementation.

Every tenant-owned table must contain `organization_id`, have a composite organization-aware foreign key where applicable, enable and force RLS, and use the existing `current_organization_id()` policy.

### 5.1 `negative_keyword_rule_snapshots`

One immutable snapshot per distinct rule/prompt content.

Key fields:

- `id uuid primary key`
- `organization_id uuid not null`
- `rule_version text not null`
- `prompt_version text not null`
- `source_path text not null`
- `rules_markdown text not null`
- `content_sha256 char(64) not null`
- `created_at timestamptz not null`
- unique `(organization_id, content_sha256)`

The hash deduplicates identical rule bodies while preserving exactly what governed a historical decision.

### 5.2 `negative_keyword_sweep_runs`

One row for the overall invocation.

Key fields:

- internal `id uuid primary key`;
- `organization_id`;
- external/current sweeper `run_key`;
- `execution_key` for retry idempotency;
- trigger kind: `scheduled`, `manual`, or `historical_import`;
- status: `running`, `partial`, `succeeded`, or `failed`;
- requested processing date and whether it was command-line or automatic;
- processing/scheduler time zone;
- started/completed timestamps and computed duration;
- `read_only` constrained to true and `google_ads_mutation_performed` constrained to false;
- rule snapshot ID, LLM provider, and model;
- campaign-name filter and account-selection mode;
- configured fetch/LLM concurrency, batch size, and candidate limit;
- discovered/eligible/selected account counts;
- succeeded/partial/failed account counts;
- raw-row, candidate, decision, KEEP, and NEGATIVE_EXACT totals;
- normalized token totals and reconciliation flag;
- error count and safe fatal error code/message;
- source artifact contract/version and created/updated timestamps.

Constraints:

- unique `(organization_id, run_key)`;
- unique `(organization_id, execution_key)` when the execution key is present;
- completed status requires `completed_at`;
- counts cannot be negative;
- `accounts_succeeded + accounts_partial + accounts_failed <= accounts_selected`;
- totals must reconcile with child data before a run can be marked succeeded.

### 5.3 `negative_keyword_sweep_account_runs`

One row per selected Built Ads Manager client account in a run.

Key fields:

- `id`, `organization_id`, `sweep_run_id`, and existing `client_accounts.id` as `account_id`;
- account name, time zone, and currency snapshots used by the run;
- account-local start/end processing dates;
- status and started/completed timestamps;
- raw/scoped/available/processed candidate counts;
- decision, failed-batch, and error counts;
- per-account token totals and fixed-input-token metadata;
- safe terminal error code/message;
- unique `(sweep_run_id, account_id)`.

The sweeper must resolve each selected canonical Google customer ID to a `client_accounts` row inside the configured organization. Unknown, archived, cross-tenant, or mismatched accounts fail closed and are recorded as safe run errors; the integration must not silently create client accounts.

### 5.4 `negative_keyword_search_term_facts`

The exact Google Ads rows fetched for the sweep, not only their aggregates.

Key fields:

- run/account foreign keys;
- metric date and channel (`search` or `performance_max`);
- campaign ID and campaign-name snapshot;
- nullable ad-group ID/name;
- complete search term;
- targeting status;
- matched keyword text and match type when supplied;
- impressions/clicks as nonnegative bigint;
- cost as nonnegative bigint micros;
- conversions and conversion value as exact `numeric`, not floating point;
- deterministic source-row hash;
- fetched/ingested timestamps;
- unique `(sweep_account_run_id, source_row_hash)`.

This table is run-scoped evidence. It complements existing daily campaign/keyword metrics and avoids pretending that `search_term_volumes` contains decision-level facts.

### 5.5 `negative_keyword_candidates`

The deterministic aggregate actually offered for classification.

Key fields:

- run/account foreign keys;
- existing deterministic `item_id`;
- date range, channel, campaign, ad group, search term, targeting/match context;
- exact aggregated performance metrics;
- stable ordinal/batch assignment;
- unique `(sweep_account_run_id, item_id)`.

Persist both raw facts and candidates so aggregation can be audited and recomputed.

### 5.6 `negative_keyword_decisions`

One validated classification per candidate.

Key fields:

- candidate foreign key and organization/run/account keys;
- decision constrained to `keep` or `negative_exact`;
- nullable `negative_text` with a check requiring exact candidate text only for `negative_exact`;
- reason limited to the current 240-character contract;
- confidence as exact bounded numeric from 0 through 1;
- rule IDs as a text array or normalized child rows;
- classifier contract version;
- decided/created timestamp;
- unique candidate ID.

The initial implementation should use a text array plus a GIN index unless rule-level analytics are an immediate requirement. The rules snapshot preserves the authoritative definition.

### 5.7 `negative_keyword_llm_batches`

One row per account batch, including failed batches.

Key fields:

- account-run foreign key and `batch_key`;
- provider, model, rule/prompt versions, status, and candidate count;
- sanitized provider request envelope and final raw response as JSONB;
- provider request ID;
- token totals and generation-request count;
- started/completed timestamps;
- unique `(sweep_account_run_id, batch_key)`.

Never store authorization headers or API keys. Before persistence, pass request/response envelopes through a tested redaction and size-limit boundary. Oversized provider payloads should be stored as an explicit truncated/redacted record with a checksum, not cause the entire account transaction to fail.

### 5.8 `negative_keyword_llm_attempts`

One row per validation/request attempt inside a batch.

Key fields:

- batch foreign key and attempt number;
- outcome: `validated`, `validation_failed`, or `request_failed`;
- provider request ID;
- token usage;
- sanitized validation/error detail;
- sanitized raw response JSONB;
- HTTP retry-attempt summary JSONB;
- started/completed timestamps where available;
- unique `(batch_id, attempt_number)`.

### 5.9 `negative_keyword_run_events` and `negative_keyword_run_errors`

Persist structured telemetry separately from human-facing safe errors.

Event fields include stage, status, timestamps, duration, optional account/batch foreign keys, provider/request ID, attempt/status code, and bounded JSONB details.

Error fields include stage, stable code, retryability, provider/status, optional account/batch/request references, occurred time, sanitized internal message, and sanitized cause metadata. Do not store stack traces by default. Raw exceptions can contain credentials, URLs, provider bodies, or database detail.

### 5.10 `negative_keyword_report_deliveries`

Persist the Resend/report-email outcome: status, safe provider message ID, attempt count, sent time, and safe error code. Do not store recipients redundantly in each run unless the approved product/security decision requires an auditable delivery target; if retained, restrict it to owner-only API access and apply seven-year retention.

### 5.11 Derived files

CSV and XLSX are generated views, not system-of-record entities. Store all facts needed to recreate them, plus optional file name/checksum metadata. Do not store workbook binaries in PostgreSQL. D-032 retired report/PDF product surfaces, so adding downloadable artifacts needs separate approval.

## 6. Persistence Semantics in the Sweeper

### 6.1 New modules

Add:

- `src/storage/postgres/database.ts` — pool creation and transaction-scoped organization context;
- `src/storage/postgres/sweep-run-repository.ts` — run/account lifecycle;
- `src/storage/postgres/sweep-data-repository.ts` — facts, candidates, decisions, batches, attempts, events, and delivery;
- `src/storage/postgres/redaction.ts` — allowlist/redaction/size limits for provider and error payloads;
- `src/storage/persistence.ts` — interface used by the pipeline so tests do not need PostgreSQL;
- `scripts/import-run-artifacts.ts` — one-time idempotent historical importer.

Add `pg` and its TypeScript types. Use parameterized queries only.

### 6.2 Configuration

Add and validate:

- `DATABASE_URL` — secret, never a plain environment variable;
- `ORGANIZATION_ID` — canonical configured UUID, never discovered with a global scan;
- `PERSIST_RUNS_TO_DATABASE=true` — rollout gate, required in deployed production after cutover;
- `WRITE_LOCAL_RUN_ARTIFACTS=true|false` — temporary diagnostic mirror only;
- bounded raw-payload byte limits if raw provider envelopes remain enabled.

The deployed job should refuse to start when database persistence is enabled but either database URL or organization ID is absent.

### 6.3 Transaction boundaries

1. Insert/reuse the top-level run before Google Ads discovery.
2. Persist the immutable rule snapshot.
3. Persist discovery counts; do not store unrelated/unconfigured MCC customer identities as durable client records.
4. For each selected account, resolve the account under RLS and create/reuse its account-run row.
5. Commit raw facts and candidates before calling the LLM so failed classifications still retain fetched evidence.
6. Persist each batch and each attempt independently so one failed batch does not roll back another.
7. Persist validated decisions only after existing strict validation succeeds.
8. Recalculate account totals from stored child rows, then finalize the account.
9. Recalculate run totals from stored account rows, then finalize the run.
10. Persist report-delivery outcome without changing a successful classification to failed; use `partial` when delivery is an approved component of overall success.

Each account remains fault-isolated. A database failure is retryable and must not be hidden by a successful local artifact write.

### 6.4 Idempotency

- Introduce one execution key that remains stable across Cloud Run retry attempts for the same invocation.
- Keep current deterministic candidate `item_id` generation.
- Use unique constraints and `INSERT ... ON CONFLICT` for run, account, raw-fact hash, candidate, batch, attempt, and decision identities.
- State transitions must be monotonic except an expired `running` lease may be reclaimed.
- Reprocessing the same execution must update/finalize incomplete rows, not duplicate facts or decisions.
- A distinct manually requested rerun may create a new run while retaining the same processing date.

### 6.5 Numeric correctness

The current sweeper maps all Google Ads values to JavaScript `number`. Before database persistence:

- carry cost micros and whole-number counts as decimal strings or bigint-safe values at the storage boundary;
- write PostgreSQL `bigint` values as strings through `pg`;
- write conversions/value as canonical decimal strings into `numeric` columns;
- never derive persisted exact values from formatted spreadsheet cells;
- add overflow and fractional-conversion tests.

## 7. Database Security and Runtime Access

Create a dedicated no-login group role and environment-specific login for the sweeper rather than reusing an administrator or a broad human/web credential.

Recommended grants:

- `SELECT` on `organizations`, `advertising_data_connections`, and `client_accounts`;
- optional `SELECT` on existing campaign/ad-group fact tables only where server-side reconciliation needs it;
- `SELECT/INSERT/UPDATE` on the new sweeper run tables;
- sequence usage required by those tables;
- no delete during normal runtime;
- no schema creation, migration, role management, `BYPASSRLS`, or Google Ads write capability.

Every database transaction sets `app.organization_id` with `SET LOCAL`/`set_config`. Worker-originated rows use a null actor ID and explicit system provenance.

Deployment work:

1. Run the sweeper in the same intended Built Ads Manager environment/project and preferably `us-west1`.
2. Add private-range VPC egress matching the existing Cloud SQL path.
3. Create a dedicated sweeper database login and store only its URL in Secret Manager.
4. Grant the sweeper Cloud Run service account access only to its database secret and currently required provider/Ads secrets.
5. Change `scripts/deploy/deploy-gcloud.ps1` so `DATABASE_URL` is always secret-bound.
6. Replace the current “upload every non-secret `.env` entry” behavior with an explicit allowlist.
7. Keep Dev, Staging, and Production databases and secrets separate.
8. Never run migrations or import historical data automatically during application deployment.

## 8. Built Ads Manager API and UI Plan

### 8.1 Product placement

After the scope-ledger decision, add two read-only surfaces.

#### Account-level: `Negative keyword review`

Add an account-detail tab after `Search keywords` and before `Locations`, subject to final founder naming/placement approval.

Top summary:

- latest completed sweep date and freshness;
- run/account status;
- candidates reviewed;
- KEEP count;
- NEGATIVE_EXACT recommendations count;
- failed batches/errors when present;
- explicit “Read-only — no changes were made in Google Ads” provenance.

Decision table, newest first:

- processed/account-local date;
- complete search term;
- recommendation;
- campaign and ad group;
- Search or Performance Max channel;
- impressions, clicks, spend, conversions, and conversion value;
- matched keyword/match type where available;
- confidence;
- rule IDs and short reason;
- run/rules/model context in a read-only detail disclosure.

Filters:

- date range;
- decision;
- campaign;
- channel;
- free-text search across term/campaign/ad group;
- optional rule ID;
- server-side sorting and cursor pagination.

Do not mix rows across client accounts. Do not add an “Apply negative”, export, rerun, or Google Ads link.

#### Owner-only: System Health sweep history

Extend the existing owner-authorized System Health/run-history composition with a distinct `Negative keyword sweeps` section rather than pretending sweeper runs are ordinary ingestion `sync_runs`.

Run table/detail should show:

- started/completed time and duration;
- requested processing date and trigger;
- status and selected/succeeded/partial/failed account counts;
- raw rows, candidates, decisions, and recommendation totals;
- provider/model/rule versions;
- token totals and reconciliation state;
- per-account status and safe errors;
- per-batch status/attempt/token summary for diagnosis.

The browser must not receive raw provider request/response JSON, unredacted errors, stack traces, credentials, organization IDs, or raw Google Ads payloads.

### 8.2 Contracts and API boundaries

In `packages/domain`, add database-independent serialized contracts such as:

- `UiNegativeKeywordSweepSummary`
- `UiNegativeKeywordDecisionRow`
- `UiNegativeKeywordDecisionQuery/Result`
- `UiNegativeKeywordSystemRun`
- `UiNegativeKeywordSystemRunDetail`
- `UiNegativeKeywordAccountRun`

Exact decimal data remains strings at the browser contract. Missing values remain null/unavailable, never fabricated zeroes.

In `packages/api`:

- add account-authorized and owner-authorized repository interfaces;
- implement PostgreSQL repositories inside `withDatabaseContext`;
- derive organization, actor, role, and account visibility from the session;
- accept only opaque run/account identifiers, filters, cursor, page size, and sort;
- reject organization/actor/customer-ID scope parameters;
- return not-found for absent, cross-tenant, or unauthorized records.

Recommended reads:

- extend the existing account-detail collection API with a `negative_keyword_decisions` collection;
- add an owner-only sweeper-run detail endpoint under the existing system API namespace;
- keep APIs parameterized, paged, no-store, and read-only.

### 8.3 Visual requirements

Use the established command-center compositions:

- command/section header;
- three-column signal band where useful;
- status badges with visible text;
- canonical `InteractiveTable` around every wide table;
- explicit loading, empty, partial, error, stale, and access-denied states;
- responsive filters and contained table scrolling;
- keyboard-accessible sorting, filtering, disclosures, and pagination;
- desktop, laptop, tablet, and 390px mobile verification.

If the account tab or batch-detail disclosure requires a new reusable pattern, add it to the canonical design-system documentation in the same Built Ads Manager change.

## 9. Historical Run Import

Existing local `runs/` data should be importable, but a backfill must never run implicitly.

Build `scripts/import-run-artifacts.ts` with:

- `--source-directory`;
- `--organization-id`;
- `--environment` safety assertion;
- `--dry-run` as the default;
- explicit `--commit`;
- optional `--run-id` or date range;
- schema/contract-version validation;
- checksum calculation for every source artifact;
- account mapping through `(organization_id, google_customer_id)`;
- idempotent upserts using `historical_import` execution keys;
- support for incomplete/partial/failed historical directories;
- a reconciliation report containing only run IDs and aggregate counts.

Import policy:

1. Inventory and validate without printing client data.
2. Reject an artifact when its account cannot be mapped; do not auto-create accounts.
3. Import raw facts, candidates, decisions, batches, attempts, telemetry, errors, tokens, rules, and delivery status.
4. Record absent artifacts explicitly rather than inventing empty success.
5. Compare database counts and token totals with artifact summaries.
6. Obtain explicit authorization before committing a Dev/Staging/Production import.
7. Keep original files untouched until a backup and sampled reconciliation are verified.
8. Decide separately whether old local/object artifacts can be archived or deleted; this plan authorizes no deletion.

## 10. Delivery Phases

### Phase 0 — Admit and specify the feature

Built Ads Manager changes:

- add a founder-approved product decision;
- change the scope ledger from `Future only` to the exact read-only scope;
- update architecture, threat model, operations, what-we-use, UI contracts, API ownership, frontend reconciliation matrix, acceptance matrix, and status/delivery plan;
- document the account-detail and System Health compositions.

Exit criteria:

- scope-lock tests recognize the approved feature;
- no ambiguity about audience, retention, historical import, or raw-payload visibility;
- no Google Ads mutation capability is admitted.

### Phase 1 — Shared schema and least-privilege access

Built Ads Manager changes:

- add the migration and rollback section;
- add RLS, organization-aware foreign keys, checks, unique indexes, query indexes, and runtime grants;
- add migration/RLS/integration tests;
- prepare (do not automatically execute) Dev role/secret/network scripts.

Exit criteria:

- migration verification passes;
- two-tenant isolation tests pass;
- sweeper role cannot read another organization or mutate unrelated tables;
- rollback is proven in an isolated database.

### Phase 2 — Sweeper persistence

Sweeper changes:

- introduce the persistence interface and PostgreSQL implementation;
- wire every current artifact datum to the schema;
- make database lifecycle transitions resilient and idempotent;
- add exact numeric handling and provider-payload redaction;
- retain local artifacts as an optional shadow during rollout;
- update `.env.example`, deployment script, architecture decision, deployment docs, and README.

Exit criteria:

- unit and PostgreSQL integration tests pass;
- success, no-candidate, partial-batch, account-failure, report-failure, database-retry, and duplicate-execution fixtures persist correctly;
- database totals reconcile with generated artifacts for representative runs.

### Phase 3 — Historical importer

Sweeper changes:

- implement dry-run and commit modes;
- test every known artifact version and missing-file case;
- produce aggregate reconciliation output without leaking client data.

Exit criteria:

- rerunning an import produces no duplicates;
- sampled database rows exactly match source facts and decisions;
- no source files are modified.

### Phase 4 — Authorized API

Built Ads Manager changes:

- publish UI contracts;
- implement account and owner repositories/APIs;
- add pagination/filter validation and safe response mapping;
- add positive and negative authorization tests.

Exit criteria:

- account managers see only permitted accounts;
- owner-only run diagnostics cannot be accessed by other roles;
- cross-tenant IDs return no data;
- no raw internal/provider payload crosses the API boundary.

### Phase 5 — UI

Built Ads Manager changes:

- add account sweep summary/history;
- add owner System Health sweep run/history/detail;
- implement canonical loading/empty/partial/error/stale states;
- update design-system documentation and UI handoff.

Exit criteria:

- component, route, accessibility, and scope-lock tests pass;
- real paged API data replaces fixtures;
- desktop and narrow-mobile screenshots prove readable, non-overlapping tables and controls;
- no mutation, rerun, backfill, or export action exists.

### Phase 6 — Controlled Dev rollout

Operational steps, each requiring explicit authorization:

1. apply the migration through the established private migration Job;
2. create the sweeper runtime login/secret and private network path;
3. deploy with local artifact shadowing enabled;
4. run one configured low-risk account;
5. reconcile database, local artifact, workbook, and API totals;
6. run an all-configured-account Dev sweep;
7. dry-run, then separately authorize, the historical import;
8. complete security/log review and backup/restore evidence;
9. only then disable production dependence on local artifacts.

Exit criteria:

- five consecutive scheduled Dev runs persist and render correctly;
- retries create no duplicates;
- partial failures remain visible and account-isolated;
- restore and rollback procedures include the new tables;
- Shah approves promotion separately for Staging and Production.

## 11. Required Tests

### Database

- all foreign key, status, count, exact-negative-text, time, and numeric checks;
- forced RLS and cross-organization denial for every new table;
- same run/account identity in two organizations remains isolated;
- unknown/cross-tenant account mapping fails closed;
- runtime role permission-denial tests for unrelated tables and delete operations;
- indexes support newest-first account history, decision filters, and owner run history.

### Sweeper

- top-level failure before discovery still creates/finalizes a failed run when the database is reachable;
- raw rows persist before classification;
- no-candidate account succeeds with zero decisions;
- one failed batch produces partial state without losing successful batches;
- provider validation retry persists both attempts but only validated decisions;
- model/report errors are redacted;
- database reconnect/retry and duplicate execution are idempotent;
- cost micros beyond JavaScript safe integer boundaries remain exact;
- local artifact write failure does not corrupt database state;
- database failure cannot be masked as successful completion.

### API/security

- owner, account-manager, CSM, executive, deactivated, unassigned, and cross-tenant cases;
- rejected organization/customer-ID query parameters;
- opaque identifier validation, cursor tampering, filter validation, and page-size bounds;
- raw payload/error/stack/credential fields absent from serialized responses;
- exact decimal strings and null/unavailable semantics.

### UI

- status and recommendation meaning never relies only on color;
- filters, sorting, pagination, and disclosures work with keyboard and screen-reader labels;
- loading, empty, partial, stale, denied, and failed states;
- long search terms, campaign names, reasons, and multiple rule IDs;
- contained table overflow at 390px with no document-level horizontal scroll;
- no forbidden negative-keyword action or run-control text/endpoint appears.

## 12. Observability and Retention

- Retain normalized run facts and audit evidence for seven years, matching Built Ads Manager D-007 unless a new decision changes this.
- Add safe metrics for run duration, account/batch outcomes, DB persistence failures, token reconciliation, and history-import reconciliation.
- Log opaque run/account-run IDs and stable error codes only; never log customer IDs, search terms, model prompts/responses, secrets, database URLs, or raw exceptions.
- Feed severe sweeper runtime/persistence failures into the existing sanitized owner Error Center only after the error type and operator guidance are explicitly added to its contract.
- Include new tables in backup sizing, restore verification, and retention jobs before Production rollout.

## 13. Recommended Product Decisions

Unless Shah chooses differently, use these defaults:

1. **Historical data:** import all valid existing runs after a dry-run and Dev sample reconciliation.
2. **Account UI:** call the tab `Negative keyword review` and place it after `Search keywords`.
3. **Audience:** authorized account viewers see decisions and campaign/search-term evidence; only Owners see model/token/batch/error diagnostics.
4. **Raw provider payloads:** retain redacted, size-bounded payloads in PostgreSQL for audit, but never return them to the UI.
5. **Files:** keep JSON/CSV/XLSX shadow output through Dev validation, then make it optional; do not add downloadable report UI.
6. **Retention:** seven years for run facts, decisions, rules, and audit evidence.
7. **Environment:** deploy each sweeper Job into the matching Built Ads Manager project/region/network; never connect a Dev job to Staging or Production data.

## 14. Definition of Done

The integration is complete only when:

- an approved scope-ledger item admits the exact read-only feature;
- every scheduled run creates a durable PostgreSQL run record before substantive work;
- all configured-account raw facts, candidates, decisions, attempts, tokens, safe telemetry, and delivery outcomes are stored and reconciled;
- every row is tied to an organization and existing client account under forced RLS;
- retrying a job or import creates no duplicates;
- Built Ads Manager shows account-level decision history and owner-only run health from authorized APIs;
- no browser response exposes raw provider/Google Ads payloads, secrets, internal errors, or organization IDs;
- no Google Ads mutation path or UI action exists;
- automated checks, mobile/desktop UI evidence, Dev pilot runs, migration verification, backup/restore, and rollback evidence all pass;
- canonical docs in both repositories match the deployed behavior.

## 15. Explicit Non-Goals

- applying negative keywords to Google Ads;
- adding any Google Ads write scope or mutation endpoint;
- rerun/backfill controls in the browser;
- using CSV/XLSX/object storage as the application system of record;
- auto-creating Built Ads Manager accounts from sweeper discovery;
- showing raw LLM requests/responses or internal stack traces to employees;
- combining search-term rows from different clients into one account-manager table;
- running migrations, historical imports, or production changes without separate authorization.
