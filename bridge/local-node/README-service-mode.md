# Headless Commander Service Mode

Service mode runs Commander Node in the background through Windows Task Scheduler. It is an explicit Commander-installed scheduled task; War Room never installs it automatically.

## Install

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\local-node\install-service.ps1
```

Boot startup is also available:

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\local-node\install-service.ps1 -StartupMode boot
```

Start immediately after install:

```powershell
Start-ScheduledTask -TaskName "War Room Commander Node Service"
```

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\local-node\uninstall-service.ps1
```

Uninstalling preserves `.runtime` logs and history for troubleshooting.

## Runtime Files

All local runtime writes are scoped to `bridge/local-node/.runtime`:

- `bridge.pid`: supervisor lock file for single-instance protection.
- `logs/commander-bridge.log`: rolling supervisor and bridge output.
- `crash-history.jsonl`: crash and restart records.
- `reconnect-history.jsonl`: reconnect/restart backoff records.

## Recovery Behavior

The supervisor starts `server.mjs` hidden, restarts it after crashes, and applies exponential backoff up to 60 seconds. The bridge itself reports reconnect count, heartbeat latency, memory usage, active provider/model, service mode, PID, and log path through authenticated heartbeats.

If a stale `bridge.pid` remains after a hard shutdown, the supervisor verifies whether the PID is still running. It reuses the lock only when the old process is gone.

## Troubleshooting

- Check `bridge/local-node/.runtime/logs/commander-bridge.log`.
- Confirm `WAR_ROOM_BRIDGE_TOKEN` exists in the scheduled task environment.
- Confirm `WAR_ROOM_CLOUD_BASE_URL` points to the official War Room deployment or local dev server.
- If the task will not start, run `pnpm bridge:supervise` manually from the repo to verify environment variables.

## Boundaries

Service mode does not expose shell execution, arbitrary command execution, deployment control, OS automation, arbitrary localhost forwarding, or bridge-driven filesystem mutation. The only local writes are runtime lock, logs, and history files under `.runtime`.
