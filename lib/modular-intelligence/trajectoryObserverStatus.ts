import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isTrajectoryObservationEnabled } from './trajectoryObservationGate'
import { RUNTIME_OBSERVER_DEV_DIR, RAW_TRAJECTORIES_FILENAME } from './runtimeTrajectoryCapture'
import type { CapturedRuntimeTrajectory } from './runtimeTrajectoryCapture'

const PRE_MISSION_GOLD = 12
const V4_MINIMUM = 20

export function readRawRuntimeTrajectories(cwd = process.cwd()): CapturedRuntimeTrajectory[] {
  const path = join(cwd, RUNTIME_OBSERVER_DEV_DIR, RAW_TRAJECTORIES_FILENAME)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as CapturedRuntimeTrajectory)
}

export function readRuntimeObserverStatus(cwd = process.cwd()) {
  const rows = readRawRuntimeTrajectories(cwd)
  const source: Record<string, number> = {}
  const review: Record<string, number> = {}
  const tools: Record<string, number> = {}
  for (const row of rows) {
    source[row.source_type] = (source[row.source_type] ?? 0) + 1
    review[row.review_state] = (review[row.review_state] ?? 0) + 1
    const key = row.decision === 'NO_TOOL' ? 'NO_TOOL' : row.selected_tool ?? 'UNKNOWN'
    tools[key] = (tools[key] ?? 0) + 1
  }
  const realRuntime = rows.filter((r) => r.source_type === 'REAL_RUNTIME')
  const rawPending = rows.filter((r) => r.review_state === 'RAW').length
  return {
    enabled: isTrajectoryObservationEnabled(),
    production_activation: false,
    REAL_RUNTIME_captured: realRuntime.length,
    RAW_pending_review: rawPending,
    VERIFIED_review_state: rows.filter((r) => r.review_state === 'VERIFIED').length,
    CURRICULUM_CANDIDATE: rows.filter((r) => r.review_state === 'CURRICULUM_CANDIDATE').length,
    source_counts: source,
    review_counts: review,
    per_tool: tools,
    pre_mission_usable_gold: PRE_MISSION_GOLD,
    v4_minimum: V4_MINIMUM,
    remaining_v4_gap_before_quality: Math.max(0, V4_MINIMUM - PRE_MISSION_GOLD),
    auto_train: false,
    auto_promote: false,
  }
}
