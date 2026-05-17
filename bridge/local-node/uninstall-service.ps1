param(
  [string]$TaskName = "War Room Commander Node Service"
)

$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $task) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Uninstalled '$TaskName'."
} else {
  Write-Host "Scheduled task '$TaskName' was not installed."
}

Write-Host "Runtime logs and history under bridge/local-node/.runtime were preserved for troubleshooting."
