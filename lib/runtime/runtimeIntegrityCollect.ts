/**
 * Single source of truth for runtime integrity payload construction.
 * Used by GET /api/runtime/integrity and by /api/chat when a fresh snapshot is required
 * (no cross-request in-memory caching of probe results).
 */
import { getOrchestrationQueueDepth } from '@/lib/orchestration/taskOrchestrator'
import {
  buildDeploymentIntegrityRollup,
  buildInternetRollupFromInternetStatusJson,
  buildPersistenceRollup,
  buildProviderIntegritySlots,
  buildToolsLayerRollup,
  mapActionQueueProbe,
  mapConversationsProbe,
  mapDeployStatusJson,
  mapEngineControlJson,
  mapInternetStatusJson,
  mapMemoryProbe,
  mapOrchestrationState,
  mapProvidersHealthJson,
  mapRedSentinelJson,
  mapRedTeamCoderJson,
  type SupabaseProbe,
} from '@/lib/runtime/runtimeIntegrityMapper'
import { finalizeRuntimeIntegrityResponse, type RuntimeIntegrityPartial } from '@/lib/runtime/finalizeRuntimeIntegrityResponse'
import type { RuntimeIntegrityResponse } from '@/lib/runtime/runtimeIntegrityTypes'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

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

export type CollectRuntimeIntegrityOptions = {
  councilMode?: string | null
}

/**
 * Raw probe rollup (no headline weighting / dashboard slices). Use `finalizeRuntimeIntegrityResponse`
 * or `collectRuntimeIntegrity` for the public API response.
 */
export async function collectRuntimeIntegrityPartial(
  req: Request,
  opts?: CollectRuntimeIntegrityOptions,
): Promise<RuntimeIntegrityPartial> {
  const base = resolveInternalBaseUrl(req)
  const councilMode = opts?.councilMode?.trim() || null

  const [
    engineRes,
    providersRes,
    sentinelRes,
    rtcRes,
    internetRes,
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
    fetchJson(base, '/api/deploy/status'),
    fetchJson(base, '/api/tools/internet/status', 8000),
    fetchJson(base, '/api/tools/research', 8000),
    probeTable('war_room_actions', 'id'),
    probeTable('war_room_conversations', 'id'),
    probeTable('war_room_messages', 'id', { column: 'role', value: 'assistant' }),
    probeTable('war_room_audit_logs', 'id'),
    probeTable('war_room_memory_proposals', 'id'),
  ])

  const engineJson = engineRes.ok ? engineRes.json : {}
  const providersJson = providersRes.ok ? providersRes.json : {}

  const subsystems = [
    mapEngineControlJson(engineJson),
    mapProvidersHealthJson(providersJson),
    mapRedSentinelJson(sentinelRes.ok ? sentinelRes.json : {}),
    mapRedTeamCoderJson(rtcRes.ok ? rtcRes.json : {}),
    mapInternetStatusJson(internetRes.json, internetRes.status),
    mapDeployStatusJson(deployRes.ok ? deployRes.json : {}),
    mapActionQueueProbe(actionProbe),
    mapConversationsProbe(convProbe),
    mapMemoryProbe(memoryProbe),
    mapOrchestrationState(getOrchestrationQueueDepth()),
  ]

  const urlPresent = Boolean(trimEnv('NEXT_PUBLIC_SUPABASE_URL'))
  const anonKeyPresent = Boolean(trimEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'))

  const generatedAt = new Date().toISOString()

  return {
    generatedAt,
    subsystems,
    attendanceParticipation: 'UNKNOWN',
    providers: buildProviderIntegritySlots(engineJson, providersJson),
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
    toolsLayer: buildToolsLayerRollup({
      toolsInternetJson: toolsInternetRes.ok ? toolsInternetRes.json : {},
      toolsResearchJson: toolsResearchRes.ok ? toolsResearchRes.json : {},
      internetStatusJson: internetRes.ok ? internetRes.json : undefined,
    }),
    deployment: buildDeploymentIntegrityRollup(deployRes.ok ? deployRes.json : {}),
    councilMode,
  }
}

/**
 * Full integrity response for GET /api/runtime/integrity (fresh probes + weighted headline + views).
 */
export async function collectRuntimeIntegrity(
  req: Request,
  opts?: CollectRuntimeIntegrityOptions,
): Promise<RuntimeIntegrityResponse> {
  const partial = await collectRuntimeIntegrityPartial(req, opts)
  return finalizeRuntimeIntegrityResponse(partial)
}
