# Ascension Phase 11B — Complete Local Model Path

**Roadmap:** #22 CLOSED · **#23:** PENDING / NOT_STARTED  
**Phase:** 11B COMPLETE (local commit only; no push / deploy)

## Architecture

```
Electron (desktop)
  → local War Room UI (Next :3848)
  → War Room Core APIs
       ├── Local core control plane :3847  /api/local/models/*
       └── Next API /api/sovereign/local-model/*
  → Canonical Local Model Router (`sovereign-local-model-router-v1`)
  → Local provider adapter
  → Ollama (loopback)
```

**Single router:** `lib/sovereign-runtime/local-model/`  
No `LocalModelRouter2`, `DesktopModelRouter`, or `CouncilLocal2`.

Renderer / preload never call Ollama directly.

## Reused modules

| Module | Role |
|---|---|
| `lib/native-builder/ollamaClient.ts` | Probe + streaming `/api/generate` |
| `lib/council/live-orchestration/backends/localBackend.ts` | `safeOllamaBaseUrl` |
| `lib/council/live-orchestration/backends/localModelRegistry.ts` | Genesis / seat registry |
| `lib/sovereign-runtime/session.ts` | Owner-scope deny |
| `lib/sovereign-runtime/endpointGuard` (new) | Loopback allow / SSRF deny |

## Provider truth

| Provider | Status |
|---|---|
| OLLAMA | IMPLEMENTED |
| LM_STUDIO | **NOT_IMPLEMENTED** (no adapter found; do not overclaim) |
| LOCAL_OPENAI_COMPATIBLE | NOT_IMPLEMENTED as separate path |

## Runtime states

`READY` · `AVAILABLE` · `UNAVAILABLE` · `NOT_RUNNING` · `NOT_CONFIGURED` · `MODEL_NOT_INSTALLED` · `ENDPOINT_UNREACHABLE` · `DEGRADED` · `TIMEOUT` · `ERROR`

**CONFIGURED ≠ AVAILABLE** · **MODEL_LISTED ≠ SUCCESSFUL_INFERENCE**

## Intelligence class

Local Qwen/Ollama = `THIRD_PARTY_MODEL_RUNNING_LOCALLY`  
≠ WRIM · ≠ Ra'el · #23 remains NOT STARTED

## Council

When Ollama + Genesis model healthy: `DEGRADED_LOCAL` (not full multi-provider Council).  
Shared physical weight across seats reported as `SHARED_PHYSICAL_MODEL`.

## Boundaries

- LOCAL MODEL ≠ LOCAL ADMIN ≠ COMMANDER ≠ APPROVAL  
- No auto pull / rm / restart / train / fine-tune  
- No warroomos.com / Cloudflare / public DNS required  
- Nebula-local first; non-loopback endpoints denied by default  
- Offline ownership remains **NOT_IMPLEMENTED**

## Validation

```bash
pnpm run validate:ascension-phase11b
pnpm run validate:ascension-phase11b:live   # only if Ollama + model installed
```

## APIs

- `GET  /api/local/models/status` (local core, loopback)
- `POST /api/local/models/infer` (local core, loopback)
- `GET  /api/sovereign/local-model/status` (Next, Commander session)
- `POST /api/sovereign/local-model/infer` (Next, Commander session)
