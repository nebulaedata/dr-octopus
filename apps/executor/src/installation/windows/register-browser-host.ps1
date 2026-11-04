<#
@author Codex
@description Runs the shared transactional Host maintenance with the verified bundled private Node runtime.
#>
param(
  [Parameter(Mandatory=$true)][ValidateSet('install','remove')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$ResourceRoot,
  [Parameter(Mandatory=$true)][string]$ProjectRoot,
  [string]$RepairRequest = ''
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$allowedOrigins = @('__OCTOPUS_BROWSER_ALLOWED_ORIGINS__')
if ($allowedOrigins.Count -lt 1 -or @($allowedOrigins | Where-Object { $_ -cnotmatch '^chrome-extension://[a-p]{32}/$' }).Count -gt 0) { throw 'Use the completed generated build.' }
$resource = (Get-Item -LiteralPath $ResourceRoot).FullName
$data = (Get-Item -LiteralPath $ProjectRoot).FullName
$node = Join-Path $resource 'resources/node/node.exe'
if ((Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant() -ne '5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5') { throw 'Private Node hash mismatch.' }
foreach ($name in @('NODE_OPTIONS','NODE_PATH','NODE_REPL_EXTERNAL_MODULE','NODE_V8_COVERAGE','NODE_USE_ENV_PROXY','NODE_EXTRA_CA_CERTS','NODE_ICU_DATA','OPENSSL_CONF')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
if ($RepairRequest) {
  & (Join-Path $resource 'native/browser-launcher.exe') '--maintain' $Mode $data $RepairRequest
} else {
  & $node (Join-Path $resource 'setup/browser-host.cjs') $Mode $resource $data
}
exit $LASTEXITCODE
