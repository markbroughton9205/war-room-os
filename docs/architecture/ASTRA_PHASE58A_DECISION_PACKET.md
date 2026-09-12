# ASTRA phase58a decision packet

**Apply now:** NO  
**SQL executed:** NO  
**#22 closeout requires apply:** NO  
**Current status:** NOT_APPLIED  

Prepared migration (do not apply in this phase):

`supabase/war_room_phase58a_astra_live_missions.sql`

## What phase58a would add

- Table `public.war_room_astra_missions` with `commander_user_id` ownership
- RLS enabled; service_role policy; anon/authenticated revoked
- Status enum `planned | running | completed | failed`
- Hard constraints `constellation_spawned = false` and `astra_provides_substantive_answer = false`
- Indexes on commander+created, status, conversation, terra object/mmsi
- PostgREST schema reload after apply

## What the current fallback already provides

- Filesystem JSON under `.war-room/astra-missions/` (gitignored)
- `WAR_ROOM_ASTRA_MISSIONS_DIR` override for isolated tests
- `WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM=1` to skip Supabase probe
- create / claim-running / complete / fail contracts
- In-process + file locks for the execute gate
- Commander user id retained on mission records
- Constellation spawn remains false

## Unavailable without apply

- DB-backed multi-instance ASTRA mission durability
- PostgREST query of `war_room_astra_missions`
- Cross-host restore of ASTRA missions from Supabase
- Production ASTRA mission persistence required by later deploy governance

## Migration risks

- Applying against production without Commander authorization
- Confusing `war_room_astra_missions` with `war_room_missions` / `lib/missions`
- Service-role-only access if RLS policies are altered
- Treating filesystem fallback as abandoned

## Rollback

- Do not apply: current fallback remains canonical for local/dev
- If later applied: drop/disable is operator SQL, not an agent action
- Filesystem fallback can remain as a labeled disaster path

## Local sovereign alternative

- ASTRA filesystem fallback is sufficient for #22 cross-agent orchestration proofs
- Durable corpus-candidate handoffs use local SQLite (AppData), independent of phase58a
- Local Commander workflows must not require Supabase

This packet is informational. No SQL is executed by Phase 14.
