# Canonical production start for War Room on Nebula Genesis.
# Executing copy lives in war-room-production\.war-room\Start-WarRoom.ps1 — keep both in sync.
#
# 2026-09-11 Cloudflare 524 class:
#   TCP port open ≠ healthy. Hung `next DEV` / wrong checkout can accept connections forever
#   without returning HTTP. Verify HTTP health; clear only incorrect War Room occupants on :3000;
#   then start production `next start` from this checkout (war-room-production).

$ErrorActionPreference = 'Stop'

$repoPath = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$nodePath = 'C:\Program Files\nodejs\node.exe'
$nextPath = Join-Path $repoPath 'node_modules\next\dist\bin\next'
$envPath = Join-Path $repoPath '.env.local'
$buildIdPath = Join-Path $repoPath '.next\BUILD_ID'
$logDirectory = Join-Path $repoPath '.war-room\logs'
$logPath = Join-Path $logDirectory 'war-room-production.log'
$healthScriptPath = Join-Path $repoPath '.war-room\Test-WarRoomHealth.ps1'
$productionPort = 3000

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

foreach ($requiredPath in @($nodePath, $nextPath, $envPath, $buildIdPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "War Room startup is missing required file: $requiredPath"
  }
}

function Write-StartLog {
  param([string]$Message)
  Add-Content -LiteralPath $logPath -Value "[$(Get-Date -Format o)] $Message"
}

function Test-PortOpen {
  param([int]$Port)
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $connection = $client.ConnectAsync('127.0.0.1', $Port)
    return ($connection.Wait(300) -and $client.Connected)
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Test-HttpResponding {
  param([int]$Port)
  # Prefer /api/health when present (public, sub-second). Fall back to / which may 307 to login.
  foreach ($path in @('/api/health', '/')) {
    try {
      $status = & curl.exe -s -o NUL -w '%{http_code}' --max-time 5 "http://127.0.0.1:$Port$path" 2>$null
      $code = [int]($status -as [int])
      if ($code -ge 200 -and $code -lt 500) { return $true }
      # 401 on /api/health means an old build without the public health route — still proves HTTP works.
      if ($path -eq '/api/health' -and $code -eq 401) { return $true }
    } catch { }
  }
  return $false
}

function Get-ListenerPids {
  param([int]$Port)
  $pids = @()
  try {
    $lines = netstat -ano | Select-String -Pattern 'LISTENING' | Select-String -Pattern ":$Port\s"
    foreach ($line in $lines) {
      $parts = ($line.ToString() -split '\s+') | Where-Object { $_ }
      if ($parts.Count -ge 5) {
        $procId = [int]$parts[-1]
        if ($procId -gt 0) { $pids += $procId }
      }
    }
  } catch { }
  return @($pids | Select-Object -Unique)
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

function Stop-IncorrectWarRoomOccupants {
  param([int]$Port)
  # Stop ONLY node.exe War Room trees bound to the production port (or their next/pnpm parents).
  # Never touches cloudflared, ollama, Cursor, or unrelated Node tools.
  $listenerPids = Get-ListenerPids -Port $Port
  $toStop = New-Object 'System.Collections.Generic.HashSet[int]'

  foreach ($procId in $listenerPids) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.Name -ne 'node.exe') { continue }
    if (-not (Test-IsWarRoomNodeCommand -CommandLine "$($proc.CommandLine)")) {
      Write-StartLog "REFUSING to stop non-War-Room listener pid=$procId"
      continue
    }
    [void]$toStop.Add([int]$procId)

    $walk = $proc
    while ($walk -and $walk.ParentProcessId) {
      $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($walk.ParentProcessId)" -ErrorAction SilentlyContinue
      if (-not $parent -or $parent.Name -ne 'node.exe') { break }
      if (-not (Test-IsWarRoomNodeCommand -CommandLine "$($parent.CommandLine)")) { break }
      [void]$toStop.Add([int]$parent.ProcessId)
      $walk = $parent
    }
  }

  foreach ($procId in $toStop) {
    try {
      Write-StartLog "STOPPING incorrect War Room occupant pid=$procId on port $Port"
      Stop-Process -Id $procId -Force -ErrorAction Stop
    } catch {
      Write-StartLog "WARN: could not stop pid=$procId ($($_.Exception.Message))"
    }
  }

  if ($toStop.Count -gt 0) {
    Start-Sleep -Seconds 2
  }
}

function Get-HealthSnapshot {
  if (-not (Test-Path -LiteralPath $healthScriptPath)) { return $null }
  try {
    return & powershell -NoProfile -ExecutionPolicy Bypass -File $healthScriptPath | ConvertFrom-Json
  } catch {
    Write-StartLog "WARN: health script failed ($($_.Exception.Message))"
    return $null
  }
}

function Test-HealthyProduction {
  param($Health)
  if (-not (Test-HttpResponding -Port $productionPort)) { return $false }
  if ($null -eq $Health) {
    # HTTP answers but no health script — treat as healthy enough to skip (avoid false restarts).
    return $true
  }
  return (
    [bool]$Health.processRunning -and
    [bool]$Health.applicationResponding -and
    -not [bool]$Health.devOccupyingPort -and
    -not [bool]$Health.hungOrigin -and
    -not [bool]$Health.wrongCheckoutOccupyingPort
  )
}

$portOpen = Test-PortOpen -Port $productionPort

if ($portOpen) {
  $health = Get-HealthSnapshot
  if (Test-HealthyProduction -Health $health) {
    Write-StartLog "Port $productionPort healthy production process; startup skipped."
    exit 0
  }

  Write-StartLog ("Port $productionPort occupied but unhealthy " +
    "(devOccupyingPort=$($health.devOccupyingPort) wrongCheckoutOccupyingPort=$($health.wrongCheckoutOccupyingPort) " +
    "hungOrigin=$($health.hungOrigin) processRunning=$($health.processRunning) " +
    "applicationResponding=$($health.applicationResponding) " +
    "httpResponding=$(Test-HttpResponding -Port $productionPort)). Clearing incorrect War Room occupants.")
  Stop-IncorrectWarRoomOccupants -Port $productionPort

  if (Test-PortOpen -Port $productionPort) {
    $healthAfter = Get-HealthSnapshot
    if (Test-HealthyProduction -Health $healthAfter) {
      Write-StartLog "Port $productionPort became healthy after clear; startup skipped."
      exit 0
    }
    Write-StartLog ("Port $productionPort still occupied after War Room occupant clear " +
      "(likely unrelated process). Refusing to bind. Manual investigation required.")
    exit 3
  }
}

Set-Location -LiteralPath $repoPath
$env:NODE_ENV = 'production'
Write-StartLog "Starting War Room on 127.0.0.1:$productionPort (next start) from $repoPath."
& $nodePath $nextPath start --hostname 127.0.0.1 --port $productionPort *>> $logPath
$exitCode = $LASTEXITCODE
Write-StartLog "War Room stopped with exit code $exitCode."
exit $exitCode
