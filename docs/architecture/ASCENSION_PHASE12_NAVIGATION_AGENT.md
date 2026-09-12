# #22 Phase 12 — Bounded NAVIGATION_AGENT Runtime

**Status:** IMPLEMENTED_BOUNDED  
**Operational Ascension agents:** 8  
**Ascension autonomy:** OFF  
**#22:** CLOSED  
**#23:** PENDING / NOT_STARTED  

## Architecture (preserve)

```
WAR ROOM CORE
    ↓
TERRA (world-state Oracle)
    ↓
NAVIGATION FOUNDATION (Phase 9)
    ↓
NAVIGATION_AGENT (this phase)
```

Critical separations:

- Foundation ≠ Navigation Agent  
- Navigation Agent ≠ Terra  
- Route calculation ≠ autonomous device control  
- Recommendation ≠ auto-execute  
- Council recommendation ≠ authorization  
- ASTRA intent ≠ dispatch  
- Local model ≠ route engine  
- Fixture location ≠ live GNSS  
- Fixture/simulated traffic ≠ live traffic  

## Identity

| Field | Value |
| --- | --- |
| agent_role | NAVIGATION_AGENT |
| runtime_version | ascension-phase12-v1 |
| policy_profile | BOUNDED_NAVIGATION_REASONING |

One canonical agent. No Navigation2. No Terra2. `#21` placeholder `FUTURE_NAVIGATION_AGENT` is fulfilled by this agent, not a second worker.

## Reuse Phase 9

Canonical modules remain `lib/terra/navigation/*`. This agent calls `runNavigationFoundation`, `computeRoute`, `mapMatchLocation`, `classifyOffRoute`, `evaluateRerouteTrigger`, `computeEta`, and `buildNavigationInstructions`. It does not rewrite them.

## API

`POST /api/ascension/navigation-agent/run` — Commander session or local Commander (Phase 11C).

Local Core loopback: `POST /api/local/ascension/navigation-agent/run`.

## Soft kill

`ASCENSION_NAVIGATION_AGENT_ENABLED=false`

When disabled, agent requests reject. Terra Navigation Foundation continues independently.

## Runtime truth

| Capability | Truth |
| --- | --- |
| NAVIGATION_AGENT | IMPLEMENTED |
| NAVIGATION_AGENT_OPERATIONAL | TRUE (unless soft-killed) |
| OPERATIONAL_ASCENSION_AGENTS | 8 |
| TERRA_NAVIGATION_FOUNDATION | IMPLEMENTED |
| MOBILE_GNSS | NOT_SUPPORTED |
| LIVE_TRAFFIC | NOT_IMPLEMENTED |
| PHONE_APP | NOT_IMPLEMENTED |
| AUTONOMOUS_DRIVING | NOT_IMPLEMENTED |
| DEVICE_CONTROL | NOT_IMPLEMENTED |
| ASCENSION_AUTONOMY | OFF |
| PHASE_11D | COMPLETE |
| #22 | ACTIVE |
| #23 | NOT_STARTED |

## Validation

```bash
pnpm run validate:ascension-phase12
```

## Explicitly not in Phase 12

- Phone app / GNSS product  
- World Learning Agent  
- WRIM / Ra'el / #23  
- Second routing engine  
- Automatic reroute execution  
- Live traffic providers  
- Push / deploy  
