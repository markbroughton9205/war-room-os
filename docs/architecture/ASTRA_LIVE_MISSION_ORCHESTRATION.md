# ASTRA Live Mission Orchestration (Roadmap #14)

Status: **PASS / LIVE-VALIDATED / COMMITTED / CLOSED**

This document records the closed Roadmap #14 slice. It does not authorize
constellation spawn, continuous watching, autonomous mission creation,
background agent loops, ASCENSION behavior, or homepage ASTRA buttons.

## Frozen after closeout

Do not add the following unless a later numbered roadmap item explicitly
requires them:

- live constellation spawning (`constellationSpawned` remains `false`)
- continuous mission watching
- autonomous mission creation
- background agent loops
- ASCENSION behavior
- self-directed action execution
- homepage ASTRA buttons merely for parity

ASTRA may invoke or orchestrate Council. ASTRA is not a substantive Council
member (`astraProvidesSubstantiveAnswer` remains `false`).

## Runtime persistence truth

- Prepared table: `war_room_astra_missions`
- Prepared migration: `supabase/war_room_phase58a_astra_live_missions.sql`
- Current local/dev closeout backend: `local_filesystem_fallback` at
  `.war-room/astra-missions/` (gitignored; never tracked)
- The production table is **not** applied as of #14 closeout

## ASTRA DATABASE PRE-DEPLOYMENT BLOCKER

**REQUIRED BEFORE PRODUCTION DEPLOYMENT:**

Apply and validate `supabase/war_room_phase58a_astra_live_missions.sql`
against the intended non-prod database first, then the production database,
according to normal deployment governance. After apply, reload PostgREST:

```sql
select pg_notify('pgrst', 'reload schema');
```

This SQL must **not** be applied to production from an agent session as part
of #14 or #15. The filesystem fallback is acceptable for local/dev only.

This is a production-migration blocker, not a blocker to beginning Roadmap
#15. Surface this requirement again during later production
migration/deployment roadmap items.

## Live acceptance recorded at closeout

- Primary vessel: PILOT L-139 / MMSI 230125910 / `digitraffic_marine`
- Completed mission: `astra-mission-1546253d-8383-4718-9cb3-250ac457c8c1`
- Council conversation: `40aac067-b712-4f8f-9a9e-97c252d018ec`
- Entry point: `executeCouncilChatRequest`
- `constellationSpawned`: false
- `astraProvidesSubstantiveAnswer`: false
- `/globe` untouched
- No new AIS provider implemented
