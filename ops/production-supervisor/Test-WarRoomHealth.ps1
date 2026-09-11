# Read-only, non-mutating War Room health probe (Wave 1 repair, audit finding "origin health").
#
# Deliberately distinguishes four separate truths instead of collapsing them into one:
#   PROCESS_RUNNING     - a production Next.js node.exe process exists for this port
#                         (`next start --port N` OR `start-server.js` child of production start;
#                         explicitly NOT `next dev` / `pnpm run dev`)
#   PORT_LISTENING      - something is listening on 127.0.0.1:3000 (TCP accept only)
#   APPLICATION_RESPONDING - an HTTP GET to that port returns a response at all (even a 307
#                            auth redirect counts - it proves Next.js itself is serving, not
#                            that any particular feature works)
#   OLLAMA_REACHABLE    - Ollama's own local API answers, checked directly and independently of
#                         War Room's own auth (this script has no Commander session, so it cannot
#                         ask the app "is Council ready" without weakening auth - it does not try).
#
# A previous audit found production could be silently down with cloudflared still reporting
# healthy because nothing distinguished "TCP port open" from "the app actually works." This
# script exists so nothing that consumes it can make that same category error again.
#
# 2026-09-11 incident extension: port can be LISTENING while HTTP never returns (hung `next
# DEV` occupying :3000). APPLICATION_RESPONDING=false with PORT_LISTENING=true is therefore a
# first-class failure mode, not "healthy enough."
#
# Never restarts anything, never writes elsewhere, never prints secrets.

param(
  [int]$Port = 3000,
  [string]$OllamaBaseUrl = 'http://localhost:11434'
)

$ErrorActionPreference = 'Stop'

function Get-NodeProcessesOnPort {
  param([int]$Port)
  $listeners = @()
  try {
    $lines = netstat -ano | Select-String -Pattern "LISTENING" | Select-String -Pattern ":$Port\s"
    foreach ($line in $lines) {
      $parts = ($line.ToString() -split '\s+') | Where-Object { $_ }
      if ($parts.Count -ge 5) {
        $pidValue = [int]$parts[-1]
        if ($pidValue -gt 0) { $listeners += $pidValue }
      }
    }
  } catch {
    return @()
  }
  return ($listeners | Select-Object -Unique)
}

function Test-ProcessRunning {
  param([int]$Port)
  try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
    $portPids = Get-NodeProcessesOnPort -Port $Port
    foreach ($p in $procs) {
      if (-not $p.CommandLine) { continue }
      $cmd = $p.CommandLine
      $isDev = ($cmd -match '\bnext\s+dev\b') -or ($cmd -match 'pnpm\.mjs run\s+dev') -or ($cmd -match '\\.next\\dev\\')
      if ($isDev) { continue }
      $isProdStart = ($cmd -match 'next\s+start') -and ($cmd -match "--port\s+$Port\b")
      $isStartServer = ($cmd -match 'start-server\.js') -and ($portPids -contains [int]$p.ProcessId)
      if ($isProdStart -or $isStartServer) {
        # Reject start-server.js whose parent is next DEV (incident 2026-09-11).
        if ($isStartServer -and $p.ParentProcessId) {
          $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
          if ($parent -and $parent.CommandLine -and ($parent.CommandLine -match '\bnext\s+dev\b')) {
            continue
          }
        }
        return $true
      }
    }
    return $false
  } catch {
    return $false
  }
}

function Test-DevOccupyingPort {
  param([int]$Port)
  try {
    $portPids = Get-NodeProcessesOnPort -Port $Port
    if ($portPids.Count -eq 0) { return $false }
    foreach ($pidValue in $portPids) {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue
      if (-not $p) { continue }
      $cmd = "$($p.CommandLine)"
      if ($cmd -match '\bnext\s+dev\b' -or $cmd -match '\\.next\\dev\\') { return $true }
      if ($p.ParentProcessId) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
        if ($parent -and $parent.CommandLine -and ($parent.CommandLine -match '\bnext\s+dev\b')) {
          return $true
        }
      }
    }
    return $false
  } catch {
    return $false
  }
}

function Test-PortListening {
  param([int]$Port)
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $connection = $client.ConnectAsync('127.0.0.1', $Port)
    return ($connection.Wait(500) -and $client.Connected)
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Test-ApplicationResponding {
  param([int]$Port)
  # Prefer GET /api/health (public, sub-second). Fall back to GET / (307-to-/login is healthy).
  # Shells out to curl.exe rather than Invoke-WebRequest (known NRE in this environment).
  foreach ($path in @('/api/health', '/')) {
    try {
      $status = & curl.exe -s -o NUL -w '%{http_code}' --max-time 5 "http://127.0.0.1:$Port$path" 2>$null
      $code = [int]($status -as [int])
      if ($code -ge 200 -and $code -lt 500) { return @{ ok = $true; status = $code; path = $path } }
    } catch { }
  }
  return @{ ok = $false; status = $null; path = $null }
}

function Test-OllamaReachable {
  param([string]$BaseUrl)
  try {
    $body = & curl.exe -s --max-time 5 "$BaseUrl/api/tags" 2>$null
    if (-not $body) { return @{ ok = $false; modelCount = 0 } }
    $parsed = $body | ConvertFrom-Json -ErrorAction Stop
    $models = @($parsed.models | ForEach-Object { $_.name })
    return @{ ok = $true; modelCount = $models.Count }
  } catch {
    return @{ ok = $false; modelCount = 0 }
  }
}

function Test-WrongCheckoutOccupyingPort {
  param([int]$Port)
  # Detect next start / start-server whose command line points at war-room-os (dev checkout)
  # while bound to the production port. Also treats next DEV as wrong for :3000.
  try {
    $portPids = Get-NodeProcessesOnPort -Port $Port
    if ($portPids.Count -eq 0) { return $false }
    foreach ($pidValue in $portPids) {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue
      if (-not $p) { continue }
      $cmd = "$($p.CommandLine)"
      if ($cmd -match '\bnext\s+dev\b' -or $cmd -match '\\.next\\dev\\') { return $true }
      if ($cmd -match 'war-room-os' -and $cmd -notmatch 'war-room-production') { return $true }
      if ($p.ParentProcessId) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
        if ($parent -and $parent.CommandLine) {
          $pcmd = "$($parent.CommandLine)"
          if ($pcmd -match '\bnext\s+dev\b') { return $true }
          if ($pcmd -match 'war-room-os' -and $pcmd -notmatch 'war-room-production') { return $true }
        }
      }
    }
    return $false
  } catch {
    return $false
  }
}

function Test-CanonicalProductionCheckoutPresent {
  param([int]$Port)
  try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
    $portPids = Get-NodeProcessesOnPort -Port $Port
    foreach ($p in $procs) {
      if (-not $p.CommandLine) { continue }
      $cmd = $p.CommandLine
      $isDev = ($cmd -match '\bnext\s+dev\b') -or ($cmd -match 'pnpm\.mjs run\s+dev') -or ($cmd -match '\\.next\\dev\\')
      if ($isDev) { continue }
      $isProdStart = ($cmd -match 'next\s+start') -and ($cmd -match "--port\s+$Port\b")
      $isStartServer = ($cmd -match 'start-server\.js') -and ($portPids -contains [int]$p.ProcessId)
      if (-not ($isProdStart -or $isStartServer)) { continue }
      if ($cmd -match 'war-room-production') { return $true }
      if ($isStartServer -and $p.ParentProcessId) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
        if ($parent -and $parent.CommandLine -and ($parent.CommandLine -match 'war-room-production')) {
          return $true
        }
      }
    }
    return $false
  } catch {
    return $false
  }
}

$processRunning = Test-ProcessRunning -Port $Port
$portListening = Test-PortListening -Port $Port
$appResult = Test-ApplicationResponding -Port $Port
$ollamaResult = Test-OllamaReachable -BaseUrl $OllamaBaseUrl
$devOccupyingPort = Test-DevOccupyingPort -Port $Port
$wrongCheckoutOccupyingPort = Test-WrongCheckoutOccupyingPort -Port $Port
$canonicalProductionCheckout = Test-CanonicalProductionCheckoutPresent -Port $Port
$hungOrigin = $portListening -and (-not $appResult.ok)

$result = [ordered]@{
  generatedAt = (Get-Date -Format o)
  port = $Port
  processRunning = $processRunning
  portListening = $portListening
  applicationResponding = $appResult.ok
  applicationHttpStatus = $appResult.status
  hungOrigin = $hungOrigin
  devOccupyingPort = $devOccupyingPort
  wrongCheckoutOccupyingPort = $wrongCheckoutOccupyingPort
  canonicalProductionCheckout = $canonicalProductionCheckout
  ollamaReachable = $ollamaResult.ok
  ollamaModelCount = $ollamaResult.modelCount
  councilReady = 'UNKNOWN_REQUIRES_AUTHENTICATED_SESSION'
  note = 'councilReady is intentionally never inferred from portListening/applicationResponding alone - this script has no Commander session and does not weaken auth to get one. Check the Inspector/backend-status route from an authenticated browser for that answer. hungOrigin=true means TCP accepts but HTTP never returns (Cloudflare 524 class). wrongCheckoutOccupyingPort=true means war-room-os or next DEV owns the production port. Ollama unreachable is DEPENDENCY_DEGRADED only - it does not make the web shell unhealthy.'
}

$result | ConvertTo-Json
