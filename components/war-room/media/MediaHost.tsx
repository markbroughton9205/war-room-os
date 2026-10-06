'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

import { CompactMediaPlayer } from './CompactMediaPlayer'
import { MediaLauncher } from './MediaLauncher'
import { MediaWindow } from './MediaWindow'
import { useMediaPlayback } from './MediaPlaybackProvider'

function isTerraWorkspacePath(pathname: string | null): boolean {
  return pathname === '/terra' || Boolean(pathname?.startsWith('/terra/'))
}

function isHigherVisionStudiosPath(pathname: string | null): boolean {
  return pathname === '/higher-vision-studios' || Boolean(pathname?.startsWith('/higher-vision-studios/'))
}

function isFoundryEngineeringPath(pathname: string | null): boolean {
  return pathname === '/war-room/engineering' || Boolean(pathname?.startsWith('/war-room/engineering/'))
}

export function MediaHost() {
  const pathname = usePathname()
  const foundryEngineering = isFoundryEngineeringPath(pathname)
  const terraWorkspace = isTerraWorkspacePath(pathname)
  const hvsWorkspace = isHigherVisionStudiosPath(pathname)
  const suppressFloating = terraWorkspace || hvsWorkspace
  const { state, controller } = useMediaPlayback()
  // On /terra, WAR ROOM MEDIA is a workspace launcher for `terra_media`.
  // MediaHost must not mount MediaWindow, CompactMediaPlayer, or a second Now Playing surface.
  // It also must not own the /terra rail launcher: that control lives in CommanderAgentDock
  // inside TerraWorkspaceLayoutProvider so CLOSE of terra_media cannot unmount it.

  useEffect(() => {
    if (terraWorkspace) {
      controller.setTerraWorkspaceSurfaceActive(true)
      controller.dismissFloatingPresentation()
      return () => controller.setTerraWorkspaceSurfaceActive(false)
    }
    controller.setTerraWorkspaceSurfaceActive(false)
    return undefined
  }, [controller, terraWorkspace])

  useEffect(() => {
    if (!hvsWorkspace) return
    controller.dismissFloatingPresentation()
    return undefined
  }, [controller, hvsWorkspace])

  useEffect(() => {
    if (suppressFloating) return
    if (state.presentation === 'window' || state.presentation === 'compact') {
      controller.notifySurfaceMounted()
      return () => controller.notifySurfaceUnmounted()
    }
    controller.notifySurfaceUnmounted()
    return undefined
  }, [controller, state.presentation, suppressFloating])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (terraWorkspace) return
      if (hvsWorkspace) return
      if (state.presentation === 'closed') return
      if (state.pinned && state.presentation === 'window') return
      controller.minimize()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controller, state.pinned, state.presentation, terraWorkspace, hvsWorkspace])

  if (terraWorkspace) {
    return (
      <div
        hidden
        data-testid="media-host-terra-suppressed"
        data-media-host="terra-workspace"
        data-terra-media-launcher-policy="commander-rail-owns-launcher"
      />
    )
  }

  if (hvsWorkspace) {
    return (
      <div
        hidden
        data-testid="media-host-hvs-suppressed"
        data-media-host="hvs-workspace"
        data-hvs-media-launcher-policy="hvs-owns-workspace"
      />
    )
  }

  return (
    <>
      {foundryEngineering ? (
        // Foundry keeps the conversation and composer clear: the launcher sits in a utility position.
        <div className="pointer-events-none fixed right-3 top-14 z-[85] lg:bottom-3 lg:left-3 lg:right-auto lg:top-auto" data-testid="media-launcher-global" data-media-dock="foundry-utility">
          <MediaLauncher variant="fallback" />
        </div>
      ) : (
        <div className="pointer-events-none fixed bottom-3 left-1/2 z-[85] -translate-x-1/2" data-testid="media-launcher-global" data-media-dock="bottom-center">
          <MediaLauncher variant="fallback" />
        </div>
      )}
      {state.presentation === 'window' ? <MediaWindow /> : null}
      {state.presentation === 'compact' ? <CompactMediaPlayer /> : null}
    </>
  )
}
