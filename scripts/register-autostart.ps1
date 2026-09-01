# Registers a scheduled task that starts the Meet Notes Assistant server
# automatically whenever you log into Windows. Run this once:
#   pwsh -File scripts\register-autostart.ps1
# To remove it later: Unregister-ScheduledTask -TaskName MeetNotesAssistantServer

$ErrorActionPreference = 'Stop'
$taskName = 'MeetNotesAssistantServer'
$scriptPath = Join-Path $PSScriptRoot 'start-meet-notes-server.ps1'

$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $powershellExe `
    -Argument "-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -Hidden `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Starts the Meet Notes Assistant local server at login' -Force

Write-Host "Registered scheduled task '$taskName'. It will start the server on your next login."
Write-Host "To start it right now: Start-ScheduledTask -TaskName $taskName"
