import type { CouncilPersistedV1, PersistedCouncilMessage } from '@/components/council/councilSessionTypes'
import {
  AUTO_CONTINUATION_COOLDOWN_MS,
  CONVERSATION_RUNTIME_STORAGE_KEY,
  IDLE_SESSION_TIMEOUT_MS,
  MAX_TURNS_PER_BURST,
} from '@/lib/conversation-runtime/config'
import type {
  ConversationTurnRecord,
  ConversationTurnType,
  CouncilConversationRuntime,
  ConversationRuntimeSnapshot,
} from '@/lib/conversation-runtime/types'
import { createInitialProviderStates } from '@/lib/provider-state/store'

function newTurnId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createConversationRuntime(sessionId: string, threadId: string | null = null): CouncilConversationRuntime {
  return {
    v: 1,
    sessionId,
    threadId,
    activeTopic: 'Awaiting decree',
    lastActivityAt: Date.now(),
    turnCount: 0,
    burstTurnCount: 0,
    lastContinuationAt: null,
    idleExpired: false,
    turns: [],
    rollingSummary: null,
    compressedSnapshot: null,
    providerStates: createInitialProviderStates(),
    unresolvedInvestigations: [],
    contradictionMap: {},
    latestSynthesis: null,
    councilMomentum: 'idle',
    humanAuthorityNote: "Ra'el retains final authority; provider continuation is conversational only.",
  }
}

export function isSessionIdle(runtime: CouncilConversationRuntime, now = Date.now()): boolean {
  return now - runtime.lastActivityAt > IDLE_SESSION_TIMEOUT_MS
}

export function canAutoContinue(runtime: CouncilConversationRuntime, now = Date.now()): boolean {
  if (isSessionIdle(runtime, now)) return false
  if (runtime.burstTurnCount >= MAX_TURNS_PER_BURST) return false
  if (runtime.lastContinuationAt && now - runtime.lastContinuationAt < AUTO_CONTINUATION_COOLDOWN_MS) return false
  return true
}

export function touchConversationRuntime(runtime: CouncilConversationRuntime): CouncilConversationRuntime {
  const now = Date.now()
  return {
    ...runtime,
    lastActivityAt: now,
    idleExpired: false,
  }
}

export function recordConversationTurn(
  runtime: CouncilConversationRuntime,
  input: {
    type: ConversationTurnType
    family?: import('@/components/council/councilSessionTypes').CouncilOrchestrationFamily
    messageId?: string
    preview: string
    countsAsBurst?: boolean
  },
): CouncilConversationRuntime {
  const turn: ConversationTurnRecord = {
    id: newTurnId(),
    type: input.type,
    at: new Date().toISOString(),
    family: input.family as ConversationTurnRecord['family'],
    messageId: input.messageId,
    preview: input.preview.slice(0, 280),
  }
  const burstDelta = input.countsAsBurst === false ? 0 : 1
  return touchConversationRuntime({
    ...runtime,
    turnCount: runtime.turnCount + 1,
    burstTurnCount: runtime.burstTurnCount + burstDelta,
    turns: [...runtime.turns, turn].slice(-120),
  })
}

export function deriveActiveTopicFromMessages(messages: PersistedCouncilMessage[]): string {
  const decreeIdx = messages.findLastIndex(m => {
    const u = m.familyName.toUpperCase()
    return m.messageType === 'decree' || u.includes("RA'EL") || u === 'RAEL'
  })
  if (decreeIdx >= 0) {
    const text = messages[decreeIdx]!.content.trim()
    if (text) return text.slice(0, 160)
  }
  const last = messages.filter(m => m.messageType === 'response').at(-1)
  if (last?.content.trim()) return last.content.trim().slice(0, 160)
  return 'Council dialogue in progress'
}

export function syncRuntimeFromCouncilStore(
  runtime: CouncilConversationRuntime,
  council: CouncilPersistedV1,
): CouncilConversationRuntime {
  const idle = isSessionIdle({ ...runtime, lastActivityAt: council.lastActivityAt || runtime.lastActivityAt })
  return {
    ...runtime,
    sessionId: council.sessionId,
    activeTopic: deriveActiveTopicFromMessages(council.messages),
    lastActivityAt: council.lastActivityAt || runtime.lastActivityAt,
    idleExpired: idle,
    councilMomentum: council.isAwaitingResponses ? 'rising' : council.councilState === 'idle' ? 'idle' : 'stable',
  }
}

export function toRuntimeSnapshot(runtime: CouncilConversationRuntime): ConversationRuntimeSnapshot {
  return {
    sessionId: runtime.sessionId,
    threadId: runtime.threadId,
    activeTopic: runtime.activeTopic,
    lastActivityAt: runtime.lastActivityAt,
    turnCount: runtime.turnCount,
    unresolvedInvestigations: runtime.unresolvedInvestigations,
    contradictionMap: runtime.contradictionMap,
    latestSynthesis: runtime.latestSynthesis,
    councilMomentum: runtime.councilMomentum,
    providerStates: runtime.providerStates,
    rollingSummary: runtime.rollingSummary,
    idleExpired: runtime.idleExpired,
  }
}

export function parseConversationRuntime(raw: string | null): CouncilConversationRuntime | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as CouncilConversationRuntime
    if (data?.v !== 1 || typeof data.sessionId !== 'string') return null
    return {
      ...createConversationRuntime(data.sessionId, data.threadId ?? null),
      ...data,
      providerStates: { ...createInitialProviderStates(), ...data.providerStates },
    }
  } catch {
    return null
  }
}

export function loadConversationRuntimeFromStorage(sessionId?: string): CouncilConversationRuntime | null {
  if (typeof window === 'undefined') return null
  const parsed = parseConversationRuntime(window.localStorage.getItem(CONVERSATION_RUNTIME_STORAGE_KEY))
  if (!parsed) return null
  if (sessionId && parsed.sessionId !== sessionId) return null
  return { ...parsed, idleExpired: isSessionIdle(parsed) }
}

export function saveConversationRuntimeToStorage(runtime: CouncilConversationRuntime): void {
  if (typeof window === 'undefined') return
  try {
    const stamped = { ...runtime, idleExpired: isSessionIdle(runtime) }
    window.localStorage.setItem(CONVERSATION_RUNTIME_STORAGE_KEY, JSON.stringify(stamped))
  } catch {
    // quota — in-memory council still works for the tab
  }
}

export function clearConversationRuntimeStorage(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(CONVERSATION_RUNTIME_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
