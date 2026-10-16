<#
@author Codex
@description Runs the private backup/restore companion only after confirming the selected installation and data are not used by a current process; never installs, registers or deletes.
#>
param(
  [Parameter(Mandatory=$true)][ValidateSet('backup','restore')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$ProductDirectory,
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [Parameter(Mandatory=$true)][string]$SourceDirectory,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
$productRoot = (Resolve-Path -LiteralPath $ProductDirectory).Path
$dataRoot = [IO.Path]::GetFullPath($DataDirectory)
if ($Mode -eq 'backup' -and [IO.Path]::GetFullPath($SourceDirectory) -ine $dataRoot) {
  throw 'Backup source must be the explicitly selected stopped data directory.'
}
foreach ($process in Get-CimInstance Win32_Process) {
  if ($process.ProcessId -eq $PID) { continue }
  $taskDefaultData = Join-Path $env:APPDATA 'Octopus Executor'
  $taskDefaultProject = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dr-octopus\executor'
  if ((($dataRoot -ieq $taskDefaultData -or $dataRoot -ieq $taskDefaultProject) -and $process.Name -ieq 'Dr.Octopus Executor.exe') -or
      ($process.ExecutablePath -and $process.ExecutablePath.StartsWith($productRoot + '\', [StringComparison]::OrdinalIgnoreCase)) -or
      ($process.CommandLine -and $process.CommandLine.IndexOf($dataRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0)) {
    throw 'Selected Executor installation or data is still in use. Exit from its tray and stop its owned adapters first.'
  }
}
$resourceRoot = Join-Path $productRoot 'resources/executor'
$privateNode = Join-Path $resourceRoot 'resources/node/node.exe'
$scriptPath = Join-Path $PSScriptRoot 'data-backup.cjs'
if ((Get-FileHash -LiteralPath $scriptPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne
    (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'data-backup.sha256') -Raw).Trim()) {
  throw 'Backup companion is changed; use the matching acceptance kit.'
}
$taskNodeOptions = $env:NODE_OPTIONS
$taskNodePath = $env:NODE_PATH
try {
  $env:NODE_OPTIONS = $null
  $env:NODE_PATH = $null
  & $privateNode $scriptPath --mode $Mode --resource $resourceRoot --source ([IO.Path]::GetFullPath($SourceDirectory)) --output ([IO.Path]::GetFullPath($OutputDirectory))
  if ($LASTEXITCODE -ne 0) { throw 'Data copy failed; preserve original and partial output for inspection.' }
} finally {
  $env:NODE_OPTIONS = $taskNodeOptions
  $env:NODE_PATH = $taskNodePath
}
