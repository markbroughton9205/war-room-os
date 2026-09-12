# #22 Phase 6 — Bounded TERRA_INTELLIGENCE_AGENT Runtime

**Status:** IMPLEMENTED_BOUNDED  
**Operational Ascension agents:** 5  
**Ascension autonomy:** OFF  
**Action authority / deploy / push / device control:** DENIED  

## Identity

| Field | Value |
| --- | --- |
| agent_role | TERRA_INTELLIGENCE_AGENT |
| runtime_version | ascension-phase6-v1 |
| policy_profile | BOUNDED_TERRA_WORLD_STATE_ANALYSIS |

## Architecture (preserve)

- **Terra** = world-state Oracle
- **TERRA_INTELLIGENCE_AGENT** = bounded analyst of Terra evidence
- **Council** = meaning / synthesis
- **ASTRA** = orchestration (assignment ≠ authorization)
- **Commander** = Tier-4 authority

## Reused architecture

- `lib/terra/liveGeoIntelligence.ts` — freshness / objects / provider statuses
- `lib/terra/maritimeProviderStatus.ts` — Digitraffic / maritime registry truth
- `lib/terra/councilHandoff.ts` — selection ≠ Council send
- Phase 1 governance + governed audit
- Optional Search: read-only only (no crawl expansion)

## Soft kill

`ASCENSION_TERRA_INTELLIGENCE_AGENT_ENABLED=false`

## Validation

```bash
pnpm run validate:ascension-phase6
```

## API

`POST /api/ascension/terra-intelligence-agent/run` (Commander session)

## Explicitly not in Phase 6

- GPS / traffic / navigation
- Planetary descent / imagery ladder
- Terra2 / Globe2
- COUNCIL_VALIDATOR
- Ascension autonomy
