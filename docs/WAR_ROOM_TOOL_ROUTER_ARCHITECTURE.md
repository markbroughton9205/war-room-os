# War Room Tool Router Architecture

Date: 2026-08-31  
Status: Phase 1 foundation. Compact dialect is **not** being trained in this mission.

## Separation of dialects

| Layer | Form | Owner |
|---|---|---|
| Model-facing | Compact lines `TOOL=sha256` / `text=hello` | WRIM / capability module |
| Runtime | `{ "tool": "sha256", "arguments": { "text": "hello" } }` | Tool Router |
| Provider | War Room API JSON, gym hash, etc. | Existing handlers |

WRIM must not be required to emit runtime JSON. Recovery-011’s V2 compact form is the model dialect; this router is the missing translation layer.

## Pipeline

```
parse  →  validate  →  normalize  →  execution boundary
```

`routeToolIntent` never sets `executed: true`. Execution is a separate function with modes `dry_run` | `mock` | `bounded_sha256`.

No uncontrolled network. Commander authorization for War Room API tools is unchanged (`requiresAuth` from `TOOL_REGISTRY`).

## ToolIntent

`decision`: `TOOL` | `NO_TOOL`  
plus `tool_id`, `arguments`, `confidence`, `source_model`, `source_module`, `raw_intent`, `validation_status`, parse errors.

Parser: deterministic, no execution, rejects XML `<tool_call>` and JSON objects, does not invent missing fields, bounds raw/arg sizes.

`TOOL=none` / `TOOL=NO_TOOL` → `NO_TOOL` (no runtime request).

## Registry integration

**Do not replace** `lib/tools/toolRegistry.ts`.

`lib/modular-intelligence/toolCatalog.ts` is a **schema view**:

- Every `TOOL_REGISTRY` entry (web, memory, files, research, repo, deployments, build) with compact argument overlays.
- AGI gym bounded `sha256` (existing reversible tool in `lib/agi-gym/engine.ts`).
- Curriculum synthetic `lookup_note` (mock/dry-run only).
- Phase 1 fixtures `echo_int` / `disabled_probe` for schema tests.

Lookup answers: exists, enabled/available, required/optional fields, types, execution provider, capability metadata.

## Validation codes

`VALID` | `INVALID_TOOL` | `MISSING_ARGUMENT` | `INVALID_ARGUMENT` | `UNKNOWN_ARGUMENT` | `UNAVAILABLE` | `SCHEMA_INCOMPATIBLE`

## ToolResult

`tool_id`, `status`, `result`, `error`, `provenance`, `started_at`, `completed_at`, `duration_ms`, `request_id`.

## Observation (not trained)

```
TOOL_RESULT=sha256
status=ok
value=...
```

Bounded `value` length. Defined only; no WRIM training on this format in Phase 1.

## Authoritative code

- Parser: `lib/modular-intelligence/toolIntent.ts` (TS runtime) and `scripts/wrim-modular/tool_intent.py` (WRIM-side). Shared fixtures: `model-lab/manifests/modular-intelligence/tool-intent-fixtures.json`.
- Router: `lib/modular-intelligence/toolRouter.ts`.
