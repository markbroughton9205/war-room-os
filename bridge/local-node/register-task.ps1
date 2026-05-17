param(
  [string]$TaskName = "War Room Commander Node Bridge",
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [switch]$Hidden
)

$ErrorActionPreference = "Stop"

$pnpm = (Get-Command pnpm -ErrorAction Stop).Source
$windowStyle = if ($Hidden) { "-WindowStyle Hidden" } else { "-NoExit" }
$argument = "$windowStyle -ExecutionPolicy Bypass -NoProfile -Command `"Set-Location '$RepoPath'; `$env:WAR_ROOM_BRIDGE_LAUNCH_MODE='task_scheduler'; pnpm bridge:supervise`""

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Starts the War Room Commander Node bridge supervisor at user login. No shell, filesystem, deployment, or OS automation is exposed through the bridge." `
  -Force

Write-Host "Registered scheduled task '$TaskName'. It will start at user login."
Write-Host "Run manually with: Start-ScheduledTask -TaskName '$TaskName'"
