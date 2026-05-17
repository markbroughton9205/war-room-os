# Secure Local Bridge Connector

Commander Node runs locally and initiates outbound requests to the War Room cloud app. The cloud app never directly connects to localhost.

## Startup

Set the shared token in both the Vercel environment and the local shell:

```powershell
$env:WAR_ROOM_BRIDGE_TOKEN="replace-with-a-long-random-token"
$env:WAR_ROOM_CLOUD_BASE_URL="https://your-war-room.vercel.app"
pnpm bridge:start
```

For local development, keep `WAR_ROOM_CLOUD_BASE_URL` unset or set it to `http://localhost:3000`.

For a managed local runtime with crash restart:

```powershell
pnpm bridge:supervise
```

The supervisor starts `server.mjs`, restarts it after crashes with exponential backoff, and reports restart metadata through the normal authenticated heartbeat. It does not expose shell execution or any new remote control path.

## Optional Windows Startup

Task Scheduler registration is explicit. Review the command first, then run it yourself:

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\local-node\register-task.ps1
```

To launch hidden/background at user login:

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\local-node\register-task.ps1 -Hidden
```

To remove the task:

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\local-node\unregister-task.ps1
```

The registration script only creates a user-login scheduled task that runs `pnpm bridge:supervise` from this repository. It is never run automatically by War Room.

## Headless Service Mode

For persistent background execution independent from visible terminals, use the service-mode installer:

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\local-node\install-service.ps1
```

Run the installer from PowerShell as Administrator. It writes `bridge/local-node/.runtime/service.env` locally so Task Scheduler does not depend on inherited shell environment variables.

Verify service state with:

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\local-node\check-service.ps1
```

Uninstall with:

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\local-node\uninstall-service.ps1
```

See `bridge/local-node/README-service-mode.md` for service-mode startup, recovery, logs, and troubleshooting details.

Optional provider configuration:

```powershell
$env:WAR_ROOM_BRIDGE_NODE_ID="commander-node"
$env:WAR_ROOM_BRIDGE_NODE_NAME="Commander Node"
$env:WAR_ROOM_BRIDGE_NODE_TYPE="commander_laptop"
$env:WAR_ROOM_BRIDGE_TRUST_LEVEL="engineering"
$env:LM_STUDIO_BASE_URL="http://127.0.0.1:1234/v1"
$env:LM_STUDIO_MODEL="loaded-model-id"
$env:OLLAMA_BASE_URL="http://127.0.0.1:11434"
```

Additional future node presets are `engineering_node`, `observer_node`, and `future_gpu_node`. Trust levels are `observer`, `inference`, `engineering`, and `restricted`.

## Boundaries

The local node only detects approved local AI providers, sends heartbeats, polls for bounded inference requests, and returns model/latency/diagnostic results. It does not expose shell execution, arbitrary commands, arbitrary localhost forwarding, filesystem writes, deployment control, or OS automation.

The worker retries failed heartbeat and poll calls with exponential backoff up to 60 seconds. The cloud marks nodes stale after the configured timeout instead of showing fake active state.

Runtime telemetry sent to `/api/bridge/runtime` includes uptime, reconnect count, heartbeat latency, provider status, memory usage, active model, node health, provider switches, and supervisor restart metadata. Bridge tokens and local provider API keys are never sent.
