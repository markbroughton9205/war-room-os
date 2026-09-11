# Production supervisor — canonical tracked copy (#18)

This directory is the **only** reviewed, version-controlled source of truth for
War Room production crash/reboot supervision (audit finding P0-1 /
2026-09-11 Cloudflare 524). There is **no Supervisor2**, no second health
system, and no second watchdog.

## Canonical chain

```
Windows login Startup shortcut "War Room OS.lnk"
  → powershell -File war-room-production\.war-room\Start-WarRoom.ps1
    → (if needed) next start --hostname 127.0.0.1 --port 3000
      → HTTP truth via GET /api/health (preferred) or GET /

Windows Scheduled Task WarRoomProductionWatchdog  [NOT REGISTERED until Commander authorizes]
  → AtStartup + every 2 minutes
    → war-room-production\.war-room\Watchdog-WarRoom.ps1
      → Test-WarRoomHealth.ps1
        → healthy? no-op
        → unhealthy? bounded recovery (max 5 / 30 min) → Start-WarRoom.ps1 detached
```

## Source vs runtime copies

| Role | Path |
|------|------|
| **Authoritative source** | `war-room-os/ops/production-supervisor/*` (this directory) |
| **Executing runtime copies** | `war-room-production\.war-room\*` |

Runtime copies are **deployment/runtime only**. Never edit them as the source
of truth. Sync is **one-way and intentional**:

```
tracked source (ops/production-supervisor)
  → validated (pnpm run validate:production-supervisor)
  → intentionally copied to war-room-production\.war-room
  → runtime
```

There is **no bidirectional automatic sync**. Use
`ops/production-supervisor/Sync-ProductionSupervisor.ps1` after
Commander authorization (dry-run default; pass `-Apply` to write).

## Port contract (Nebula Genesis) — FROZEN

| Role | Checkout | Command | Port |
|------|----------|---------|------|
| **Production** | `war-room-production` | `next start --hostname 127.0.0.1 --port 3000` | **3000** (Cloudflare Tunnel origin) |
| **Development** | `war-room-os` | `pnpm dev` → `next dev --port 3001` | **3001** |

A development Next process must **never** occupy `:3000`.

## Health semantics

`port open` is **not** healthy.

| State | Meaning | Supervisor action |
|-------|---------|-------------------|
| **APPLICATION_HEALTHY** | HTTP answers (`/api/health` preferred; `/` 307-to-login counts). Production process present. Not DEV / not wrong checkout / not hung. | No restart |
| **DEPENDENCY_DEGRADED** | App HTTP answers; cheap dep probe failed (Supabase auth health and/or Ollama). `/api/health` returns HTTP **200** with `status: "degraded"`. | **Do not** restart web shell |
| **APPLICATION_UNHEALTHY** | No HTTP, hung origin (TCP accept, no HTTP), next DEV on :3000, wrong checkout, or missing production process | Bounded recovery |

`/api/health` is public, middleware-bypassed, bounded (≤400ms/dep), non-secret,
and independent of Council / ASTRA / Terra / Overpass / Research Engine / model
inference. Council may be slow or fail while origin health stays green.

## Process ownership / kill safety

Only `node.exe` processes whose **command line** proves War Room ownership
(`next dev`, `next start`, `start-server.js`, `war-room-os`, `war-room-production`)
may be stopped. Unrelated Node listeners on `:3000` → **refuse**, fail loudly
(`Start-WarRoom.ps1` exit 3). **Never** stop `cloudflared` or `Ollama`.

Wrong-checkout detection: command-line / parent evidence for `next DEV` on
`:3000` or `war-room-os` paths without `war-room-production`.

## Files

- `Start-WarRoom.ps1` — production entrypoint; HTTP-gated; clears incorrect War Room occupants only
- `Test-WarRoomHealth.ps1` — read-only JSON probe (`processRunning`, `portListening`, `applicationResponding`, `hungOrigin`, `devOccupyingPort`, `wrongCheckoutOccupyingPort`, `canonicalProductionCheckout`, `ollamaReachable`; `councilReady` always UNKNOWN without auth)
- `Watchdog-WarRoom.ps1` — max **5** restarts / **30** minutes; ownership-gated kill; never touches cloudflared/Ollama
- `Install-WarRoomWatchdogTask.ps1` — registers `WarRoomProductionWatchdog` (Admin only) — **do not run until authorized**
- `Sync-ProductionSupervisor.ps1` — one-way source → runtime copy helper (dry-run default; pass `-Apply` to write)

## Logging (no secrets)

| Log | Path (under `war-room-production`) |
|-----|-------------------------------------|
| Production start | `.war-room\logs\war-room-production.log` |
| Watchdog decisions | `.war-room\logs\watchdog.log` |
| Restart window state | `.war-room\logs\watchdog-state.json` |

Logs record start/stop, PID, checkout path, port, health flags, wrong-process
refusals, restart reason/count, backoff ceiling, and start failures.

## Startup ownership model

**Current (observed):**

1. Login Startup shortcut `War Room OS.lnk` → `war-room-production\.war-room\Start-WarRoom.ps1` (idempotent)
2. Separate `Ollama.lnk` Startup entry (independent failure domain)
3. Scheduled Task `WarRoomProductionWatchdog` — **prepared, not registered**

**Recommended canonical model:** keep the Startup shortcut for interactive login
start; register the Scheduled Task for AtStartup + crash recovery. Both paths
call the same idempotent `Start-WarRoom.ps1` (healthy production → no-op; only
one production listener survives). Do **not** remove the Startup shortcut until
the task is registered and proven.

## Watchdog registration (Commander / Admin only)

**DO NOT register in agent passes.** After scripts are synced to
`war-room-production\.war-room\`, run once in an **Administrator** PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\markb\Documents\Codex\war-room-production\.war-room\Install-WarRoomWatchdogTask.ps1"
```

Inspect without elevation:

```powershell
Get-ScheduledTask -TaskName WarRoomProductionWatchdog | Select-Object TaskName, State
```

## Validation

```powershell
pnpm run validate:production-supervisor
```

Structural/decision tests only — does not mutate production `:3000`.

## Boundaries (#18 does NOT own)

- Cloudflare Tunnel restart/replacement
- Ollama restart
- Desktop / Tauri
- #19 conversation ownership
- Council / Terra / model provider changes
- Automatic deploy or autonomous updates
