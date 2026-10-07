# DEV-9 bounded manual sweeper (read-only)

This document describes the **manual** Keyword Sweeper instance: a separate
entry point and a separate Cloud Run job from the daily production sweeper.
It exists for internal, operator-invoked sweeps of **one authorized company
over an explicit bounded date range**, and it is **read-only with respect to
Google Ads** by construction.

Controlling product decisions: Built Ads Manager `docs/product/decisions.md`
entries **D-060** (Jira **DEV-9**) and **D-061** (browser-started wiring). The daily sweeper job
(`negative-keyword-sweeper`) and its scheduler are unchanged.

## Safety properties

| Layer | Control |
| --- | --- |
| Entry point | `src/manual-sweep.ts` refuses to start unless `GOOGLE_ADS_MUTATION_MODE` is `disabled` (or unset); it never accepts `--execute-production-google-ads-mutations`. |
| Writer | With mutation mode disabled, `runSweeper` never constructs a negative-keyword writer (`createNegativeKeywordWriter` returns `undefined`), so no mutation request can be built. |
| Reader | The only Google Ads client used is the shared read-only client; `assertReadOnlyGoogleAdsPath`/`assertReadOnlyGoogleAdsQuery` block every non-`searchStream`, non-`SELECT` call. |
| Deployment | The manual job forces `GOOGLE_ADS_MUTATION_MODE=disabled` in its environment and never receives `GOOGLE_ADS_PRODUCTION_MUTATION_CONFIRMATION`. |
| LLM provider | Moonshot-only: the job pins `LLM_PROVIDER=moonshot` and its environment contains no other provider's API key or model setting. `MOONSHOT_THINKING=disabled` is required: with thinking active (explicit or default), `kimi-k2.6` ignores the strict `json_schema` response format and free-forms, which the local validator rejects fail-closed (probe-verified 2026-09-29). |
| Scope | One company per run (10-digit customer ID), resolved against the committed sweep-accounts master file and enabled MCC leaf accounts; persistence fails closed without an active `client_accounts` mapping. |
| Bounded input | `--start-date`/`--end-date` are required, real calendar dates, start ≤ end, span ≤ **31 days**, and the end date may not be in the future (`RUN_TIME_ZONE`). |
| Campaign filter | Unchanged: `CAMPAIGN_NAME_CONTAINS` (default `Built by Shah`), applied to fetched search-term rows and to the positive-keyword inventory query. |
| Policy | Unchanged: the database-owned effective policy (static rule set + account revision + phrase protections) with `effective_sha256` fail-closed parity is compiled per account before any LLM spend. |
| Idempotency/audit | Runs persist with `run_key`/`execution_key` idempotency while semantic origin is recorded independently: bounded single-company runs are `trigger_kind=manual`; Built Ads Manager requests use `requested_date_source=built_ads_manager_ui`; direct operator runs use `command_line`. Evidence also retains `read_only=true`, `google_ads_mutation_performed=false`, `account_selection_mode=customer`, per-account `start_date`/`end_date`, candidates, decisions, batches, token usage, events, and sanitized errors. The requestor is attributable through Google Cloud audit logs (the principal calling `run.jobs.run`) correlated by execution name. |
| Scheduling | **No Cloud Scheduler trigger exists for this job.** The daily cadence is intentionally inactive. |

## Invocation

### In Google Cloud (deployed job)

```powershell
gcloud run jobs execute negative-keyword-sweeper-manual `
  --region us-west1 --project built-ads-manager-dev `
  --args='dist/src/manual-sweep.js,--customer,8402372674,--start-date,2026-09-01,--end-date,2026-09-15'
```

Quote the `--args` value: in PowerShell an unquoted comma is an array operator
and the overrides would be joined with spaces into one broken argument.

The job is deployed with `node dist/src/manual-sweep.js` and **no sweep
arguments**, so a bare `gcloud run jobs execute` fails closed with a usage
error instead of sweeping anything by accident.

Direct operators require `roles/run.invoker` (or broader Cloud Run
administration) on the job. The Built Ads Manager web runtime uses the
job-scoped custom role `builtAdsManualSweeperInvoker`, containing only
`run.jobs.run` and `run.jobs.runWithOverrides`, because every browser request
passes the validated customer and bounded date arguments as execution
overrides. Neither role grants Google Ads write access.

### Locally

```powershell
npm run sweep:manual -- --customer 8402372674 --start-date 2026-09-01 --end-date 2026-09-15
```

Local runs use the repo `.env` and require the same guards:
`PERSIST_RUNS_TO_DATABASE=true`, the sweep-accounts master file, and mutation
mode disabled.

The Built Ads Manager gateway appends the reserved
`--request-source built-ads-manager-ui` argument. This affects retained origin
metadata only; it does not broaden scope or enable a writer. Operators should
omit the flag for direct terminal runs.

### Inspecting results

Manual runs persist to the same shared database tables as daily runs
(`negative_keyword_sweep_runs` / `_account_runs` / `_candidates` /
`_decisions`, always with `read_only=true` and no mutation evidence) and are
visible in the existing Built Ads Manager keyword-sweep evidence surfaces.
The run workbook/CSV is produced exactly as for daily runs, including every
KEEP and NEGATIVE_EXACT candidate with rule IDs and reasons.

## Future daily scheduling (designed, inactive)

The all-companies mode is the designed scheduled form:

```powershell
npm run sweep:manual -- --all-organizations [--date 2026-09-27]
```

It selects every sweep-accounts master-file company that is an enabled MCC
leaf (the 30-day baseline gate is deliberately not applied to this read-only
instance), keeps the `CAMPAIGN_NAME_CONTAINS` campaign filter, processes one
date per run (default: the account-local date 48 hours back), and remains
read-only.

Activating it requires a separate approved founder decision and action-time
approval. Only then create the trigger, for example:

```powershell
gcloud scheduler jobs create http negative-keyword-sweeper-manual-daily `
  --location us-west1 --project built-ads-manager-dev `
  --schedule "30 6 * * *" --time-zone "America/Los_Angeles" `
  --uri "https://us-west1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/built-ads-manager-dev/jobs/negative-keyword-sweeper-manual:run" `
  --http-method POST --oauth-service-account-email sweeper-runner@built-ads-manager-dev.iam.gserviceaccount.com `
  --message-body '{"overrides":{"containerOverrides":[{"args":["dist/src/manual-sweep.js","--all-organizations"]}]}}'
```

Do not create this scheduler as part of DEV-9.

## Deployment

```powershell
powershell -File scripts/deploy/deploy-manual-sweeper-gcloud.ps1 -ProjectId built-ads-manager-dev
```

The script typechecks, runs the manual-sweeper tests, builds the image under
the **separate** tag `sweeper:manual-latest` (the daily job's `sweeper:latest`
is never touched), reuses the `sweeper-runner` service account and shared
secrets, and creates/updates only the `negative-keyword-sweeper-manual` job.
It creates no scheduler. The job environment is Moonshot-only for LLM calls
(`LLM_PROVIDER=moonshot`; no other provider key is uploaded).

## What this instance deliberately does not do

- No Google Ads mutation of any kind (no negative criteria, shared lists,
  budgets, bids, statuses, ads, or assets).
- No public or client-side Cloud Run credential, queue, or scheduler. D-061
  permits the authenticated Built Ads Manager server to invoke this one
  bounded job through the Cloud Run Admin API.
- No automatic retry of ambiguous outcomes (the mutation stage does not exist
  here; Cloud Run task retries are idempotent through `execution_key`).
- No rollback/removal workflow. Any future apply or removal workflow requires
  its own approved task per DEV-9.
