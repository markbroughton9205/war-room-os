# #22 Phase 2 — Bounded RESEARCH_AGENT Runtime

**Status:** ACTIVE (#22 not closed)  
**Operational Ascension agents:** 2 (shared registry — RESEARCH_AGENT + ENGINEERING_AGENT)  
**Ascension autonomy:** OFF  
**This agent:** RESEARCH_AGENT remains IMPLEMENTED_BOUNDED / invocation-driven
  

## Runtime truth

| Claim | Truth |
|---|---|
| RESEARCH_AGENT | IMPLEMENTED_BOUNDED |
| Mode | READ-ONLY DISCOVERY / SESSION_BOUNDED |
| Invocation | Commander / Council / ASTRA wrappers — same pipeline |
| Autonomous | false |
| Ascension autonomy | OFF |

## Modules

- `lib/ascension/research-agent/*`
- `POST /api/ascension/research-agent/run` (Commander session)

## Reuses

`runLiveResearchRouter` → `buildLiveResearchEvidencePacket` → Phase 1 `evaluateCouncilAutoResearch` + `governedAudit`

## Validate

```bash
node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/ascension/research-agent/validation.ts
```
