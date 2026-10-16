<#
@author Codex
@description Runs complete inventory verification with digest-checked private Node and companion; no PATH fallback, service startup, registration or credentials.
#>
param(
  [Parameter(Mandatory=$true)][string]$ProductDirectory,
  [Parameter(Mandatory=$true)][string]$ReportPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
$product = (Resolve-Path -LiteralPath $ProductDirectory).Path
$node = Join-Path $product 'resources/executor/resources/node/node.exe'
$probe = Join-Path $PSScriptRoot 'verify-runtime-manifest.cjs'
$expectedProbe = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'verify-runtime-manifest.sha256') -Raw).Trim()
if ($expectedProbe -cnotmatch '^[a-f0-9]{64}$' -or
    (Get-FileHash -LiteralPath $probe -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expectedProbe -or
    (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant() -cne '5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5') {
  throw 'Inventory verifier or private Node digest mismatch.'
}
$report = [IO.Path]::GetFullPath($ReportPath)
$savedNodeOptions = $env:NODE_OPTIONS
$savedNodePath = $env:NODE_PATH
$savedPathExt = $env:PATHEXT
try {
  $env:NODE_OPTIONS = $null
  $env:NODE_PATH = $null
  # Windows PowerShell otherwise may treat an EXE as a document when PATHEXT is absent.
  $env:PATHEXT = '.EXE'
  & $node $probe --product $product --report $report
  $result = $LASTEXITCODE
} finally {
  $env:NODE_OPTIONS = $savedNodeOptions
  $env:NODE_PATH = $savedNodePath
  $env:PATHEXT = $savedPathExt
}
exit $result
