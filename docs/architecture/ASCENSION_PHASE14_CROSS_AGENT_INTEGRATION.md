# #22 Phase 14 — Cross-Agent Orchestration + Durable Handoffs

**Status:** IMPLEMENTED  
**Operational Ascension agents:** 9 (unchanged)  
**Ascension autonomy:** OFF  
**ASTRA phase58a:** NOT_APPLIED  
**Production corpus persistence:** FALSE  
**#22:** ACTIVE  
**#23:** NOT_STARTED  

## Architecture (preserved)

```
COMMANDER
    ↓
WAR ROOM
    ↓
TERRA
    ↓
COUNCIL
    ↓
ASTRA
    ↓
ASCENSION AGENTS
    ↓
TOOLS / EXTERNAL WORLD
```

ASTRA remains the canonical executive orchestration layer. This phase adds **helpers** under `lib/ascension/integration/` that invoke existing `runBounded*` agents. It does **not** add:

- a tenth agent
- AscensionOrchestrator2 / AgentBus2 / CouncilRouter2 / MissionEngine2 / WorkflowEngine2
- a new Council or a parallel ASTRA

## Canonical handoff envelope

`createCanonicalHandoff` is the only envelope constructor. It carries owner/session, evidence IDs, provenance, runtime truth, and authority scope. It refuses:

- null owners
- cross-user handoff
- TARGET authority > SOURCE authority
- minting COMMANDER_ONLY / Tier-4
- hidden CoT, credentials, private conversation bodies

## Durable corpus candidates

Local SQLite beside the Phase 11C AppData stack:

`{WAR_ROOM_LOCAL_DATA_DIR or AppData}/data/corpus-candidate-handoffs.sqlite`

Review states: `PROPOSED | CURATED | REQUIRES_REVIEW | REJECTED | APPROVED_FOR_FUTURE_CORPUS | SUPERSEDED`

`APPROVED_FOR_FUTURE_CORPUS ≠ TRAINED ≠ WR-CORPUS`. No automatic #23 promotion. No production corpus write.

## ASTRA persistence truth

`MISSION_DURABILITY_CURRENT_STATE` is the existing filesystem fallback (`.war-room/astra-missions/`) unless a later Commander-authorized apply of phase58a occurs.

This phase **does not apply** `supabase/war_room_phase58a_astra_live_missions.sql`.

See [`ASTRA_PHASE58A_DECISION_PACKET.md`](./ASTRA_PHASE58A_DECISION_PACKET.md).

## Soft kill

Workflows call `isXRuntimeAvailable()` then `runBoundedX`. They do not call internal analyze/synthesize helpers to bypass disable flags. A required disabled agent yields `PARTIAL` / `AGENT_DISABLED` without fabricating downstream completion.
