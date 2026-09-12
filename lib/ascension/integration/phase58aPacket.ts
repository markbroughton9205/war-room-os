/**
 * #22 Phase 14 — ASTRA phase58a decision packet.
 * Factual. Do NOT apply SQL. #22 closeout does not require applying it.
 */
import { ASTRA_PHASE58A_STATUS } from './identity'

export const ASTRA_PHASE58A_DECISION_PACKET = Object.freeze({
  packet_id: 'astra-phase58a-decision-phase14',
  apply_now: false,
  current_status: ASTRA_PHASE58A_STATUS,
  sql_path: 'supabase/war_room_phase58a_astra_live_missions.sql',
  what_phase58a_would_add: [
    'Supabase table public.war_room_astra_missions with commander_user_id ownership',
    'RLS enabled; service_role policy; anon/authenticated revoked',
    'Status enum planned|running|completed|failed',
    'Hard constraints constellation_spawned=false and astra_provides_substantive_answer=false',
    'Indexes on commander+created, status, conversation, terra object/mmsi',
    'PostgREST schema reload after apply',
  ],
  what_current_fallback_already_provides: [
    'Filesystem JSON under .war-room/astra-missions/ (gitignored)',
    'WAR_ROOM_ASTRA_MISSIONS_DIR override for isolated tests',
    'WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM=1 to skip Supabase probe',
    'create / claim-running / complete / fail mission contracts',
    'In-process + file locks for execute gate',
    'Commander user id retained on mission records',
    'Constellation spawn remains false',
  ],
  what_remains_unavailable_without_apply: [
    'DB-backed multi-instance ASTRA mission durability',
    'PostgREST query of war_room_astra_missions',
    'Cross-host restore of ASTRA missions from Supabase',
    'Production ASTRA mission persistence as required by later deploy governance',
  ],
  migration_risks: [
    'Applying against production without Commander authorization',
    'Confusing war_room_astra_missions with war_room_missions / lib/missions',
    'Service-role-only access if RLS policies are altered',
    'Irreversible expectation that filesystem fallback is abandoned',
  ],
  rollback_considerations: [
    'Do not apply: current fallback remains canonical for local/dev',
    'If later applied: drop/disable is operator SQL, not an agent action',
    'Filesystem fallback can remain as labeled disaster path',
  ],
  phase22_closeout_requires_apply: false,
  local_sovereign_alternative: [
    'ASTRA filesystem fallback is sufficient for #22 cross-agent orchestration proofs',
    'Durable corpus-candidate handoffs use local SQLite (AppData), independent of phase58a',
    'Local Commander workflows must not require Supabase',
  ],
  sql_executed: false,
} as const)

export function astraPhase58aDecisionPacket() {
  return ASTRA_PHASE58A_DECISION_PACKET
}
