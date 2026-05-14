/**
 * Council session persistence: survives refresh within the same browser tab.
 * Persisted under key `war-room-council-session` in **sessionStorage** (see `useCouncilSession.ts`).
 *
 * **Dual-write:** When Supabase is configured, the main War Room page also appends the same lines to
 * `war_room_messages` for the active Live Council conversation (`POST /api/conversations/[id]/messages`).
 * If the DB is offline, sessionStorage remains the source of truth for that tab until persistence returns.
 */
export const COUNCIL_SESSION_STORAGE_KEY = 'war-room-council-session'

/** Base cap on autonomous orchestration rounds before Ra'el must speak. */
export const COUNCIL_MAX_CONSECUTIVE_AUTONOMOUS = 8

/** Deep discussion mode raises the autonomous cap. */
export const COUNCIL_MAX_CONSECUTIVE_AUTONOMOUS_DEEP = 20

/** Minimum gap between autonomous orchestration rounds (ms). */
export const COUNCIL_ORCHESTRATION_INTERVAL_MS = 22_000

/** Insert a Red Team turn randomly every N autonomous rounds (deterministic PRNG optional; we use counter). */
export const COUNCIL_RED_TEAM_EVERY_N_TURNS = 4

/** Recent turns to enforce family cooldown (skip if same family spoke last K turns). */
export const COUNCIL_FAMILY_COOLDOWN_TURNS = 2
