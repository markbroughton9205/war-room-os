'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { useApplicationActivity } from '@/lib/ui/applicationActivity'
import { TerraHomeEarth3D } from './TerraHomeEarth3D'
import { EARTH_ASSETS, EARTH_STATUS_LABEL, EARTH_VISUAL_LABEL } from './terraHomeEarth/earthAssets'
import {
  INTERACTION_IDLE_MS,
  resolveHomeEarthQuality,
  type HomeEarthQuality,
} from './terraHomeEarth/earthQuality'
import type { HomeEarthRendererHandle } from './terraHomeEarth/earthRenderer'
import '@/app/terra-home-globe.css'

type TerraMotion = 'live' | 'paused' | 'reduced'
type EarthRendererMode = 'pending' | 'webgl' | 'css-fallback'

function isClientSnapshot() {
  return true
}

function isServerSnapshot() {
  return false
}

function subscribeClientFlag() {
  return () => {}
}

const AMBIENT_NODES = [
  { top: '32%', left: '28%' },
  { top: '46%', left: '62%' },
  { top: '58%', left: '41%' },
] as const

function TerraHomeGlobeCssFallback({
  dragOffset,
  orbitPaused,
  orbitSeconds,
  onTexError,
}: {
  dragOffset: number
  orbitPaused: boolean
  orbitSeconds: number
  onTexError: () => void
}) {
  return (
    <div className="terra-home-globe-sphere absolute inset-0 overflow-hidden rounded-full">
      <div className="absolute inset-0" style={{ transform: `translate3d(${dragOffset}px, 0, 0)` }}>
        <div
          className="terra-home-globe-orbit terra-home-globe-earth-tex absolute inset-y-0 left-0 w-[200%]"
          style={{
            animationDuration: `${orbitSeconds}s`,
            animationPlayState: orbitPaused ? 'paused' : 'running',
            willChange: orbitPaused ? 'auto' : 'transform',
            backgroundImage: `url(${EARTH_ASSETS.day2k})`,
          }}
          data-testid="terra-home-globe-orbit-track"
        />
      </div>
      {/* Local NASA Blue Marble used only when WebGL is unavailable. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={EARTH_ASSETS.day2k} alt="" hidden onError={onTexError} />
      <div className="terra-home-globe-sphere-shade pointer-events-none absolute inset-0 rounded-full" aria-hidden="true" />
      <div className="terra-home-globe-atmosphere pointer-events-none absolute inset-0 rounded-full" aria-hidden="true" />
    </div>
  )
}

export function TerraHomeGlobePreview() {
  const router = useRouter()
  const activity = useApplicationActivity()
  const hostRef = useRef<HTMLDivElement>(null)
  const earthRef = useRef<HomeEarthRendererHandle | null>(null)
  const resumeTimerRef = useRef<number | null>(null)
  const pointerRef = useRef({ id: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false })
  const [intersecting, setIntersecting] = useState(true)
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const [idlePaused, setIdlePaused] = useState(false)
  const [failedTex, setFailedTex] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [rendererMode, setRendererMode] = useState<EarthRendererMode>('pending')
  const isClient = useSyncExternalStore(subscribeClientFlag, isClientSnapshot, isServerSnapshot)
  const quality: HomeEarthQuality = isClient
    ? resolveHomeEarthQuality({
        viewportWidth: window.innerWidth,
        deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
        focused: activity.focused,
      })
    : 'BALANCED'

  const active = activity.mode === 'HOME_ACTIVE' && activity.visible && intersecting
  const orbitPaused = !active || hovered || dragging || idlePaused || reducedMotion
  const webglUnavailable = rendererMode === 'css-fallback'
  const previewUnavailable = webglUnavailable && failedTex
  const motion: TerraMotion = reducedMotion ? 'reduced' : orbitPaused ? 'paused' : 'live'
  const globeWidth = quality === 'CINEMATIC'
    ? 'clamp(14rem, 38vmin, 26rem)'
    : quality === 'BALANCED'
      ? 'clamp(13rem, 34vmin, 23rem)'
      : 'clamp(12rem, 30vmin, 20rem)'
  const orbitSeconds = 90
  const statusLabel = EARTH_STATUS_LABEL
  const visualLabel = webglUnavailable
    ? previewUnavailable
      ? 'Earth preview · 3D unavailable'
      : 'Earth visual · NASA Blue Marble · 2D fallback'
    : EARTH_VISUAL_LABEL

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      setIntersecting(entries[0]?.isIntersecting ?? false)
    }, { threshold: 0.05 })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => {
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current)
  }, [])

  const scheduleResume = useCallback(() => {
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current)
    setIdlePaused(true)
    resumeTimerRef.current = window.setTimeout(() => {
      resumeTimerRef.current = null
      setIdlePaused(false)
    }, INTERACTION_IDLE_MS)
  }, [])

  useEffect(() => {
    const stage = hostRef.current?.querySelector('.terra-home-globe-stage')
    if (!stage) return
    const onNativeWheel = (event: Event) => {
      const wheel = event as WheelEvent
      if (rendererMode !== 'webgl' || !earthRef.current) return
      wheel.preventDefault()
      earthRef.current.applyZoom(wheel.deltaY)
      earthRef.current.notifyInteraction()
      scheduleResume()
    }
    stage.addEventListener('wheel', onNativeWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onNativeWheel)
  }, [rendererMode, scheduleResume])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    earthRef.current?.setDragging(true)
    scheduleResume()
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current.id !== event.pointerId) return
    const dx = event.clientX - pointerRef.current.lastX
    const dy = event.clientY - pointerRef.current.lastY
    pointerRef.current.lastX = event.clientX
    pointerRef.current.lastY = event.clientY
    if (
      Math.abs(event.clientX - pointerRef.current.startX) > 5
      || Math.abs(event.clientY - pointerRef.current.startY) > 5
    ) pointerRef.current.moved = true
    if (earthRef.current && rendererMode === 'webgl') {
      const width = event.currentTarget.clientWidth || 320
      const height = event.currentTarget.clientHeight || 320
      earthRef.current.applyDrag(dx, dy, width, height)
      earthRef.current.notifyInteraction()
      return
    }
    setDragOffset(value => {
      const width = hostRef.current?.clientWidth || 320
      const next = value + dx
      return ((next % width) + width) % width
    })
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current.id !== event.pointerId) return
    const shouldEnter = !pointerRef.current.moved
    pointerRef.current.id = -1
    setDragging(false)
    earthRef.current?.setDragging(false)
    scheduleResume()
    if (shouldEnter) router.push('/terra')
  }

  return (
    <div
      ref={hostRef}
      className="terra-home-globe absolute inset-0 grid place-items-center overflow-hidden"
      data-testid="terra-home-globe-preview"
      data-preview-instance="1"
      data-preview-quality={quality}
      data-preview-active={String(active)}
      data-terra-runtime="UNLOADED"
      data-terra-motion={motion}
      data-home-earth-renderer={rendererMode === 'webgl' ? 'three' : rendererMode === 'css-fallback' ? 'css-fallback' : 'pending'}
      data-home-earth-state={webglUnavailable ? '3D_RENDER_UNAVAILABLE' : rendererMode === 'webgl' ? 'ready' : 'pending'}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(8,145,178,0.16),rgba(6,78,59,0.08)_42%,rgba(0,0,0,0.97)_68%)]" />

      <div className="relative z-10 flex min-w-0 flex-col items-center">
        <button
          type="button"
          className="mb-3 text-[10px] font-bold uppercase tracking-[0.42em] text-cyan-200/80"
          onClick={() => router.push('/terra')}
        >
          War Room
        </button>

        <div
          className="terra-home-globe-stage relative touch-none select-none"
          style={{ width: globeWidth, aspectRatio: '1 / 1' }}
          role="link"
          tabIndex={0}
          aria-label="Open full Terra"
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') router.push('/terra')
          }}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            setDragging(false)
            earthRef.current?.setDragging(false)
          }}
          data-testid="terra-home-globe-click-target"
        >
          <div className="terra-home-globe-glow pointer-events-none absolute -inset-[12%] rounded-full" aria-hidden="true" />
          {!previewUnavailable && motion !== 'reduced' ? (
            <div className="terra-home-globe-pulse pointer-events-none absolute inset-[-3%] rounded-full" aria-hidden="true" data-testid="terra-home-globe-pulse" />
          ) : null}

          {previewUnavailable ? (
            <div className="absolute inset-0 grid place-items-center rounded-full bg-slate-950 text-center">
              <div>
                <p className="text-xs font-bold tracking-[0.3em] text-cyan-200">TERRA</p>
                <p className="mt-2 text-[9px] uppercase tracking-widest text-slate-500">Earth preview unavailable</p>
              </div>
            </div>
          ) : webglUnavailable ? (
            <TerraHomeGlobeCssFallback
              dragOffset={dragOffset}
              orbitPaused={orbitPaused}
              orbitSeconds={orbitSeconds}
              onTexError={() => setFailedTex(true)}
            />
          ) : (
            <div className="absolute inset-[-8%] overflow-visible">
              <div className="pointer-events-none absolute inset-[8%] rounded-full bg-[radial-gradient(circle_at_42%_36%,#0a3a4f,#041016_74%)]" aria-hidden="true" />
              {isClient ? (
                <TerraHomeEarth3D
                  quality={quality}
                  active={active}
                  reducedMotion={reducedMotion}
                  dragging={dragging}
                  idleHold={idlePaused}
                  onReady={handle => {
                    earthRef.current = handle
                    setRendererMode('webgl')
                  }}
                  onUnavailable={() => {
                    earthRef.current = null
                    setRendererMode('css-fallback')
                  }}
                />
              ) : null}
              <div className="pointer-events-none absolute inset-[8%]" aria-hidden="true" data-terra-decor="ambient">
                {AMBIENT_NODES.map(node => (
                  <span
                    key={`${node.top}-${node.left}`}
                    className="terra-home-globe-node absolute h-1 w-1 rounded-full"
                    style={{ top: node.top, left: node.left }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.36em] text-cyan-200">{statusLabel}</p>
          <p className="mt-1 text-[8px] uppercase tracking-[0.2em] text-slate-500">{visualLabel}</p>
          <Link
            href="/terra"
            className="mt-3 inline-flex rounded-full border border-cyan-300/35 bg-cyan-300/5 px-4 py-1.5 text-[9px] font-bold uppercase tracking-[0.24em] text-cyan-100 hover:bg-cyan-300/10"
            data-testid="terra-home-enter-button"
          >
            Enter Terra
          </Link>
        </div>
      </div>
    </div>
  )
}
