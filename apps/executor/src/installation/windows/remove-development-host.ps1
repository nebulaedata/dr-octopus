<#
@author Codex
@description Explicitly removes only a selected workspace's matching current-user dev Host registrations, preserving profiles, data, production and foreign entries.
#>
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{16}$')][string]$WorkspaceKey,
  [Parameter(Mandatory=$true)][string]$ExpectedManifest
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
Import-Module (Join-Path $PSHOME 'Modules/CimCmdlets/CimCmdlets.psd1')
if ($ExpectedManifest -notmatch '^[A-Za-z]:\\' -or $ExpectedManifest -notmatch '\\browser-host\\registration\\native-host\.json$') { throw 'Invalid development manifest.' }
$taskHost = 'com.octopus.executor.browser.dev_' + $WorkspaceKey
$taskHostRoot = Split-Path (Split-Path $ExpectedManifest)
$taskDataRoot = Split-Path (Split-Path (Split-Path $taskHostRoot))
$taskAppRoot = ''
try {
  $taskOwnerFile = Get-Item -LiteralPath (Join-Path $taskHostRoot 'state/owner.json')
  if ($taskOwnerFile.Length -le 65536 -and !($taskOwnerFile.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    $taskOwner = Get-Content -LiteralPath $taskOwnerFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([IO.Path]::IsPathRooted($taskOwner.source)) { $taskAppRoot = Split-Path $taskOwner.source }
  }
} catch { $taskAppRoot = '' }
$taskRunning = @(Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $PID -and $_.CommandLine -and
  ($_.CommandLine.IndexOf($taskDataRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
   ($taskAppRoot -and $_.CommandLine.IndexOf($taskAppRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0))
})
if ($taskRunning.Count) { throw 'Close this workspace development session before removing its registration.' }
$taskHash = [Security.Cryptography.SHA256]::Create()
try { $taskKeyHash = [BitConverter]::ToString($taskHash.ComputeHash([Text.Encoding]::UTF8.GetBytes('"' + $taskHost + '"'))).Replace('-', '').ToLowerInvariant() } finally { $taskHash.Dispose() }
$taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskMutex = [Threading.Mutex]::new($false, ('Global\OctopusBrowserMaintenance-' + $taskSid + '-' + $taskKeyHash))
$taskAcquired = $false
$taskResults = @()
$taskForeign = $false
try {
  try { $taskAcquired = $taskMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $taskAcquired = $true }
  if (!$taskAcquired) { throw 'Host maintenance is busy; retry after it finishes.' }
  foreach ($taskBrowser in @('Chrome','Edge')) {
    $taskVendor = if ($taskBrowser -eq 'Chrome') { 'Google\Chrome' } else { 'Microsoft\Edge' }
    foreach ($taskView in @('Registry32','Registry64')) {
      $taskBase = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::$taskView)
      try {
        $taskPath = 'Software\' + $taskVendor + '\NativeMessagingHosts\' + $taskHost
        $taskKey = $taskBase.OpenSubKey($taskPath)
        $taskValue = $null
        if ($taskKey) { try { $taskValue = $taskKey.GetValue('') } finally { $taskKey.Dispose() } }
        $taskState = 'missing'
        if ($null -ne $taskValue) {
          if ($taskValue -is [string] -and [string]::Equals($taskValue, $ExpectedManifest, [StringComparison]::OrdinalIgnoreCase)) {
            $taskBase.DeleteSubKey($taskPath, $false)
            $taskState = 'removed'
          } else { $taskState = 'foreign-preserved'; $taskForeign = $true }
        }
        $taskResults += @{browser=$taskBrowser;view=$taskView;state=$taskState}
      } finally { $taskBase.Dispose() }
    }
  }
} finally {
  if ($taskAcquired) { $taskMutex.ReleaseMutex() }
  $taskMutex.Dispose()
}
ConvertTo-Json -InputObject @($taskResults) -Compress
if ($taskForeign) { exit 2 }
