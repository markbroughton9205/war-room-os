# #21 — WAR ROOM AGENT CAPABILITY MATRIX REPORT

**Status:** EVALUATION COMPLETE (governance definitions + validation checked in)
**Authorization:** Commander #20 CLOSED → #21 AUTHORIZED
**Commit baseline:** #20 closeout `ac8a16c4df7a48ea737cca35fc70dc2952d2d48f` · production release `2f1461a5c60cca52d3dc235c66f06b4c0750a6a2`
**Constraints honored:** No new powers granted · No #22 implementation · No push · No deploy · No production authority change

**Core principle:** `CAPABILITY != AUTHORITY` — every capability has separate **TECHNICAL REACH** and **POLICY AUTHORITY**.

**Canonical code:** `lib/agent-capability-matrix/`
**Validate:** `node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/agent-capability-matrix/validation.ts`
(also registered as `pnpm run validate:agent-capability-matrix` — if pnpm deps-status fails on `ERR_PNPM_IGNORED_BUILDS`, use the node command; **63/63 PASS** on #21 closeout)

---

## Architecture (governance target)

```
COMMANDER
    ↓
WAR ROOM
    ↓
TERRA — THE ORACLE / WORLD-STATE INTELLIGENCE   → WHAT IS HAPPENING? WHERE? WHEN? SOURCE? FRESHNESS? CONFIDENCE? PROVENANCE? WORLD CONTEXT?
    ↓
COUNCIL — REASONING / DELIBERATION              → WHAT DOES IT MEAN?
    ↓
ASTRA — EXECUTIVE ORCHESTRATION                 → WHAT SHOULD WE DO?
    ↓
ASCENSION AGENTS — SPECIALIZED EXECUTION        → WHAT AM I AUTHORIZED TO DO?  (#22 TARGET — NOT STARTED)
    ↓
TOOLS / SYSTEMS / EXTERNAL WORLD
```

**Runtime honesty:** Live control is forked under Commander session (`Terra ∥ Council ∥ Tools`; ASTRA beside Council), not a single linear pipe. The chain above is the evaluation architecture to preserve.

---

## 1. Current actor inventory

See `lib/agent-capability-matrix/actors.ts` (`ACTOR_INVENTORY`).

| ID | Name | Class | Status |
|---|---|---|---|
| commander | COMMANDER | HUMAN | IMPLEMENTED |
| aurora…phoenix, nova | Nebula seats | REASONER | IMPLEMENTED |
| solara | SOLARA | REASONER | REGISTERED_ONLY |
| baby | Baby observer | OBSERVER | IMPLEMENTED |
| astra | ASTRA | ORCHESTRATOR | IMPLEMENTED (spawn DEFERRED) |
| council_runtime / scout_swarm | Council / scout | ORCHESTRATOR | IMPLEMENTED |
| constellation_temps | Temporary agents | REASONER | DEFERRED |
| terra | Terra | WORLD_STATE_SOURCE | IMPLEMENTED |
| research_engine / search_engine | Research / Search | DATA_SOURCE | IMPLEMENTED |
| crawler | Sovereign crawler | TOOL | IMPLEMENTED |
| ollama_bridge | Ollama | TOOL | IMPLEMENTED |
| native_builder | Native-builder / Mission Runtime | EXECUTOR | IMPLEMENTED |
| codex / cursor_agent | Engineering bridges | EXECUTOR | NOT_IMPLEMENTED / REGISTERED_ONLY |
| foundry | Agent Foundry | OTHER | REGISTERED_ONLY |
| opportunity_agents / income_workers | Income workflow | ORCHESTRATOR | IMPLEMENTED (approval-bound) |
| background_workers | Workers | EXECUTOR | IMPLEMENTED |
| production_supervisor | Watchdog | OTHER | IMPLEMENTED (OS scripts) |
| ascension | ASCENSION foundation | OTHER | REGISTERED_ONLY (#22 NOT STARTED) |

**Not War Room capabilities:** Kimi/Moonshot; live constellation workers; Codex invocable from War Room.

---

## 2. Actor classifications

| Class | Meaning |
|---|---|
| HUMAN | Commander authority |
| REASONER | LLM deliberation / challenge / synthesis |
| ORCHESTRATOR | Plans or routes work without being the substantive answerer |
| EXECUTOR | Mutates or runs processes under policy |
| TOOL | Invokable subsystem without persona |
| DATA_SOURCE | Read/fetch intelligence |
| WORLD_STATE_SOURCE | Terra-class geo/world evidence |
| OBSERVER | Witness / propose only |
| OTHER | Registry, scripts, foundation |

Name sounding like an agent ≠ agent. Foundry blueprints and SOLARA are registered, not live executors.

---

## 3. Terra Oracle definition

Documented in `terraOracleContract.ts` as **WAR ROOM WORLD-STATE ORACLE**.

- Terra answers world-state questions with provenance.
- Terra does **NOT** authorize action, silently create missions, or act as a second Council.
- `Terra selection ≠ Council send ≠ ASTRA mission ≠ execution authorization`.

---

## 4. Terra evidence contract

Canonical fields (`TERRA_EVIDENCE_CONTRACT_FIELDS`): type, category, object/event id, location, geometry, observed_at, retrieved_at, source, provider, freshness, confidence, provenance, truth_status, human-readable meaning, nearby world context, coverage state (live/cached/stale/no_coverage), council review state.

Maps onto existing `TerraIntelligenceEvent` / `TerraLiveGeoObject` / handoff — **contract only; no Terra redesign**.

---

## 5–9. Domains, actions, reach, authority, risk

| Catalog | Location |
|---|---|
| Domains (29) | `CAPABILITY_DOMAINS` |
| Actions (22) | `CAPABILITY_ACTIONS` |
| Technical reach | `NO_REACH` … `FULL_TECHNICAL_REACH` + `UNKNOWN` |
| Policy authority | `DENIED` … `COMMANDER_ONLY` + `SYSTEM_INTERNAL` / `NOT_APPLICABLE` |
| Risk tiers | `TIER_0` … `TIER_4` |

---

## 10. Current governance inventory

| Layer | Path |
|---|---|
| Standing + dangerous policy | `lib/permissions/policy.ts` |
| Explicit provider-call approval | `lib/council/approved-call/*` |
| Memory write approval | `lib/council/memory-write-gate/*` |
| Crawl approval | crawler `CrawlApproval` |
| Kernel routing (always non-autonomous) | `lib/kernel/routing.ts` |
| Ascension autonomy OFF | `ASCENSION_AUTONOMY_GUARD` |
| Foundry external/self-expand forbidden | `agentCapabilityRegistry.ts` |
| #19 ownership | `conversationOwnership.ts` |
| Baby guardrails | `BABY_AI_GUARDRAILS` |
| Audit | `war_room_audit_logs` |

**Preserved Commander-only / non-autonomous:** production deploy, git push, governed production commit, spending, transfers, trading, wagering, settlement submission, destructive DB, source approval where governed, production crawl expansion, high-impact external action — unless explicitly authorized.

---

## 11. Empirical reach findings (safe only)

| Probe | Result |
|---|---|
| Git metadata read | PASS (`live-council-intelligence-repair@ac8a16c`) |
| Git status read | PASS |
| Temp sandbox file write | PASS |
| Public HTTP HEAD example.com | PASS (200) |
| Ollama `127.0.0.1:11434/api/tags` | PASS (200) |
| Dangerous kinds never auto-allow | PASS (structural) |
| ASTRA `constellationSpawned:false` + Terra selection never mission | PASS (structural) |
| Ascension self-mod / production edit / unvalidated promotion | ALL false |
| Native-builder git commit/push not registered | PASS (validation guards) |
| Kernel `autonomousExecutionAllowed` | always false |

**Not performed (forbidden):** push, deploy, delete, spend, trade, live SQL alter, stop/restart production.

**Structurally proven no-reach:** agent browser, Twilio, general email send, git commit/push executor, production deploy CLI, wager/trade, free-form SQL.

---

## 12–21. Agent-specific matrices

Full rows: `CANONICAL_CAPABILITY_MATRIX` in `matrix.ts`. Summary pattern (Engineering example):

| Capability | Technical | Authority |
|---|---|---|
| Repository read | READ_ONLY | READ_ALLOWED |
| Repository write | WRITE_BOUNDED | BOUNDED_ALLOWED (approval) |
| Tests/build (fixed argv) | EXECUTE_SANDBOXED | BOUNDED_ALLOWED |
| Git commit | DISCOVER_ONLY | APPROVAL_REQUIRED / structurally forbidden today |
| Git push | DISCOVER_ONLY | COMMANDER_ONLY |
| Production deploy | DISCOVER_ONLY | COMMANDER_ONLY |

| Agent | CURRENT highlight | TARGET highlight |
|---|---|---|
| Research | Web read + approved crawl | Same; no deploy/finance |
| Engineering | Bounded patch + validation | Push/deploy remain Commander-only even if tech later |
| Terra Intelligence | N/A as agent (Commander Terra APIs today) | Query/analyze/submit evidence; **no** auto mission |
| Operations | Watchdog status read | Restart/deploy Commander-only |
| Security / Red Team | Analyze/challenge only | No self-approve / destructive execute |
| Council Validator | Analyze/verify | Cannot authorize itself |
| ASTRA | Create/execute → Council; spawn deferred | Workers only with inheritance caps |
| Corpus/Data | Search query; approved crawl write | No SQL alter |
| Future Navigation | NOT_IMPLEMENTED | GPS/device control denied by default |
| Future World-Learning | Foundation analyze | Memory write approval; no self-expand |

---

## 22. Council authority boundary

**May:** reason, challenge, synthesize, recommend, interpret Terra/Search/Memory.
**Must not:** inherit executor authority; treat recommendation as authorization; authorize itself.

**Known tension:** auto live research on research intents (`execute.ts` → `runLiveResearchRouter`) without `ExplicitExecutionApproval`. Documented for #22 — do not pretend it is free tool-calling or full authorization.

---

## 23. ASTRA authority boundary

- Creates planned missions; executes Council; plans constellation with `spawned:false`.
- `MISSION CREATED != ACTION AUTHORIZED`; `PLANNED != RUNNING`; `SPAWN REQUEST != WORKER SPAWNED`.
- No substantive answers; no deploy/finance; Terra selection alone never creates a mission.

---

## 24. Ownership / memory boundary

Integrates #19: service-role technical reach ≠ policy permission; `requireOwnedConversation` fail-closed; Baby separated; memory proposals ≠ approved writes; execution approval cannot authorize memory writes.

---

## 25. Approval model

**Reuse existing mechanisms** — do not invent a parallel system.
Minimum types: `NO_APPROVAL`, `POLICY_AUTO_ALLOWED`, `SESSION_APPROVAL`, `ONE_ACTION_APPROVAL`, `COMMANDER_EXPLICIT_APPROVAL`.
Tier 4: never blanket permanent by default.
Gap: some `DANGEROUS_ACTION_KINDS` unwired to all routes (payments use parallel gates).

Conceptual envelope: `ToolAuthorityEnvelope` in `types.ts` (evaluation only).

---

## 26. Audit model

Reuse `insertWarRoomAuditLog` + ASTRA mission audit + auto-mode ledger. Extend metadata for agent/tool/capability rather than a second audit table.

---

## 27. Denial states

`NO_TECHNICAL_REACH` · `POLICY_DENIED` · `APPROVAL_REQUIRED` · `APPROVAL_EXPIRED` · `TARGET_OUT_OF_SCOPE` · `UNAVAILABLE` · `NOT_IMPLEMENTED` · `DEGRADED`
Do not conflate policy denial with technical failure, or missing implementation with permission denial.

---

## 28. UI recommendation

**Do not build UI in #21.** Future Commander surface: Agent Capability Matrix with filters (agent/domain/risk/approval-required/live/unimplemented) and actions (inspect / temporary approval / revoke / audit).

---

## 29. Red-team findings

See `RED_TEAM_FINDINGS` in `governance.ts`. Highest: service-role IDOR if ownership skipped; Council auto-research breadth; ASTRA execute fan-out; dangerous-kinds wiring gaps; constellation privilege laundering if #22 mis-implements inheritance.

---

## 30. No-self-escalation invariants

Agents must never: grant themselves capabilities; change own policy tier; approve own approvals; modify Commander approval requirements; spawn more-privileged agents as bypass; route through another agent to evade policy.

---

## 31. Child-agent inheritance

Default: child capability ≤ parent; child authority ≤ parent; mission-scoped; time-bounded; **no privilege amplification**.

---

## 32. Complete canonical capability matrix

Machine-readable: `lib/agent-capability-matrix/matrix.ts` (`CANONICAL_CAPABILITY_MATRIX`).
Each row: TECHNICAL REACH · POLICY AUTHORITY · RISK TIER · APPROVAL · RUNTIME STATUS · EVIDENCE · CURRENT vs TARGET.

---

## 33. CURRENT vs TARGET distinction

| CURRENT_RUNTIME | TARGET_ASCENSION |
|---|---|
| What code can do today under policy | Proposed Ascension agent definitions |
| Must not be overstated | Must not be described as already available |

Validation rejects TARGET rows marked `IMPLEMENTED`.

---

## 34. #22 input contract

`lib/agent-capability-matrix/roadmap22Contract.ts` + `docs/architecture/ROADMAP_22_ASCENSION_INPUT_CONTRACT.md`.

Constrains: which agents may exist; tool reach bands; approval; non-delegable; audit; Terra/ASTRA/Council limits; inheritance; no self-escalation.

**#22 status: NOT STARTED. Do not implement here.**

---

## 35. Blockers

1. `war_room_astra_missions` Supabase migration still not applied (filesystem fallback) — pre-prod ASTRA persistence blocker (pre-existing).
2. Dangerous action kinds catalog vs route wiring incomplete — close before granting Ascension reach.
3. Council auto-research vs tool-authority envelope decision deferred to #22 design (not a #21 fail).
4. Unrelated dirty tree (`TerraEarthImagery`, `work/**`, etc.) must stay out of #21 commit when Commander authorizes commit.

---

## 36. Files changed

| Path | Role |
|---|---|
| `lib/agent-capability-matrix/*` | Types, actors, Terra contract, matrix, governance, #22 contract, validation |
| `docs/AGENT_CAPABILITY_MATRIX.md` | This report |
| `docs/architecture/ROADMAP_22_ASCENSION_INPUT_CONTRACT.md` | #22 input |
| `docs/MASTER_OS_ROADMAP.md` | #21 entry |
| `package.json` | `validate:agent-capability-matrix` |

---

## 37. Is #21 evaluation COMPLETE?

**YES** — inventory, contracts, matrices, empirical safe probes, invariants, validation, and #22 input contract delivered. No powers granted. No #22 implementation. No push/deploy.

---

## 38. Implementation changes recommended before #22?

**Recommended (governance hardening — optional pre-#22, not power grants):**

1. Wire remaining dangerous `actionKind`s through `assertAutoOrApproval` (or document intentional parallel gates).
2. Decide Council auto-research approval class (`POLICY_AUTO_ALLOWED` vs `SESSION_APPROVAL`).
3. Extend audit metadata for agent/tool/capability fields.
4. Apply ASTRA missions SQL before production persistence reliance.
5. Keep Ascension autonomy guards false until Commander explicitly opens #22.

**Do not:** implement Ascension agents, grant push/deploy/finance, spawn constellation workers, or weaken Commander gates.
