'use client'

import { useEffect } from 'react'

import { CompactMediaPlayer } from './CompactMediaPlayer'
import { MediaLauncher } from './MediaLauncher'
import { MediaWindow } from './MediaWindow'
import { useMediaPlayback } from './MediaPlaybackProvider'

export function MediaHost() {
  const { state, controller } = useMediaPlayback()

  useEffect(() => {
    if (state.presentation === 'window' || state.presentation === 'compact') {
      controller.notifySurfaceMounted()
      return () => controller.notifySurfaceUnmounted()
    }
    controller.notifySurfaceUnmounted()
    return undefined
  }, [controller, state.presentation])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (state.presentation === 'closed') return
      if (state.pinned && state.presentation === 'window') return
      controller.minimize()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controller, state.pinned, state.presentation])

  return (
    <>
      {!state.headerLauncherMounted ? (
        <div className="pointer-events-none fixed bottom-4 left-4 z-[85]" data-testid="media-launcher-global">
          <MediaLauncher variant="fallback" />
        </div>
      ) : null}
      {state.presentation === 'window' ? <MediaWindow /> : null}
      {state.presentation === 'compact' ? <CompactMediaPlayer /> : null}
    </>
  )
}
