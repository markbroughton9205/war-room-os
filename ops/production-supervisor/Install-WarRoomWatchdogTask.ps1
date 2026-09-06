# Registers the War Room production watchdog as a Windows Scheduled Task (Wave 1 repair, audit
# finding P0-1). Chosen over NSSM/a Windows Service because it needs no third-party binary
# download/install and is fully reversible with a single Unregister-ScheduledTask call.
#
# Triggers:
#   - At system startup (covers reboot recovery - does not require an interactive login, unlike
#     the pre-existing Startup-folder shortcut this supplements).
#   - Every 2 minutes thereafter, indefinitely (covers crash recovery between reboots).
#
# Runs as SYSTEM so "run whether user is logged on or not" needs no stored password. Idempotent:
# re-running this script updates the existing task in place rather than duplicating it.
#
# Does NOT touch Cloudflared, does NOT change how Start-WarRoom.ps1 itself behaves, does NOT
# require Administrator to inspect afterward (Get-ScheduledTask works unelevated) but DOES require
# Administrator to register (creating a SYSTEM-run task is a privileged operation).

$ErrorActionPreference = 'Stop'

$taskName = 'WarRoomProductionWatchdog'
$repoPath = Split-Path -Parent $PSScriptRoot
$watchdogScript = Join-Path $repoPath '.war-room\Watchdog-WarRoom.ps1'

if (-not (Test-Path -LiteralPath $watchdogScript)) {
  throw "Watchdog script not found at $watchdogScript"
}

$isElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isElevated) {
  throw "Registering a SYSTEM-run Scheduled Task requires an elevated (Administrator) PowerShell session. Re-run this script as Administrator."
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchdogScript`""

$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$repeatingTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration ([TimeSpan]::MaxValue)

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 3) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $action `
  -Trigger @($startupTrigger, $repeatingTrigger) -Principal $principal -Settings $settings `
  -Description 'Restarts War Room production (port 3000) if it is not running. See .war-room\Watchdog-WarRoom.ps1. Never touches Cloudflared or app config.' `
  -Force | Out-Null

Write-Output "Registered scheduled task '$taskName'."
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
