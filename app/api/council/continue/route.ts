import { applyRollingContextCompression } from '@/lib/context-compression/rolling'
import { buildCouncilMemoryBridge } from '@/lib/council-memory/bridge'
import { loadCouncilThreadFromStore, publishAndPersistBusEvent } from '@/lib/cognitive-bus/persistence'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  applyContinuationPlanToRuntime,
  createConversationRuntime,
  planCouncilContinuation,
  toRuntimeSnapshot,
} from '@/lib/conversation-runtime'
import {
  conversationRuntimeMigrationHint,
  loadConversationRuntimeFromSupabase,
  persistConversationRuntimeToSupabase,
} from '@/lib/conversation-runtime/persist'
import { rebuildConversationRuntime } from '@/lib/conversation-runtime/sync'
import { mergeProviderStatesFromMessages } from '@/lib/provider-state/store'
import { runDeliberationStep } from '@/lib/orchestration/deliberation'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FAMILIES: CouncilOrchestrationFamily[] = [
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'red_team',
  'baby',
  'kimi',
  'bridge_architect',
]

function isFamily(value: string): value is CouncilOrchestrationFamily {
  return FAMILIES.includes(value as CouncilOrchestrationFamily)
}

function coerceMessages(raw: unknown): { familyName: string; content: string; messageType: string }[] {
  if (!Array.isArray(raw)) return []
  const out: { familyName: string; content: string; messageType: string }[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (typeof r.familyName !== 'string' || typeof r.content !== 'string') continue
    out.push({
      familyName: r.familyName,
      content: r.content,
      messageType: typeof r.messageType === 'string' ? r.messageType : 'response',
    })
  }
  return out
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

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : ''
  const activeTopic = typeof body.activeTopic === 'string' ? body.activeTopic.trim() : ''
  const maxSteps = typeof body.maxSteps === 'number' ? Math.min(3, Math.max(1, body.maxSteps)) : 3

  if (!sessionId) {
    return jsonWithPersistence({ ok: false, error: 'sessionId required' }, sup.ok, { status: 400 })
  }

  let runtime = createConversationRuntime(sessionId, threadId || null)
  if (threadId && sup.ok) {
    const loaded = await loadConversationRuntimeFromSupabase(sup.client, threadId)
    if (loaded.runtime && typeof loaded.runtime === 'object') {
      runtime = { ...runtime, ...loaded.runtime, sessionId }
    }
    await loadCouncilThreadFromStore(sup.client, threadId)
  }

  const messages = coerceMessages(body.messages)
  if (messages.length) {
    runtime = {
      ...runtime,
      providerStates: mergeProviderStatesFromMessages(runtime.providerStates, messages),
      activeTopic: activeTopic || runtime.activeTopic,
    }
  }

  if (body.council && typeof body.council === 'object') {
    const council = body.council as { sessionId?: string; messages?: unknown[]; lastActivityAt?: number }
    if (council.sessionId === sessionId && Array.isArray(council.messages)) {
      runtime = rebuildConversationRuntime(
        {
          v: 1,
          sessionId,
          councilState: 'active',
          lastActivityAt: typeof council.lastActivityAt === 'number' ? council.lastActivityAt : Date.now(),
          messages: council.messages as import('@/components/council/councilSessionTypes').PersistedCouncilMessage[],
          deepDiscussionMode: false,
          consecutiveAutonomousCount: 0,
          lastSpeakerFamily: null,
          cooldownUntil: {},
          isAwaitingResponses: false,
          requiresRaelForAutonomous: false,
          providerErrorMessage: null,
          recentOrchestrationSpeakers: [],
          autonomousRoundIndex: 0,
          lastContentHashByFamily: {},
          councilChannelOpen: true,
        },
        threadId || null,
        runtime,
      )
    }
  }

  const rolling = applyRollingContextCompression(
    messages.map((m, i) => ({
      id: `continue-${i}`,
      familyName: m.familyName,
      content: m.content,
      messageType: m.messageType,
    })),
  )
  if (rolling.applied) {
    runtime = {
      ...runtime,
      rollingSummary: rolling.summaryBlock,
      compressedSnapshot: rolling.compressed,
      latestSynthesis: rolling.compressed.decisionSummary[0] ?? runtime.latestSynthesis,
    }
  }

  const plan = planCouncilContinuation(runtime, { activeTopic: activeTopic || runtime.activeTopic, maxSteps })
  runtime = applyContinuationPlanToRuntime(runtime, plan)

  if (threadId && sup.ok) {
    const persisted = await persistConversationRuntimeToSupabase(sup.client, threadId, runtime)
    if (persisted.migrationRequired) {
      runtime = {
        ...runtime,
        humanAuthorityNote: `${runtime.humanAuthorityNote} Migration: ${conversationRuntimeMigrationHint()}`,
      }
    }
  }

  if (threadId && plan.ok && sup.ok) {
    await runDeliberationStep(sup.client, { threadId, kind: 'synthesize', correlationId: sessionId })
    for (const step of plan.steps) {
      await publishAndPersistBusEvent(sup.client, {
        threadId,
        type: 'synthesis_step',
        correlationId: sessionId,
        payload: {
          conversationalTurn: step.turnType,
          family: step.family,
          preview: step.promptHint.slice(0, 280),
          commanderAuthority: "Ra'el approval required for external actions.",
        },
      })
      try {
        await buildCouncilMemoryBridge(sup.client, step.family)
      } catch {
        /* memory bridge optional */
      }
    }
  }

  const providerUpdates = Array.isArray(body.providerUpdates) ? body.providerUpdates : []
  for (const row of providerUpdates) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const familyRaw = typeof r.family === 'string' ? r.family.trim() : ''
    const displayText = typeof r.displayText === 'string' ? r.displayText.trim() : ''
    if (!familyRaw || !displayText || !isFamily(familyRaw)) continue
    if (threadId && sup.ok) {
      await runDeliberationStep(sup.client, {
        threadId,
        kind: 'register_packet',
        family: familyRaw,
        displayText,
        correlationId: sessionId,
      })
    }
  }

  return jsonWithPersistence(
    {
      ok: plan.ok,
      plan,
      runtime: toRuntimeSnapshot(runtime),
      rolling: rolling.applied
        ? { summaryBlock: rolling.summaryBlock.slice(0, 1200), tokenEstimateAfter: rolling.tokenEstimateAfter }
        : null,
      conversationalOnly: true,
      commanderAuthority: "Ra'el retains final authority; no autonomous external actions.",
      chatInvokeHint:
        'Invoke /api/chat with mode "continue", councilSingleFamily, conversationalTurn: true, and raelDirectiveText set to active topic.',
    },
    sup.ok,
    { headers: { 'cache-control': 'no-store' } },
  )
}
