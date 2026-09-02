param(
    [ValidateSet('idle', 'queued', 'generating', 'paused', 'failed', 'completed', 'interrupted', 'mixed')]
    [string]$State = 'mixed',
    [switch]$Rebuild
)

# Windows-only interactive acceptance helper for the notification-area matrix.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoDir = Split-Path -Parent $scriptDir
$exePath = Join-Path $repoDir 'dist\win-unpacked\ImageQueue.exe'
$profileRoot = Join-Path ([System.IO.Path]::GetTempPath()) "imagequeue-status-icon-acceptance-$State"

Set-Location $repoDir
if ($Rebuild) {
    & npm run build:unpack
    if ($LASTEXITCODE -ne 0) { throw "ImageQueue package build failed with exit code $LASTEXITCODE" }
}
if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw "Packaged ImageQueue is missing at $exePath. Run this script once with -Rebuild."
}
if (Get-Process -Name 'ImageQueue' -ErrorAction SilentlyContinue) {
    throw 'ImageQueue is already running. Use Exit ImageQueue, then launch the next acceptance state.'
}
if (-not (Test-Path -LiteralPath $profileRoot)) {
    New-Item -ItemType Directory -Path $profileRoot | Out-Null
}

$env:IMAGEQUEUE_HOME = $profileRoot
$env:IMAGEQUEUE_STATUS_ACCEPTANCE_STATE = $State
$env:IMAGEQUEUE_DEBUG = '1'

Write-Host "Launching packaged ImageQueue with inert '$State' queue data." -ForegroundColor Cyan
Write-Host "Disposable profile: $profileRoot"
Write-Host 'No provider processor is started; API keys and generation services are not used.'
Start-Process -FilePath $exePath
