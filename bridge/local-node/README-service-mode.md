# Headless Commander Service Mode

Service mode runs Commander Node in the background through Windows Task Scheduler. It is an explicit Commander-installed scheduled task; War Room never installs it automatically.

## Install

Run from an elevated PowerShell. The installer stops immediately with `Run PowerShell as Administrator` if it is not elevated.

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\local-node\install-service.ps1
```

The installer writes `bridge/local-node/.runtime/service.env` using `WAR_ROOM_BRIDGE_TOKEN` and `WAR_ROOM_CLOUD_BASE_URL` from the current environment or prompts for them. This file is local runtime state and is ignored by git.

Boot startup is also available:

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\local-node\install-service.ps1 -StartupMode boot
```

Start immediately after install:

```powershell
Start-ScheduledTask -TaskName "War Room Commander Node Service"
```

## Verify

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\local-node\check-service.ps1
```

The diagnostic report includes task state, last result, runtime PID, recent logs, service.env presence, Node path, pnpm path, and last heartbeat timestamp.

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\local-node\uninstall-service.ps1
```

Uninstalling preserves `.runtime` logs and history for troubleshooting.

## Runtime Files

All local runtime writes are scoped to `bridge/local-node/.runtime`:

- `bridge.pid`: supervisor lock file for single-instance protection.
- `service.env`: local service environment containing `WAR_ROOM_BRIDGE_TOKEN` and `WAR_ROOM_CLOUD_BASE_URL`.
- `supervisor.log`: rolling supervisor log.
- `service.log`: bridge process output.
- `logs/commander-bridge.log`: legacy bridge output mirror.
- `crash-history.jsonl`: crash and restart records.
- `reconnect-history.jsonl`: reconnect/restart backoff records.
- `heartbeat-state.json`: last successful heartbeat timestamp and provider state.

## Recovery Behavior

The supervisor starts `server.mjs` hidden, restarts it after crashes, and applies exponential backoff up to 60 seconds. The bridge itself reports reconnect count, heartbeat latency, memory usage, active provider/model, service mode, PID, and log path through authenticated heartbeats.

If a stale `bridge.pid` remains after a hard shutdown, the supervisor verifies whether the PID is still running. It reuses the lock only when the old process is gone.

## Troubleshooting

- Check `bridge/local-node/.runtime/logs/commander-bridge.log`.
- Check `bridge/local-node/.runtime/supervisor.log`.
- Check `bridge/local-node/.runtime/service.log`.
- Confirm `bridge/local-node/.runtime/service.env` exists and contains `WAR_ROOM_BRIDGE_TOKEN` and `WAR_ROOM_CLOUD_BASE_URL`.
- If the task will not start, run `pnpm bridge:supervise` manually from the repo to verify environment variables.

## Boundaries

Service mode does not expose shell execution, arbitrary command execution, deployment control, OS automation, arbitrary localhost forwarding, or bridge-driven filesystem mutation. The only local writes are runtime lock, logs, and history files under `.runtime`.
