$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptRoot

Start-Job { Start-Sleep -Seconds 4; Start-Process 'http://localhost:3000' } | Out-Null

pnpm dev
