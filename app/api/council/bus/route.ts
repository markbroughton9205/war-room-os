import { loadCouncilThreadFromStore, snapshotThreadForClient } from '@/lib/cognitive-bus/persistence'
import type { DeliberationStepKind } from '@/lib/orchestration/deliberation'
import { runDeliberationStep } from '@/lib/orchestration/deliberation'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DELIBERATION_KINDS = [
  'intake',
  'advance',
  'register_packet',
  'challenge',
  'synthesize',
  'approve_operator_packet',
] as const

function isDeliberationKind(value: string): value is DeliberationStepKind {
  return (DELIBERATION_KINDS as readonly string[]).includes(value)
}

function isFamily(value: string): value is CouncilOrchestrationFamily {
  return ['chatgpt', 'claude', 'grok', 'gemini', 'red_team', 'baby', 'kimi', 'bridge_architect'].includes(value)
}

export async function GET(req: Request) {
  const sup = tryWarRoomSupabase()
  const url = new URL(req.url)
  const threadId = (url.searchParams.get('threadId') ?? '').trim()
  if (!threadId) {
    return jsonWithPersistence({ ok: false, error: 'threadId required' }, sup.ok, { status: 400 })
  }

  if (sup.ok) {
    const loaded = await loadCouncilThreadFromStore(sup.client, threadId)
    if (!loaded.ok) {
      return jsonWithPersistence({ ok: false, error: loaded.error }, sup.ok, { status: 503 })
    }
  }

  const snapshot = snapshotThreadForClient(threadId, 100)
  return jsonWithPersistence(
    {
      ok: true,
      ...snapshot,
      orchestrationSummary: {
        phase: snapshot.state.phase,
        consensusState: snapshot.state.operatorPacket?.consensus_state ?? null,
        openContradictions: snapshot.state.operatorPacket?.open_contradictions ?? [],
        commanderApprovalRequired: snapshot.state.operatorPacket?.commander_approval_required ?? true,
      },
    },
    sup.ok,
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()
  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    body = {}
  }

  const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : ''
  const kindRaw = typeof body.kind === 'string' ? body.kind.trim() : ''
  if (!threadId || !kindRaw || !isDeliberationKind(kindRaw)) {
    return jsonWithPersistence(
      { ok: false, error: 'threadId and valid kind required (server orchestration only).' },
      sup.ok,
      { status: 400 },
    )
  }

  if (sup.ok) {
    await loadCouncilThreadFromStore(sup.client, threadId)
  }

  const familyRaw = typeof body.family === 'string' ? body.family.trim() : ''
  const result = await runDeliberationStep(sup.ok ? sup.client : null, {
    threadId,
    kind: kindRaw,
    decree: typeof body.decree === 'string' ? body.decree : undefined,
    signalId: typeof body.signalId === 'string' ? body.signalId : undefined,
    family: familyRaw && isFamily(familyRaw) ? familyRaw : undefined,
    displayText: typeof body.displayText === 'string' ? body.displayText : undefined,
    correlationId: typeof body.correlationId === 'string' ? body.correlationId : undefined,
    approved: body.approved === true,
  })

  if (!result.ok) {
    return jsonWithPersistence(
      {
        ok: false,
        phase: result.phase,
        priority: result.priority,
        events: result.events,
        operatorPacket: result.operatorPacket,
        routedFamilies: result.routedFamilies,
        consensusState: result.consensusState,
        error: result.error,
      },
      sup.ok,
      { status: 400 },
    )
  }

  return jsonWithPersistence(
    {
      ok: true,
      phase: result.phase,
      priority: result.priority,
      routedFamilies: result.routedFamilies,
      consensusState: result.consensusState,
      operatorPacket: result.operatorPacket,
      events: result.events.map(event => ({
        id: event.id,
        type: event.type,
        at: event.at,
        payload: sanitizeEventPayload(event.payload),
      })),
      commanderAuthority: 'Commander approval required for escalations and PROPOSED operator packets.',
    },
    sup.ok,
    { headers: { 'cache-control': 'no-store' } },
  )
}

function sanitizeEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (key.toLowerCase().includes('prompt') || key.toLowerCase().includes('apikey')) continue
    if (typeof value === 'string') out[key] = value.slice(0, 600)
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) out[key] = value
    else if (Array.isArray(value)) out[key] = value.slice(0, 12)
    else if (value && typeof value === 'object') out[key] = sanitizeEventPayload(value as Record<string, unknown>)
  }
  return out
}
