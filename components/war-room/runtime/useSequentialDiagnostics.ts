'use client'

import { useCallback, useState } from 'react'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { DiagnosticIntentMode } from '@/lib/council/diagnosticMode'
import type { DiagnosticPanelState } from '@/components/war-room/runtime/DiagnosticSessionPanel'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'

/** Local UI state for sequential runtime diagnostics (optional; wire from page submitter). */
export function useSequentialDiagnostics() {
  const [session, setSession] = useState<DiagnosticPanelState | null>(null)

  const reset = () => {
    setSession(null)
  }

  const start = (order: CouncilOrchestrationFamily[], intentMode: DiagnosticIntentMode = 'sequential_diagnostics') => {
    if (!order.length) {
      setSession(null)
      return
    }
    setSession({
      active: true,
      turnIndex: 0,
      order,
      hold: false,
      intentMode,
      outcomes: [],
    })
  }

  const setTurn = (turnIndex: number) => {
    setSession(prev => (prev ? { ...prev, turnIndex } : prev))
  }

  const setHold = (hold: boolean, holdReason?: string) => {
    setSession(prev => (prev ? { ...prev, hold, ...(holdReason !== undefined ? { holdReason } : {}) } : prev))
  }

  const recordOutcome = useCallback((family: CouncilOrchestrationFamily, runtime: ProviderFamilyOutcomeStatus) => {
    setSession(prev => {
      if (!prev?.active) return prev
      const next = [...(prev.outcomes ?? [])]
      const idx = next.findIndex(o => o.family === family)
      const row = { family, runtime }
      if (idx >= 0) next[idx] = row
      else next.push(row)
      return { ...prev, outcomes: next }
    })
  }, [])

  const stop = () => setSession(null)

  return { session, reset, start, setTurn, setHold, recordOutcome, stop }
}
