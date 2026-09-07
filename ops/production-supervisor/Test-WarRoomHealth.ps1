# Read-only, non-mutating War Room health probe (Wave 1 repair, audit finding "origin health").
#
# Deliberately distinguishes four separate truths instead of collapsing them into one:
#   PROCESS_RUNNING     - a `next start --port 3000` node.exe process exists
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
# Never restarts anything, never writes elsewhere, never prints secrets.

param(
  [int]$Port = 3000,
  [string]$OllamaBaseUrl = 'http://localhost:11434'
)

$ErrorActionPreference = 'Stop'

function Test-ProcessRunning {
  param([int]$Port)
  try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
    foreach ($p in $procs) {
      if ($p.CommandLine -and $p.CommandLine -match "next start" -and $p.CommandLine -match "--port\s+$Port\b") {
        return $true
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
  # Shells out to curl.exe rather than Invoke-WebRequest: this environment's Invoke-WebRequest
  # throws an internal System.NullReferenceException even on a plain GET, unrelated to redirects.
  # A 307-to-/login is a normal, healthy response from this app (auth gate) and counts as
  # responding; only a transport-level failure (connection refused/reset/timeout) does not.
  try {
    $status = & curl.exe -s -o NUL -w '%{http_code}' --max-time 5 "http://127.0.0.1:$Port/" 2>$null
    $code = [int]($status -as [int])
    if ($code -gt 0) { return @{ ok = $true; status = $code } }
    return @{ ok = $false; status = $null }
  } catch {
    return @{ ok = $false; status = $null }
  }
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

$processRunning = Test-ProcessRunning -Port $Port
$portListening = Test-PortListening -Port $Port
$appResult = Test-ApplicationResponding -Port $Port
$ollamaResult = Test-OllamaReachable -BaseUrl $OllamaBaseUrl

$result = [ordered]@{
  generatedAt = (Get-Date -Format o)
  port = $Port
  processRunning = $processRunning
  portListening = $portListening
  applicationResponding = $appResult.ok
  applicationHttpStatus = $appResult.status
  ollamaReachable = $ollamaResult.ok
  ollamaModelCount = $ollamaResult.modelCount
  councilReady = 'UNKNOWN_REQUIRES_AUTHENTICATED_SESSION'
  note = 'councilReady is intentionally never inferred from portListening/applicationResponding alone - this script has no Commander session and does not weaken auth to get one. Check the Inspector/backend-status route from an authenticated browser for that answer.'
}

$result | ConvertTo-Json
