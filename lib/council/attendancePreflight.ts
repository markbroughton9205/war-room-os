import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { orchestrationFamilyToLocalAgentId } from '@/components/council/councilOrchestration'
import type { EngineControlStatusResponse, EngineId, EngineStatus } from '@/lib/engine-control/types'
import { engineRowMap, isEngineFunctional } from '@/lib/council/familyRoster'
import { raceWithTimeout } from '@/lib/council/providerIsolation'
import {
  ATTENDANCE_PREFLIGHT_PER_FAMILY_MS,
  ATTENDANCE_PREFLIGHT_STATUS_FETCH_MS,
} from '@/lib/council/providerTimeouts'

export type AttendancePreflightStatus = 'healthy' | 'unavailable' | 'degraded'

export type AttendancePreflightOpts = {
  perFamilyTimeoutMs?: number
  statusFetchTimeoutMs?: number
  engineMap?: Map<EngineId, EngineStatus>
  localFamilyAgents?: { familyAgents: { id: string; functional: boolean }[] }
  skipGeminiForSession?: boolean
  signal?: AbortSignal
}

function cloudEngineIdForFamily(family: CouncilOrchestrationFamily): EngineId | null {
  if (family === 'chatgpt' || family === 'baby') return 'chatgpt'
  if (family === 'claude' || family === 'red_team') return 'claude'
  if (family === 'grok') return 'grok'
  if (family === 'gemini') return 'gemini'
  return null
}

function classifyFamilyFromEngineMap(
  family: CouncilOrchestrationFamily,
  engineMap: Map<EngineId, EngineStatus>,
  opts: AttendancePreflightOpts,
): AttendancePreflightStatus {
  if (family === 'gemini' && opts.skipGeminiForSession) return 'unavailable'

  if (family === 'kimi' || family === 'bridge_architect') {
    const agentId = orchestrationFamilyToLocalAgentId(family)
    if (!agentId) return 'unavailable'
    const agent = opts.localFamilyAgents?.familyAgents.find(a => a.id === agentId)
    return agent?.functional ? 'healthy' : 'unavailable'
  }

  const eid = cloudEngineIdForFamily(family)
  if (!eid) return 'unavailable'

  const row = engineMap.get(eid)
  if (!row?.configured) return 'unavailable'
  if (isEngineFunctional(engineMap, eid)) return 'healthy'
  // Key present but engine-status slow or probe failed — still attempt minimal attendance call.
  if (row.configured) return 'degraded'
  return 'unavailable'
}

async function resolveEngineMap(
  opts: AttendancePreflightOpts,
  budgetMs: number,
): Promise<{ map: Map<EngineId, EngineStatus>; fetchTimedOut: boolean }> {
  if (opts.engineMap && opts.engineMap.size > 0) {
    return { map: opts.engineMap, fetchTimedOut: false }
  }

  const raced = await raceWithTimeout(
    fetch('/api/engine-control/status', { cache: 'no-store', signal: opts.signal }).then(async res => {
      if (!res.ok) throw new Error('engine-control status not ok')
      const json = (await res.json()) as EngineControlStatusResponse
      return engineRowMap(json.engines)
    }),
    budgetMs,
  )

  if (raced.ok) return { map: raced.value, fetchTimedOut: false }
  if (opts.engineMap && opts.engineMap.size > 0) {
    return { map: opts.engineMap, fetchTimedOut: raced.reason === 'timeout' }
  }
  return { map: new Map(), fetchTimedOut: raced.reason === 'timeout' }
}

/**
 * Lightweight per-family readiness probe for attendance gather (no model generate).
 */
export async function runAttendancePreflight(
  families: CouncilOrchestrationFamily[],
  opts: AttendancePreflightOpts = {},
): Promise<Partial<Record<CouncilOrchestrationFamily, AttendancePreflightStatus>>> {
  const perFamilyMs = opts.perFamilyTimeoutMs ?? ATTENDANCE_PREFLIGHT_PER_FAMILY_MS
  const statusFetchMs = opts.statusFetchTimeoutMs ?? ATTENDANCE_PREFLIGHT_STATUS_FETCH_MS
  const unique = [...new Set(families)]
  const { map: engineMap, fetchTimedOut } = await resolveEngineMap(opts, statusFetchMs)

  const out: Partial<Record<CouncilOrchestrationFamily, AttendancePreflightStatus>> = {}

  await Promise.all(
    unique.map(async family => {
      const raced = await raceWithTimeout(
        Promise.resolve(classifyFamilyFromEngineMap(family, engineMap, opts)),
        perFamilyMs,
      )
      if (raced.ok) {
        out[family] = raced.value
        return
      }
      const fallback = classifyFamilyFromEngineMap(family, engineMap, opts)
      out[family] = fetchTimedOut && fallback !== 'unavailable' ? 'degraded' : fallback
    }),
  )

  return out
}

export function attendancePreflightToProviderRuntime(
  status: AttendancePreflightStatus | undefined,
): 'READY' | 'DEGRADED' | 'SKIPPED' {
  if (status === 'healthy') return 'READY'
  if (status === 'degraded') return 'DEGRADED'
  return 'SKIPPED'
}

/** True when attendance gather should skip /api/chat for this family (missing key / local down only). */
export function attendancePreflightSkipsChat(
  status: AttendancePreflightStatus | undefined,
): boolean {
  return status === 'unavailable'
}
