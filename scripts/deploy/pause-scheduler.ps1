#Requires -Version 5.1
<#
.SYNOPSIS
  Pauses or resumes the daily Cloud Scheduler trigger for the sweeper WITHOUT
  undeploying anything. The Cloud Run Job stays deployed and can still be run
  manually; only the automatic daily trigger is disabled/enabled.

.EXAMPLE
  powershell -File scripts/deploy/pause-scheduler.ps1 -ProjectId my-project
  powershell -File scripts/deploy/pause-scheduler.ps1 -ProjectId my-project -Resume
#>
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region = "us-central1",
  [string]$JobName = "negative-keyword-sweeper",
  [switch]$Resume
)

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$localGcloudBin = Join-Path $ProjectRoot "tools\sdk\google-cloud-sdk\bin"
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue) -and (Test-Path $localGcloudBin)) {
  $env:PATH = "$localGcloudBin;$env:PATH"
}

$schedulerName = "$JobName-daily"
$action = if ($Resume) { "resume" } else { "pause" }

gcloud scheduler jobs $action $schedulerName --location $Region --project $ProjectId
if ($LASTEXITCODE -ne 0) { throw "Failed to $action scheduler job '$schedulerName'." }

Write-Host "Scheduler '$schedulerName' $($action)d. The Cloud Run Job '$JobName' remains deployed."
Write-Host "  Verify:  gcloud scheduler jobs describe $schedulerName --location $Region --project $ProjectId"
if (-not $Resume) {
  Write-Host "  Resume:  powershell -File scripts/deploy/pause-scheduler.ps1 -ProjectId $ProjectId -Region $Region -Resume"
}
