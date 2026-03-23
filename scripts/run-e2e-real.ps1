param(
  [int]$Port = 3010,
  [int]$StartupTimeoutSec = 120,
  [int]$ScenarioTimeoutMs = 180000,
  [switch]$AutoOnly
)

$ErrorActionPreference = "Stop"
$baseUrl = "http://127.0.0.1:$Port"
$projectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "[e2e] starting next dev on $baseUrl ..."
$process = Start-Process `
  -FilePath "npm.cmd" `
  -ArgumentList @("run", "dev", "--", "--hostname", "127.0.0.1", "--port", "$Port") `
  -WorkingDirectory $projectRoot `
  -PassThru

try {
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 1200
    try {
      $null = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/workspace/config" -TimeoutSec 6
      $ready = $true
      break
    } catch {
      # keep waiting
    }
  }

  if (-not $ready) {
    throw "server did not become ready within $StartupTimeoutSec seconds"
  }

  Write-Host "[e2e] server ready, running scenario script ..."
  $scriptArgs = @("$projectRoot/scripts/e2e-real-scenario.mjs", "--baseUrl=$baseUrl", "--timeoutMs=$ScenarioTimeoutMs")
  if ($AutoOnly.IsPresent) {
    $scriptArgs += "--autoOnly=true"
  }
  & node @scriptArgs
  if ($LASTEXITCODE -ne 0) {
    throw "e2e scenario script failed with exit code $LASTEXITCODE"
  }
}
finally {
  if ($process -and -not $process.HasExited) {
    Write-Host "[e2e] stopping dev server ..."
    & taskkill /PID $process.Id /T /F | Out-Null
  }
}
