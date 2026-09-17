'use client'

import { useCallback, useEffect, useRef, type PointerEvent } from 'react'

import { useMediaPlayback } from './MediaPlaybackProvider'
import { AlertPanel } from './AlertPanel'
import { MediaHeader } from './MediaHeader'
import { MediaTabs } from './MediaTabs'
import { NowPlaying } from './NowPlaying'
import { SourceInfo } from './SourceInfo'
import { StationBrowser } from './StationBrowser'

export function MediaWindow() {
  const { state, controller } = useMediaPlayback()
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (state.windowFocusNonce < 1) return
    panelRef.current?.focus()
  }, [state.windowFocusNonce])

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const handle = (event.target as HTMLElement | null)?.closest('[data-media-drag-handle="true"]')
    if (!handle) return
    if ((event.target as HTMLElement | null)?.closest('button')) return
    const panel = event.currentTarget
    const rect = panel.getBoundingClientRect()
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    }
    panel.setPointerCapture(event.pointerId)
  }, [])

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    const x = Math.min(window.innerWidth - 48, Math.max(8, event.clientX - drag.current.offsetX))
    const y = Math.min(window.innerHeight - 48, Math.max(8, event.clientY - drag.current.offsetY))
    controller.setWindowPosition({ x, y })
  }, [controller])

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null
  }, [])

  const positioned = state.windowPosition !== null

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]" data-testid="media-window-layer">
      <section
        ref={panelRef}
        role="dialog"
        aria-label="War Room Media"
        tabIndex={-1}
        data-testid="media-window"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="pointer-events-auto flex flex-col overflow-hidden rounded-2xl border border-cyan-400/35 bg-[rgba(4,10,16,0.94)] shadow-[0_24px_80px_rgba(0,0,0,0.62),0_0_48px_rgba(16,185,129,0.12)] backdrop-blur-2xl outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/50"
        style={{
          width: 'min(780px, calc(100vw - 17rem))',
          height: 'min(640px, calc(100vh - 7rem))',
          maxHeight: 'min(640px, calc(100vh - 7rem))',
          position: 'absolute',
          left: positioned ? state.windowPosition!.x : 'max(15.25rem, 18%)',
          top: positioned ? state.windowPosition!.y : '7%',
          transform: 'none',
        }}
      >
        <MediaHeader />
        <MediaTabs />
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden px-3 pb-3 md:grid-cols-[minmax(16.5rem,0.4fr)_minmax(0,1fr)]">
          <StationBrowser />
          <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto">
            <NowPlaying />
            <SourceInfo />
            <AlertPanel />
          </div>
        </div>
      </section>
    </div>
  )
}
