'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

import { CompactMediaPlayer } from './CompactMediaPlayer'
import { MediaLauncher } from './MediaLauncher'
import { MediaWindow } from './MediaWindow'
import { useMediaPlayback } from './MediaPlaybackProvider'

function isFoundryEngineeringPath(pathname: string | null): boolean {
  return pathname === '/war-room/engineering' || Boolean(pathname?.startsWith('/war-room/engineering/'))
}

export function MediaHost() {
  const pathname = usePathname()
  const foundryEngineering = isFoundryEngineeringPath(pathname)
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
      {foundryEngineering ? (
        // Foundry keeps the conversation and composer clear: the launcher sits in a utility position.
        <div className="pointer-events-none fixed right-3 top-14 z-[85] lg:bottom-3 lg:left-3 lg:right-auto lg:top-auto" data-testid="media-launcher-global" data-media-dock="foundry-utility">
          <MediaLauncher variant="fallback" />
        </div>
      ) : !state.headerLauncherMounted ? (
        <div className="pointer-events-none fixed bottom-4 left-4 z-[85]" data-testid="media-launcher-global">
          <MediaLauncher variant="fallback" />
        </div>
      ) : null}
      {state.presentation === 'window' ? <MediaWindow /> : null}
      {state.presentation === 'compact' ? <CompactMediaPlayer /> : null}
    </>
  )
}
