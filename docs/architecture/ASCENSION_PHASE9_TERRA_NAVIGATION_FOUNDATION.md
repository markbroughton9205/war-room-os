# #22 Phase 9 — Terra Navigation Foundation

**Status:** IMPLEMENTED_BOUNDED (foundation only)  
**Operational Ascension agents:** 7 (unchanged — no new agent)  
**Ascension autonomy:** OFF  
**FUTURE_NAVIGATION_AGENT:** fulfilled by NAVIGATION_AGENT in Phase 12 (this document is the foundation only)  
**#22:** ACTIVE  
**#23:** NOT STARTED  

## Architecture (preserve)

| Layer | Role |
| --- | --- |
| TERRA | World-state oracle + Earth surface |
| TERRA NAVIGATION FOUNDATION | Location / road graph / routing / traffic contract / navigation capability |
| FUTURE_NAVIGATION_AGENT | Bounded worker — implemented in Phase 12 as NAVIGATION_AGENT |

Critical separations:

- Foundation ≠ Navigation Agent  
- Route calculation ≠ autonomous device control  
- Traffic contract ≠ live traffic provider  
- GPS input ≠ surveillance authority  
- Route available ≠ action authorized  
- Mission ≠ movement authorization  

## Canonical module

`lib/terra/navigation/*`

| File | Responsibility |
| --- | --- |
| `types.ts` | Contracts (location, road, traffic, incident, route, ETA, instructions, mobile) |
| `geometry.ts` | Haversine / bearing / polyline; reuses `isValidLiveCoordinate` |
| `location.ts` | GNSS observation + privacy defaults (SESSION_SCOPED) |
| `graph.ts` | Bounded graph build + Helsinki fixture |
| `routing.ts` | Deterministic **A\*** shortest-time routing (DRIVING) |
| `guidance.ts` | Map match, off-route, ETA, instructions, traffic truth, fixtures |
| `ownership.ts` | Owner scope, Baby deny, no tracking/device control |
| `runtimeTruth.ts` | Capability + roadmap truth |
| `service.ts` | Request-driven orchestration + governed audit |
| `validation.ts` | Deterministic Phase 9 gates |

## Reused (not duplicated)

- `lib/terra/liveGeoIntelligence.ts` — coordinate validation  
- `lib/terra/roadTrafficSourceRegistry.ts` — registered road/traffic sources (registered ≠ live nav traffic)  
- Existing Terra Earth surface / Cesium / urban detail (unchanged visuals)  
- `requireCommanderSession` for API ownership  
- Ascension operational registry (count stays 7)  

## Runtime truth (honest)

| Capability | Truth |
| --- | --- |
| LOCATION_INPUT | IMPLEMENTED |
| ROAD_GRAPH | IMPLEMENTED_BOUNDED |
| ROUTING | IMPLEMENTED_BOUNDED |
| MAP_MATCHING | IMPLEMENTED_BOUNDED |
| NAVIGATION_INSTRUCTIONS | IMPLEMENTED_BOUNDED |
| TRAFFIC_CONTRACT | IMPLEMENTED |
| LIVE_TRAFFIC | NOT_IMPLEMENTED |
| INCIDENTS | FIXTURE_ONLY |
| MOBILE_GNSS | NOT_SUPPORTED |
| BACKGROUND_TRACKING | DENIED |
| DEVICE_CONTROL | DENIED |
| FUTURE_NAVIGATION_AGENT | IMPLEMENTED_BOUNDED (Phase 12 NAVIGATION_AGENT) |

## APIs (Commander session)

- `GET /api/terra/navigation/status`
- `POST /api/terra/navigation/route`
- `POST /api/terra/navigation/match`
- `POST /api/terra/navigation/progress`

## Validation

```bash
node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/navigation/validation.ts
# or
pnpm run validate:ascension-phase9
```

## Explicitly not in Phase 9

- FUTURE_NAVIGATION_AGENT / FUTURE_WORLD_LEARNING_AGENT  
- #23 / WR-CORPUS / tokenizer / WRIM / Ra'el  
- Live traffic provider wiring that invents speeds  
- Mobile GPS app UI  
- Background tracking daemon / device control  
- ASTRA phase58a SQL apply  
- New Terra2 / Map2 / Globe2 / RoadGraph2  
- Push / deploy / production or DEV :3001 restart  
