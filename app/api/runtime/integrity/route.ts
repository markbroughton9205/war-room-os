import { getOrchestrationQueueDepth } from '@/lib/orchestration/taskOrchestrator'
import { insertDiagnosticEvent } from '@/lib/runtime/diagnosticLog'
import {
  buildDeploymentIntegrityRollup,
  buildInternetRollupFromInternetStatusJson,
  buildPersistenceRollup,
  buildProviderIntegritySlots,
  buildRuntimeHealthRollup,
  buildToolsLayerRollup,
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
import type { RuntimeIntegrityResponse } from '@/lib/runtime/runtimeIntegrityTypes'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FAILING_LOG_COOLDOWN_MS = 300_000
const lastFailingIntegrityLogAt = new Map<string, number>()

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
  filter?: { column: string; value: string },
): Promise<SupabaseProbe> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return { ok: false, error: 'Supabase not configured for this runtime.' }
  }
  let q = sup.client.from(table).select(columns).limit(1)
  if (filter) {
    q = sup.client.from(table).select(columns).eq(filter.column, filter.value).limit(1)
  }
  const { error, data } = await q
  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true, hasRows: Array.isArray(data) && data.length > 0 }
}

function trimEnv(name: string): string {
  return typeof process.env[name] === 'string' ? process.env[name]!.trim() : ''
}

function maybeLogFailingSubsystems(subsystems: RuntimeIntegrityResponse['subsystems']): void {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return
  const now = Date.now()
  for (const s of subsystems) {
    if (s.status !== 'FAILING') continue
    const prev = lastFailingIntegrityLogAt.get(s.id) ?? 0
    if (now - prev < FAILING_LOG_COOLDOWN_MS) continue
    lastFailingIntegrityLogAt.set(s.id, now)
    insertDiagnosticEvent(sup.client, {
      subsystem: s.id,
      severity: 'FAILING',
      source_family: 'integrity_poll',
      evidence: {
        label: s.label,
        truthLevel: s.truthLevel,
        evidence: s.evidence.slice(0, 4000),
      },
      recommendation: s.recommendation.slice(0, 2000),
      diagnostic_mode: null,
    })
  }
}

export async function GET(req: Request): Promise<Response> {
  const base = resolveInternalBaseUrl(req)
  const url = new URL(req.url)
  const councilMode = url.searchParams.get('councilMode')?.trim() || null

  const [
    engineRes,
    providersRes,
    sentinelRes,
    rtcRes,
    internetRes,
    localRes,
    deployRes,
    toolsInternetRes,
    toolsResearchRes,
    actionProbe,
    convProbe,
    messagesProbe,
    auditProbe,
    memoryProbe,
  ] = await Promise.all([
    fetchJson(base, '/api/engine-control/status'),
    fetchJson(base, '/api/providers/health'),
    fetchJson(base, '/api/red-sentinel/status'),
    fetchJson(base, '/api/red-team-coder/status'),
    fetchJson(base, '/api/internet/status'),
    fetchJson(base, '/api/local-agent/status'),
    fetchJson(base, '/api/deploy/status'),
    fetchJson(base, '/api/tools/internet/status', 8000),
    fetchJson(base, '/api/tools/research', 8000),
    probeTable('war_room_actions', 'id'),
    probeTable('war_room_conversations', 'id'),
    probeTable('war_room_messages', 'id', { column: 'role', value: 'assistant' }),
    probeTable('war_room_audit_logs', 'id'),
    probeTable('war_room_memory_proposals', 'id'),
  ])

  const subsystems = [
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

  const urlPresent = Boolean(trimEnv('NEXT_PUBLIC_SUPABASE_URL'))
  const anonKeyPresent = Boolean(trimEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'))

  const body: RuntimeIntegrityResponse = {
    generatedAt: new Date().toISOString(),
    overallStatus: computeOverallStatus(subsystems),
    subsystems,
    attendanceParticipation: 'UNKNOWN',
    providers: buildProviderIntegritySlots(engineRes.ok ? engineRes.json : {}, providersRes.ok ? providersRes.json : {}),
    internetRollup: buildInternetRollupFromInternetStatusJson(internetRes.ok ? internetRes.json : null),
    persistence: buildPersistenceRollup({
      conversations: convProbe,
      messages: messagesProbe,
      actions: actionProbe,
      audit: auditProbe,
      memory: memoryProbe,
      urlPresent,
      anonKeyPresent,
    }),
    runtimeHealth: buildRuntimeHealthRollup({
      councilModeFromQuery: councilMode,
      orchestrationQueueDepth: getOrchestrationQueueDepth(),
      subsystems,
    }),
    toolsLayer: buildToolsLayerRollup({
      toolsInternetJson: toolsInternetRes.ok ? toolsInternetRes.json : {},
      toolsResearchJson: toolsResearchRes.ok ? toolsResearchRes.json : {},
      internetStatusJson: internetRes.ok ? internetRes.json : undefined,
    }),
    deployment: buildDeploymentIntegrityRollup(deployRes.ok ? deployRes.json : {}),
  }

  maybeLogFailingSubsystems(subsystems)

  return Response.json(body)
}
