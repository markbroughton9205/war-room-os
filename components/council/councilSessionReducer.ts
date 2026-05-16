import {
  COUNCIL_MAX_CONSECUTIVE_AUTONOMOUS,
  COUNCIL_MAX_CONSECUTIVE_AUTONOMOUS_DEEP,
} from './councilConstants'
import { createMessageId } from '@/lib/council/messageIds'
import type {
  CouncilLifecycleState,
  CouncilOrchestrationFamily,
  CouncilPersistedV1,
  PersistedCouncilMessage,
} from './councilSessionTypes'

export const INITIAL_COUNCIL_MESSAGES: PersistedCouncilMessage[] = [{
  id: '0',
  familyName: 'SYSTEM',
  content: "War Room initialized. ChatGPT, Claude, Grok, and Gemini Families present. Speak your decree, Ra'el.",
  timestamp: '--:--',
  color: '#FFD700',
  icon: '⚔',
  provider: '',
  messageType: 'system',
}]

export function createInitialCouncilPersisted(sessionId: string): CouncilPersistedV1 {
  return {
    v: 1,
    sessionId,
    councilState: 'idle',
    lastActivityAt: Date.now(),
    messages: INITIAL_COUNCIL_MESSAGES,
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
    councilChannelOpen: false,
  }
}

export type CouncilSessionAction =
  | { type: 'HYDRATE'; payload: CouncilPersistedV1 }
  | { type: 'END_SESSION'; payload: { sessionId: string } }
  | { type: 'CLEAR_SESSION'; payload: { sessionId: string } }
  | { type: 'SET_COUNCIL_STATE'; payload: CouncilLifecycleState }
  | { type: 'TOUCH_ACTIVITY' }
  | { type: 'SET_DEEP_DISCUSSION'; payload: boolean }
  | { type: 'SET_AWAITING_RESPONSES'; payload: boolean }
  | { type: 'SET_COUNCIL_CHANNEL_OPEN'; payload: boolean }
  | { type: 'SET_MESSAGES'; payload: PersistedCouncilMessage[] }
  | { type: 'ADD_MESSAGES'; payload: PersistedCouncilMessage[] }
  | { type: 'REMOVE_MESSAGES'; payload: { ids: string[] } }
  | { type: 'ADD_MESSAGES_REMOVING'; payload: { messages: PersistedCouncilMessage[]; removeIds: string[] } }
  | { type: 'UPDATE_MESSAGE'; payload: { id: string; content: string } }
  | { type: 'INCREMENT_AUTONOMOUS' }
  | { type: 'RESET_AUTONOMOUS' }
  | { type: 'SET_REQUIRES_RAEL'; payload: boolean }
  | { type: 'SET_PROVIDER_ERROR'; payload: string }
  | { type: 'CLEAR_PROVIDER_ERROR' }
  | { type: 'RECORD_ORCHESTRATION_SPEAKER'; payload: { family: CouncilOrchestrationFamily; contentHash: string } }
  | { type: 'BUMP_AUTONOMOUS_ROUND' }
  | { type: 'ADD_SYSTEM_MESSAGE_DEDUPED'; payload: { id?: string; content: string; timestamp: string } }

function maxAutonomousCap(deep: boolean) {
  return deep ? COUNCIL_MAX_CONSECUTIVE_AUTONOMOUS_DEEP : COUNCIL_MAX_CONSECUTIVE_AUTONOMOUS
}

function latestRaelIndex(messages: PersistedCouncilMessage[]): number {
  return messages.findLastIndex(m => {
    const u = m.familyName.toUpperCase()
    return u.includes("RA'EL") || u === 'RAEL'
  })
}

function visibleOutputKey(message: PersistedCouncilMessage): string {
  return [
    message.familyName.trim().toLowerCase(),
    message.messageType.trim().toLowerCase(),
    message.provider.trim().toLowerCase(),
    message.content.replace(/\s+/g, ' ').trim().toLowerCase(),
  ].join('|')
}

function appendDedupedVisibleMessages(
  existingMessages: PersistedCouncilMessage[],
  incomingMessages: PersistedCouncilMessage[],
): PersistedCouncilMessage[] {
  const latestRael = latestRaelIndex(existingMessages)
  const ids = new Set(existingMessages.map(m => m.id))
  const visibleKeys = new Set(
    existingMessages
      .slice(Math.max(0, latestRael + 1))
      .map(visibleOutputKey)
      .filter(Boolean),
  )
  const out = [...existingMessages]
  for (const message of incomingMessages) {
    const key = visibleOutputKey(message)
    if (ids.has(message.id) || (key && visibleKeys.has(key))) continue
    ids.add(message.id)
    if (key) visibleKeys.add(key)
    out.push(message)
  }
  return out
}

export function councilSessionReducer(state: CouncilPersistedV1, action: CouncilSessionAction): CouncilPersistedV1 {
  const now = Date.now()

  switch (action.type) {
    case 'HYDRATE':
      return { ...action.payload, v: 1 }

    case 'END_SESSION': {
      const next = createInitialCouncilPersisted(action.payload.sessionId)
      next.lastActivityAt = now
      return next
    }

    case 'CLEAR_SESSION': {
      const next = createInitialCouncilPersisted(action.payload.sessionId)
      next.lastActivityAt = now
      next.messages = []
      next.councilChannelOpen = state.councilChannelOpen
      next.deepDiscussionMode = state.deepDiscussionMode
      next.councilState = state.councilState === 'paused' ? 'paused' : 'idle'
      return next
    }

    case 'SET_COUNCIL_STATE':
      return { ...state, councilState: action.payload, lastActivityAt: now }

    case 'TOUCH_ACTIVITY':
      return { ...state, lastActivityAt: now }

    case 'SET_DEEP_DISCUSSION': {
      const deep = action.payload
      const cap = maxAutonomousCap(deep)
      let consecutiveAutonomousCount = state.consecutiveAutonomousCount
      let councilState = state.councilState
      if (consecutiveAutonomousCount > cap) consecutiveAutonomousCount = cap
      if (councilState === 'waiting_for_rael' && !state.requiresRaelForAutonomous) {
        councilState = 'active'
      }
      return {
        ...state,
        deepDiscussionMode: deep,
        consecutiveAutonomousCount,
        councilState,
        lastActivityAt: now,
      }
    }

    case 'SET_AWAITING_RESPONSES':
      return { ...state, isAwaitingResponses: action.payload, lastActivityAt: now }

    case 'SET_COUNCIL_CHANNEL_OPEN':
      return { ...state, councilChannelOpen: action.payload, lastActivityAt: now }

    case 'SET_MESSAGES':
      return { ...state, messages: action.payload, lastActivityAt: now }

    case 'ADD_MESSAGES':
      return {
        ...state,
        messages: appendDedupedVisibleMessages(state.messages, action.payload),
        lastActivityAt: now,
      }

    case 'REMOVE_MESSAGES': {
      const ids = new Set(action.payload.ids)
      if (!ids.size) return state
      return {
        ...state,
        messages: state.messages.filter(m => !ids.has(m.id)),
        lastActivityAt: now,
      }
    }

    case 'ADD_MESSAGES_REMOVING': {
      const ids = new Set(action.payload.removeIds)
      const kept = ids.size ? state.messages.filter(m => !ids.has(m.id)) : state.messages
      return {
        ...state,
        messages: appendDedupedVisibleMessages(kept, action.payload.messages),
        lastActivityAt: now,
      }
    }

    case 'UPDATE_MESSAGE':
      return {
        ...state,
        messages: state.messages.map(m => (m.id === action.payload.id ? { ...m, content: action.payload.content } : m)),
        lastActivityAt: now,
      }

    case 'INCREMENT_AUTONOMOUS': {
      const cap = maxAutonomousCap(state.deepDiscussionMode)
      const nextCount = state.consecutiveAutonomousCount + 1
      const hit = nextCount >= cap
      return {
        ...state,
        consecutiveAutonomousCount: nextCount,
        requiresRaelForAutonomous: hit ? true : state.requiresRaelForAutonomous,
        councilState: hit ? 'waiting_for_rael' : state.councilState,
        lastActivityAt: now,
      }
    }

    case 'RESET_AUTONOMOUS': {
      const leaveWait = state.councilState === 'waiting_for_rael'
      return {
        ...state,
        consecutiveAutonomousCount: 0,
        requiresRaelForAutonomous: false,
        councilState: leaveWait ? 'active' : state.councilState,
        lastActivityAt: now,
      }
    }

    case 'SET_REQUIRES_RAEL':
      return {
        ...state,
        requiresRaelForAutonomous: action.payload,
        councilState: action.payload ? 'waiting_for_rael' : state.councilState,
        lastActivityAt: now,
      }

    case 'SET_PROVIDER_ERROR':
      return {
        ...state,
        providerErrorMessage: action.payload,
        councilState: 'provider_error',
        lastActivityAt: now,
      }

    case 'CLEAR_PROVIDER_ERROR':
      return {
        ...state,
        providerErrorMessage: null,
        councilState: state.councilChannelOpen ? 'active' : 'idle',
        lastActivityAt: now,
      }

    case 'RECORD_ORCHESTRATION_SPEAKER': {
      const { family, contentHash } = action.payload
      const recent = [...state.recentOrchestrationSpeakers, family].slice(-4)
      return {
        ...state,
        lastSpeakerFamily: family,
        recentOrchestrationSpeakers: recent.slice(-2),
        lastContentHashByFamily: { ...state.lastContentHashByFamily, [family]: contentHash },
        lastActivityAt: now,
      }
    }

    case 'BUMP_AUTONOMOUS_ROUND':
      return { ...state, autonomousRoundIndex: state.autonomousRoundIndex + 1, lastActivityAt: now }

    case 'ADD_SYSTEM_MESSAGE_DEDUPED': {
      const lastSystem = [...state.messages].reverse().find(m => m.familyName === 'SYSTEM')
      if (lastSystem?.content === action.payload.content) return state
      const message = {
        id: action.payload.id ?? createMessageId('system'),
        familyName: 'SYSTEM',
        content: action.payload.content,
        timestamp: action.payload.timestamp,
        color: '#FFD700',
        icon: '⚙',
        provider: '',
        messageType: 'system',
      }
      return {
        ...state,
        messages: appendDedupedVisibleMessages(state.messages, [message]),
        lastActivityAt: now,
      }
    }

    default:
      return state
  }
}
