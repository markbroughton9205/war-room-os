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
