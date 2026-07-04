'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CouncilOutputMode } from '@/lib/council/compression'
import type { CouncilPersistedV1 } from '@/components/council/councilSessionTypes'
import {
  loadConversationRuntimeFromStorage,
  saveConversationRuntimeToStorage,
  toRuntimeSnapshot,
} from '@/lib/conversation-runtime/sessionStore'
import type { CouncilConversationRuntime, ConversationRuntimeSnapshot } from '@/lib/conversation-runtime/types'
import { rebuildConversationRuntime } from '@/lib/conversation-runtime/sync'
import { clearConversationRuntimeStorage } from '@/lib/conversation-runtime/sessionStore'

export function useConversationRuntime(
  council: CouncilPersistedV1,
  threadId: string | null,
  outputMode: CouncilOutputMode,
  mounted: boolean,
  /**
   * Server-reported stability mode (e.g. the caller's councilPassthroughMode),
   * threaded down to compressCouncilOutput so it doesn't fall back to reading
   * the server-only COUNCIL_STABILITY_MODE env var, which is always unset in
   * the browser.
   */
  stabilityMode: boolean,
) {
  const runtimeRef = useRef<CouncilConversationRuntime | null>(null)
  const [runtime, setRuntime] = useState<CouncilConversationRuntime | null>(null)

  const messageFingerprint = useMemo(
    () => `${council.messages.length}:${council.messages.at(-1)?.id ?? ''}:${council.lastActivityAt}`,
    [council.messages, council.lastActivityAt],
  )

  useEffect(() => {
    if (!mounted) return
    const stored = loadConversationRuntimeFromStorage(council.sessionId)
    const rebuilt = rebuildConversationRuntime(council, threadId, stored ?? runtimeRef.current, outputMode, stabilityMode)
    runtimeRef.current = rebuilt
    setRuntime(rebuilt)
    saveConversationRuntimeToStorage(rebuilt)
  }, [mounted, council, threadId, outputMode, messageFingerprint, stabilityMode])

  const snapshot: ConversationRuntimeSnapshot | null = useMemo(
    () => (runtime ? toRuntimeSnapshot(runtime) : null),
    [runtime],
  )

  const resetRuntime = useCallback((sessionId: string) => {
    clearConversationRuntimeStorage()
    const fresh = rebuildConversationRuntime(
      { ...council, sessionId, messages: council.messages.slice(0, 1) },
      threadId,
      null,
      outputMode,
      stabilityMode,
    )
    runtimeRef.current = fresh
    setRuntime(fresh)
    saveConversationRuntimeToStorage(fresh)
  }, [council, threadId, outputMode, stabilityMode])

  return { runtime, snapshot, resetRuntime }
}
