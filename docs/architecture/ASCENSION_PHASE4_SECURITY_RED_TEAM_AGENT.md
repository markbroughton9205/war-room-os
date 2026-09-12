# #22 Phase 4 — Bounded SECURITY_RED_TEAM_AGENT Runtime

**Status:** IMPLEMENTED_BOUNDED  
**Operational Ascension agents:** 3 (`RESEARCH_AGENT`, `ENGINEERING_AGENT`, `SECURITY_RED_TEAM_AGENT`)  
**Ascension autonomy:** OFF  
**Auto-remediation / exploit / deploy:** DENIED  

## Identity

| Field | Value |
| --- | --- |
| agent_role | SECURITY_RED_TEAM_AGENT |
| runtime_version | ascension-phase4-v1 |
| policy_profile | BOUNDED_SECURITY_EVALUATION |

## Reused architecture

- `lib/permissions/*` (Phase 1) — policy decisions, approval envelope, equivalent-action guards, no-self-escalation
- `lib/war-room/governedAudit.ts` — Gate C audit
- `#19` ownership match helpers
- Research / Engineering deny profiles + worktree path probes
- Agent capability matrix / dangerous-action registry

Does **not** create a second policy engine or audit system.

## Soft kill

`ASCENSION_SECURITY_RED_TEAM_AGENT_ENABLED=false`

## Validation

```bash
pnpm run validate:ascension-phase4
```

## API

`POST /api/ascension/security-red-team-agent/run` (Commander session)
