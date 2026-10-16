<#
@author Codex
@description Checks offline acceptance artifacts and required files without starting applications, changing registrations, or reading credentials.
#>
param(
  [Parameter(Mandatory=$true)][string]$ArtifactDirectory,
  [Parameter(Mandatory=$true)][string]$ReportPath,
  [string]$ProductDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')

<#
@description Requires an ordinary file, rejecting reparse points along its path within the checked root.
#>
function Get-CheckedFile([string]$Root, [string]$Relative) {
  if ((Get-Item -LiteralPath $Root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'Acceptance root is a reparse point.'
  }
  if ([IO.Path]::IsPathRooted($Relative) -or $Relative.Contains('\') -or $Relative.Split('/') -contains '..') {
    throw 'Invalid relative acceptance path.'
  }
  $current = $Root
  foreach ($part in $Relative.Split('/')) {
    if (!$part -or $part -eq '.') { throw 'Invalid acceptance path component.' }
    $current = Join-Path $current $part
    $item = Get-Item -LiteralPath $current -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Acceptance reparse points are not supported.' }
  }
  if ($item.PSIsContainer) { throw 'Acceptance file is a directory.' }
  return $item
}

<#
@description Bounds metadata before parsing; no user data or private configuration is inspected.
#>
function Read-Metadata([string]$Root, [string]$Relative, [long]$Limit) {
  $file = Get-CheckedFile $Root $Relative
  if ($file.Length -gt $Limit) { throw 'Acceptance metadata exceeds its limit.' }
  return Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
}

$artifactRoot = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
if (!$ProductDirectory) { $ProductDirectory = Join-Path $artifactRoot 'win-unpacked' }
$productRoot = (Resolve-Path -LiteralPath $ProductDirectory).Path
$reportFile = [IO.Path]::GetFullPath($ReportPath)
if (Test-Path -LiteralPath $reportFile) { throw 'Report already exists; choose a new report path.' }
$report = [ordered]@{
  schemaVersion = 1
  recordedAtUtc = [DateTime]::UtcNow.ToString('o')
  scope = 'artifact-and-environment-preflight-only'
  preflightPassed = $false
  acceptance = @{ G4 = 'pending'; G5 = 'pending'; G6 = 'pending' }
  error = $null
}
$exitCode = 0
try {
  $metadata = Read-Metadata $artifactRoot 'acceptance-artifacts.json' 16384
  if ($metadata.signed -isnot [bool] -or $metadata.signed -ne $false -or
      $metadata.computerEnabled -isnot [bool] -or $metadata.computerEnabled -ne $true -or
      $metadata.productName -cne 'Dr.Octopus Executor' -or $metadata.version -cne '0.0.1' -or @($metadata.files).Count -ne 2) {
    throw 'Expected the unsigned acceptance package with Computer enabled and two artifacts.'
  }
  $report.product = @{ name = $metadata.productName; version = $metadata.version; signed = $metadata.signed }
  if ($metadata.PSObject.Properties.Name -contains 'runtimeManifestSha256') {
    $manifestFile = Get-CheckedFile $productRoot 'runtime-manifest.json'
    if ($metadata.runtimeManifestSha256 -isnot [string] -or $metadata.runtimeManifestSha256 -cnotmatch '^[a-f0-9]{64}$' -or
        (Get-FileHash -LiteralPath $manifestFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $metadata.runtimeManifestSha256) {
      throw 'Runtime manifest digest mismatch.'
    }
    $manifest = Read-Metadata $productRoot 'runtime-manifest.json' 8388608
    if ($manifest.schemaVersion -ne 1 -or $manifest.productBuildId -cne $metadata.productBuildId) {
      throw 'Runtime manifest identity mismatch.'
    }
    $report.runtimeManifest = @{ productBuildId = $manifest.productBuildId; digestVerified = $true; fullInventory = 'run-verify-runtime-manifest-separately' }
  } else {
    $report.runtimeManifest = @{ digestVerified = $false; fullInventory = 'legacy-package-without-unified-inventory' }
  }
  $verified = @()
  foreach ($entry in $metadata.files) {
    if ($entry.path -isnot [string] -or $entry.path -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]+\.(exe|zip)$' -or
        $entry.sha256 -isnot [string] -or $entry.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
        ($entry.size -isnot [int] -and $entry.size -isnot [long]) -or $entry.size -le 0) {
      throw 'Invalid artifact metadata.'
    }
    $file = Get-CheckedFile $artifactRoot $entry.path
    if ($file.Length -ne $entry.size -or
        (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256) {
      throw 'Artifact size or SHA-256 mismatch.'
    }
    $verified += @{ name = $entry.path; size = $file.Length; sha256 = $entry.sha256 }
  }
  if (@($verified | Where-Object { $_.name.EndsWith('.exe') }).Count -ne 1 -or
      @($verified | Where-Object { $_.name.EndsWith('.zip') }).Count -ne 1) {
    throw 'Exactly one installer and one ZIP are required.'
  }
  $report.artifacts = $verified
  $required = @(
    'Dr.Octopus Executor.exe', 'resources/app.asar', 'INSTALLATION.md',
    'resources/executor/assets/brand/app.ico',
    'resources/executor/native/file-commit.node', 'resources/executor/native/stdio-exit.node',
    'resources/executor/native/mcp-launcher.exe', 'resources/executor/native/browser-launcher.exe',
    'resources/executor/native/process-supervisor.exe', 'resources/executor/runtime/index.cjs',
    'resources/executor/bridge/native-host.cjs', 'resources/executor/bridge/mcp-stdio.cjs',
    'resources/executor/setup/register-browser-host.ps1',
    'resources/executor/resources/node/node.exe', 'resources/executor/resources/node/LICENSE',
    'resources/executor/resources/search/fd/fd.exe', 'resources/executor/resources/search/rg/rg.exe',
    'resources/executor/computer-resources.json'
  )
  foreach ($relative in $required) { $null = Get-CheckedFile $productRoot $relative }
  $systemShellPath = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
  if (!(Test-Path -LiteralPath $systemShellPath -PathType Leaf)) { throw 'System Windows PowerShell is unavailable.' }
  $systemShellVersion = (& $systemShellPath -NoLogo -NoProfile -NonInteractive -Command '[Console]::Write($PSVersionTable.PSVersion.ToString())')
  if ($LASTEXITCODE -ne 0 -or $systemShellVersion -notmatch '^5\.1\.\d+(\.\d+)?$') { throw 'System Windows PowerShell 5.1 is required.' }
  $report.systemShell = @{ kind='powershell'; version=$systemShellVersion; available=$true; source='operating-system' }
  foreach ($browser in @('chrome', 'edge')) {
    $manifest = Read-Metadata $productRoot "resources/browser/$browser/manifest.json" 65536
    if ($manifest.manifest_version -ne 3) { throw 'MV3 extension required.' }
    foreach ($relative in @('background.js', 'content-scripts/content.js', 'licenses/page-controller-1.12.4.txt', 'licenses/noble-hashes-1.8.0.txt')) {
      $null = Get-CheckedFile $productRoot "resources/browser/$browser/$relative"
    }
  }
  $licenses = Read-Metadata $productRoot 'third-party-licenses/inventory.json' 262144
  if (!@($licenses).Count) { throw 'Third-party license inventory is empty.' }
  foreach ($license in $licenses) {
    if ($license.name -isnot [string] -or $license.version -notmatch '^[0-9A-Za-z.+-]+$' -or !@($license.notices).Count) {
      throw 'Invalid third-party license inventory.'
    }
    $directory = [Uri]::EscapeDataString($license.name) + '@' + $license.version
    foreach ($notice in $license.notices) {
      if ($notice -isnot [string] -or $notice.Contains('/') -or $notice.Contains('\')) { throw 'Invalid license notice path.' }
      $null = Get-CheckedFile $productRoot "third-party-licenses/$directory/$notice"
    }
  }
  $report.requiredFilesPresent = $true
  $report.licenseRecords = @($licenses).Count
  $systemTools = @()
  foreach ($name in @('node.exe', 'python.exe', 'python3.exe', 'git.exe')) {
    $systemTools += @{ name = $name; foundOnPath = [bool](Get-Command $name -CommandType Application -ErrorAction SilentlyContinue) }
  }
  $keys = @(
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.octopus.executor.browser',
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.octopus.executor.browser'
  )
  $registrations = @($keys | Where-Object { Test-Path -LiteralPath $_ }).Count
  $dataExists = Test-Path -LiteralPath (Join-Path $env:APPDATA 'Octopus Executor')
  $projectExists = Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dr-octopus\executor')
  $report.environment = @{
    osVersion = [Environment]::OSVersion.Version.ToString()
    is64BitOperatingSystem = [Environment]::Is64BitOperatingSystem
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    processorArchitecture = $env:PROCESSOR_ARCHITECTURE
    systemTools = $systemTools
    existingHostRegistrations = $registrations
    defaultUserDataExists = $dataExists
    defaultProjectExists = $projectExists
    freshUserForInstallerTest = ($registrations -eq 0 -and !$dataExists -and !$projectExists)
    networkIsolation = 'not-verified-manual-evidence-required'
  }
  $report.preflightPassed = $true
} catch {
  $report.error = $_.Exception.Message
  $exitCode = 1
}
# CreateNew refuses replacement even if another writer appears after the initial existence check.
$stream = [IO.File]::Open($reportFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($report | ConvertTo-Json -Depth 8))
  $stream.Write($bytes, 0, $bytes.Length)
} finally {
  $stream.Dispose()
}
Write-Output "Preflight report saved. Exit code: $exitCode. Product acceptance remains pending."
exit $exitCode
