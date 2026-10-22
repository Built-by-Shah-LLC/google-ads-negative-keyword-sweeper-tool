# Deploying to Google Cloud

The sweeper is a batch CLI, so it deploys as one shared **Cloud Run Job**. A
**Cloud Scheduler** coordinator trigger runs every 30 minutes. Secrets (Google Ads tokens,
LLM-provider keys, Resend key, SMTP password) live in
**Secret Manager**; allowlisted non-secret settings become job environment variables.
The Job runs in `us-west1` on the Built Ads Manager private VPC and writes to
the same private Cloud SQL PostgreSQL database.

## Architecture

```text
Cloud Scheduler (every 30 minutes, UTC)
        |  HTTPS POST :run with --schedule-coordinator
        v
Cloud Run Job: negative-keyword-sweeper
        |  claims due PostgreSQL schedules and creates durable occurrences
        |  POST :run with --occurrence-id <uuid>
        v
Same Cloud Run Job: negative-keyword-sweeper
        |
        +-- Google Ads API (read-only GAQL plus separately gated exact-negative mutations)
        +-- Moonshot/Kimi API by default (OpenAI/Gemini remain selectable)
        +-- Resend API (per-run Excel workbook delivery)
        +-- private VPC --> Built Ads Manager Cloud SQL (durable source of truth)
```

Run artifacts are written under `runs/` inside the container as diagnostics.
Cloud SQL, not the ephemeral filesystem, is the durable run record.

## Prerequisites

1. A Google Cloud project with billing enabled.
2. The Google Cloud SDK (`gcloud`) authenticated as the deploying account:

   ```powershell
   gcloud auth login
   ```

3. A populated `.env` in the repository root (see `.env.example`), including the
   selected LLM provider and the Resend run-report settings. The local
   `.env.openai` file may override the OpenAI key/model. Both files are ignored by Git
   and excluded from the container image.
4. Built Ads Manager migrations through
   `0023_sweeper_effective_decision_outcomes.sql` applied by
   its private migration Job. The database administrator must first create the
   non-bypass-RLS login `bam_dev_negative_keyword_sweeper`; that migration Job
   creates/grants `bam_negative_keyword_sweeper_runtime`.
   The dashboard-owned policy/runtime and pilot schema introduced by
   `0021_negative_keyword_policy_and_pilot_completion.sql` must also be present;
   do not infer migration order across branches from the filename alone.
5. Secret Manager values `bam-dev-sweeper-database-url` and
   `bam-dev-organization-id`, readable only by `sweeper-runner`. The database
   URL must target private `bam-dev-postgres/built_ads_manager` and must not
   reuse the web or worker login.

Migrations `0022` and `0023` must precede this revision because every persisted
account run stores an immutable positive-keyword inventory and each LLM
decision receives a separate immutable effective outcome.
After migration, rerun the versioned sweeper runtime grants so the dedicated
role can insert the snapshot/outcome tables and update only the account counts.

## Deploy

```powershell
powershell -File scripts/deploy/deploy-gcloud.ps1 `
  -ProjectId built-ads-manager-dev `
  -ApprovedBaseCommit PREVIOUS_APPROVED_COMMIT
```

The script is idempotent; re-run it after code changes to rebuild and redeploy.
Optional parameters `-Schedule` and `-ScheduleTimeZone` control the coordinator only;
the safe defaults are `*/30 * * * *` and `Etc/UTC`. User schedules own their frequency,
30-minute wall-clock slot, and IANA timezone in PostgreSQL. The job defaults to
`--schedule-coordinator`, not to an account sweep.

Run scope is controlled by two `.env` settings (uploaded as plain job env vars):

- `CAMPAIGN_NAME_CONTAINS` — only campaigns whose name contains this text
  (case-insensitive) are handled. Defaults to `Built by Shah`; set it empty to disable.
- `ACCOUNT_ALLOWLIST` — comma-separated customer IDs (dashes optional) or account-name
  fragments. Empty means every enabled leaf account under the MCC.
- `SCHEDULED_REPORT_RECIPIENT_ALLOWLIST` — deployment ceiling for scheduled email.
  Empty means no scheduled recipient is sent a report.
- `SCHEDULED_AUTOMATIC_MUTATION_ENABLED` — deployment-wide mutation gate. Keep false
  unless an explicitly reviewed rollout enables it.
- `SCHEDULED_MUTATION_CUSTOMER_ALLOWLIST` — customer IDs permitted for scheduled
  mutation; every account in an occurrence must be listed or the run is forced read-only.

## Operate

```powershell
# Trigger the coordinator immediately (it dispatches only due database occurrences)
gcloud run jobs execute negative-keyword-sweeper --region us-west1 --project built-ads-manager-dev `
  --args=--schedule-coordinator

# Retry a durable occurrence without exposing account IDs to the scheduler
gcloud run jobs execute negative-keyword-sweeper --region us-west1 --project built-ads-manager-dev `
  --args=--occurrence-id,OCCURRENCE_UUID

# View logs
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=negative-keyword-sweeper" `
  --project YOUR_PROJECT_ID --limit 50
```

Scheduled runs use the calendar date two days before the occurrence in that schedule's
timezone. The occurrence snapshots the selected accounts, schedule revision, recipients,
and mutation request before dispatch.

## Pause / resume automatic schedule dispatch

To stop the automatic daily run without undeploying anything (the Cloud Run Job stays
deployed and can still be executed manually):

```powershell
powershell -File scripts/deploy/pause-scheduler.ps1 -ProjectId built-ads-manager-dev -Region us-west1

# Re-enable the coordinator later:
powershell -File scripts/deploy/pause-scheduler.ps1 -ProjectId built-ads-manager-dev -Region us-west1 -Resume
```

This only pauses the Cloud Scheduler job `negative-keyword-sweeper-coordinator`; nothing is
deleted.

## Optional diagnostic artifact retention

Cloud Run Job storage is ephemeral. PostgreSQL already retains the authoritative
run evidence. If separate diagnostic JSON/CSV/XLSX retention is required, mount a
Cloud Storage bucket with Cloud Storage FUSE:

```powershell
gcloud storage buckets create gs://YOUR_PROJECT_ID-sweeper-runs --location us-west1
gcloud storage buckets add-iam-policy-binding gs://YOUR_PROJECT_ID-sweeper-runs `
  --member serviceAccount:sweeper-runner@YOUR_PROJECT_ID.iam.gserviceaccount.com `
  --role roles/storage.objectAdmin
gcloud run jobs update negative-keyword-sweeper --region us-west1 --project YOUR_PROJECT_ID `
  --add-volume name=runs,type=cloud-storage,bucket=YOUR_PROJECT_ID-sweeper-runs `
  --add-volume-mount volume=runs,mount-path=/app/dist/runs
```

## Security notes

- Secrets are injected from Secret Manager at runtime and never baked into the image.
- Plain environment variables are deployment-script allowlisted, so retired provider
  credentials in a developer's `.env` cannot be uploaded as plaintext.
- The job uses the dedicated `sweeper-runner` service account.
- The database login uses forced organization RLS, has no schema/role ownership,
  and can update only sweep lifecycle tables. Built Ads Manager's normal app
  role is SELECT-only on the sweep schema.
- A checked schedule does not by itself permit mutation. The deployment switch, complete
  customer allowlist, existing production-mode confirmation, validation, and read-back
  verification must all pass. Otherwise the occurrence is forced read-only and audited.
