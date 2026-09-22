'use client'

import { useEffect, useRef } from 'react'

import type { HomeEarthQuality } from './terraHomeEarth/earthQuality'
import type { HomeEarthRendererHandle } from './terraHomeEarth/earthRenderer'

export type TerraHomeEarth3DHandle = HomeEarthRendererHandle

type TerraHomeEarth3DProps = {
  quality: HomeEarthQuality
  active: boolean
  reducedMotion: boolean
  dragging: boolean
  idleHold: boolean
  onReady?: (handle: HomeEarthRendererHandle) => void
  onUnavailable?: () => void
}

export function TerraHomeEarth3D({
  quality,
  active,
  reducedMotion,
  dragging,
  idleHold,
  onReady,
  onUnavailable,
}: TerraHomeEarth3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handleRef = useRef<HomeEarthRendererHandle | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let handle: HomeEarthRendererHandle | null = null

    ;(async () => {
      const { detectHomeEarthWebGL, createHomeEarthRenderer } = await import('./terraHomeEarth/earthRenderer')
      if (cancelled) return
      if (!detectHomeEarthWebGL()) {
        onUnavailable?.()
        return
      }
      try {
        handle = await createHomeEarthRenderer({ canvas, quality, reducedMotion })
        if (cancelled) {
          handle.dispose()
          return
        }
        handleRef.current = handle
        const parent = canvas.parentElement
        if (parent) handle.resize(parent.clientWidth, parent.clientHeight)
        handle.setActive(active)
        handle.setDragging(dragging)
        handle.setIdleHold(idleHold)
        onReady?.(handle)
      } catch {
        if (!cancelled) onUnavailable?.()
      }
    })()

    return () => {
      cancelled = true
      handleRef.current = null
      handle?.dispose()
    }
  }, [quality]) // eslint-disable-line react-hooks/exhaustive-deps -- recreate only when quality changes

  useEffect(() => {
    handleRef.current?.setActive(active)
  }, [active])

  useEffect(() => {
    handleRef.current?.setReducedMotion(reducedMotion)
  }, [reducedMotion])

  useEffect(() => {
    handleRef.current?.setDragging(dragging)
  }, [dragging])

  useEffect(() => {
    handleRef.current?.setIdleHold(idleHold)
  }, [idleHold])

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!parent || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect
      if (!box) return
      handleRef.current?.resize(box.width, box.height)
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="terra-home-earth-canvas absolute inset-0 h-full w-full"
      data-testid="terra-home-earth-canvas"
      data-earth-quality={quality}
      aria-hidden="true"
    />
  )
}
