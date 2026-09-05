$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptRoot

# WR-Engineer Phase 5 — local Ollama runtime if already installed.
# Does not start a second War Room process. Does not download or train a model.
$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollamaCmd) {
  $ollamaUp = $false
  try {
    Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 -UseBasicParsing | Out-Null
    $ollamaUp = $true
  } catch {
    $ollamaUp = $false
  }
  if (-not $ollamaUp) {
    Write-Host 'WR-Engineer: starting existing Ollama runtime (no model download).'
    Start-Process -FilePath $ollamaCmd.Source -ArgumentList 'serve' -WindowStyle Hidden
  }
} else {
  Write-Host 'WR-Engineer: Ollama not installed — local engine stays UNAVAILABLE until Commander installs it.'
}

Start-Job { Start-Sleep -Seconds 4; Start-Process 'http://localhost:3000' } | Out-Null

pnpm dev
