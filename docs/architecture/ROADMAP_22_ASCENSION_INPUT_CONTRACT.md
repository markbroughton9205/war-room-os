# Roadmap #22 — Ascension / Agent Development Input Contract

**Source:** Roadmap #21 Agent Capability Matrix
**Status:** NOT STARTED — input specification only
**Do not implement Ascension agents from this document until Commander authorizes #22.**

Machine-readable twin: `lib/agent-capability-matrix/roadmap22Contract.ts`
Full #21 report: `docs/AGENT_CAPABILITY_MATRIX.md`

---

## CURRENT_RUNTIME vs TARGET_ASCENSION

| | |
|---|---|
| **CURRENT_RUNTIME** | What War Room code can do today under existing policy (documented in #21 matrix rows marked `CURRENT_RUNTIME`) |
| **TARGET_ASCENSION** | Proposed Ascension agent definitions only (`TARGET_ASCENSION` rows) — **not** available until #22 implements under these gates |

Never describe TARGET_ASCENSION as CURRENT_RUNTIME. Never grant powers merely because they are discovered.

## Hard constraints (#21 → #22)

1. `CAPABILITY != AUTHORITY`
2. No self-escalation (self-grant, self-approve, privilege spawn, policy laundering)
3. Child agent capability/authority ≤ parent; mission-scoped; time-bounded; no amplification
4. Service-role DB reach ≠ user ownership policy permission (#19)
5. Terra does not authorize action or create missions
6. Council recommendation ≠ authorization
7. ASTRA: `PLANNED != RUNNING`, `MISSION CREATED != ACTION AUTHORIZED`, `SPAWN REQUEST != WORKER SPAWNED`
8. Never describe TARGET_ASCENSION as CURRENT_RUNTIME
9. Never grant powers merely because they are discovered
10. Commander remains ultimate authority for Tier 4 / governed actions

## Mandatory #22 opening hardening gates (do NOT implement in #21)

These are findings / opening requirements from #21. They are **not** capability grants.

| Gate | Requirement |
|---|---|
| **A. Dangerous-kind route wiring** | Wire remaining `DANGEROUS_ACTION_KINDS` (`lib/permissions/policy.ts`) to the actual routes/tools that can perform them, or document intentional parallel gates (e.g. payments). Catalog presence ≠ enforcement. |
| **B. Council auto-research approval classification** | Explicitly classify server-driven live research (`runLiveResearchRouter` on research intents) as `POLICY_AUTO_ALLOWED` vs `SESSION_APPROVAL` (or stricter). Recommendation still ≠ authorization. |
| **C. Audit metadata completeness** | Extend `war_room_audit_logs` / related audit metadata so agent, tool, capability, policy decision, and approval decision are attributable for meaningful actions. |

Also preserve: no-self-escalation · Commander Tier-4 authority · ASTRA phase58a SQL as a **separate** persistence dependency (do not apply as part of opening #22 unless separately authorized).

---

## Agents that may exist under #22

- RESEARCH_AGENT
- ENGINEERING_AGENT
- TERRA_INTELLIGENCE_AGENT
- OPERATIONS_AGENT
- SECURITY_RED_TEAM_AGENT
- COUNCIL_VALIDATOR
- ASTRA_ORCHESTRATOR (existing; extend carefully)
- DATA_CORPUS_AGENT
- FUTURE_NAVIGATION_AGENT (implemented in #22 Phase 12 as NAVIGATION_AGENT)
- WORLD_LEARNING_AGENT (implemented in #22 Phase 13; #21 FUTURE_WORLD_LEARNING_AGENT placeholder fulfilled)

---

## Tool reach bands

### Read by default (policy-bounded)

Terra query · Sovereign Search / web read · Repository read · Git metadata read · Scoped memory read · Session intelligence read · Ollama / model providers under existing gates

### Bounded with approval

Native-builder repo write · Approved crawler corpus write · Memory durable write · Fixed-argv validation shell · ASTRA mission create/execute (Commander session)

### Commander-only or denied by default

Git commit/push · Production deploy · Production restart/stop · Spend/transfer/trade/wager · Email/SMS · Browser computer-use · Destructive SQL · Secrets / external account mutation

---

## Non-delegable

Commander Tier-4 authority · Self-approval · Production deploy · Git push · Financial movement · Destructive DB · Changing approval requirements

---

## Terra / Council / ASTRA

| Actor | May | Must not |
|---|---|---|
| Terra | Provide evidence + provenance | Authorize action; silent missions; act as second Council |
| Council | Reason, challenge, synthesize, recommend, interpret | Authorize by recommendation alone; inherit unrestricted execute |
| ASTRA | Plan missions; invoke Council; plan constellation | Substantive seat answers; claim spawn when false; autonomous create loops |

---

## Audit

Every meaningful agent tool call, approval decision, policy vs technical denial classification, ASTRA lifecycle event, and memory write outcome must be attributable. Prefer extending `war_room_audit_logs` metadata.

---

## Approval types (minimum)

`NO_APPROVAL` · `POLICY_AUTO_ALLOWED` · `SESSION_APPROVAL` · `ONE_ACTION_APPROVAL` · `COMMANDER_EXPLICIT_APPROVAL`

No blanket permanent Tier-4 authorization by default. Reuse existing approval mechanisms; no parallel system unless absolutely necessary.
