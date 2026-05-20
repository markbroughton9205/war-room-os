'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'war-room-live-mode'

export type LiveRoomMode = 'operator' | 'builder' | 'intelligence' | 'repair'

type Ctx = {
  liveMode: LiveRoomMode
  setLiveMode: (mode: LiveRoomMode) => void
  engineeringDrawerOpen: boolean
  setEngineeringDrawerOpen: (open: boolean) => void
  toggleEngineeringDrawer: () => void
}

const LiveRoomModeContext = createContext<Ctx | null>(null)

export function LiveRoomModeProvider({ children }: { children: React.ReactNode }) {
  const [liveMode, setLiveModeState] = useState<LiveRoomMode>('operator')
  const [engineeringDrawerOpen, setEngineeringDrawerOpen] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY)
        if (raw === 'operator' || raw === 'builder' || raw === 'intelligence' || raw === 'repair') {
          setLiveModeState(raw)
        }
      } catch {
        /* ignore */
      }
    })
    return () => cancelAnimationFrame(id)
  }, [])

  const setLiveMode = useCallback((mode: LiveRoomMode) => {
    setLiveModeState(mode)
    try {
      sessionStorage.setItem(STORAGE_KEY, mode)
    } catch {
      /* ignore */
    }
    if (mode === 'repair') setEngineeringDrawerOpen(true)
  }, [])

  const toggleEngineeringDrawer = useCallback(() => {
    setEngineeringDrawerOpen(prev => !prev)
  }, [])

  const value = useMemo(
    () => ({
      liveMode,
      setLiveMode,
      engineeringDrawerOpen,
      setEngineeringDrawerOpen,
      toggleEngineeringDrawer,
    }),
    [liveMode, setLiveMode, engineeringDrawerOpen, toggleEngineeringDrawer],
  )

  return <LiveRoomModeContext.Provider value={value}>{children}</LiveRoomModeContext.Provider>
}

export function useLiveRoomMode(): Ctx {
  const ctx = useContext(LiveRoomModeContext)
  if (!ctx) {
    return {
      liveMode: 'operator',
      setLiveMode: () => undefined,
      engineeringDrawerOpen: false,
      setEngineeringDrawerOpen: () => undefined,
      toggleEngineeringDrawer: () => undefined,
    }
  }
  return ctx
}
