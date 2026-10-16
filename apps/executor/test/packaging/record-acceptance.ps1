<#
@author Codex
@description Records operator-observed dedicated-computer acceptance against an exact artifact build identity without changing product gates, running tools or collecting desktop contents.
#>
param(
  [Parameter(Mandatory=$true)][string]$ArtifactDirectory,
  [Parameter(Mandatory=$true)][ValidateSet('clean-machine','browser-install','cross-computer','computer','manual-upgrade')][string]$Scenario,
  [Parameter(Mandatory=$true)][ValidateSet('passed','failed','not-tested')][string]$Outcome,
  [Parameter(Mandatory=$true)][ValidateLength(1,10000)][string]$Observation,
  [Parameter(Mandatory=$true)][string]$ReportPath,
  [string[]]$EvidenceFiles = @()
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
$taskArtifact = Get-Content -LiteralPath (Join-Path $ArtifactDirectory 'acceptance-artifacts.json') -Raw | ConvertFrom-Json
if ($taskArtifact.productName -cne 'Dr.Octopus Executor' -or $taskArtifact.version -cne '0.0.1' -or
    $taskArtifact.signed -ne $false -or $taskArtifact.computerEnabled -ne $true -or
    $taskArtifact.productBuildId -cnotmatch '^[a-f0-9]{64}$') { throw 'Unsupported acceptance artifact identity.' }
if ($EvidenceFiles.Count -gt 20) { throw 'Too many evidence files.' }
$taskEvidence = @()
foreach ($taskPath in $EvidenceFiles) {
  $taskFile = Get-Item -LiteralPath $taskPath -Force
  if ($taskFile.PSIsContainer -or $taskFile.Length -gt 20MB -or
      ($taskFile.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Evidence file rejected.' }
  $taskEvidence += @{name=$taskFile.Name;bytes=$taskFile.Length;sha256=(Get-FileHash -LiteralPath $taskFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
}
$taskReport = [ordered]@{
  schemaVersion=1; scope='operator-observation'; recordedAt=[DateTime]::UtcNow.ToString('o')
  productBuildId=$taskArtifact.productBuildId; scenario=$Scenario; outcome=$Outcome
  observation=$Observation; evidence=$taskEvidence
  acceptance=@{G4='pending';G5='pending';G6='pending'}
}
$taskOutput = [IO.File]::Open([IO.Path]::GetFullPath($ReportPath),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try {
  $taskBytes = [Text.UTF8Encoding]::new($false).GetBytes(($taskReport | ConvertTo-Json -Depth 6))
  $taskOutput.Write($taskBytes,0,$taskBytes.Length)
} finally { $taskOutput.Dispose() }
Write-Output 'Operator observation recorded; release gates remain pending.'
