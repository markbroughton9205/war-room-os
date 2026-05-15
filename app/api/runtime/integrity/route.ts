import { getOrchestrationQueueDepth } from '@/lib/orchestration/taskOrchestrator'
import {
  computeOverallStatus,
  mapActionQueueProbe,
  mapConversationsProbe,
  mapDeployStatusJson,
  mapEngineControlJson,
  mapInternetStatusJson,
  mapLocalAgentJson,
  mapMemoryProbe,
  mapOrchestrationState,
  mapProvidersHealthJson,
  mapRedSentinelJson,
  mapRedTeamCoderJson,
  type SupabaseProbe,
} from '@/lib/runtime/runtimeIntegrityMapper'
import type { RuntimeIntegrityResponse, SubsystemRow } from '@/lib/runtime/runtimeIntegrityTypes'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function resolveInternalBaseUrl(req: Request): string {
  const trimmedPublic = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (trimmedPublic) return trimmedPublic.replace(/\/$/, '')
  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000'
  const protoHeader = req.headers.get('x-forwarded-proto')
  const isLocal = /^(localhost|127\.0\.0\.1)/i.test(host.split(':')[0] ?? '')
  const proto = protoHeader ?? (isLocal ? 'http' : 'https')
  return `${proto}://${host.replace(/\/$/, '')}`
}

async function fetchJson(
  base: string,
  path: string,
  timeoutMs = 12_000,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
      headers: { ...(init?.headers ?? {}), Accept: 'application/json' },
    })
    let json: unknown = {}
    try {
      json = await res.json()
    } catch {
      json = {}
    }
    return { ok: res.ok, status: res.status, json }
  } catch {
    return { ok: false, status: 0, json: {} }
  } finally {
    clearTimeout(t)
  }
}

async function probeTable(
  table: string,
  columns: string,
): Promise<SupabaseProbe> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return { ok: false, error: 'Supabase not configured for this runtime.' }
  }
  const { error, data } = await sup.client.from(table).select(columns).limit(1)
  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true, hasRows: Array.isArray(data) && data.length > 0 }
}

export async function GET(req: Request): Promise<Response> {
  const base = resolveInternalBaseUrl(req)

  const [
    engineRes,
    providersRes,
    sentinelRes,
    rtcRes,
    internetRes,
    localRes,
    deployRes,
    actionProbe,
    convProbe,
    memoryProbe,
  ] = await Promise.all([
    fetchJson(base, '/api/engine-control/status'),
    fetchJson(base, '/api/providers/health'),
    fetchJson(base, '/api/red-sentinel/status'),
    fetchJson(base, '/api/red-team-coder/status'),
    fetchJson(base, '/api/internet/status'),
    fetchJson(base, '/api/local-agent/status'),
    fetchJson(base, '/api/deploy/status'),
    probeTable('war_room_actions', 'id'),
    probeTable('war_room_conversations', 'id'),
    probeTable('war_room_memory_proposals', 'id'),
  ])

  const subsystems: SubsystemRow[] = [
    mapEngineControlJson(engineRes.ok ? engineRes.json : {}),
    mapProvidersHealthJson(providersRes.ok ? providersRes.json : {}),
    mapRedSentinelJson(sentinelRes.ok ? sentinelRes.json : {}),
    mapRedTeamCoderJson(rtcRes.ok ? rtcRes.json : {}),
    mapInternetStatusJson(internetRes.json, internetRes.status),
    mapLocalAgentJson(localRes.ok ? localRes.json : {}),
    mapDeployStatusJson(deployRes.ok ? deployRes.json : {}),
    mapActionQueueProbe(actionProbe),
    mapConversationsProbe(convProbe),
    mapMemoryProbe(memoryProbe),
    mapOrchestrationState(getOrchestrationQueueDepth()),
  ]

  const body: RuntimeIntegrityResponse = {
    generatedAt: new Date().toISOString(),
    overallStatus: computeOverallStatus(subsystems),
    subsystems,
  }

  return Response.json(body)
}
