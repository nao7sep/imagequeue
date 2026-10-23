Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$scriptExitCode = 0
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$global:OutputEncoding = $utf8
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Missing required command: node" }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "Missing required command: npm" }
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    & node (Join-Path $scriptDir "launcher.mjs") run-dev
    if ($LASTEXITCODE -eq 130) { exit 130 }
    if ($LASTEXITCODE -ne 0) { throw "ImageQueue run-dev failed with exit code $LASTEXITCODE." }
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    $scriptExitCode = 1
    Read-Host "Press Enter to close" | Out-Null
}
exit $scriptExitCode
