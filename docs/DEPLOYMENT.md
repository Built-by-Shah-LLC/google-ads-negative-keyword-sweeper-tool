# Deploying to Google Cloud

The sweeper is a batch CLI, so it deploys as a **Cloud Run Job** triggered daily by
**Cloud Scheduler**. Secrets (Google Ads tokens, LLM-provider keys, Resend key, SMTP password) live in
**Secret Manager**; allowlisted non-secret settings become job environment variables.

## Architecture

```text
Cloud Scheduler (daily cron)
        |  HTTPS POST :run (OIDC via sweeper-runner service account)
        v
Cloud Run Job: negative-keyword-sweeper
        |
        +-- Google Ads API (read-only GAQL; no mutations exist in src/)
        +-- Moonshot/Kimi API by default (OpenAI/Gemini remain selectable)
        +-- Resend API (per-run Excel workbook delivery)
```

Run artifacts are written under `runs/` inside the container unless durable storage is
mounted as described below.

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

## Deploy

```powershell
powershell -File scripts/deploy/deploy-gcloud.ps1 -ProjectId YOUR_PROJECT_ID -Region us-central1
```

The script is idempotent; re-run it after code changes to rebuild and redeploy.
Optional parameters `-Schedule "0 6 * * *"` and `-ScheduleTimeZone "UTC"` control the
daily trigger. The job defaults to `--all-organizations`.

## Operate

```powershell
# Trigger a run immediately
gcloud run jobs execute negative-keyword-sweeper --region us-central1 --project YOUR_PROJECT_ID

# One-off exact processing date for one organization
gcloud run jobs execute negative-keyword-sweeper --region us-central1 --project YOUR_PROJECT_ID `
  --update-args "--date 2026-08-25,--organization-limit,1"

# View logs
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=negative-keyword-sweeper" `
  --project YOUR_PROJECT_ID --limit 50
```

An explicit `--date` is the exact date queried. Scheduled runs use the single calendar
date 48 hours before execution in `RUN_TIME_ZONE`, shared by every organization.

## Pause / resume the daily trigger

To stop the automatic daily run without undeploying anything (the Cloud Run Job stays
deployed and can still be executed manually):

```powershell
powershell -File scripts/deploy/pause-scheduler.ps1 -ProjectId YOUR_PROJECT_ID -Region us-central1

# Re-enable the daily trigger later:
powershell -File scripts/deploy/pause-scheduler.ps1 -ProjectId YOUR_PROJECT_ID -Region us-central1 -Resume
```

This only pauses the Cloud Scheduler job `negative-keyword-sweeper-daily`; nothing is
deleted.

## Durable run artifacts

Cloud Run Job storage is ephemeral. If durable JSON/CSV/XLSX artifacts are required, mount a
Cloud Storage bucket with Cloud Storage FUSE:

```powershell
gcloud storage buckets create gs://YOUR_PROJECT_ID-sweeper-runs --location us-central1
gcloud storage buckets add-iam-policy-binding gs://YOUR_PROJECT_ID-sweeper-runs `
  --member serviceAccount:sweeper-runner@YOUR_PROJECT_ID.iam.gserviceaccount.com `
  --role roles/storage.objectAdmin
gcloud run jobs update negative-keyword-sweeper --region us-central1 --project YOUR_PROJECT_ID `
  --add-volume name=runs,type=cloud-storage,bucket=YOUR_PROJECT_ID-sweeper-runs `
  --add-volume-mount volume=runs,mount-path=/app/dist/runs
```

## Security notes

- Secrets are injected from Secret Manager at runtime and never baked into the image.
- Plain environment variables are deployment-script allowlisted, so retired provider
  credentials in a developer's `.env` cannot be uploaded as plaintext.
- The job uses the dedicated `sweeper-runner` service account.
- The pipeline remains read-only against Google Ads.
