'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'war-room-ui-mode'

export type WarRoomUiMode = 'operator' | 'advanced'

type Ctx = {
  uiMode: WarRoomUiMode
  setUiMode: (m: WarRoomUiMode) => void
}

const WarRoomUiModeContext = createContext<Ctx | null>(null)

export function WarRoomUiModeProvider({ children }: { children: React.ReactNode }) {
  const [uiMode, setUiModeState] = useState<WarRoomUiMode>('operator')

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY)
        if (raw === 'advanced' || raw === 'operator') setUiModeState(raw)
      } catch {
        /* ignore */
      }
    })

    return () => cancelAnimationFrame(id)
  }, [])

  const setUiMode = useCallback((m: WarRoomUiMode) => {
    setUiModeState(m)
    try {
      sessionStorage.setItem(STORAGE_KEY, m)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo(() => ({ uiMode, setUiMode }), [uiMode, setUiMode])

  return <WarRoomUiModeContext.Provider value={value}>{children}</WarRoomUiModeContext.Provider>
}

export function useWarRoomUiMode(): Ctx {
  const c = useContext(WarRoomUiModeContext)
  if (!c) {
    return { uiMode: 'operator', setUiMode: () => undefined }
  }
  return c
}
