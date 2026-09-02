import { assertAutoOrApproval } from '@/lib/permissions/policy'
import { orchestrateWarRoomSearch, type SearchProviderId } from '@/lib/internet/warRoomSearchOrchestrator'
import { getResourceSnapshot } from '@/lib/system/resourceMonitor'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { fetchWarRoomPermissionsState, recordLastStandingAutoAction } from '@/lib/war-room/permissionsState'
import {
  canRunInternetPoll,
  recordInternetPoll,
  releaseWorkerSlot,
  shouldPauseWorkersDueToResources,
  tryAcquireWorkerSlot,
} from '@/lib/workers/limits'
import { observeWarRoomApiTool } from '@/lib/modular-intelligence/warRoomToolTrajectoryObserve'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTION_KIND = 'internet_research'

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, sup.ok, { status: 400 })
  }

  const body = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  const state = await fetchWarRoomPermissionsState(sup.ok ? sup.client : null)
  const gate = assertAutoOrApproval({
    mode: state.mode,
    safetyLock: state.safetyLock,
    actionKind: ACTION_KIND,
    body,
  })

  if (!gate.ok) {
    return jsonWithPersistence({ error: gate.error }, sup.ok, { status: gate.status })
  }

  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query) {
    return jsonWithPersistence({ error: 'query is required.' }, sup.ok, { status: 400 })
  }

  const snapshot = getResourceSnapshot()
  if (shouldPauseWorkersDueToResources(snapshot)) {
    return jsonWithPersistence(
      { error: 'Server memory pressure high; try again shortly.', retryAfterMs: 5000 },
      sup.ok,
      { status: 429, headers: { 'Retry-After': '5' } },
    )
  }

  if (!canRunInternetPoll()) {
    return jsonWithPersistence(
      { error: 'Internet poll rate limit exceeded.', retryAfterMs: 60_000 },
      sup.ok,
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

  const worker = tryAcquireWorkerSlot('internet')
  if (!worker.ok) {
    return jsonWithPersistence(
      { error: worker.error, retryAfterMs: worker.retryAfterMs },
      sup.ok,
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(worker.retryAfterMs / 1000))) } },
    )
  }

  recordInternetPoll()

  const providers = Array.isArray(body.providers)
    ? body.providers.filter((p): p is SearchProviderId => p === 'grok' || p === 'tavily' || p === 'firecrawl')
    : undefined

  let result: Awaited<ReturnType<typeof orchestrateWarRoomSearch>>
  try {
    result = await orchestrateWarRoomSearch({
      query,
      providers,
      conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
      actionId: typeof body.actionId === 'string' ? body.actionId : null,
      supabase: sup.ok ? sup.client : null,
    })
  } finally {
    releaseWorkerSlot()
  }

  if (gate.viaAutoPolicy && sup.ok) {
    await recordLastStandingAutoAction(sup.client, {
      kind: ACTION_KIND,
      detail: { queryLength: query.length, providerCount: providers?.length ?? 0 },
    })
    await insertWarRoomAuditLog(sup.client, {
      actor: 'system',
      category: 'permissions',
      message: `Standing auto-run: ${ACTION_KIND}`,
      metadata: { auto: true, actionKind: ACTION_KIND, mode: state.mode },
    })
  }

  const tavilyOnly = Array.isArray(providers) && providers.length === 1 && providers[0] === 'tavily'
  observeWarRoomApiTool({
    toolId: tavilyOnly ? 'web' : 'research',
    requestText: query,
    arguments: { query },
    ok: true,
    status: 'complete',
    resultMeta: {
      op: 'internet_search',
      providerCount: result.providerOrder.length,
      providers: result.providerOrder.join(','),
    },
  })

  return jsonWithPersistence({ result }, sup.ok)
}
