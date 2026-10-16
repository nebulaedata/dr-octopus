<#
@author Codex
@description Runs the finite network acceptance probe with digest-checked private product Node; never searches PATH or changes Executor settings and registrations.
#>
param(
  [Parameter(Mandatory=$true)][string]$ProductDirectory,
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [Parameter(Mandatory=$true)][string]$ReportPath,
  [Parameter(Mandatory=$true)][string]$FixturePath,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
$product = (Resolve-Path -LiteralPath $ProductDirectory).Path
$node = Join-Path $product 'resources/executor/resources/node/node.exe'
$probe = Join-Path $PSScriptRoot 'network-probe.cjs'
$expectedProbe = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'network-probe.sha256') -Raw).Trim()
if ($expectedProbe -cnotmatch '^[a-f0-9]{64}$' -or
    (Get-FileHash -LiteralPath $probe -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expectedProbe -or
    (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant() -cne '5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5') {
  throw 'Acceptance probe or private Node digest mismatch.'
}
$configuration = (Resolve-Path -LiteralPath $ConfigPath).Path
$report = [IO.Path]::GetFullPath($ReportPath)
$savedNodeOptions = $env:NODE_OPTIONS
$savedNodePath = $env:NODE_PATH
$savedPathExt = $env:PATHEXT
try {
  $env:NODE_OPTIONS = $null
  $env:NODE_PATH = $null
  $env:PATHEXT = '.EXE'
  & $node $probe --config $configuration --report $report --fixture-path $FixturePath --expected-sha256 $ExpectedSha256
  $result = $LASTEXITCODE
} finally {
  $env:NODE_OPTIONS = $savedNodeOptions
  $env:NODE_PATH = $savedNodePath
  $env:PATHEXT = $savedPathExt
}
exit $result
