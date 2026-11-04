<#
@author Codex
@description Exports the shared read-only Host maintenance evidence, excluding user paths and credentials, without configuring registrations or starting Runtime.
#>
param(
  [Parameter(Mandatory=$true)][string]$ProductDirectory,
  [Parameter(Mandatory=$true)][string]$ReportPath,
  [string]$ProjectRoot = (Join-Path $env:USERPROFILE '.dr-octopus/executor')
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$taskResource = Join-Path (Resolve-Path -LiteralPath $ProductDirectory).Path 'resources/executor'
$taskNode = Join-Path $taskResource 'resources/node/node.exe'
$taskReport = [ordered]@{schemaVersion=2;scope='registration-diagnostics-only';phase='unknown';code='HOST_DIAGNOSTICS_UNAVAILABLE';acceptance=@{G4='pending';G5='pending';G6='pending'}}
try {
  if ((Get-FileHash -LiteralPath $taskNode -Algorithm SHA256).Hash.ToLowerInvariant() -ne '5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5') { throw 'Private Node hash mismatch.' }
  foreach ($name in @('NODE_OPTIONS','NODE_PATH','NODE_REPL_EXTERNAL_MODULE','NODE_V8_COVERAGE','NODE_USE_ENV_PROXY','NODE_EXTRA_CA_CERTS','NODE_ICU_DATA','OPENSSL_CONF')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  $taskOutput = & (Join-Path $taskResource 'native/browser-launcher.exe') '--maintain' inspect $ProjectRoot
  if ($LASTEXITCODE -ne 0) { throw 'Diagnostic process unavailable.' }
  $taskEvidence = $taskOutput | ConvertFrom-Json
  $taskReport.phase = $taskEvidence.phase
  $taskReport.code = 'INSPECTED'
  $taskReport.hostName = $taskEvidence.hostName
  $taskReport.bundleId = $taskEvidence.bundleId
  $taskReport.at = $taskEvidence.at
  $taskReport.checks = @($taskEvidence.checks | ForEach-Object { @{id=$_.id;status=$_.status;code=$_.code} })
} catch { $taskReport.code = 'HOST_DIAGNOSTICS_UNAVAILABLE' }
$taskFile = [IO.File]::Open([IO.Path]::GetFullPath($ReportPath), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
  $taskBytes = [Text.UTF8Encoding]::new($false).GetBytes(($taskReport | ConvertTo-Json -Depth 6))
  $taskFile.Write($taskBytes,0,$taskBytes.Length)
} finally { $taskFile.Dispose() }
Write-Output 'Diagnostic evidence written. Local component readiness does not prove a browser handshake.'
