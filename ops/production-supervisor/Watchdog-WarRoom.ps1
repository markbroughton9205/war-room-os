# Production crash/reboot supervisor (Wave 1 repair, audit finding P0-1).
#
# Registered as a Scheduled Task (see Install-WarRoomWatchdogTask.ps1) with two triggers: at
# system startup, and repeating every 2 minutes thereafter. This script is the thing that actually
# decides whether to (re)start War Room; the task just calls it on a schedule.
#
# Idempotent and safe to run concurrently/redundantly: Start-WarRoom.ps1 itself already checks for
# an existing listener on port 3000 before doing anything, so calling it when War Room is already
# up is a documented no-op (see that script). This script adds:
#   - a real health check (PROCESS_RUNNING, not just "did something answer on the port")
#   - hung-origin / next-dev-on-production-port detection (2026-09-11 Cloudflare 524 incident)
#   - bounded backoff so a persistently-crashing app doesn't spin in a tight restart loop forever
#   - a durable, append-only log of every restart decision and why it was made
#
# Never touches Cloudflared, never modifies environment/config, never installs/downloads anything.

$ErrorActionPreference = 'Stop'

$repoPath = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $repoPath '.war-room\logs'
$watchdogLogPath = Join-Path $logDirectory 'watchdog.log'
$stateLogPath = Join-Path $logDirectory 'watchdog-state.json'
$startScriptPath = Join-Path $repoPath '.war-room\Start-WarRoom.ps1'
$healthScriptPath = Join-Path $repoPath '.war-room\Test-WarRoomHealth.ps1'

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Write-WatchdogLog {
  param([string]$Message)
  Add-Content -LiteralPath $watchdogLogPath -Value "[$(Get-Date -Format o)] $Message"
}

# Bounded backoff: at most 5 restart attempts inside any rolling 30-minute window. This is a crash
# LOOP guard, not a general rate limit - a single restart after a real crash is expected and fine;
# the point is to stop hammering `next start` (and paging whoever reads the log) if it's crashing
# every few seconds for a reason a restart can't fix.
$maxRestartsPerWindow = 5
$windowMinutes = 30

function Get-WatchdogState {
  if (Test-Path -LiteralPath $stateLogPath) {
    try {
      $raw = Get-Content -LiteralPath $stateLogPath -Raw | ConvertFrom-Json
      # windowStartedAt is stored as a plain ISO-8601 string (see Save-WatchdogState) specifically
      # to avoid PowerShell's verbose/lossy default [datetime]->JSON->[datetime] round-trip, which
      # silently failed to parse back here in testing (state always reset to "fresh window" -
      # exactly the failure mode that would defeat the crash-loop guard below without ever
      # surfacing an error, since a broken window reset just looks like "no crashes yet").
      return @{
        restartCount = [int]$raw.restartCount
        windowStartedAt = [datetime]::Parse($raw.windowStartedAt, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
      }
    } catch {
      Write-WatchdogLog "WARN: watchdog-state.json unreadable ($($_.Exception.Message)) - starting a fresh backoff window."
    }
  }
  return @{ restartCount = 0; windowStartedAt = (Get-Date) }
}

function Save-WatchdogState {
  param([hashtable]$State)
  @{ restartCount = $State.restartCount; windowStartedAt = $State.windowStartedAt.ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $stateLogPath
}

function Test-IsWarRoomNodeCommand {
  param([string]$CommandLine)
  if (-not $CommandLine) { return $false }
  return (
    $CommandLine -match '\bnext\s+dev\b' -or
    $CommandLine -match 'pnpm\.mjs run\s+dev' -or
    $CommandLine -match 'next\s+start' -or
    $CommandLine -match 'start-server\.js' -or
    $CommandLine -match '\\.next\\dev\\' -or
    $CommandLine -match 'war-room-os' -or
    $CommandLine -match 'war-room-production'
  )
}

function Stop-PortOccupants {
  param([int]$Port = 3000)
  # Stop ONLY proven War Room node.exe trees on the production port.
  # Never kills unrelated Node apps, cloudflared, or Ollama.
  $pids = @()
  try {
    $lines = netstat -ano | Select-String -Pattern "LISTENING" | Select-String -Pattern ":$Port\s"
    foreach ($line in $lines) {
      $parts = ($line.ToString() -split '\s+') | Where-Object { $_ }
      if ($parts.Count -ge 5) {
        $pidValue = [int]$parts[-1]
        if ($pidValue -gt 0) { $pids += $pidValue }
      }
    }
  } catch { }

  $toStop = New-Object System.Collections.Generic.HashSet[int]
  foreach ($pidValue in ($pids | Select-Object -Unique)) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.Name -ne 'node.exe') {
      Write-WatchdogLog "REFUSING to stop non-War-Room listener pid=$pidValue (name=$($proc.Name))"
      continue
    }
    if (-not (Test-IsWarRoomNodeCommand -CommandLine "$($proc.CommandLine)")) {
      Write-WatchdogLog "REFUSING to stop non-War-Room listener pid=$pidValue"
      continue
    }
    [void]$toStop.Add($pidValue)

    while ($proc -and $proc.ParentProcessId -and $proc.Name -eq 'node.exe') {
      $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)" -ErrorAction SilentlyContinue
      if (-not $parent -or $parent.Name -ne 'node.exe') { break }
      if (-not (Test-IsWarRoomNodeCommand -CommandLine "$($parent.CommandLine)")) { break }
      [void]$toStop.Add([int]$parent.ProcessId)
      $proc = $parent
    }
  }

  foreach ($pidValue in $toStop) {
    try {
      Write-WatchdogLog "STOPPING hung/wrong War Room occupant pid=$pidValue on port $Port"
      Stop-Process -Id $pidValue -Force -ErrorAction Stop
    } catch {
      Write-WatchdogLog "WARN: could not stop pid=$pidValue ($($_.Exception.Message))"
    }
  }
  if ($toStop.Count -gt 0) {
    Start-Sleep -Seconds 2
  }
}

$state = Get-WatchdogState
if (((Get-Date) - $state.windowStartedAt).TotalMinutes -gt $windowMinutes) {
  $state = @{ restartCount = 0; windowStartedAt = (Get-Date) }
}

$health = & powershell -NoProfile -ExecutionPolicy Bypass -File $healthScriptPath | ConvertFrom-Json

# Ollama has its own login-time Startup-folder autostart (a separate, pre-existing shortcut) but
# no crash supervision of its own, and War Room's Next.js process can be "up" while Ollama isn't
# ready yet (each Council request re-probes Ollama fresh, so this is never a permanent hard-fail -
# see lib/native-builder/ollamaClient.ts's probeOllama()). This watchdog does not restart Ollama
# itself (a different app, out of scope for this repair) - it only makes the dependency visible so
# an operator reading this log can tell "War Room is up but Ollama isn't warm yet" apart from
# "War Room itself is down," which a bare port check could not previously distinguish.
if (-not $health.ollamaReachable) {
  Write-WatchdogLog "NOTE: Ollama not reachable right now (War Room process/port otherwise healthy=$($health.processRunning -and $health.portListening -and $health.applicationResponding)). Local Council routing will fall back per COUNCIL_ROUTING_MODE until Ollama comes up on its own Startup entry."
}

$healthy = $health.processRunning -and $health.portListening -and $health.applicationResponding -and (-not $health.devOccupyingPort) -and (-not $health.hungOrigin) -and (-not $health.wrongCheckoutOccupyingPort)

if ($healthy) {
  # Healthy. Reset the backoff window on a confirmed-healthy observation so a single blip a long
  # time ago doesn't count against a currently-stable process, but don't log anything - this task
  # runs every 2 minutes and a "still fine" heartbeat every 2 minutes forever is log noise, not
  # signal. Only restarts and backoff decisions are worth a durable record.
  $state.restartCount = 0
  Save-WatchdogState -State $state
  exit 0
}

if ($state.restartCount -ge $maxRestartsPerWindow) {
  Write-WatchdogLog "BACKOFF: War Room appears down (processRunning=$($health.processRunning) portListening=$($health.portListening) applicationResponding=$($health.applicationResponding) hungOrigin=$($health.hungOrigin) devOccupyingPort=$($health.devOccupyingPort) wrongCheckoutOccupyingPort=$($health.wrongCheckoutOccupyingPort) canonicalProductionCheckout=$($health.canonicalProductionCheckout)) but $($state.restartCount) restarts already attempted in the last $windowMinutes min. Skipping this cycle rather than restart-looping. Manual investigation needed."
  exit 1
}

$state.restartCount += 1
Save-WatchdogState -State $state
Write-WatchdogLog "RESTARTING: War Room unhealthy (processRunning=$($health.processRunning) portListening=$($health.portListening) applicationResponding=$($health.applicationResponding) hungOrigin=$($health.hungOrigin) devOccupyingPort=$($health.devOccupyingPort) wrongCheckoutOccupyingPort=$($health.wrongCheckoutOccupyingPort) canonicalProductionCheckout=$($health.canonicalProductionCheckout)). Attempt $($state.restartCount)/$maxRestartsPerWindow in this $windowMinutes-min window."

if ($health.hungOrigin -or $health.devOccupyingPort -or $health.wrongCheckoutOccupyingPort -or ($health.portListening -and -not $health.processRunning) -or ($health.portListening -and -not $health.applicationResponding)) {
  Stop-PortOccupants -Port 3000
}

try {
  # Start-WarRoom.ps1 blocks for the life of the `next start` process (it's the actual server
  # entrypoint), so run it detached the same way the Startup-folder shortcut does - this watchdog
  # tick must return promptly, not babysit the server process itself.
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $startScriptPath `
    -WindowStyle Hidden
  Write-WatchdogLog "Relaunch invoked (detached). Next watchdog tick will confirm whether it came up."
} catch {
  Write-WatchdogLog "ERROR invoking Start-WarRoom.ps1: $($_.Exception.Message)"
  exit 1
}
