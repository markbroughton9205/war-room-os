# One-way sync: ops/production-supervisor → war-room-production\.war-room
# Runtime copies are NEVER the authoritative source.
# Default is dry-run. Pass -Apply only after Commander authorization.

param(
  [string]$SourceDir = (Split-Path -Parent $PSCommandPath),
  [string]$RuntimeDir = 'C:\Users\markb\Documents\Codex\war-room-production\.war-room',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'

$files = @(
  'Start-WarRoom.ps1',
  'Test-WarRoomHealth.ps1',
  'Watchdog-WarRoom.ps1',
  'Install-WarRoomWatchdogTask.ps1'
)

if (-not (Test-Path -LiteralPath $SourceDir)) {
  throw "Source directory missing: $SourceDir"
}
if (-not (Test-Path -LiteralPath $RuntimeDir)) {
  throw "Runtime directory missing: $RuntimeDir (create/sync only under Commander authorization)"
}

Write-Output "SOURCE=$SourceDir"
Write-Output "RUNTIME=$RuntimeDir"
Write-Output ("MODE={0}" -f ($(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })))

foreach ($name in $files) {
  $src = Join-Path $SourceDir $name
  $dst = Join-Path $RuntimeDir $name
  if (-not (Test-Path -LiteralPath $src)) {
    throw "Missing source file: $src"
  }
  $srcHash = (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash
  $dstHash = if (Test-Path -LiteralPath $dst) { (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash } else { $null }
  $changed = $srcHash -ne $dstHash
  Write-Output ("FILE={0} changed={1} src={2} dst={3}" -f $name, $changed, $srcHash, $dstHash)

  if ($changed) {
    if ($Apply) {
      Copy-Item -LiteralPath $src -Destination $dst -Force
      Write-Output "COPIED $name"
    } else {
      Write-Output "DRY-RUN would copy $name (pass -Apply to write)"
    }
  }
}

if (-not $Apply) {
  Write-Output 'No files written. Re-run with -Apply after Commander authorization.'
}
