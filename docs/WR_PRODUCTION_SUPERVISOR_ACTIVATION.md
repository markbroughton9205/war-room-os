# #18 Production Supervisor — Controlled Live Activation Plan

**STATUS:** PLAN ONLY — DO NOT EXECUTE without explicit Commander authorization.

Expected downtime for a clean cutover: typically **under 2 minutes** if production
is stopped once and Start-WarRoom restores immediately; watchdog cycle wait up to
**~2 minutes** if relying on the scheduled task alone.

## Preconditions

1. `#18` code validated (`pnpm run validate:production-supervisor`)
2. Clean production build containing public `/api/health` + supervisor scripts
3. Runtime copies synced:
   `ops/production-supervisor/*` → `war-room-production\.war-room\*`
   via `Sync-ProductionSupervisor.ps1 -Apply`
4. Production checkout built and ready on Nebula Genesis
5. Cloudflare Tunnel / Ollama left alone (not restarted by this plan)

## Activation sequence (Commander-authorized)

### 1. Verify current live production
```powershell
netstat -ano | findstr ":3000"
Get-CimInstance Win32_Process -Filter "ProcessId=<PID>" | Select-Object CommandLine
powershell -NoProfile -ExecutionPolicy Bypass -File `
  "C:\Users\markb\Documents\Codex\war-room-production\.war-room\Test-WarRoomHealth.ps1"
```

### 2. Build exact committed #18 candidate (in war-room-os or deploy pipeline)
```powershell
pnpm exec tsc --noEmit
pnpm run build
# record BUILD_ID / .next/build-meta.json
```

### 3–4. Sync application build + supervisor scripts to war-room-production
Use the authorized deploy path for the Next build, then:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  "C:\Users\markb\Documents\Codex\war-room-os\ops\production-supervisor\Sync-ProductionSupervisor.ps1" -Apply
```

### 5. Stop/start production safely (authorized only)
Prefer:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  "C:\Users\markb\Documents\Codex\war-room-production\.war-room\Start-WarRoom.ps1"
```
(Idempotent when healthy; clears only War Room-owned wrong occupants when unhealthy.)

### 6–8. Verify local + public health + login/root
```powershell
curl.exe -s -i --max-time 5 http://127.0.0.1:3000/api/health
# expect HTTP 200 + status ok|degraded (not 401 once new build is live)
# public URL via Cloudflare; confirm origin answers
# open /login or / and confirm app shell
```

### 9. Verify cloudflared untouched
```powershell
Get-Service Cloudflared
Get-Process cloudflared
# BINARY should still be: tunnel run --url http://127.0.0.1:3000 --token-file ...
```

### 10–11. Register watchdog (Administrator) + verify task
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  "C:\Users\markb\Documents\Codex\war-room-production\.war-room\Install-WarRoomWatchdogTask.ps1"
Get-ScheduledTask -TaskName WarRoomProductionWatchdog | Select-Object TaskName, State
```

### 12–14. Intentional terminate → prove watchdog restores → public site returns
Authorized lab only: stop War Room production tree only; wait ≤1 watchdog cycle
(2 min) or run Watchdog once; confirm Start-WarRoom restores; public site OK.

### 15–17. Wrong/hung War Room process simulation
Authorized lab only: prove detection of hung/DEV/wrong-checkout War Room occupant;
only War Room-owned process replaced; cloudflared + Ollama survive.

### 18. Restart ceiling (safe)
Confirm after 5 restarts / 30 min the watchdog logs BACKOFF and stops restarting.

### 19. Inspect logs
`.war-room\logs\war-room-production.log`, `watchdog.log`, `watchdog-state.json`

### 20. Rollback if needed
See Rollback below.

## Explicit non-actions

- Do not reboot the host
- Do not restart cloudflared
- Do not restart Ollama because Council is slow
- Do not register the task from an agent session without Commander order
- Do not kill processes by generic `node.exe` name alone

## Rollback

1. `Unregister-ScheduledTask -TaskName WarRoomProductionWatchdog -Confirm:$false` (Admin)
2. Startup shortcut still starts production via `Start-WarRoom.ps1`
3. Restore prior runtime script hashes from the last known-good sync if needed
4. If app build is bad: redeploy previous known-good production build and Start-WarRoom
