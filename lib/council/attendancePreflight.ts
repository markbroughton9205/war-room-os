import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { orchestrationFamilyToLocalAgentId } from '@/components/council/councilOrchestration'
import type { EngineControlStatusResponse, EngineId, EngineStatus } from '@/lib/engine-control/types'
import { engineRowMap, isEngineFunctional, unavailableReason } from '@/lib/council/familyRoster'
import { raceWithTimeout } from '@/lib/council/providerIsolation'
import { ATTENDANCE_PREFLIGHT_PER_FAMILY_MS } from '@/lib/council/providerTimeouts'

export type AttendancePreflightStatus = 'healthy' | 'unavailable' | 'degraded'

export type AttendancePreflightOpts = {
  perFamilyTimeoutMs?: number
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
  if (row.configured && row.reachable) {
    const reason = unavailableReason(row)
    if (reason !== 'ok' && reason !== 'not configured') return 'degraded'
  }
  return 'unavailable'
}

async function resolveEngineMap(
  opts: AttendancePreflightOpts,
  budgetMs: number,
): Promise<Map<EngineId, EngineStatus>> {
  if (opts.engineMap && opts.engineMap.size > 0) return opts.engineMap

  const raced = await raceWithTimeout(
    fetch('/api/engine-control/status', { cache: 'no-store', signal: opts.signal }).then(async res => {
      if (!res.ok) throw new Error('engine-control status not ok')
      const json = (await res.json()) as EngineControlStatusResponse
      return engineRowMap(json.engines)
    }),
    budgetMs,
  )

  if (raced.ok) return raced.value
  return opts.engineMap ?? new Map()
}

/**
 * Lightweight per-family readiness probe for attendance gather (no model generate).
 */
export async function runAttendancePreflight(
  families: CouncilOrchestrationFamily[],
  opts: AttendancePreflightOpts = {},
): Promise<Partial<Record<CouncilOrchestrationFamily, AttendancePreflightStatus>>> {
  const perFamilyMs = opts.perFamilyTimeoutMs ?? ATTENDANCE_PREFLIGHT_PER_FAMILY_MS
  const unique = [...new Set(families)]
  const engineMap = await resolveEngineMap(opts, perFamilyMs)

  const out: Partial<Record<CouncilOrchestrationFamily, AttendancePreflightStatus>> = {}

  await Promise.all(
    unique.map(async family => {
      const raced = await raceWithTimeout(
        Promise.resolve(classifyFamilyFromEngineMap(family, engineMap, opts)),
        perFamilyMs,
      )
      out[family] = raced.ok ? raced.value : 'unavailable'
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
