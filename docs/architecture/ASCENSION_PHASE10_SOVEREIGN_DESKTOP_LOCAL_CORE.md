# #22 Phase 10 — Sovereign Desktop + Local Core Foundation

**Status:** IMPLEMENTED_FOUNDATION  
**Desktop technology:** Electron  
**Local core:** `127.0.0.1:3847`  
**Operational Ascension agents:** 7 (unchanged)  
**Ascension autonomy:** OFF  
**#22:** CLOSED · **#23:** PENDING / NOT_STARTED  
**Inherited #16:** `gate16_prebuild_gate_configured` — **PASS 14/14** (validation accepts prebuild chain that starts with `validate-commander-identity.cjs`, including Cesium asset copy).  

## Architectural truth

```
WEBSITE != WAR ROOM
WAR ROOM CORE = LOCAL / SELF-HOSTED
DESKTOP APP = PRIMARY COMMANDER INTERFACE (foundation)
WEB UI = OPTIONAL ACCESS SURFACE
DOMAIN / CLOUDFLARE = OPTIONAL REMOTE
```

## Why Electron (not Tauri)

| Option | Decision |
| --- | --- |
| Tauri | Smaller footprint, but requires Rust toolchain; prior research ≠ implementation; not available on this host at Phase 10 start |
| Electron | Matches Node/Next stack; Windows support; `contextIsolation` + `sandbox` + hardened preload; future macOS-capable; no Rust gate |

## Modules

- `lib/sovereign-runtime/*` — inventory, boot, health, session, security, local core server, truth
- `desktop/` — Electron main/preload + local renderer assets
- Port **3847** avoids production `:3000` and DEV `:3001`

## Launch (local only)

```bash
# Terminal A — local core
node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types -e "import { startLocalCoreServer } from './lib/sovereign-runtime/localCoreServer.ts'; await startLocalCoreServer({}); console.log('listening')"

# Or proof:
pnpm run validate:sovereign-local-proof

# Desktop (after pnpm install in desktop/):
cd desktop && pnpm install && pnpm start
```

Desktop loads **only** `http://127.0.0.1:3847/` — never `https://warroomos.com`.

## Auth truth

Supabase Commander session still required for privileged #19 APIs.  
Local desktop session is loopback foundation identity — **not** fabricated offline ownership.

## Validation

```bash
pnpm run validate:ascension-phase10
node desktop/scripts/build-check.cjs
```
