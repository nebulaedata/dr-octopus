<#
@author Codex
@description Reads current-user Browser Host registrations against one selected installation and writes non-secret evidence without changing keys or starting a service.
#>
param(
  [Parameter(Mandatory=$true)][string]$ProductDirectory,
  [Parameter(Mandatory=$true)][string]$ReportPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
$taskProduct = (Resolve-Path -LiteralPath $ProductDirectory).Path
$taskResource = Join-Path $taskProduct 'resources/executor'
$taskExpected = Join-Path $taskResource 'bridge/native-host.json'
$taskAllowedOrigins = @()
try {
  $taskIdentityFile = Get-Item -LiteralPath (Join-Path $taskResource 'browser-identity.json') -Force
  if ($taskIdentityFile.Length -gt 65536 -or ($taskIdentityFile.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Identity record rejected.' }
  $taskIdentity = (Get-Content -LiteralPath $taskIdentityFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json).identity
  $taskOrigins = @($taskIdentity.allowedOrigins)
  if ($taskIdentity.schemaVersion -ne 1 -or $taskOrigins.Count -lt 1 -or $taskOrigins.Count -gt 3 -or
      @($taskOrigins | Where-Object { $_ -cnotmatch '^chrome-extension://[a-p]{32}/$' }).Count -gt 0 -or
      @($taskOrigins | Select-Object -Unique).Count -ne $taskOrigins.Count) { throw 'Identity record rejected.' }
  $taskAllowedOrigins = $taskOrigins
} catch { $taskAllowedOrigins = @() }
$taskReport = [ordered]@{ schemaVersion=1; scope='registration-diagnostics-only'; browsers=@(); acceptance=@{G4='pending';G5='pending';G6='pending'} }
foreach ($taskBrowser in @('Chrome','Edge')) {
  $taskVendor = if ($taskBrowser -eq 'Chrome') { 'Google\Chrome' } else { 'Microsoft\Edge' }
  $taskKey = 'HKCU:\Software\' + $taskVendor + '\NativeMessagingHosts\com.octopus.executor.browser'
  $taskState = 'missing'
  if (Test-Path -LiteralPath $taskKey) {
    $taskManifest = (Get-Item -LiteralPath $taskKey).GetValue('')
    $taskState = 'other-installation'
    if ($taskManifest -ieq $taskExpected) {
      $taskState = 'invalid-selected-installation'
      try {
        $taskFile = Get-Item -LiteralPath $taskManifest -Force
        if ($taskFile.Length -gt 65536 -or ($taskFile.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Manifest rejected.' }
        $taskConfig = Get-Content -LiteralPath $taskManifest -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($taskConfig.name -cne 'com.octopus.executor.browser' -or $taskConfig.type -cne 'stdio' -or
            $taskConfig.path -ine (Join-Path $taskResource 'native/browser-launcher.exe') -or
            $taskAllowedOrigins.Count -lt 1 -or
            @($taskConfig.allowed_origins).Count -ne $taskAllowedOrigins.Count -or
            @(Compare-Object -ReferenceObject $taskAllowedOrigins -DifferenceObject @($taskConfig.allowed_origins) -CaseSensitive).Count -gt 0) { throw 'Manifest identity rejected.' }
        foreach ($taskRequired in @('native/browser-launcher.exe','native/file-commit.node','bridge/native-host.cjs','resources/node/node.exe')) {
          $taskEntry = Get-Item -LiteralPath (Join-Path $taskResource $taskRequired) -Force
          if ($taskEntry.PSIsContainer -or ($taskEntry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Host resource rejected.' }
        }
        $taskState = 'registered-resources-present'
      } catch { $taskState = 'invalid-selected-installation' }
    }
  }
  $taskReport.browsers += @{ browser=$taskBrowser; state=$taskState }
}
$taskOutput = [IO.File]::Open([IO.Path]::GetFullPath($ReportPath), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
  $taskBytes = [Text.UTF8Encoding]::new($false).GetBytes(($taskReport | ConvertTo-Json -Depth 6))
  $taskOutput.Write($taskBytes,0,$taskBytes.Length)
} finally { $taskOutput.Dispose() }
Write-Output 'Registration evidence written. Resource presence does not prove a successful bridge handshake.'
