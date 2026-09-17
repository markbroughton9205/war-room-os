'use client'

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'

import { getMediaPlaybackController, type MediaPlaybackController } from '@/lib/media/playback/controller'
import type { MediaAutoMode, MediaNormalizedState, MediaStation, MediaSurfaceReason } from '@/lib/media/types'

type MediaPlaybackContextValue = {
  state: MediaNormalizedState
  controller: MediaPlaybackController
  stations: MediaStation[]
}

type WarRoomMediaTestApi = {
  autoSelect: (id: string, reason?: MediaSurfaceReason) => void
  setAutoMode: (mode: MediaAutoMode) => void
}

const MediaPlaybackContext = createContext<MediaPlaybackContextValue | null>(null)

export function MediaPlaybackProvider({ children }: { children: ReactNode }) {
  const controller = getMediaPlaybackController()
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getServerSnapshot)
  const value = useMemo<MediaPlaybackContextValue>(
    () => ({ state, controller, stations: controller.getStations() }),
    [state, controller],
  )

  useEffect(() => {
    controller.hydrateSession()
    const api: WarRoomMediaTestApi = {
      autoSelect: (id, reason = 'LOCAL_MEDIA') => controller.autoSelectStation(id, reason),
      setAutoMode: mode => controller.setAutoMediaMode(mode),
    }
    window.__warRoomMediaTest = api
    return () => {
      if (window.__warRoomMediaTest === api) delete window.__warRoomMediaTest
    }
  }, [controller])

  return <MediaPlaybackContext.Provider value={value}>{children}</MediaPlaybackContext.Provider>
}

export function useMediaPlayback(): MediaPlaybackContextValue {
  const value = useContext(MediaPlaybackContext)
  if (!value) {
    throw new Error('useMediaPlayback must be used within MediaPlaybackProvider')
  }
  return value
}

declare global {
  interface Window {
    __warRoomMediaTest?: WarRoomMediaTestApi
  }
}

