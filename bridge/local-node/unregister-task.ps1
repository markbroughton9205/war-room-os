param(
  [string]$TaskName = "War Room Commander Node Bridge"
)

$ErrorActionPreference = "Stop"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Unregistered scheduled task '$TaskName'."
