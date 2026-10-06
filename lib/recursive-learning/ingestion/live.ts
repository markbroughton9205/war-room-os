import { defaultLearningLog } from '../paths'
import { missionToEvents } from './missionAdapter'
import { recordIngestionFailure } from './failureLog'

/**
 * Live hook for terminal mission transitions. Failure-safe by construction: never throws, never awaited by the
 * caller's critical path, and disabled with WAR_ROOM_LEARNING_INGEST=off. A failed ingestion is logged honestly
 * and produces no event.
 */
export function ingestMissionOutcomeSafe(mission: unknown): void {
  if (process.env.WAR_ROOM_LEARNING_INGEST === 'off') return
  // test runs must not write into the real War Room evidence log unless explicitly redirected
  if (process.env.NODE_ENV === 'test' && !process.env.WAR_ROOM_LEARNING_DIR) return
  const id = typeof (mission as { missionId?: unknown })?.missionId === 'string' ? (mission as { missionId: string }).missionId : 'unknown'
  try {
    const { events, skipped } = missionToEvents(mission, { backfilled: false })
    if (events.length === 0) {
      if (skipped === 'secret_detected') recordIngestionFailure('foundry-mission', id, 'secret_detected: event withheld')
      return
    }
    const res = defaultLearningLog().recordEvents(events)
    for (const r of res.rejected) recordIngestionFailure('foundry-mission', id, `rejected: ${r.reason}`)
  } catch (err) {
    recordIngestionFailure('foundry-mission', id, `ingest_error: ${err instanceof Error ? err.message : 'unknown'}`)
  }
}
