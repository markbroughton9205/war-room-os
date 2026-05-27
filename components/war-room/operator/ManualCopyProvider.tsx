'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import { ManualCopyModal } from './ManualCopyModal'

type ManualCopyState = {
  text: string
  title?: string
}

type ManualCopyContextValue = {
  openManualCopy: (text: string, title?: string) => void
}

const ManualCopyContext = createContext<ManualCopyContextValue | null>(null)

export function ManualCopyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ManualCopyState | null>(null)

  const openManualCopy = useCallback((text: string, title?: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setState({ text: trimmed, title })
  }, [])

  const closeManualCopy = useCallback(() => setState(null), [])

  const value = useMemo(() => ({ openManualCopy }), [openManualCopy])

  return (
    <ManualCopyContext.Provider value={value}>
      {children}
      {state ? (
        <ManualCopyModal text={state.text} title={state.title} onClose={closeManualCopy} />
      ) : null}
    </ManualCopyContext.Provider>
  )
}

export function useManualCopy(): ManualCopyContextValue {
  const ctx = useContext(ManualCopyContext)
  if (!ctx) {
    throw new Error('useManualCopy must be used within ManualCopyProvider')
  }
  return ctx
}
