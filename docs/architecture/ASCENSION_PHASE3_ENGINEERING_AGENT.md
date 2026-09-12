# #22 Phase 3 — Bounded ENGINEERING_AGENT Runtime

**Status:** IMPLEMENTED_BOUNDED  
**Operational Ascension agents:** 2 (`RESEARCH_AGENT`, `ENGINEERING_AGENT`)  
**Ascension autonomy:** OFF  
**Runtime commit/push/deploy authority:** DENIED  

## Identity

| Field | Value |
| --- | --- |
| agent_role | ENGINEERING_AGENT |
| runtime_version | ascension-phase3-v1 |
| policy_profile | BOUNDED_ISOLATED_WORKTREE_ENGINEERING |

## Reused architecture

- `lib/native-builder/patchPolicy.ts` — denylist / bounds patterns
- `lib/native-builder/validationRunner.ts` — fixed-argv validation model (conceptual reuse)
- `lib/repo/paths.ts`, `lib/repo/status.ts`, `lib/repo/diff.ts` — read-only git/repo helpers
- `lib/permissions/*` — Phase 1 governance (deny aliases, no self-escalation, equivalent-action guard)
- `lib/war-room/governedAudit.ts` — Gate C audit metadata
- `#19` ownership pure match (`assertEngineeringOwnerScopeMatch`)

Does **not** create a second generic coding platform. Worktree-scoped writes are implemented in
`lib/ascension/engineering-agent/worktree.ts` (canonical path resolve + allowlist).

## Flow

```
TASK → REPO VERIFIED → ISOLATED WORKTREE VERIFIED → ALLOWED PATHS
  → MODIFY → VALIDATE (allowlist) → DIFF → RETURN RESULT
```

PATCH READY ≠ COMMITTED ≠ PUSHED ≠ DEPLOYED.

## Soft kill

`ASCENSION_ENGINEERING_AGENT_ENABLED=false`

## Validation

```bash
pnpm run validate:ascension-phase3
```

## API

`POST /api/ascension/engineering-agent/run` (Commander session)
