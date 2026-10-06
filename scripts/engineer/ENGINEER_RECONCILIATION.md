# War Room Engineer — Phase 0 Reconciliation

Canonical repository truth as of this activation. No parallel Engineer/Builder/Engineering Core was created.

## 1. Where is the existing Native Builder?

`lib/native-builder/` — execution owner.

| Module | Role |
|---|---|
| `runtime.ts` | Sole repair state machine (inspect → plan → approve → apply → validate → verify) |
| `patchPolicy.ts` / `patchApplier.ts` / `rollback.ts` | Bounded transactional file mutation |
| `validationRunner.ts` / `processRegistry.ts` / `commandOutput.ts` | Allowlisted real spawn + process-tree kill + live output |
| `repositoryInspector.ts` | Contained reads/search |
| `workspaceRegistry.ts` | Phase B “open existing git repo” registry |
| `storage.ts` | `.war-room/native-builder/{issues,repairs}` JSON |
| `repairPlanner.ts` | Deterministic templates + Ollama + hosted coder proposals |
| `commitPreparation.ts` | Commit message/staging **data only** |
| `councilAssist.ts` | Advisory Council — never executes |

API: `app/api/native-builder/**` (older direct surface).

## 2. Where is WR-Engineer?

The Commander-facing name for the **same** native-builder engine, projected through Mission Runtime:

- `lib/mission-runtime/engineeringStrategy.ts` — `SingleAgentEngineeringStrategy` (facade, not a second engine)
- `app/api/mission-runtime/engineering/**`
- UI: `/builder`, `/war-room/engineering`, `/war-room/code-operator` (all reuse `BuilderWorkspace`)

`lib/ascension/engineering-agent/` is a **separate** Ascension Phase 3 bounded-worktree agent. It is not the Builder/Engineer product path and was not extended here.

## 3. Which implementation is canonical?

**Native Builder `runtime.ts` is the only execution owner.** Mission Runtime projects repairs as `RuntimeMission` (`missionId === repairId`). UI never mutates files itself.

## 4. Which portions overlap?

Mission Runtime and Native Builder APIs both drive the same repairs. Overlap is intentional projection, not duplication of persistence or patch application.

## 5. What is abandoned/stale?

- `CODE_OPERATOR_ALLOWED_ROOTS` was hardcoded to a macOS path and exact-match only — unusable on Nebula for arbitrary projects.
- “New Project” / empty-directory open documented as unimplemented.
- `NATIVE_TERMINAL_OPERATION_IDS` listed ops (`test_script`, `dev_server_status`, …) that `validationRunner` only partially implemented.
- `/native-builder` panel is the older direct API client; Engineer UI is Mission Runtime.

## 6. Which UI calls which backend?

| Route | Client | Backend |
|---|---|---|
| `/builder` | `BuilderWorkspace` | `/api/mission-runtime/engineering/**` |
| `/war-room/engineering` | `EngineeringMissionConsole` → `BuilderWorkspace` | same |
| `/war-room/code-operator` | same console | same |
| `/native-builder` | `NativeBuilderPanel` | `/api/native-builder/**` |

Repair Packet panels are **Council advisory** (`/api/council/repair-packet`), not the coding agent.

## 7–10. What is REAL / stubbed / simulated / external-agent?

| Capability (pre-activation) | Truth |
|---|---|
| File read/search | REAL, contained |
| File write | REAL, gated, 5 files / 150 lines / limited extensions; `package.json` denylisted |
| Terminal | REAL but **fixed argv only** (tsc/eslint/build/git diff --check/scripts/run-*.mjs) |
| Process kill | REAL |
| Git status/diff | REAL read-only |
| Git commit/push/deploy | NOT autonomous (invariant). Commit prep is data. |
| Rollback | REAL content snapshots |
| Autonomous loop | Bounded **replan only**; each apply still needed Commander approval |
| New project / empty dir | STUBBED |
| Arbitrary external projects | Registry existed; allowlist + UI not productized |
| Structured agent tools | Missing (proposal → StructuredPatch, not a tool loop) |
| Cursor / Claude Code / Codex | NOT the executor. Optional hosted **proposal** via Council providers. |

## 11. Model adapters

- Deterministic templates (`repairPlanner.ts`)
- Local Ollama (`ollamaClient.ts`)
- Hosted: Claude / ChatGPT / Grok / Gemini via `lib/council/providerDirectCall.ts` (key-gated, honest unavailable)
- Council assist: advisory only

## 12–15. Filesystem / terminal / Git / validation

See tables above. Validation is real `pnpm exec tsc` / eslint / build against **the active repo root** (War Room by default).

## 16. Persistence / memory

Issues + repairs + snapshots under the **active** workspace root. No per-project engineering memory. Command output is in-process only.

## 17. Permission / audit

`assertAutoOrApproval` (`file_modification`, `rollback`, `commit`, `push`, `deploy`). Native-builder transitions audit via `logWarRoomRepoAudit`.

## Activation decision

Extend **this** stack:

1. Broaden `workspaceRegistry` (projects root, new project, non-git dirs, prefix allowlist).
2. Add typed command policy + terminal ops **in** native-builder (no raw shell).
3. Add `bounded_coding` mission mode: Commander start authorizes in-workspace local-dev; still walks `awaiting_local_execution_approval` (state graph unchanged).
4. External workspaces use a looser patch profile; War Room self-repair keeps existing limits.
5. Commander-gated git commit/push as a **separate** module (not a terminal op id). Deploy remains denied.
6. Engineer UI remains Mission Runtime thin client.

WRIM / Ra'el / sparse experts: untouched.
