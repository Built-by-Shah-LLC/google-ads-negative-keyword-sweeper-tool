#Requires -Version 5.1
<#
.SYNOPSIS
  Deploys the DEV-9 bounded MANUAL Keyword Sweeper as a separate, read-only
  Cloud Run Job. Does NOT touch the existing daily sweeper job or scheduler.

.DESCRIPTION
  Differences from scripts/deploy/deploy-gcloud.ps1 (the daily sweeper):
    * Separate Cloud Run Job 'negative-keyword-sweeper-manual'.
    * Separate image tag 'sweeper:manual-latest' so the existing job's
      'sweeper:latest' image is never modified.
    * Entry point dist/src/manual-sweep.js (bounded manual sweeps), deployed
      with no sweep arguments: a bare execution fails closed with usage.
    * GOOGLE_ADS_MUTATION_MODE=disabled is FORCED in the job environment, and
      the production confirmation value is never uploaded. The manual entry
      point also refuses any non-disabled mode at startup (defense in depth).
    * NO Cloud Scheduler trigger is created. The daily cadence for this job is
      deliberately inactive; enabling it requires a separate approved founder
      decision and action-time approval (see docs/MANUAL_SWEEPER.md).

  Steps performed (idempotent - safe to re-run):
    1. Run repository checks (typecheck + manual-sweep tests).
    2. Enable required Google Cloud APIs.
    3. Build the container image with Cloud Build under the manual tag.
    4. Create/update Secret Manager secrets from the local .env file.
    5. Create/update the Cloud Run Job (read-only, manual invocation only).

  Note: gcloud writes normal progress output to stderr, so this script does not
  use $ErrorActionPreference = "Stop"; every gcloud call checks $LASTEXITCODE.

.PARAMETER ProjectId
  Target Google Cloud project ID (must exist, with billing enabled).

.PARAMETER Region
  Deployment region. Default: us-west1, matching Built Ads Manager Dev.

.EXAMPLE
  powershell -File scripts/deploy/deploy-manual-sweeper-gcloud.ps1 -ProjectId built-ads-manager-dev
#>
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region = "us-west1",
  [string]$JobName = "negative-keyword-sweeper-manual",
  [string]$RepoName = "negative-keyword-sweeper",
  [string]$ImageTag = "manual-latest",
  [string]$ServiceAccountName = "sweeper-runner",
  [string]$WebServiceAccountName = "bam-dev-web",
  [string]$DatabaseSecretName = "bam-dev-sweeper-database-url",
  [string]$OrganizationSecretName = "bam-dev-organization-id",
  [string]$Network = "default",
  [string]$Subnet = "default"
)

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $ProjectRoot
try {
  Get-Command npm -ErrorAction Stop | Out-Null
  & npm run check
  if ($LASTEXITCODE -ne 0) { throw "Typecheck failed; deployment stopped." }
  & node --import tsx --test test/manual-sweep.test.ts
  if ($LASTEXITCODE -ne 0) { throw "Manual sweeper tests failed; deployment stopped." }
} finally { Pop-Location }
$Image = "$Region-docker.pkg.dev/$ProjectId/$RepoName/sweeper:$ImageTag"
$ServiceAccountEmail = "$ServiceAccountName@$ProjectId.iam.gserviceaccount.com"
$WebServiceAccountEmail = "$WebServiceAccountName@$ProjectId.iam.gserviceaccount.com"
$WebInvokerRoleId = "builtAdsManualSweeperInvoker"
$WebInvokerRole = "projects/$ProjectId/roles/$WebInvokerRoleId"

# Fall back to the project-local Cloud SDK when gcloud is not on PATH.
$localGcloudBin = Join-Path $ProjectRoot "tools\sdk\google-cloud-sdk\bin"
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue) -and (Test-Path $localGcloudBin)) {
  $env:PATH = "$localGcloudBin;$env:PATH"
}

# Keys from .env that are stored in Secret Manager (never as plain env vars).
# LLM is Moonshot-only for this job: no other provider key is ever uploaded.
$SecretKeys = @(
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "MOONSHOT_API_KEY",
  "RESEND_API_KEY",
  "SMTP_PASSWORD"
)

# Only these reviewed non-secret keys may be copied from local configuration
# into the Cloud Run Job. Unknown .env keys are never uploaded as plaintext.
# Mutation-related keys are deliberately absent: the job forces
# GOOGLE_ADS_MUTATION_MODE=disabled below and the production confirmation
# value must never exist in this job's environment.
$PlainEnvironmentKeys = @(
  "GOOGLE_ADS_API_VERSION", "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  "MOONSHOT_BASE_URL", "MOONSHOT_MODEL", "MOONSHOT_THINKING",
  "LLM_BATCH_SIZE", "GOOGLE_FETCH_CONCURRENCY", "LLM_CONCURRENCY",
  "LLM_REQUEST_TIMEOUT_MS", "LLM_MAX_ATTEMPTS", "RUN_TIME_ZONE",
  "CAMPAIGN_NAME_CONTAINS", "ACCOUNT_ALLOWLIST",
  "RUN_REPORT_EMAIL_ENABLED", "RUN_REPORT_EMAIL_TO", "RUN_REPORT_EMAIL_FROM",
  "RUN_REPORT_EMAIL_SUBJECT_PREFIX", "RESEND_REQUEST_TIMEOUT_MS", "RESEND_MAX_ATTEMPTS",
  "LOG_LEVEL", "ERROR_EMAIL_ENABLED", "ERROR_EMAIL_TO", "ERROR_EMAIL_FROM",
  "ERROR_EMAIL_SUBJECT_PREFIX", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER",
  "ALERT_HANDLED_ERROR_CODES", "ALERT_HANDLED_ERROR_STAGES",
  "PERSIST_RUNS_TO_DATABASE", "DATABASE_POOL_MAX", "DATABASE_MAX_PAYLOAD_BYTES"
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
  "compute.googleapis.com",
  "iam.googleapis.com",
  "--project", $ProjectId) "Failed to enable Google Cloud APIs."

Write-Host "==> Creating Artifact Registry repository '$RepoName' (if missing)"
if (-not (Test-GcloudResource @("artifacts", "repositories", "describe", $RepoName, "--location", $Region, "--project", $ProjectId))) {
  Invoke-Gcloud @("artifacts", "repositories", "create", $RepoName,
    "--repository-format", "docker", "--location", $Region, "--project", $ProjectId) "Failed to create Artifact Registry repository."
}

Write-Host "==> Building container image with Cloud Build: $Image"
Write-Host "    (separate tag '$ImageTag'; the daily sweeper's 'sweeper:latest' is not modified)"
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
if ($config["PERSIST_RUNS_TO_DATABASE"] -notmatch "^(?i:true|1|yes)$") {
  throw "PERSIST_RUNS_TO_DATABASE must be true before deploying the sweeper."
}
if ($config.ContainsKey("GOOGLE_ADS_MUTATION_MODE") -and $config["GOOGLE_ADS_MUTATION_MODE"] -and $config["GOOGLE_ADS_MUTATION_MODE"] -ne "disabled") {
  Write-Host "    NOTE: local .env sets GOOGLE_ADS_MUTATION_MODE=$($config['GOOGLE_ADS_MUTATION_MODE']); the manual job ignores it and forces 'disabled'."
}
foreach ($sharedSecret in @($DatabaseSecretName, $OrganizationSecretName)) {
  if (-not (Test-GcloudResource @("secrets", "describe", $sharedSecret, "--project", $ProjectId))) {
    throw "Required shared Built Ads Manager secret '$sharedSecret' does not exist."
  }
}

Write-Host "==> Creating/updating Secret Manager secrets"
$secretEnvMappings = @()
$secretNamesForRuntime = @()
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
  $secretNamesForRuntime += $secretName
  Write-Host "    $key -> secret/$secretName"
}
$secretEnvMappings += "DATABASE_URL=${DatabaseSecretName}:latest"
$secretEnvMappings += "ORGANIZATION_ID=${OrganizationSecretName}:latest"
$secretNamesForRuntime += $DatabaseSecretName
$secretNamesForRuntime += $OrganizationSecretName

Write-Host "==> Creating service account '$ServiceAccountEmail' (if missing)"
if (-not (Test-GcloudResource @("iam", "service-accounts", "describe", $ServiceAccountEmail, "--project", $ProjectId))) {
  Invoke-Gcloud @("iam", "service-accounts", "create", $ServiceAccountName,
    "--display-name", "Negative Keyword Sweeper runner", "--project", $ProjectId) "Failed to create service account."
}
foreach ($secretName in ($secretNamesForRuntime | Select-Object -Unique)) {
  Invoke-Gcloud @("secrets", "add-iam-policy-binding", $secretName,
    "--project", $ProjectId,
    "--member", "serviceAccount:$ServiceAccountEmail",
    "--role", "roles/secretmanager.secretAccessor") "Failed to grant $ServiceAccountEmail access to secret $secretName."
}

$projectNumber = (gcloud projects describe $ProjectId --project $ProjectId --format="value(projectNumber)" 2>$null)
if ($projectNumber -notmatch "^\d+$") { throw "Could not resolve the Google Cloud project number." }
$cloudRunServiceAgent = "service-$projectNumber@serverless-robot-prod.iam.gserviceaccount.com"
Invoke-Gcloud @("projects", "add-iam-policy-binding", $ProjectId,
  "--member", "serviceAccount:$cloudRunServiceAgent",
  "--role", "roles/compute.networkUser") "Failed to grant direct VPC access to the Cloud Run service agent."

Write-Host "==> Preparing plain environment variables"
$plainEnvPairs = @()
foreach ($key in $PlainEnvironmentKeys) {
  if (-not $config.ContainsKey($key)) { continue }
  if (-not $config[$key]) { continue }
  $plainEnvPairs += "$key=$($config[$key])"
}
# DEV-9 hard gate: the manual job is read-only. Force the disabled mode and
# never upload a production confirmation value, regardless of local .env.
$plainEnvPairs += "GOOGLE_ADS_MUTATION_MODE=disabled"
# LLM is Moonshot-only for this job, regardless of local .env provider choice.
$plainEnvPairs += "LLM_PROVIDER=moonshot"
# Values may contain commas (RUN_REPORT_EMAIL_TO, ACCOUNT_ALLOWLIST), so use ';' as
# the gcloud list delimiter via the ^;^ escape prefix instead of the default comma.
$plainEnvVarsArg = "^;^" + ($plainEnvPairs -join ";")

Write-Host "==> Creating/updating Cloud Run Job '$JobName' (manual, read-only, NO scheduler)"
$jobArgs = @(
  "run", "jobs", "create", $JobName,
  "--image", $Image,
  "--region", $Region,
  "--project", $ProjectId,
  "--service-account", $ServiceAccountEmail,
  "--network", $Network,
  "--subnet", $Subnet,
  "--vpc-egress", "private-ranges-only",
  "--set-secrets", ($secretEnvMappings -join ","),
  "--set-env-vars", $plainEnvVarsArg,
  "--task-timeout", "21600",
  "--max-retries", "1",
  "--memory", "1Gi",
  "--command=node",
  "--args=dist/src/manual-sweep.js"
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

# Browser-started requests always use bounded container-argument overrides.
# roles/run.invoker contains run.jobs.run but not run.jobs.runWithOverrides, so
# give the web runtime a purpose-built role with only those two permissions.
Write-Host "==> Granting the web runtime bounded run-with-overrides permission"
$roleArgs = @(
  "iam", "roles", "create", $WebInvokerRoleId,
  "--project", $ProjectId,
  "--title", "Built Ads manual sweeper invoker",
  "--description", "Runs the fixed manual sweeper job with bounded container argument overrides.",
  "--permissions", "run.jobs.run,run.jobs.runWithOverrides",
  "--stage", "GA"
)
if (Test-GcloudResource @("iam", "roles", "describe", $WebInvokerRoleId, "--project", $ProjectId)) {
  $roleArgs[2] = "update"
}
Invoke-Gcloud $roleArgs "Failed to create or update the bounded web invoker role."
Invoke-Gcloud @("run", "jobs", "add-iam-policy-binding", $JobName,
  "--region", $Region, "--project", $ProjectId,
  "--member", "serviceAccount:$WebServiceAccountEmail",
  "--role", $WebInvokerRole) "Failed to grant bounded run-with-overrides permission to the web runtime."
Invoke-Gcloud @("iam", "service-accounts", "add-iam-policy-binding", $ServiceAccountEmail,
  "--project", $ProjectId,
  "--member", "serviceAccount:$WebServiceAccountEmail",
  "--role", "roles/iam.serviceAccountUser") "Failed to grant the web runtime actAs permission on the sweeper runner."

Write-Host ""
Write-Host "Deployment complete. NO Cloud Scheduler trigger was created (daily cadence intentionally inactive)."
Write-Host ""
Write-Host "  Manual bounded sweep (one company, explicit range, read-only):"
Write-Host "    gcloud run jobs execute $JobName --region $Region --project $ProjectId ``"
Write-Host "      --args='dist/src/manual-sweep.js,--customer,8402372674,--start-date,2026-09-01,--end-date,2026-09-15'"
Write-Host "    (quote the --args value: unquoted commas are PowerShell array operators)"
Write-Host ""
Write-Host "  A bare execution (no sweep arguments) fails closed with usage by design."
Write-Host "  View logs:      gcloud logging read `"resource.type=cloud_run_job AND resource.labels.job_name=$JobName`" --project $ProjectId --limit 50"
Write-Host "  Scheduling:     see docs/MANUAL_SWEEPER.md - activation requires a separate approved decision."
