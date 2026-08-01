'use client'

import { startTransition, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { COUNCIL_SESSION_STORAGE_KEY } from './councilConstants'
import {
  loadConversationRuntimeFromStorage,
  saveConversationRuntimeToStorage,
} from '@/lib/conversation-runtime/sessionStore'
import {
  councilSessionReducer,
  createInitialCouncilPersisted,
} from './councilSessionReducer'
import type { CouncilPersistedV1 } from './councilSessionTypes'
import { createMessageId } from '@/lib/council/messageIds'
import {
  councilMessageFromPersisted,
  shouldPersistCouncilMessage,
  type CouncilMessagePersistenceContext,
} from '@/lib/council/messagePersistenceFilter'

export const MAX_PERSISTED_MESSAGES = 100

function newSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `council-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function clipMessages(
  store: CouncilPersistedV1,
  persistenceCtx?: CouncilMessagePersistenceContext,
): CouncilPersistedV1 {
  const filtered = store.messages.filter(m =>
    shouldPersistCouncilMessage(councilMessageFromPersisted(m), persistenceCtx),
  )
  const clipped =
    filtered.length <= MAX_PERSISTED_MESSAGES
      ? filtered
      : filtered.slice(-MAX_PERSISTED_MESSAGES)
  return { ...store, messages: clipped }
}

function normalizePersistedMessageIds(store: CouncilPersistedV1): CouncilPersistedV1 {
  const seen = new Set<string>()
  return {
    ...store,
    messages: store.messages.map(message => {
      const id = typeof message.id === 'string' ? message.id.trim() : ''
      if (id && !seen.has(id)) {
        seen.add(id)
        return message
      }
      const nextId = createMessageId(`session-${message.messageType || message.familyName || 'message'}`)
      seen.add(nextId)
      return { ...message, id: nextId }
    }),
  }
}

function parsePersisted(raw: string | null): CouncilPersistedV1 | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as CouncilPersistedV1
    if (data?.v !== 1 || typeof data.sessionId !== 'string' || !Array.isArray(data.messages)) return null
    return normalizePersistedMessageIds(clipMessages(data, undefined))
  } catch {
    return null
  }
}

export function useCouncilSession(persistenceCtx?: CouncilMessagePersistenceContext) {
  const [mounted, setMounted] = useState(false)
  const skipNextPersist = useRef(true)
  const storeRef = useRef<CouncilPersistedV1 | null>(null)

  const [store, dispatch] = useReducer(
    councilSessionReducer,
    undefined as unknown as CouncilPersistedV1,
    () => createInitialCouncilPersisted(newSessionId()),
  )

  useEffect(() => {
    storeRef.current = store
  }, [store])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sessionRaw = window.sessionStorage.getItem(COUNCIL_SESSION_STORAGE_KEY)
    const localRaw = window.localStorage.getItem(COUNCIL_SESSION_STORAGE_KEY)
    const parsed = parsePersisted(sessionRaw) ?? parsePersisted(localRaw)
    if (parsed) dispatch({ type: 'HYDRATE', payload: parsed })
    const runtime = loadConversationRuntimeFromStorage(parsed?.sessionId)
    if (runtime && parsed) {
      saveConversationRuntimeToStorage({ ...runtime, sessionId: parsed.sessionId, lastActivityAt: parsed.lastActivityAt })
    }
    skipNextPersist.current = true
    startTransition(() => setMounted(true))
  }, [])

  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return
    if (skipNextPersist.current) {
      skipNextPersist.current = false
      return
    }
    try {
      const clipped = clipMessages(store, persistenceCtx)
      window.sessionStorage.setItem(COUNCIL_SESSION_STORAGE_KEY, JSON.stringify(clipped))
      try {
        window.localStorage.setItem(COUNCIL_SESSION_STORAGE_KEY, JSON.stringify(clipped))
      } catch {
        /* quota */
      }
      const runtime = loadConversationRuntimeFromStorage(clipped.sessionId)
      if (runtime) {
        saveConversationRuntimeToStorage({
          ...runtime,
          sessionId: clipped.sessionId,
          lastActivityAt: clipped.lastActivityAt,
        })
      }
    } catch {
      // Quota or privacy mode — council still works in-memory for this tab.
    }
  }, [store, mounted, persistenceCtx])

  const newSessionIdCb = useCallback(() => newSessionId(), [])

  return { store, dispatch, mounted, newSessionId: newSessionIdCb }
}
