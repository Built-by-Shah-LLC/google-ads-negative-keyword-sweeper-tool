#Requires -Version 5.1
<#
.SYNOPSIS
  Triggers one DEV-9 bounded manual keyword-sweeper run (read-only) for a
  single company and date range on the negative-keyword-sweeper-manual
  Cloud Run job.

.DESCRIPTION
  This is the canonical manual trigger (the same action an operator would take
  from a UI button; DEV-9 deliberately has no browser trigger). It validates
  the inputs and calls the Cloud Run REST API directly with an explicit
  container-argument array. gcloud's --args list flag cannot express duplicate
  values (a single-day range repeats the date), so the REST override is the
  reliable path. The job itself re-validates everything and refuses any
  mutation mode other than disabled.

.EXAMPLE
  powershell -File scripts/execute-manual-sweep.ps1 -CustomerId 8402372674 -StartDate 2026-09-27 -EndDate 2026-09-27
#>
param(
  [Parameter(Mandatory = $true)][string]$CustomerId,
  [Parameter(Mandatory = $true)][string]$StartDate,
  [Parameter(Mandatory = $true)][string]$EndDate,
  [string]$ProjectId = "built-ads-manager-dev",
  [string]$Region = "us-west1",
  [string]$JobName = "negative-keyword-sweeper-manual",
  [switch]$Async
)

$normalizedCustomer = $CustomerId -replace "-", ""
if ($normalizedCustomer -notmatch "^\d{10}$") { throw "CustomerId must be a 10-digit Google Ads customer ID." }
foreach ($pair in @(@("StartDate", $StartDate), @("EndDate", $EndDate))) {
  if ($pair[1] -notmatch "^\d{4}-\d{2}-\d{2}$") { throw "$($pair[0]) must use YYYY-MM-DD." }
}
if ($StartDate -gt $EndDate) { throw "StartDate must not be after EndDate." }

$containerArgs = @(
  "dist/src/manual-sweep.js",
  "--customer", $normalizedCustomer,
  "--start-date", $StartDate,
  "--end-date", $EndDate
)
$body = @{
  overrides = @{
    containerOverrides = @(@{ args = $containerArgs })
  }
} | ConvertTo-Json -Depth 6

$accessToken = (gcloud auth print-access-token 2>$null)
if (-not $accessToken) { throw "No active gcloud account. Run: gcloud auth login" }
$headers = @{ Authorization = "Bearer $accessToken"; "Content-Type" = "application/json" }
$runUri = "https://$Region-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$ProjectId/jobs/$($JobName):run"

Write-Host "==> Executing $JobName (read-only manual sweep)"
Write-Host "    customer=$normalizedCustomer range=$StartDate..$EndDate"
$response = Invoke-RestMethod -Method Post -Uri $runUri -Headers $headers -Body $body
$executionName = $response.metadata.name
if (-not $executionName) { $executionName = $response.name }
Write-Host "    execution: $executionName"
if ($Async -or -not $executionName) { exit 0 }

$executionUri = "https://$Region-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$ProjectId/executions/$executionName"
$deadline = (Get-Date).AddHours(6)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 20
  $execution = Invoke-RestMethod -Method Get -Uri $executionUri -Headers $headers
  $completed = $execution.status.conditions | Where-Object { $_.type -eq "Completed" } | Select-Object -First 1
  if ($completed -and $completed.status -eq "True") {
    # Cloud Run job executions have no "Succeeded" condition; success is
    # reported via status.succeededCount / status.failedCount.
    $failedCount = 0
    if ($null -ne $execution.status.failedCount) { $failedCount = [int]$execution.status.failedCount }
    $succeededCount = 0
    if ($null -ne $execution.status.succeededCount) { $succeededCount = [int]$execution.status.succeededCount }
    if ($failedCount -eq 0 -and $succeededCount -gt 0) {
      Write-Host "==> Execution SUCCEEDED"
      exit 0
    }
    Write-Host "==> Execution FAILED (see Cloud Logging for the run error)"
    exit 1
  }
}
throw "Timed out waiting for execution $executionName."
