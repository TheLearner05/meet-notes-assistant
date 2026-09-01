# Starts the Meet Notes Assistant server if it isn't already running.
# Invoked by the "MeetNotesAssistantServer" scheduled task at login.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $repoRoot 'apps\server'
$logDir = Join-Path $repoRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'server.log'

$portInUse = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
if ($portInUse) {
    "$(Get-Date -Format o) already running on port 8787, skipping" | Add-Content -Path $logFile
    exit 0
}

Set-Location $serverDir
"$(Get-Date -Format o) starting server" | Add-Content -Path $logFile
& pnpm start *>> $logFile
