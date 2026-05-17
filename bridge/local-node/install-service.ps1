param(
  [string]$TaskName = "War Room Commander Node Service",
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [ValidateSet("login", "boot")]
  [string]$StartupMode = "login",
  [string]$BridgeToken = $env:WAR_ROOM_BRIDGE_TOKEN,
  [string]$CloudBaseUrl = $env:WAR_ROOM_CLOUD_BASE_URL
)

$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Run PowerShell as Administrator"
  exit 1
}

$pnpm = (Get-Command pnpm -ErrorAction Stop).Source
$runtimeDir = Join-Path $PSScriptRoot ".runtime"
$logsDir = Join-Path $runtimeDir "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$serviceEnvPath = Join-Path $runtimeDir "service.env"
if ([string]::IsNullOrWhiteSpace($BridgeToken)) {
  $secureToken = Read-Host "WAR_ROOM_BRIDGE_TOKEN" -AsSecureString
  $BridgeToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken))
}
if ([string]::IsNullOrWhiteSpace($CloudBaseUrl)) {
  $CloudBaseUrl = Read-Host "WAR_ROOM_CLOUD_BASE_URL"
}
if ([string]::IsNullOrWhiteSpace($BridgeToken) -or [string]::IsNullOrWhiteSpace($CloudBaseUrl)) {
  throw "WAR_ROOM_BRIDGE_TOKEN and WAR_ROOM_CLOUD_BASE_URL are required."
}

@(
  "# Local Commander Node service environment. Do not commit.",
  "WAR_ROOM_BRIDGE_TOKEN=$BridgeToken",
  "WAR_ROOM_CLOUD_BASE_URL=$CloudBaseUrl"
) | Set-Content -Path $serviceEnvPath -Encoding UTF8

$command = "Set-Location '$RepoPath'; `$env:WAR_ROOM_BRIDGE_SERVICE_MODE='1'; `$env:WAR_ROOM_BRIDGE_LAUNCH_MODE='task_scheduler'; `$env:WAR_ROOM_BRIDGE_STARTUP_MODE='$StartupMode'; & '$pnpm' bridge:supervise"
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

$registeredTask = Get-ScheduledTask -TaskName $TaskName
$taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName

Write-Host "Installed '$TaskName' in headless service mode."
Write-Host "Startup mode: $StartupMode"
Write-Host "Runtime directory: $runtimeDir"
Write-Host "Service environment: $serviceEnvPath"
Write-Host "TaskName: $TaskName"
Write-Host "State: $($registeredTask.State)"
Write-Host "LastRunTime: $($taskInfo.LastRunTime)"
Write-Host "LastTaskResult: $($taskInfo.LastTaskResult)"
Write-Host "WorkingDirectory: $RepoPath"
Write-Host "Action command: powershell.exe $argument"
Write-Host "Start now: Start-ScheduledTask -TaskName '$TaskName'"
