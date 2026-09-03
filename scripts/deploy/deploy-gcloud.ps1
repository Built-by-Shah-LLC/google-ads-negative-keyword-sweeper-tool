#Requires -Version 5.1
<#
.SYNOPSIS
  Deploys the Google Ads Negative Keyword Sweeper to Google Cloud as a
  Cloud Run Job triggered daily by Cloud Scheduler.

.DESCRIPTION
  Steps performed (idempotent — safe to re-run):
    1. Enable required Google Cloud APIs.
    2. Create an Artifact Registry Docker repository.
    3. Build the container image with Cloud Build (no local Docker required).
    4. Create/update Secret Manager secrets from the local .env file.
    5. Create a dedicated service account with secret access.
    6. Create or update the Cloud Run Job.
    7. Create or update the daily Cloud Scheduler trigger.

  Note: gcloud writes normal progress output to stderr, so this script does not
  use $ErrorActionPreference = "Stop"; every gcloud call checks $LASTEXITCODE.

.PARAMETER ProjectId
  Target Google Cloud project ID (must exist, with billing enabled).

.PARAMETER Region
  Deployment region. Default: us-central1.

.EXAMPLE
  powershell -File scripts/deploy/deploy-gcloud.ps1 -ProjectId my-project -Region us-central1
#>
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region = "us-central1",
  [string]$JobName = "negative-keyword-sweeper",
  [string]$RepoName = "negative-keyword-sweeper",
  [string]$ServiceAccountName = "sweeper-runner",
  [string]$Schedule = "0 6 * * *",
  # 6:00 AM Pacific Time (America/Los_Angeles handles PST/PDT automatically).
  [string]$ScheduleTimeZone = "America/Los_Angeles"
)

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Image = "$Region-docker.pkg.dev/$ProjectId/$RepoName/sweeper:latest"
$ServiceAccountEmail = "$ServiceAccountName@$ProjectId.iam.gserviceaccount.com"

# Fall back to the project-local Cloud SDK when gcloud is not on PATH.
$localGcloudBin = Join-Path $ProjectRoot "tools\sdk\google-cloud-sdk\bin"
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue) -and (Test-Path $localGcloudBin)) {
  $env:PATH = "$localGcloudBin;$env:PATH"
}

# Keys from .env that are stored in Secret Manager (never as plain env vars).
$SecretKeys = @(
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "KIMI_API_KEY",
  "MOONSHOT_API_KEY",
  "RESEND_API_KEY",
  "SMTP_PASSWORD"
)

function Read-DotEnv([string]$Path) {
  $values = @{}
  foreach ($rawLine in Get-Content $Path) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith("#")) { continue }
    $separator = $line.IndexOf("=")
    if ($separator -lt 1) { continue }
    $key = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim().Trim('"').Trim("'")
    $values[$key] = $value
  }
  return $values
}

function ConvertTo-SecretName([string]$Key) {
  return ($Key.ToLower() -replace "_", "-")
}

# Returns $true when the gcloud lookup succeeds (resource exists), $false otherwise.
function Test-GcloudResource([string[]]$GcloudArgs) {
  & gcloud @GcloudArgs 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Invoke-Gcloud([string[]]$GcloudArgs, [string]$FailureMessage) {
  & gcloud @GcloudArgs
  if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
}

Write-Host "==> Checking gcloud authentication"
$account = (gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null)
if (-not $account) { throw "No active gcloud account. Run: gcloud auth login" }
Write-Host "    Active account: $account"
Invoke-Gcloud @("config", "set", "project", $ProjectId) "Failed to set project $ProjectId."

Write-Host "==> Enabling Google Cloud APIs"
Invoke-Gcloud @("services", "enable",
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "secretmanager.googleapis.com",
  "cloudscheduler.googleapis.com",
  "iam.googleapis.com",
  "--project", $ProjectId) "Failed to enable Google Cloud APIs."

Write-Host "==> Creating Artifact Registry repository '$RepoName' (if missing)"
if (-not (Test-GcloudResource @("artifacts", "repositories", "describe", $RepoName, "--location", $Region, "--project", $ProjectId))) {
  Invoke-Gcloud @("artifacts", "repositories", "create", $RepoName,
    "--repository-format", "docker", "--location", $Region, "--project", $ProjectId) "Failed to create Artifact Registry repository."
}

Write-Host "==> Building container image with Cloud Build: $Image"
Invoke-Gcloud @("builds", "submit", $ProjectRoot, "--tag", $Image, "--project", $ProjectId) "Cloud Build failed."

Write-Host "==> Reading configuration from .env and .env.openai"
$envPath = Join-Path $ProjectRoot ".env"
if (-not (Test-Path $envPath)) { throw ".env not found at $envPath" }
$config = Read-DotEnv $envPath
# The app also loads .env.openai (provider-specific overrides win over .env).
$openaiEnvPath = Join-Path $ProjectRoot ".env.openai"
if (Test-Path $openaiEnvPath) {
  foreach ($key in (Read-DotEnv $openaiEnvPath).GetEnumerator()) {
    $config[$key.Key] = $key.Value
  }
}

Write-Host "==> Creating/updating Secret Manager secrets"
$secretEnvMappings = @()
foreach ($key in $SecretKeys) {
  if (-not $config.ContainsKey($key) -or -not $config[$key]) { continue }
  $secretName = ConvertTo-SecretName $key
  $tempFile = Join-Path $env:TEMP "$secretName.txt"
  [System.IO.File]::WriteAllText($tempFile, $config[$key])
  if (Test-GcloudResource @("secrets", "describe", $secretName, "--project", $ProjectId)) {
    Invoke-Gcloud @("secrets", "versions", "add", $secretName, "--data-file=$tempFile", "--project", $ProjectId) "Failed to add version to secret $secretName."
  } else {
    Invoke-Gcloud @("secrets", "create", $secretName, "--data-file=$tempFile", "--project", $ProjectId) "Failed to create secret $secretName."
  }
  Remove-Item $tempFile -Force
  $secretEnvMappings += "$key=${secretName}:latest"
  Write-Host "    $key -> secret/$secretName"
}

Write-Host "==> Creating service account '$ServiceAccountEmail' (if missing)"
if (-not (Test-GcloudResource @("iam", "service-accounts", "describe", $ServiceAccountEmail, "--project", $ProjectId))) {
  Invoke-Gcloud @("iam", "service-accounts", "create", $ServiceAccountName,
    "--display-name", "Negative Keyword Sweeper runner", "--project", $ProjectId) "Failed to create service account."
}
Invoke-Gcloud @("projects", "add-iam-policy-binding", $ProjectId,
  "--member", "serviceAccount:$ServiceAccountEmail",
  "--role", "roles/secretmanager.secretAccessor") "Failed to grant secret access to $ServiceAccountEmail."

Write-Host "==> Preparing plain environment variables"
$plainEnvPairs = @()
foreach ($key in $config.Keys) {
  if ($SecretKeys -contains $key) { continue }
  if (-not $config[$key]) { continue }
  $plainEnvPairs += "$key=$($config[$key])"
}
# Values may contain commas (RUN_REPORT_EMAIL_TO, ACCOUNT_ALLOWLIST), so use ';' as
# the gcloud list delimiter via the ^;^ escape prefix instead of the default comma.
$plainEnvVarsArg = "^;^" + ($plainEnvPairs -join ";")

Write-Host "==> Creating/updating Cloud Run Job '$JobName'"
$jobArgs = @(
  "run", "jobs", "create", $JobName,
  "--image", $Image,
  "--region", $Region,
  "--project", $ProjectId,
  "--service-account", $ServiceAccountEmail,
  "--set-secrets", ($secretEnvMappings -join ","),
  "--set-env-vars", $plainEnvVarsArg,
  "--task-timeout", "21600",
  "--max-retries", "1",
  "--memory", "1Gi",
  "--args=--all-organizations"
)
if (Test-GcloudResource @("run", "jobs", "describe", $JobName, "--region", $Region, "--project", $ProjectId)) {
  $jobArgs[2] = "update"
}
Invoke-Gcloud $jobArgs "Cloud Run Job deployment failed."

Write-Host "==> Granting the service account permission to invoke the job"
Invoke-Gcloud @("run", "jobs", "add-iam-policy-binding", $JobName,
  "--region", $Region, "--project", $ProjectId,
  "--member", "serviceAccount:$ServiceAccountEmail",
  "--role", "roles/run.invoker") "Failed to grant run.invoker on the job."

Write-Host "==> Creating/updating Cloud Scheduler trigger (daily: $Schedule [$ScheduleTimeZone])"
$schedulerName = "$JobName-daily"
$runUri = "https://$Region-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$ProjectId/jobs/$($JobName):run"
$schedulerArgs = @(
  "scheduler", "jobs", "create", "http", $schedulerName,
  "--location", $Region,
  "--project", $ProjectId,
  "--schedule", $Schedule,
  "--time-zone", $ScheduleTimeZone,
  "--uri", $runUri,
  "--http-method", "POST",
  "--oauth-service-account-email", $ServiceAccountEmail
)
if (Test-GcloudResource @("scheduler", "jobs", "describe", $schedulerName, "--location", $Region, "--project", $ProjectId)) {
  $schedulerArgs[2] = "update"
}
Invoke-Gcloud $schedulerArgs "Cloud Scheduler setup failed."

Write-Host ""
Write-Host "Deployment complete."
Write-Host "  Run once now:   gcloud run jobs execute $JobName --region $Region --project $ProjectId"
Write-Host "  View logs:      gcloud logging read `"resource.type=cloud_run_job AND resource.labels.job_name=$JobName`" --project $ProjectId --limit 50"
Write-Host "  Note: runs/ artifacts are ephemeral inside the job. See docs/DEPLOYMENT.md for optional Cloud Storage mounting."
