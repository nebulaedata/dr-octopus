<#
@author Codex
@description Migrates this product's current-user Chrome/Edge Native Host entries and removes only registrations still owned by this installation.
#>
param(
  [Parameter(Mandatory=$true)][ValidateSet('install','remove')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$ResourceRoot,
  [Parameter(Mandatory=$true)][string]$ProjectRoot,
  [switch]$MigrateProduct
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
$allowedOrigins = @('__OCTOPUS_BROWSER_ALLOWED_ORIGINS__')
if ($allowedOrigins.Count -lt 1 -or $allowedOrigins.Count -gt 3 -or
    @($allowedOrigins | Where-Object { $_ -cnotmatch '^chrome-extension://[a-p]{32}/$' }).Count -gt 0) {
  throw 'Run the generated dist/setup registration script after a successful build.'
}
<#
@description Resolves physical DOS directories so a browser outside an MSIX filesystem view reads the same resources and device data.
#>
function Resolve-BrowserHostDirectory([string]$Path) {
  $directory = Get-Item -LiteralPath $Path
  if (!$directory.PSIsContainer) { throw 'Host paths must be existing directories.' }
  if (!('OctopusBrowserHostPath' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class OctopusBrowserHostPath {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint GetFinalPathNameByHandleW(IntPtr handle, StringBuilder result, uint count, uint flags);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);
  /**
   * Returns only an existing local directory's physical path without changing its data or permissions.
   */
  public static string Resolve(string path) {
    IntPtr handle = CreateFileW(path, 0x80, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
    if (handle == new IntPtr(-1)) { throw new Win32Exception(Marshal.GetLastWin32Error()); }
    try {
      var result = new StringBuilder(32768);
      uint length = GetFinalPathNameByHandleW(handle, result, 32768, 0);
      if (length == 0) { throw new Win32Exception(Marshal.GetLastWin32Error()); }
      if (length >= 32768) { throw new InvalidOperationException("Host path exceeds the supported limit."); }
      return result.ToString();
    } finally { CloseHandle(handle); }
  }
}
'@
  }
  $physical = [OctopusBrowserHostPath]::Resolve($directory.FullName)
  if ($physical -notmatch '^\\\\\?\\[A-Za-z]:\\') { throw 'Host paths must resolve to local DOS directories.' }
  return $physical.Substring(4)
}
$resource = Resolve-BrowserHostDirectory $ResourceRoot
$data = if ($Mode -eq 'install') { Resolve-BrowserHostDirectory $ProjectRoot } else { [IO.Path]::GetFullPath($ProjectRoot) }
$launcher = Join-Path $resource 'native/browser-launcher.exe'
$bridge = Join-Path $resource 'bridge'
$manifest = Join-Path $bridge 'native-host.json'
$locator = Join-Path $bridge 'host-location.json'
$keys = @('HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.octopus.executor.browser', 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.octopus.executor.browser')
if ($Mode -eq 'remove') {
  foreach ($key in $keys) {
    if ((Test-Path -LiteralPath $key) -and (Get-Item -LiteralPath $key).GetValue('') -eq $manifest) {
      Remove-Item -LiteralPath $key
    }
  }
  Write-Output 'Removed owned Chrome/Edge registration. Kept resources and user data.'
  exit 0
}
foreach ($path in @($launcher, (Join-Path $bridge 'native-host.cjs'), (Join-Path $resource 'native/file-commit.node'), (Join-Path $resource 'resources/node/LICENSE'))) {
  if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Required private Host resource missing.' }
}
if ((Get-FileHash -LiteralPath (Join-Path $resource 'resources/node/node.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -ne '5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5') { throw 'Private Node hash mismatch.' }
foreach ($key in $keys) {
  if (!(Test-Path -LiteralPath $key)) { continue }
  $existing = (Get-Item -LiteralPath $key).GetValue('')
  if ($existing -eq $manifest) { continue }
  if (!$MigrateProduct) { throw 'Existing foreign Native Host registration; no changes made.' }
  # Recognize the fixed product contract; never execute a script from the previous installation.
  if (![IO.Path]::IsPathRooted($existing)) {
    throw 'Unrecognized Native Host registration; no changes made.'
  }
  if (!(Test-Path -LiteralPath $existing -PathType Leaf)) {
    throw ('Registered Native Host manifest is missing: ' + $existing + '. Restore the old installation or back up and explicitly remove only the verified stale registration before retrying. No changes made.')
  }
  $previous = Get-Content -LiteralPath $existing -Raw -Encoding UTF8 | ConvertFrom-Json
  $previousRoot = Split-Path (Split-Path $existing)
  $expectedLauncher = Join-Path $previousRoot 'native/browser-launcher.exe'
  $previousOrigins = @($previous.allowed_origins)
  if ($previousOrigins.Count -lt 1 -or $previousOrigins.Count -gt 3 -or
      @($previousOrigins | Where-Object { $_ -isnot [string] -or $_ -cnotmatch '^chrome-extension://[a-p]{32}/$' }).Count -gt 0 -or
      @($previousOrigins | Select-Object -Unique).Count -ne $previousOrigins.Count) {
    throw 'Unrecognized Native Host registration; no changes made.'
  }
  $currentIdentity = $previousOrigins.Count -eq $allowedOrigins.Count -and
    @(Compare-Object -ReferenceObject $allowedOrigins -DifferenceObject $previousOrigins -CaseSensitive).Count -eq 0
  if ((Split-Path $existing -Leaf) -ne 'native-host.json' -or
      (Split-Path (Split-Path $existing) -Leaf) -ne 'bridge' -or
      $previous.name -ne 'com.octopus.executor.browser' -or $previous.type -ne 'stdio' -or
      $previous.path -ne $expectedLauncher -or
      !$currentIdentity) {
    throw 'Unrecognized Native Host registration; no changes made.'
  }
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
if (!$MigrateProduct -and (Test-Path -LiteralPath $locator)) {
  if ((Get-Content -LiteralPath $locator -Raw -Encoding UTF8 | ConvertFrom-Json).projectRoot -ne $data) {
    throw 'Existing Host data locator differs; no changes made.'
  }
}
[IO.File]::WriteAllText($locator, (@{projectRoot=$data} | ConvertTo-Json -Compress), $utf8)
[IO.File]::WriteAllText($manifest, (@{name='com.octopus.executor.browser';description='Octopus Browser Bridge';path=$launcher;type='stdio';allowed_origins=$allowedOrigins} | ConvertTo-Json), $utf8)
foreach ($key in $keys) {
  New-Item -Path $key -Force | Out-Null
  Set-Item -LiteralPath $key -Value $manifest
}
Write-Output 'Registered owned Chrome/Edge Native Host. Enable bridge explicitly in Executor.'
