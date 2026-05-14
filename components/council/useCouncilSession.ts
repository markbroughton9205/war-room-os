'use client'

import { startTransition, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { COUNCIL_SESSION_STORAGE_KEY } from './councilConstants'
import {
  councilSessionReducer,
  createInitialCouncilPersisted,
} from './councilSessionReducer'
import type { CouncilPersistedV1 } from './councilSessionTypes'
import { createMessageId } from '@/lib/council/messageIds'

const MAX_PERSISTED_MESSAGES = 100

function newSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `council-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function clipMessages(store: CouncilPersistedV1): CouncilPersistedV1 {
  if (store.messages.length <= MAX_PERSISTED_MESSAGES) return store
  return { ...store, messages: store.messages.slice(-MAX_PERSISTED_MESSAGES) }
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
    return normalizePersistedMessageIds(clipMessages(data))
  } catch {
    return null
  }
}

export function useCouncilSession() {
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
    const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem(COUNCIL_SESSION_STORAGE_KEY) : null
    const parsed = parsePersisted(raw)
    if (parsed) dispatch({ type: 'HYDRATE', payload: parsed })
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
      const clipped = clipMessages(store)
      window.sessionStorage.setItem(COUNCIL_SESSION_STORAGE_KEY, JSON.stringify(clipped))
    } catch {
      // Quota or privacy mode — council still works in-memory for this tab.
    }
  }, [store, mounted])

  const newSessionIdCb = useCallback(() => newSessionId(), [])

  return { store, dispatch, mounted, newSessionId: newSessionIdCb }
}
