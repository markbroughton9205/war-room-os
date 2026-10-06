/**
 * One Home session is visible at a time.
 * Sidebar selection, transcript cache, and remote conversation fetch must not
 * independently decide what the pane shows.
 *
 * Canonical UI identity: activeSessionId (the rail selection / liveCouncilConvId).
 * Ledger UUID shape is not remoteness — a local session id may look like a UUID.
 */

import { shouldDetachConversationBinding } from './conversationBinding'
import { countPersistableTranscriptMessages } from '@/lib/conversation-runtime/transcriptReconciliation'

export const SESSION_HYDRATION_GET_PATH = '/api/conversations/'

export type SessionMessageLike = { messageType: string; content?: string }

export type HydrationApplyDecision = {
  apply: boolean
  reason:
    | 'active_session'
    | 'aborted'
    | 'stale_generation'
    | 'no_active_session'
    | 'selection_mismatch'
    | 'owner_mismatch'
    | 'keep_local'
}

export type SessionBindingSource = 'remote_conversation' | 'local_ledger' | 'unavailable'

export function decideHydrationApply(input: {
  selectedSessionId: string
  activeSessionId: string | null
  resultSessionId: string
  selectionGeneration: number
  resultGeneration: number
  aborted?: boolean
}): HydrationApplyDecision {
  if (input.aborted) return { apply: false, reason: 'aborted' }
  if (input.resultGeneration !== input.selectionGeneration) {
    return { apply: false, reason: 'stale_generation' }
  }
  if (!input.activeSessionId) return { apply: false, reason: 'no_active_session' }
  if (input.selectedSessionId !== input.activeSessionId) {
    return { apply: false, reason: 'selection_mismatch' }
  }
  if (input.resultSessionId !== input.activeSessionId) {
    return { apply: false, reason: 'owner_mismatch' }
  }
  return { apply: true, reason: 'active_session' }
}

/** Stale pane must not render under a different selected session. */
export function visibleTranscriptForSelection<T>(input: {
  activeSessionId: string | null
  transcriptOwnerId: string | null
  messages: readonly T[]
}): { visible: boolean; messages: readonly T[] } {
  if (!input.activeSessionId || input.transcriptOwnerId !== input.activeSessionId) {
    return { visible: false, messages: [] }
  }
  return { visible: true, messages: input.messages }
}

export function sidebarPaneIdentitiesAgree(input: {
  sidebarSessionId: string | null
  paneOwnerId: string | null
}): boolean {
  return Boolean(input.sidebarSessionId) && input.sidebarSessionId === input.paneOwnerId
}

export function shouldPersistLocalTranscript(input: {
  cacheSessionId: string
  activeSessionId: string | null
  transcriptOwnerId: string | null
}): boolean {
  return Boolean(
    input.activeSessionId
    && input.cacheSessionId === input.activeSessionId
    && input.transcriptOwnerId === input.activeSessionId,
  )
}

export function shouldHydrateAlreadySelectedSession(input: {
  selectedSessionId: string
  activeSessionId: string | null
  transcriptOwnerId: string | null
}): boolean {
  if (!input.selectedSessionId) return false
  if (input.selectedSessionId !== input.activeSessionId) return true
  return input.transcriptOwnerId !== input.selectedSessionId
}

export function shouldCommitFetchedTranscript(input: {
  fetchedSessionId: string
  activeSessionId: string | null
  visibleOwnerId: string | null
  localMessages: readonly SessionMessageLike[]
  fetchedMessages: readonly SessionMessageLike[]
}): boolean {
  if (!input.activeSessionId || input.fetchedSessionId !== input.activeSessionId) return false
  if (input.visibleOwnerId !== input.activeSessionId) return true
  if (input.fetchedMessages.length === 0) return input.localMessages.length === 0
  const localCount = countPersistableTranscriptMessages(input.localMessages)
  const fetchedCount = countPersistableTranscriptMessages(input.fetchedMessages)
  if (localCount > fetchedCount) return false
  return true
}

export function sessionBindingSourceFromHttp(status: number): SessionBindingSource {
  if (status === 200) return 'remote_conversation'
  if (shouldDetachConversationBinding({ status })) return 'local_ledger'
  return 'unavailable'
}

/** UUID format never proves a row is a remote owned conversation. */
export function ledgerIdIsNotRemoteAuthority(id: string): boolean {
  return typeof id === 'string' && id.trim().length > 0
}

export function historyHydrationRequest(sessionId: string): { method: 'GET'; path: string; startsMission: boolean } {
  return {
    method: 'GET',
    path: `${SESSION_HYDRATION_GET_PATH}${sessionId}`,
    startsMission: false,
  }
}

export type SimulatedSessionState = {
  activeSessionId: string | null
  transcriptOwnerId: string | null
  generation: number
  messages: SessionMessageLike[]
  lastHydrationMethod: 'GET' | 'POST' | null
  startedMission: boolean
}

export function createSimulatedSessionState(): SimulatedSessionState {
  return {
    activeSessionId: null,
    transcriptOwnerId: null,
    generation: 0,
    messages: [],
    lastHydrationMethod: null,
    startedMission: false,
  }
}

export function simulateSelectSession(
  state: SimulatedSessionState,
  sessionId: string,
  localMessages: readonly SessionMessageLike[],
): { generation: number } {
  const generation = state.generation + 1
  state.generation = generation
  state.activeSessionId = sessionId
  state.transcriptOwnerId = sessionId
  state.messages = [...localMessages]
  state.lastHydrationMethod = 'GET'
  state.startedMission = false
  return { generation }
}

export function simulateFetchResolve(
  state: SimulatedSessionState,
  input: {
    resultSessionId: string
    resultGeneration: number
    fetchedMessages: readonly SessionMessageLike[]
    aborted?: boolean
  },
): HydrationApplyDecision {
  const decision = decideHydrationApply({
    selectedSessionId: input.resultSessionId,
    activeSessionId: state.activeSessionId,
    resultSessionId: input.resultSessionId,
    selectionGeneration: state.generation,
    resultGeneration: input.resultGeneration,
    aborted: input.aborted,
  })
  if (!decision.apply) return decision
  const commit = shouldCommitFetchedTranscript({
    fetchedSessionId: input.resultSessionId,
    activeSessionId: state.activeSessionId,
    visibleOwnerId: state.transcriptOwnerId,
    localMessages: state.messages,
    fetchedMessages: input.fetchedMessages,
  })
  if (!commit) return { apply: false, reason: 'keep_local' }
  state.messages = [...input.fetchedMessages]
  state.transcriptOwnerId = input.resultSessionId
  return decision
}
