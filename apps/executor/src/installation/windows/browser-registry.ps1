<#
@author Codex
@description Reads both browser registry views and policy evidence; writes only the selected current-user product registration.
#>
param(
  [Parameter(Mandatory=$true)][ValidateSet('inspect','set','remove')][string]$Mode,
  [Parameter(Mandatory=$true)][ValidatePattern('^com\.octopus\.executor\.browser(?:\.dev_[a-f0-9]{16})?$')][string]$HostName,
  [ValidateSet('chrome','edge')][string]$Browser = 'chrome',
  [ValidateSet('Registry32','Registry64')][string]$View = 'Registry64',
  [string]$ManifestPath = '',
  [string]$ExpectedPath = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$vendors = @{chrome='Google\Chrome'; edge='Microsoft\Edge'}
if ($Mode -ne 'inspect') {
  if (![IO.Path]::IsPathRooted($ManifestPath)) { throw 'Manifest path must be absolute.' }
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::$View)
  try {
    $path = 'Software\' + $vendors[$Browser] + '\NativeMessagingHosts\' + $HostName
    if ($Mode -eq 'set') {
      $existingKey = $base.OpenSubKey($path)
      $existing = ''
      if ($existingKey) { try { $existing = [string]$existingKey.GetValue('') } finally { $existingKey.Dispose() } }
      if ($existing -cne $ExpectedPath -and $existing -cne $ManifestPath) { throw 'HOST_REGISTRY_CHANGED' }
      $key = $base.CreateSubKey($path)
      try { $key.SetValue('', $ManifestPath, [Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }
    } else {
      $key = $base.OpenSubKey($path)
      $owned = $false
      if ($key) { try { $owned = $key.GetValue('') -ceq $ManifestPath } finally { $key.Dispose() } }
      if ($owned) { $base.DeleteSubKey($path, $false) }
    }
  } finally { $base.Dispose() }
  exit 0
}
$records = @()
foreach ($flavor in @('chrome','edge')) {
  foreach ($hive in @('CurrentUser','LocalMachine')) {
    foreach ($registryView in @('Registry32','Registry64')) {
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::$hive, [Microsoft.Win32.RegistryView]::$registryView)
      try {
        $key = $base.OpenSubKey('Software\' + $vendors[$flavor] + '\NativeMessagingHosts\' + $HostName)
        $value = $null
        if ($key) { try { $value = $key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $key.Dispose() } }
        $policyRoot = 'Software\Policies\' + $vendors[$flavor]
        $policy = $base.OpenSubKey($policyRoot)
        $userHosts = $true
        if ($policy) { try { $userHosts = $policy.GetValue('NativeMessagingUserLevelHosts', 1) -ne 0 } finally { $policy.Dispose() } }
        $lists = @{}
        foreach ($list in @('NativeMessagingBlocklist','NativeMessagingAllowlist')) {
          $key = $base.OpenSubKey($policyRoot + '\' + $list)
          $values = @()
          if ($key) { try { $values = @($key.GetValueNames() | ForEach-Object { [string]$key.GetValue($_) }) } finally { $key.Dispose() } }
          $lists[$list] = $values
        }
        $blocked = !$userHosts -or (($lists.NativeMessagingBlocklist -contains '*' -or $lists.NativeMessagingBlocklist -contains $HostName) -and $lists.NativeMessagingAllowlist -notcontains $HostName)
        $records += @{browser=$flavor; hive=$hive; view=$registryView; path=$value; blocked=$blocked}
      } finally { $base.Dispose() }
    }
  }
}
ConvertTo-Json -InputObject @($records) -Compress -Depth 4
