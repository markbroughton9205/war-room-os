param(
  [string]$TaskName = "War Room Commander Node Service",
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [ValidateSet("login", "boot")]
  [string]$StartupMode = "login"
)

$ErrorActionPreference = "Stop"

$pnpm = (Get-Command pnpm -ErrorAction Stop).Source
$runtimeDir = Join-Path $PSScriptRoot ".runtime"
$logsDir = Join-Path $runtimeDir "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$command = "Set-Location '$RepoPath'; `$env:WAR_ROOM_BRIDGE_SERVICE_MODE='1'; `$env:WAR_ROOM_BRIDGE_LAUNCH_MODE='task_scheduler'; `$env:WAR_ROOM_BRIDGE_STARTUP_MODE='$StartupMode'; pnpm bridge:supervise"
$argument = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"$command`""

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
$trigger = if ($StartupMode -eq "boot") {
  New-ScheduledTaskTrigger -AtStartup
} else {
  New-ScheduledTaskTrigger -AtLogOn
}
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Headless War Room Commander Node bridge service. Explicit Commander-installed task; no remote shell, filesystem mutation, deployment, OS automation, or arbitrary localhost forwarding is exposed through the bridge." `
  -Force | Out-Null

Write-Host "Installed '$TaskName' in headless service mode."
Write-Host "Startup mode: $StartupMode"
Write-Host "Runtime directory: $runtimeDir"
Write-Host "Start now: Start-ScheduledTask -TaskName '$TaskName'"
