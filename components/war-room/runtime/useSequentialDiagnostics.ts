'use client'

import { useState } from 'react'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { DiagnosticPanelState } from '@/components/war-room/runtime/DiagnosticSessionPanel'

/** Local UI state for sequential runtime diagnostics (optional; wire from page submitter). */
export function useSequentialDiagnostics() {
  const [session, setSession] = useState<DiagnosticPanelState | null>(null)

  const reset = () => {
    setSession(null)
  }

  const start = (order: CouncilOrchestrationFamily[]) => {
    if (!order.length) {
      setSession(null)
      return
    }
    setSession({ active: true, turnIndex: 0, order, hold: false })
  }

  const setTurn = (turnIndex: number) => {
    setSession(prev => (prev ? { ...prev, turnIndex } : prev))
  }

  const setHold = (hold: boolean) => {
    setSession(prev => (prev ? { ...prev, hold } : prev))
  }

  const stop = () => setSession(null)

  return { session, reset, start, setTurn, setHold, stop }
}
