'use client'

/**
 * One React boundary over CommanderLocationController.
 * Terra components consume this instead of calling navigator.geolocation.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  INITIAL_COMMANDER_LOCATION_STATE,
  type CommanderLocationState,
} from '@/lib/terra/commanderLocation'
import { CommanderLocationController } from '@/lib/terra/commanderLocationController'

type CommanderLocationContextValue = CommanderLocationState & {
  locateOnce: () => void
  followMe: () => void
  stop: () => void
  setFollowCamera: (follow: boolean) => void
}

const CommanderLocationContext = createContext<CommanderLocationContextValue | null>(null)

export function CommanderLocationProvider({ children }: { children: ReactNode }) {
  const controllerRef = useRef<CommanderLocationController | null>(null)
  if (!controllerRef.current) controllerRef.current = new CommanderLocationController()
  const [state, setState] = useState<CommanderLocationState>(INITIAL_COMMANDER_LOCATION_STATE)

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return
    const unsubscribe = controller.subscribe(setState)
    return () => {
      unsubscribe()
      controller.destroy()
      controllerRef.current = null
    }
  }, [])

  const locateOnce = useCallback(() => controllerRef.current?.locateOnce(), [])
  const followMe = useCallback(() => controllerRef.current?.followMe(), [])
  const stop = useCallback(() => controllerRef.current?.stop(), [])
  const setFollowCamera = useCallback((follow: boolean) => controllerRef.current?.setFollowCamera(follow), [])

  const value = useMemo<CommanderLocationContextValue>(() => ({
    ...state,
    locateOnce,
    followMe,
    stop,
    setFollowCamera,
  }), [state, locateOnce, followMe, stop, setFollowCamera])

  return <CommanderLocationContext.Provider value={value}>{children}</CommanderLocationContext.Provider>
}

export function useCommanderLocation(): CommanderLocationContextValue {
  const value = useContext(CommanderLocationContext)
  if (!value) throw new Error('useCommanderLocation must be used inside CommanderLocationProvider')
  return value
}
