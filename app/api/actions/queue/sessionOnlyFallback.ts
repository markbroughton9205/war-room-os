/**
 * Optional operator escape hatch when the action queue cannot write to Supabase.
 *
 * Set `WAR_ROOM_ACTION_QUEUE_SESSION_ONLY_FALLBACK=1` to return a structured 503 with
 * `persisted: false` instead of a generic 500 — still **never** treated as successful persistence
 * (no 201 with a fake row; `x-war-room-persistence` remains `unavailable` when Supabase is down).
 */
export const WAR_ROOM_ACTION_QUEUE_SESSION_ONLY_FALLBACK_ENV = 'WAR_ROOM_ACTION_QUEUE_SESSION_ONLY_FALLBACK'

export function isWarRoomActionQueueSessionOnlyFallbackEnabled(): boolean {
  return process.env[WAR_ROOM_ACTION_QUEUE_SESSION_ONLY_FALLBACK_ENV] === '1'
}
