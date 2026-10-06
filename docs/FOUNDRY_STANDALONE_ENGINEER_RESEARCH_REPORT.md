# FOUNDRY STANDALONE ENGINEER — RESEARCH REPORT
**Commander:** Mark | **Date:** 2026-09-21 (ET) | **Mode:** RESEARCH ONLY  
**Hard locks:** No code changes · No Foundry mutation · No commit/push/deploy/install · HVU ≠ graduation · Codegen ≠ engineer  
**Evidence labels:** DOCUMENTED | BENCHMARKED | DEMONSTRATED | CLAIMED | INFERRED  
**Foundry status labels:** NOT_PRESENT | PRESENT_UNPROVEN | PARTIALLY_PROVEN | PROVEN | PRODUCTION_PROVEN  
**Sources:** Official docs/repos/papers/benchmarks (2026); War Room audit tree `/workspace/war-room-os-audit` READ-ONLY  
**Wave stamps:** `waves/WAVE_1.md` … `waves/WAVE_8.md`

---

## 1. Executive findings (answers to Commander)

1) **What Foundry already can do**  
Native Builder / Foundry Engineering Core can: ingest issues; plan small repairs; apply patches only after Commander approval (gated repair); run typed validations; run a bounded local-coder Foundry mission loop with schema-validated actions (read/search/create/patch/delete/run validation/process control); enforce argv shell policy (no free shell strings); compute completion truth from real test counts and product-file diffs; bind workspace identity; route specialist *roles* over one core; arbiter local GPU models; refuse git push/deploy/self-expansion (install/deploy API routes 403). Agent Foundry registry exists as governance, not the coding executor. **Box honesty:** no live Foundry process / `.war-room` store on audit checkout; Nebula authoritative tree offline this research — zero `PRODUCTION_PROVEN` claims.

2) **What it lacks**  
Mission Contract + acceptance DAG; event-sourced multi-day persistence/replay; project-scale edit profiles with worktree isolation; parallel ownership locks; unified resource governor; OS/browser computer-use for general apps; LSP-grade repo intel; Auto-Engineer unattended envelope with heartbeat; self-improve harness (safe); benchmark/graduation mission suites; durable capability atlas for Foundry-the-engineer (not only WR actor matrix).

3) **Gaps that block standalone** (P0)  
Mission understanding/acceptance binding; durable mission runtime + resume without "continue"; verification-complete ownership (no external agent owner); project-scale profile beyond 12-turn Node scaffolds; stagnation→replan engine; resource governor; security-preserving Auto-Engineer mode.

4) **Build order**  
See §36 — dependency-derived phases A→G (Contract → Persist → Verify → Scale → Parallel → Auto-Engineer → Graduate).

5) **How each ability is proven**  
Unit/validation suites (`foundry.validation.ts`, native-builder validators); architectural governance docs; capability matrix empirical probes; future graduation harness missions with frozen acceptors; optional public benches as regression only.

6) **Graduation test design**  
See §37 — multi-mission WR-owned harness; no Codex/Cursor/Claude Code primary ownership; no continue-spam; evidence pack required.

7) **When ready for HVU**  
Only after graduation PASS + HVU readiness gate (§38). HVU is first major assignment *after* graduation.

**Architecture one-liner:** Foundry SE = event-sourced Mission Owner over a typed, policy-gated Engineering Core (actions/tools/shell/verify), with model workers behind a router — never an external frontier agent as owner.

---

## 2. Definition — Standalone AI software engineer

A standalone AI software engineer is a **mission-owning organization** that can take a large engineering assignment and drive it through understand → plan → implement → test → verify → repair/replan → deliver, with durable state, explicit authority boundaries, and evidence-based completion — **without** another frontier coding agent owning the project and **without** the Commander repeatedly prompting continuation.

It is **not**: autocomplete; chat-with-repo; one-shot codegen; a role-playing multi-agent UI; a wrapper that secretly delegates ownership to Codex/Cursor/Claude Code/Devin.

**Council ≠ Foundry ≠ Terra ≠ Media ≠ HVS.** Foundry owns engineering execution under Commander authority; Council deliberates; Terra is world-state; etc.

---

## 3. 2026 reference landscape (mechanisms, not worship)

| System | Class | Primary mechanisms | Label |
|---|---|---|---|
| OpenAI Codex | Cloud/CLI/IDE agent | Sandbox exec, AGENTS.md, Skills, MCP, subagents, PR handoff | DOCUMENTED |
| Cursor Cloud Agents | VM agents | Env snapshots, plan/agent modes, computer use, artifacts, API agent+runs | DOCUMENTED |
| Claude Code | Local/IDE agent | Tool permissions, CLAUDE.md, auto memory, subagents, hooks | DOCUMENTED |
| Google Jules | Async GH agent | Issue→PR, Gemini | DOCUMENTED\|CLAIMED |
| OpenHands V1 | OSS platform/SDK | Event-sourced state, typed tools, workspaces, Agent Server | DOCUMENTED |
| Aider | Terminal pair | Repo map, git-native commits | DOCUMENTED\|DEMONSTRATED |
| Goose | MCP-first agent | Model-agnostic, embeddable | DOCUMENTED |
| Cline / Roo | IDE agents | Approvals, modes/orchestrator, checkpoints | DOCUMENTED |
| Continue | OSS IDE | Pluggable models | DOCUMENTED |
| SWE-agent / mini-SWE-agent | Research harness | ACI; bash-only ReAct for fair LM compare | DOCUMENTED\|BENCHMARKED |
| Devin | Commercial | Async jobs (public) | CLAIMED (public only) |
| Copilot coding agent | GH-integrated | Issues/Actions→PR | DOCUMENTED\|CLAIMED |
| Cody / Amp | Code intel / agentic | Search index; multi-model routing | DOCUMENTED\|CLAIMED |
| Replit Agent | Platform agent | Scaffold/test/deploy in hosted runtime | DOCUMENTED\|CLAIMED |

Detail and steal/avoid lists: `waves/WAVE_1.md`.

---

## 4. Cross-system mechanism catalog

1. Doctrine files (AGENTS.md/CLAUDE.md)  
2. Typed tool schemas + permissions  
3. Sandbox / fixed-argv execution  
4. Reproducible agent environments  
5. Event-sourced mission state + resume  
6. Repo map / code intelligence  
7. Git worktrees/checkpoints/PR artifacts  
8. Verification-first completion  
9. Skills/modes/subagents with scoped tools  
10. MCP for external systems  
11. Stagnation detection  
12. Model routing + degradation  
13. Resource governors  
14. Human approval on dangerous actions  
15. Plan-then-act outer loop + ReAct inner loop  

---

## 5. FOUNDRY_MISSION_UNDERSTANDING_REQUIREMENTS (RQ1)

**Must produce a versioned Mission Contract:** goal, non-goals, acceptance criteria (each mapped to verification ops), constraints, scope, deliverables, assumptions, risks/unknowns, stop/escalate rules, budget envelope.

**Foundry now:** `commanderRequest` string + specialist heuristic — PRESENT_UNPROVEN as understanding.  
**Missing:** contract schema, criterion↔test binding, assumption log, clarify-or-assume policy.  
**Priority:** P0. **Refs:** Cursor/Codex plan mode; issue tickets (Jules/Copilot).  
**Test:** Given ambiguous vs precise prompts, emit contract; refuse COMPLETE unless criteria satisfied.

---

## 6. FOUNDRY_REPOSITORY_INTELLIGENCE_STACK (RQ2)

**Layers:** inventory → build/test discovery → search/ACI → optional LSP → durable project memory → doctrine file (War Room Foundry equivalent of AGENTS.md).

**Foundry now:** `repoMap`, `repositoryInspector`, `projectMemory`, `foundryEngineeringKnowledge` — PARTIALLY_PROVEN.  
**Missing:** LSP/diagnostics loop; multi-package graph; hot-spot/ownership intel.  
**Priority:** P0 for discovery commands; P1 for LSP. **Refs:** Aider repo map; Cody; SWE-agent ACI.

---

## 7. FOUNDRY_OWNERSHIP_ENGINE (RQ3)

**Rules:** One Mission Owner lease; file/worktree locks; authority matrix (approve/deny); no ownership transfer to external coding agents for graduation missions; Council advisory ≠ Foundry owner.

**Foundry now:** Roles over one Engineering Core — DOCUMENTED; Agent Foundry REGISTERED_ONLY; Codex/Cursor bridges NOT_IMPLEMENTED — good (keeps ownership local) but also means Foundry must itself be competent.  
**Missing:** leases, worktree locks, explicit ownership audit log.  
**Priority:** P0.

---

## 8. Planning graphs (RQ4)

Mission → Epics → Tasks → Actions → Verifications with dependency edges and acceptance nodes.

**Foundry now:** `plan: string[]` briefs; deterministic repair templates — PARTIAL / NOT graph.  
**Missing:** DAG planner, cost estimates, plan diff on replan.  
**Priority:** P0 (minimum: task list + deps + acceptance links).

---

## 9. Engineering loop requirements (RQ5)

```
observe → context → propose typed actions → policy → execute → validate → memory → complete|repair|replan|escalate
```

**Foundry now:** `foundryLoop` / `engineerLoop` / gated `runtime.ts` — PARTIALLY_PROVEN (repair class designed; live Nebula E2E UNKNOWN).  
**Keep:** typed actions, completion truth, duplicate-failure stop.  
**Raise:** turn caps from constant to governor-driven; bind to Mission Contract.

---

## 10. Code editing / mutation model (RQ8)

**Foundry now:** CREATE/PATCH/DELETE via Engineering Core; patchPolicy profiles; denylist — PROVEN policy design.  
**Missing:** AST-aware multi-file refactors; progressive unlock under `external_coding` / generated_project surfaces.  
**Priority:** P1 (scale), P0 (keep policy on war_room_source).

---

## 11. Self-debugging (RQ6)

**Foundry now:** failureEvidence, DEBUGGER role, repairPlanner, repairVerifier — PARTIALLY_PROVEN for known classes.  
**Missing:** root-cause graphs; flake handling; log/MCP debug.  
**Priority:** P1.

---

## 12. FOUNDRY_REPLAN_ENGINE (RQ7)

Triggers: verify fail, stagnation, env block, Commander scope change, discovery.  
Actions: invalidate dependents, insert spikes, MVP cut, escalate with evidence.

**Foundry now:** stagnation stop + model improvisation — NOT a replan engine.  
**Priority:** P0.

---

## 13. Testing strategy (RQ10)

Require real tests (Foundry already forbids 0-test COMPLETE). Extend to integration/e2e for generated apps under sandbox profile; keep WR installed runtime on 3848 without Foundry starting `next dev`.

**Priority:** P0 for criterion-linked tests; P1 for e2e sandbox.

---

## 14. FOUNDRY_VERIFICATION_ARCHITECTURE (RQ11)

Layers: policy → tool result → **test truth counts** → runtime probes → diff/product truth → optional advisory review → Commander accept (WR-source).

**Foundry now:** `foundryCompletionTruth` — PROVEN intent.  
**Missing:** acceptance checklist object; second-channel verifier mission.  
**Priority:** P0.

---

## 15. Computer / browser / runtime use (RQ12)

**Foundry now:** local HTTP probes, owned processes, `browser.inspect_local`, intentional skip of WR next dev — PARTIAL.  
**Missing:** OSWorld-class desktop; sandboxed browser for generated UI.  
**Priority:** P2 (general computer use); P1 (sandbox browser for generated apps).  
**Refs:** Cursor computer use — DOCUMENTED; OSWorld — BENCHMARKED.

---

## 16. FOUNDRY_SHELL_EXECUTION_MODEL (RQ13)

**Non-negotiable:** model never emits free shell strings; only typed operations / argv classified SAFE_LOCAL; dangerous equivalents denied; outputs redacted.

**Foundry now:** commandPolicy + validationRunner + terminalExecutor — PROVEN design.  
**Priority:** P0 preserve; extend operation catalog carefully with tests.

---

## 17. FOUNDRY_RESEARCH_AND_LEARNING_LOOP (RQ17)

Research → cite → propose → verify → remember (TTL). Retrieved content = untrusted data (already in Foundry prompt). Live network research stays Commander-approval gated (NATIVE_BUILDER governance — DOCUMENTED).

**Priority:** P1.

---

## 18. Engineering memory (RQ15)

Episodic mission events; semantic architecture; procedural commands; preference corrections. Persist under `.war-room/foundry/` with provenance.

**Foundry now:** sessions, projectMemory, knowledge store — PRESENT_UNPROVEN.  
**Priority:** P1.

---

## 19. Capability atlas (RQ16)

Machine-readable atlas of Foundry engineer capabilities with status labels + evidence pointers + authority. Distinct from WR actor matrix but linked.

**Foundry now:** WR AGENT_CAPABILITY_MATRIX — PROVEN for actors; Foundry-SE atlas — NOT_PRESENT.  
**Priority:** P1 (P0 for graduation reporting).

---

## 20. FOUNDRY_TOOL_REGISTRY_ARCHITECTURE (RQ18)

Versioned registry entries: schema, side effects, policy class, approval, owner, tests. Actions/tools/ops already closed sets — extend, don't open stringly tools. Optional MCP behind same gate.

**Priority:** P1.

---

## 21. FOUNDRY_MODEL_ROUTER (RQ19)

Route by task class, privacy, context, cost; fallbacks; degradation briefings. Build on `localModelArbiter` + hosted proposal paths.

**Priority:** P1 (P0 if local coder unavailability blocks missions — already BLOCKED path exists).

---

## 22. Loop architectures (RQ22)

**Recommended:** Outer event-sourced Mission FSM + Inner typed ReAct loop; keep gated approve-apply for `war_room_source`. Modes/roles as routing only. Parallelism only with worktrees (§25).

---

## 23. FOUNDRY_PERSISTENT_MISSION_RUNTIME (RQ14)

Durable mission documents; event log; resume/cancel/pause; heartbeat; crash recovery tests.

**Foundry now:** JSON repairs/sessions + resumeCodingMission — PARTIALLY_PROVEN.  
**Missing:** event-sourced replay (OpenHands-class).  
**Priority:** P0.

---

## 24. FOUNDRY_RESOURCE_GOVERNOR (RQ23)

Unify turns/tokens/time/GPU/disk/network budgets; hard stop + Commander burn-down UI.

**Priority:** P0.

---

## 25. FOUNDRY_PARALLEL_ENGINEERING_MODEL (RQ24)

Worktree-per-subtask; file leases; merge queue; no shared dirty tree. Until then: sequential only (honest).

**Priority:** P2 for true parallel; P1 for worktree isolation even single-threaded.

---

## 26. Context management (RQ25)

Budgeter: pin Mission Contract + failing evidence; repo map; skill metadata; compact logs.  

**Priority:** P1.

---

## 27. VCS model (RQ26)

Branch-per-mission; optional checkpoint commits under profile; `commit_prepare` only; **never** autonomous push/deploy. PR artifact pack for human review.

**Foundry now:** governance correct — PROVEN restraint.  
**Priority:** P1 productize branch/checkpoint; P0 keep no-push.

---

## 28. FOUNDRY_ENGINEERING_SECURITY_MODEL (RQ27)

Preserve: session auth, dangerous kinds, denylist, argv policy, redaction, research approval, no self_expansion/external_execution, Ascension autonomy OFF, CAPABILITY≠AUTHORITY.

Standalone success must not require weakening these.

**Priority:** P0 preserve.

---

## 29. FOUNDRY_SELF_HEALING_ENGINE (RQ28)

Unify detection/response for process/model/workspace/dependency faults; escalate when heal unsafe (install/deploy).

**Priority:** P1.

---

## 30. Self-improvement + self-rewrite (RQ20–21)

Self-improve: telemetry→proposal→offline eval→Commander approve→canary.  
Self-rewrite of Foundry core: dual-control meta-mission only; forbidden during HVU; registry already denies self_expansion.

**Priority:** P2 improve; P3 rewrite (post-graduation optional).

---

## 31. Senior behavior, Auto-Engineer, benchmarks (RQ29–31)

**Senior gates (machine-checkable):** acceptance present; tests can fail; minimal diff bias; BLOCKED is honest; evidence pack on escalate.

**Auto-Engineer:** unattended within pre-approved envelope + governor + heartbeat + auto-pause on novel danger.

**Benchmarks (directional only):**
- SWE-bench Verified / bash-only — BENCHMARKED ([swebench.com/verified](https://www.swebench.com/verified))
- SWE-Lancer — BENCHMARKED (arXiv:2502.12115)
- Terminal-Bench, OSWorld, WebArena — BENCHMARKED domain suites
Harness variance and known Verified noise ⇒ **graduation uses WR-owned missions**, benches as optional regressions.

---

## 32. Foundry current-state inventory (§RQ32)

### 32.1 Code map (audit tree, unmodified)
- `lib/native-builder/` — Engineering Core (~70+ modules): foundryLoop, engineerLoop, runtime, actions, tools, validation, policy, memory, arbiter, sessions, completion truth, workspace identity, repair planner/verifier, etc.
- `lib/agents/foundry/` — Agent Foundry governance/registry (not coding executor).
- `components/war-room/foundry/` — Foundry UX shell/nav/terra background.
- `app/api/agents/foundry`, `app/api/mission-runtime/engineering/foundry`, `app/api/native-builder/*`.
- `scripts/run-foundry-validation.mjs` → `foundry.validation.ts`.
- Docs: `NATIVE_BUILDER_ARCHITECTURE_AND_GOVERNANCE.md`, `AGENT_CAPABILITY_MATRIX.md`, phase-10 Agent Foundry notes.

### 32.2 Capability status table (summary)

| Area | Status |
|---|---|
| Gated small repair | PARTIALLY_PROVEN (artifact); live Nebula E2E UNKNOWN |
| Typed tools/actions/shell policy | PROVEN |
| Completion truth | PROVEN (design) / PARTIALLY_PROVEN (mission scale) |
| Foundry mission loop ≤12 turns | PARTIALLY_PROVEN |
| Roles routing | PRESENT |
| Repo map/inspector | PARTIALLY_PROVEN |
| Sessions/persistence JSON | PARTIALLY_PROVEN |
| Local model arbiter | PARTIALLY_PROVEN |
| Coding research | PARTIALLY_PROVEN |
| Agent Foundry live executor | NOT_PRESENT (REGISTERED_ONLY) |
| External Codex/Cursor owner bridge | NOT_IMPLEMENTED |
| Mission Contract/DAG | NOT_PRESENT |
| Event-sourced replay | NOT_PRESENT |
| Parallel worktrees | NOT_PRESENT |
| Resource governor unified | NOT_PRESENT |
| Auto-Engineer mode | NOT_PRESENT |
| Computer-use general | NOT_PRESENT |
| Push/deploy autonomy | DENIED (correct) |

### 32.3 Additional artifact facts (from Wave 7 partial inspect)
- `browser.inspect_local` **stubs** with `VISUAL_VERIFICATION_NOT_AVAILABLE` — computer-use NOT_PRESENT effectively.
- Mission-runtime `.../install` and `.../deploy` routes always 403 via `denyInstallUpdate` / `denyDeploy`.
- `.../replan` is Commander-invoked `planRepair()` — comment in route: not an autonomous retry loop.
- Two Foundry meanings must not collapse: Engineering Foundry (`lib/native-builder`) vs Agent Foundry (`lib/agents/foundry`, REGISTERED_ONLY).
- Audit tip: `/workspace/war-room-os-audit` @ detached `10a3d34` (2026-09-17); authoritative Nebula path not available this turn.

### 32.4 Honesty note
NATIVE_BUILDER doc states Native Builder is **not** a general autonomous coding agent. Foundry loop extends toward novel projects but remains turn-bounded (`MAX_TURNS=12`) and scaffold-oriented. Claiming standalone engineer today would be false. Avenger Blind Spot overclaims (SWE-bench≠org, demo≠production, continue-loops≠autonomy, HVU≠graduation) are adopted as report doctrine — see `waves/WAVE_BLINDSPOT_OVERCLAIM.md`.

---

## 33. FOUNDARY_STANDALONE_ENGINEER_GAP_MATRIX

| CAPABILITY_ID | NAME | WHY_REQUIRED | CURRENT_STATUS | EVIDENCE | REFERENCE_SYSTEMS | MISSING | PRIORITY | DEPENDENCIES | TEST_REQUIRED | GRADUATION_CRITERIA |
|---|---|---|---|---|---|---|---|---|---|---|
| C01 | Mission Contract | Own acceptance | PRESENT_UNPROVEN | commanderRequest only | Codex/Cursor plan | Schema+bindings | P0 | — | Contract parse fixtures | Criteria drive COMPLETE |
| C02 | Repo intel + test discovery | Closed loop | PARTIALLY_PROVEN | repoMap/inspector | Aider/SWE-ACI | LSP; richer map | P0 | — | Map on sample repos | Discovers test/build cmds |
| C03 | Ownership engine | No owner thrash | PRESENT_UNPROVEN | roles; matrix | OpenHands/Cursor | Leases/locks | P0 | C01 | Lease contention tests | Single owner audit |
| C04 | Plan DAG | Order work | NOT_PRESENT | plan string[] | Plan-mode agents | DAG+costs | P0 | C01 | DAG validate | Plan executed/replanned |
| C05 | Engineering loop at mission scale | Deliver | PARTIALLY_PROVEN | foundryLoop | SWE-agent/OH | Governor-driven horizon | P0 | C01,C14,C24 | Multi-hour sim | Completes harness missions |
| C06 | Replan engine | Recover | NOT_PRESENT | dup-fail stop | Reflect loops | Graph replan | P0 | C04,C14 | Inject fail→replan | No continue-spam |
| C07 | Edit engine profiles | Scale safely | PARTIALLY_PROVEN | patchPolicy | Aider/Claude | Scale profile | P1 | C28 | Policy matrix tests | WR-source safe; gen-project scales |
| C08 | Self-debug | Fix fails | PARTIALLY_PROVEN | repair* | All agents | RCA graph | P1 | C14 | Known-bug fixtures | Fixes N fixtures unaided |
| C09 | Test strategy | Proof | PARTIALLY_PROVEN | node_test truth | SWE-bench | e2e sandbox | P0 | C14 | 0-test reject | pass>0 enforced |
| C10 | Verification arch | Truth | PARTIALLY_PROVEN | completionTruth | — | Checklist object | P0 | C01,C09 | Truth fixtures | No false COMPLETE |
| C11 | Runtime/browser sandbox | UI proof | PRESENT_UNPROVEN | http_probe; skip next | Cursor CU | Sandbox browser | P1 | C16,C28 | Generated app probe | UI criteria verified |
| C12 | Typed shell model | Safety | PROVEN | commandPolicy | mini-SWE contrast | Op catalog growth | P0 | — | Deny free shell | Zero free-shell escapes |
| C13 | Computer use general | Desktop tasks | NOT_PRESENT | matrix no-reach | OSWorld/Cursor | Full CU | P2 | C28 | Optional OSWorld subset | Out of min spec |
| C14 | Mission persistence | Multi-day | PARTIALLY_PROVEN | storage/resume | OpenHands events | Event replay | P0 | — | Kill-9 resume | Resume mid-mission |
| C15 | Memory system | Learn | PRESENT_UNPROVEN | projectMemory | Claude memory | Provenance memory | P1 | C14 | Memory roundtrip | Cross-mission reuse |
| C16 | Capability atlas | Honesty | NOT_PRESENT | WR actor matrix | — | Foundry-SE atlas | P1 | C32 | Atlas schema | Atlas matches evidence |
| C17 | Research/learn loop | Unknowns | PARTIALLY_PROVEN | codingResearch | NB intel mission | Cite-verify-remember | P1 | C28 | Untrusted inject | Ignores hostile pages |
| C18 | Tool registry | Extensibility | PARTIALLY_PROVEN | closed enums | MCP ecosystems | Versioned registry | P1 | C12 | Registry validate | No stringly tools |
| C19 | Model router | Reliability | PARTIALLY_PROVEN | localModelArbiter | Amp/Codex | Task-class routing | P1 | C24 | Fallback drills | Degrades honestly |
| C20 | Self-improve | Raise ceiling | PRESENT_UNPROVEN | evolution scorecards | Research agents | Gated harness evolve | P2 | C31,C37 | Offline eval | No silent self-mod |
| C21 | Self-rewrite | Meta | NOT_PRESENT | self_expansion denied | — | Dual-control process | P3 | Grad+C28 | Dual-approve drill | Never mid-HVU |
| C22 | Loop architecture | Clarity | PARTIALLY_PROVEN | dual loops | OH/SWE | Outer FSM | P0 | C14 | FSM tests | States auditable |
| C23 | Resource governor | Stop runaway | NOT_PRESENT | MAX_TURNS const | Cloud quotas | Unified budgets | P0 | C14 | Budget breakers | Hard stop fires |
| C24 | Parallel engineering | Throughput | NOT_PRESENT | sequential | Codex parallel | Worktrees+locks | P2 | C03,C27 | Parallel merge | No clobber |
| C25 | Context manager | Quality | PRESENT_UNPROVEN | prompt assemble | Claude compact | Budgeter | P1 | C01 | Context audits | Pins contract+fails |
| C26 | VCS workflow | Delivery | PARTIALLY_PROVEN | commit_prepare; no push | Aider/Cursor PR | Branch+artifacts | P1 | C28 | Branch mission | No push/deploy |
| C27 | Worktree isolation | Safe scale | NOT_PRESENT | workspace bind | Cursor/Codex | Worktree manager | P1 | C03 | Isolate edits | WR tree clean |
| C28 | Security model | Survive autonomy | PROVEN | policies/matrix | All serious agents | Keep+extend | P0 | — | Security regressions | No privilege creep |
| C29 | Self-heal | Uptime | PRESENT_UNPROVEN | processRegistry etc | — | Unified engine | P1 | C14,C23 | Fault injection | Heal or BLOCKED |
| C30 | Senior behavior gates | Quality | PRESENT_UNPROVEN | completion honesty | — | Checklist gates | P1 | C01,C10 | Gate unit tests | Gates block bad COMPLETE |
| C31 | Auto-Engineer mode | Unattended | NOT_PRESENT | — | Cloud agents | Envelope+heartbeat | P0 | C14,C23,C28 | Soak test 4h | No continue needed |
| C32 | Inventory honesty | Trust | PARTIALLY_PROVEN | this report | — | Living atlas | P0 | — | Drift check | Claims≤evidence |
| C33 | Gap closure tracking | Manage build | NOT_PRESENT | — | — | Tracker from matrix | P1 | C32 | — | P0=0 before grad |
| C34 | Min standalone spec | Target | NOT_PRESENT→spec | §34 | — | Implement | P0 | P0 caps | Spec acceptance | Meets §34 |
| C35 | Full intel end-state | North star | NOT_PRESENT | §35 | Landscape | Long-range | P3 | Grad | — | Post-HVU evolve |
| C36 | Phased build | Order | NOT_PRESENT→plan | §36 | — | Execute later | P0 | — | Phase exit tests | Dep order held |
| C37 | Graduation harness | Prove SE | NOT_PRESENT | §37 | SWE benches (aux) | Mission suite | P0 | C34 | Harness run | PASS §37 |
| C38 | HVU gate | Protect HVU | NOT_PRESENT | §38 | — | Gate checklist | P0 | C37 | Gate review | PASS before assign |
| C39 | Risk register | Avoid landmines | PRESENT (this §39) | — | Blind spots | Maintain | P1 | — | — | Risks owned |
| C40 | Final recommendation | Decision | §40 | — | — | Commander decide | P0 | — | — | HOLD build until approve |

---

## 34. FOUNDRY_STANDALONE_MINIMUM_SPEC

Must-have before claiming "standalone engineer":
1. Mission Contract + acceptance↔verify binding (C01)  
2. Event-sourced or equivalent durable mission runtime with resume (C14)  
3. Outer Mission FSM + inner typed loop (C22,C05)  
4. Replan on stagnation/verify-fail (C06)  
5. Resource governor hard stops (C23)  
6. Verification architecture with no false COMPLETE (C10,C09)  
7. Typed shell + security model preserved (C12,C28)  
8. Ownership engine — Foundry owns; no external agent owner (C03)  
9. Auto-Engineer envelope with heartbeat (C31)  
10. Graduation harness PASS (C37)  
11. Capability atlas truthful (C16/C32)  
12. Generated-project scale profile with worktree isolation (C07,C27) — at least single-threaded  

Explicitly **out of minimum:** OSWorld computer use; self-rewrite; full parallel factory; Media/HVS domains; HVU itself.

---

## 35. FOUNDRY FULL ENGINEERING INTELLIGENCE (end-state)

North star after graduation + HVU lessons:
- Multi-worktree parallel engineers under Master Owner  
- LSP-aware refactors; sandbox browser/desktop profiles  
- MCP tool marketplace behind policy  
- Self-improve canaries on harness suite  
- Optional public bench regressions (SWE-Verified/Terminal-Bench)  
- Doctrine files auto-maintained from memory  
- Deep integration with Council (advisory) / ASTRA (orchestration) **without** ceding engineering ownership  
- Still never autonomous push/deploy/spend  

---

## 36. Dependency-derived build phases

| Phase | Name | Delivers | Depends on | Exit test |
|---|---|---|---|---|
| A | Contract & Atlas | C01,C16,C32,C10 checklist | — | Contract fixtures green |
| B | Persist & FSM | C14,C22,C23 | A | Kill-resume; budget stop |
| C | Replan & Verify | C06,C09,C05 scale | A,B | Injected fail recovers |
| D | Scale profiles | C07,C27,C11 sandbox | C,C28 | Generated app mission |
| E | Memory/Router/Tools | C15,C17,C18,C19,C25 | B | Degradation+memory reuse |
| F | Auto-Engineer | C31,C30,C29,C26 | C,D,E,C28 | 4h soak no continue |
| G | Graduate | C37,C38 | F + all P0=closed | Graduation PASS |

**Do not** start HVU in phases A–F. **Do not** implement during this research mission.

---

## 37. Graduation test design

**Purpose:** Prove Foundry is a standalone engineer **before** HVU.

**Rules:**
- No Codex/Cursor/Claude Code/Devin/Jules as primary owner (models-as-workers via router OK if Foundry owns loop/state/verify).  
- Commander may set Mission Contract once; may answer ≤N clarifying questions; **continue-spam forbidden** (Auto-Engineer must proceed or BLOCKED with evidence).  
- Push/deploy still forbidden.  

**Suite (minimum 5 missions, frozen harnesses):**
1. **Greenfield CLI** — Node ESM tool + node:test; COMPLETE only with pass>0.  
2. **Greenfield HTTP app** — health + behavioral tests; sandbox runtime.  
3. **Repair known defect** in fixture repo — gated or coding profile as appropriate.  
4. **Multi-file feature** on generated_project with worktree; mid-fail injected → replan.  
5. **Kill-resume** — SIGKILL mid-mission; resume to COMPLETE or honest BLOCKED.  

**Pass bar:** ≥4/5 COMPLETE with evidence packs; zero false COMPLETE; zero policy escapes (free shell/push/deploy); ownership audit shows Foundry Master throughout.

**Not the graduation test:** Higher Visions University.

---

## 38. HVU readiness gate

Assign HVU only if:
1. Graduation PASS (§37) recorded with evidence  
2. All P0 gaps CLOSED or WAIVED in writing by Commander  
3. Auto-Engineer soak passed  
4. Security regression suite green  
5. HVU Mission Contract drafted (scope, non-goals, acceptance) **as assignment**, not as grad exam  
6. Explicit Commander order: "Foundry owns HVU engineering"  

Until then: **HOLD HVU**.

---

## 39. Risks and failure modes

| Risk | Why it matters | Mitigation |
|---|---|---|
| Wrap Cursor/Codex as owner | Never graduates Foundry | Forbidden for grad/HVU ownership |
| Benchmark chasing | False confidence | WR harness primary |
| Weaken security for autonomy | Production compromise | C28 P0 preserve |
| False COMPLETE | Lies to Commander | Completion truth + gates |
| 12-turn theater | Looks busy, not done | Governor + replan |
| Self-rewrite mid-HVU | Self-corruption | Dual-control; ban mid-HVU |
| Parallel without locks | Repo corruption | Worktrees or sequential |
| Memory poisoning | Bad lore | Provenance+TTL+untrusted research |
| Confusing Agent Foundry registry with executor | Wrong build target | Matrix honesty |
| Treating HVU as exam | Scope blowup / fail public | Graduate first |

---

## 40. Final recommendation

**Recommendation: BUILD Foundry as the standalone engineer — deepen Engineering Core into a Mission OS; do not outsource ownership to another frontier coding agent.**

- **Already strong substrate:** typed tools, argv shell, patch/git governance, completion truth culture, gated repair production path, local model arbiter, role routing.  
- **Blocking gaps are organizational** (contract, persistence/FSM, replan, governor, Auto-Engineer, graduation harness), not "add more codegen."  
- **Phased order A→G** (§36). Research ends here — **HARD STOP, no implementation in this mission.**  
- **HVU** remains the first major post-graduation assignment, not the exam.

**Commander decision requested:** Approve research conclusions and authorize Phase A planning (separate mission) when ready.

---

## Appendix A — Named requirement artifacts (index)

| Artifact | Section |
|---|---|
| FOUNDRY_MISSION_UNDERSTANDING_REQUIREMENTS | §5 |
| FOUNDRY_REPOSITORY_INTELLIGENCE_STACK | §6 |
| FOUNDRY_OWNERSHIP_ENGINE | §7 |
| FOUNDRY_REPLAN_ENGINE | §12 |
| FOUNDRY_PROJECT_SCALE_ENGINEERING_REQUIREMENTS | §10, §34 |
| FOUNDRY_VERIFICATION_ARCHITECTURE | §14 |
| FOUNDRY_SHELL_EXECUTION_MODEL | §16 |
| FOUNDRY_PERSISTENT_MISSION_RUNTIME | §23 |
| FOUNDRY_RESEARCH_AND_LEARNING_LOOP | §17 |
| FOUNDRY_TOOL_REGISTRY_ARCHITECTURE | §20 |
| FOUNDRY_MODEL_ROUTER | §21 |
| FOUNDRY_SELF_HEALING_ENGINE | §29 |
| FOUNDRY_RESOURCE_GOVERNOR | §24 |
| FOUNDRY_PARALLEL_ENGINEERING_MODEL | §25 |
| FOUNDRY_ENGINEERING_SECURITY_MODEL | §28 |
| FOUNDARY_STANDALONE_ENGINEER_GAP_MATRIX | §33 |
| FOUNDRY_STANDALONE_MINIMUM_SPEC | §34 |
| FOUNDRY FULL ENGINEERING INTELLIGENCE | §35 |
| Graduation test + HVU gate | §37–38 |

## Appendix B — Primary sources (sample)

- OpenAI Codex: https://openai.com/index/introducing-codex/ ; https://developers.openai.com/codex/concepts/customization  
- Cursor Cloud Agents: https://cursor.com/docs/cloud-agent  
- Claude Code: https://code.claude.com/docs/en/overview  
- OpenHands SDK: https://github.com/openhands/software-agent-sdk  
- SWE-bench Verified: https://www.swebench.com/verified  
- SWE-Lancer: arXiv:2502.12115  
- SWE-agent ACI: https://swe-agent.com/latest/background/aci/  
- War Room: `/workspace/war-room-os-audit/docs/architecture/NATIVE_BUILDER_ARCHITECTURE_AND_GOVERNANCE.md`, `docs/AGENT_CAPABILITY_MATRIX.md`, `lib/native-builder/*` (READ-ONLY)

## Appendix C — Wave stamp index

**Required stamps:** `waves/WAVE_1.md` … `waves/WAVE_8.md`

**Avengers companion stamps (folded into this report):**
- `WAVE_1_LANDSCAPE_2026.md` — deep landscape
- `WAVE_2_UNDERSTAND_OWN_PLAN.md` — RQ1–4 depth
- `WAVE_3_4_LOOPS_VERIFY.md` — loops + verify science
- `WAVE_7_PARTIAL_BOX_FOUNDRY_INSPECT.md` — box inventory (Nebula offline)
- `WAVE_EVIDENCE_SOURCES.md`, `WAVE_HISTORIAN_LINEAGE.md`, `WAVE_SCIENCE_LOOPS_MEMORY.md`
- `WAVE_BLINDSPOT_OVERCLAIM.md`, `WAVE_ENGINEER_FOUNDRY_FIT.md`

**Mirrors:** `/workspace/foundry-standalone-engineer/` · `/workspace/terra-swarm/foundry-waves/`

---

**END OF REPORT — HARD STOP. No implementation.**
