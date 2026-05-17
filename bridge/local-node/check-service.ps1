param(
  [string]$TaskName = "War Room Commander Node Service"
)

$ErrorActionPreference = "Stop"

$runtimeDir = Join-Path $PSScriptRoot ".runtime"
$pidPath = Join-Path $runtimeDir "bridge.pid"
$serviceEnvPath = Join-Path $runtimeDir "service.env"
$supervisorLog = Join-Path $runtimeDir "supervisor.log"
$serviceLog = Join-Path $runtimeDir "service.log"
$heartbeatStatePath = Join-Path $runtimeDir "heartbeat-state.json"
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
$pnpmPath = (Get-Command pnpm -ErrorAction SilentlyContinue).Source
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$taskInfo = if ($null -ne $task) { Get-ScheduledTaskInfo -TaskName $TaskName } else { $null }

$runtimePid = $null
$runtimePidRunning = $false
if (Test-Path $pidPath) {
  $runtimePid = [int](Get-Content $pidPath -Raw).Trim()
  $runtimePidRunning = $null -ne (Get-Process -Id $runtimePid -ErrorAction SilentlyContinue)
}

$lastHeartbeat = "not recorded"
if (Test-Path $heartbeatStatePath) {
  try {
    $heartbeat = Get-Content $heartbeatStatePath -Raw | ConvertFrom-Json
    $lastHeartbeat = $heartbeat.lastHeartbeatAt
  } catch {
    $lastHeartbeat = "unreadable"
  }
}

Write-Host "TaskExists: $($null -ne $task)"
Write-Host "TaskName: $TaskName"
Write-Host "TaskState: $(if ($task) { $task.State } else { 'missing' })"
Write-Host "LastResultCode: $(if ($taskInfo) { $taskInfo.LastTaskResult } else { 'n/a' })"
Write-Host "LastRunTime: $(if ($taskInfo) { $taskInfo.LastRunTime } else { 'n/a' })"
Write-Host "RuntimePid: $(if ($runtimePid) { $runtimePid } else { 'n/a' })"
Write-Host "RuntimePidRunning: $runtimePidRunning"
Write-Host "ServiceEnvPresent: $(Test-Path $serviceEnvPath)"
Write-Host "NodePath: $(if ($nodePath) { $nodePath } else { 'not found' })"
Write-Host "PnpmPath: $(if ($pnpmPath) { $pnpmPath } else { 'not found' })"
Write-Host "LastHeartbeatTimestamp: $lastHeartbeat"
Write-Host "SupervisorLog: $supervisorLog"
if (Test-Path $supervisorLog) {
  Get-Content $supervisorLog -Tail 20
} else {
  Write-Host "No supervisor log yet."
}
Write-Host "ServiceLog: $serviceLog"
if (Test-Path $serviceLog) {
  Get-Content $serviceLog -Tail 20
} else {
  Write-Host "No service log yet."
}
