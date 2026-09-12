# #22 Phase 1 — Ascension Governance Hardening

**Status:** ACTIVE (Phase 1 complete when validation PASS + committed)
**Does not close #22.** No Ascension execution agents created. Autonomy remains OFF.

## Opening gates addressed

| Gate | Result |
|---|---|
| **A** Dangerous-kind route/tool wiring | Canonical registry + enforcement map; wired `permissions/update`, `income/scout`, `economic/command`; shell equivalent guard; orphans documented STRUCTURAL_NO_REACH / PARALLEL_GATE / NOT_IMPLEMENTED_FAIL_CLOSED |
| **B** Council auto-research classification | `SESSION_BOUNDED_READ_ONLY_DISCOVERY` — search/read/fetch allowed in Commander session; crawl/persist/mutation/spend denied |
| **C** Audit metadata | `buildGovernedAuditMetadata` / `insertGovernedAuditLog` with required policy fields |

## Core modules

- `lib/permissions/dangerousActionRegistry.ts`
- `lib/permissions/policyDecision.ts`
- `lib/permissions/equivalentActionGuard.ts`
- `lib/permissions/noSelfEscalation.ts`
- `lib/permissions/councilAutoResearchAuthority.ts`
- `lib/permissions/approvalEnvelope.ts`
- `lib/war-room/governedAudit.ts`
- `lib/permissions/ascensionPhase1.validation.ts`

## Validate

```bash
node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/permissions/ascensionPhase1.validation.ts
```

## Invariants preserved

- CAPABILITY ≠ AUTHORITY
- Terra cannot authorize
- Council cannot authorize execution
- ASTRA mission ≠ execution authority
- No self-escalation / child ≤ parent
- Ascension autonomy OFF
- Operational Ascension agents: **0**
