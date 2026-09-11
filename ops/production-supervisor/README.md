# Production supervisor — canonical tracked copy

This directory is the reviewed, version-controlled source of truth for the scripts that
implement production crash/reboot supervision (audit finding P0-1 / 2026-09-11 Cloudflare 524).
The **executing** copy lives in `war-room-production\.war-room\` (a git-untracked directory in
both `war-room-os` and `war-room-production` — see each repo's `.gitignore`), because Windows
Task Scheduler and `Start-WarRoom.ps1` both resolve paths relative to that specific checkout,
not this one.

**When you edit one of these scripts, edit both copies** (here, for review/history, and in
`war-room-production\.war-room\`, for actual execution) or copy this version over the production
one after review. There is no automation that syncs them for you.

## Port contract (Nebula Genesis)

| Role | Checkout | Command | Port |
|------|----------|---------|------|
| **Production** | `war-room-production` | `next start --hostname 127.0.0.1 --port 3000` | **3000** (Cloudflare Tunnel origin) |
| **Development** | `war-room-os` | `pnpm dev` → `next dev --port 3001` | **3001** |

**DEV PORT ≠ 3000.** Development must never bind production port 3000 on Nebula Genesis.
A hung `next DEV` on :3000 previously accepted TCP, returned no HTTP, and caused Cloudflare 524
while `Start-WarRoom.ps1` skipped startup because the port looked “active.”

## Health contract

`port open` is **not** healthy. Healthy means:

1. Something listens on `127.0.0.1:3000`
2. An HTTP probe succeeds (`GET /api/health` preferred; `GET /` 307-to-login also counts)
3. Process is production `next start` from `war-room-production` (not `next DEV` / `pnpm DEV` / wrong checkout)

If unhealthy and the listener is an incorrect War Room Node tree (`next DEV`, hung origin, wrong
checkout), `Start-WarRoom.ps1` / `Watchdog-WarRoom.ps1` stop **only that tree**, then start
production. They never touch cloudflared, Ollama, or unrelated Node processes.

## Files

- `Start-WarRoom.ps1` — production entrypoint. HTTP-health gated; clears incorrect War Room
  occupants on :3000; then `next start`.
- `Test-WarRoomHealth.ps1` — read-only probe: `processRunning`, `portListening`,
  `applicationResponding`, `hungOrigin`, `devOccupyingPort`, `ollamaReachable`. `councilReady`
  stays unknown without an authenticated session.
- `Watchdog-WarRoom.ps1` — crash/reboot decision: max 5 restarts per rolling 30 minutes,
  logs to `.war-room\logs\watchdog.log`, clears hung/`next DEV` occupants, invokes
  `Start-WarRoom.ps1` detached.
- `Install-WarRoomWatchdogTask.ps1` — registers the watchdog as a Windows Scheduled Task
  (SYSTEM, AtStartup + every 2 minutes). **Requires elevated Administrator PowerShell.**

## Watchdog registration (Commander / Admin only)

Registration is **not** performed by agents. After supervisor scripts are synced to
`war-room-production\.war-room\`, run once in an **Administrator** PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\markb\Documents\Codex\war-room-production\.war-room\Install-WarRoomWatchdogTask.ps1"
```

Safe to re-run — updates the existing task in place. Inspect without elevation:

```powershell
Get-ScheduledTask -TaskName WarRoomProductionWatchdog | Select-Object TaskName, State
```
