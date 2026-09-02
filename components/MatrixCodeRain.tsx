'use client'

import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  getMatrixStatusServerSnapshot,
  getMatrixStatusSnapshot,
  subscribeMatrixStatus,
} from '@/lib/ui/matrixStatusBus'
import { matrixRuntimeIntensity, matrixRuntimeRgb } from '@/lib/ui/matrixRuntimeColors'

const CHARSET = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ{}[]<>/\\|#$%+=*'
const GOLD = '255, 215, 0'
const GREEN = '0, 255, 65'

type Stream = {
  x: number
  y: number
  speed: number
  length: number
  fontSize: number
  depth: number
  highlight: boolean
}

function pickChar() {
  return CHARSET[Math.floor(Math.random() * CHARSET.length)] ?? '0'
}

function makeStreams(width: number, height: number) {
  const fontSize = width < 640 ? 13 : 15
  const columnWidth = fontSize * 2
  const columnCount = Math.ceil(width / columnWidth)

  return Array.from({ length: columnCount }, (_, index): Stream => {
    const depth = 0.45 + Math.random() * 0.55

    return {
      x: index * columnWidth + Math.random() * fontSize,
      y: Math.random() * height,
      speed: (34 + Math.random() * 58) * depth,
      length: 8 + Math.floor(Math.random() * 18),
      fontSize,
      depth,
      highlight: Math.random() < 0.08,
    }
  })
}

export const MatrixCodeRain = memo(function MatrixCodeRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const streamsRef = useRef<Stream[]>([])
  const lastTimeRef = useRef(0)
  const [reducedMotion, setReducedMotion] = useState(false)

  // Real runtime state only -- never fabricated. Read via a ref inside the animation loop (not a
  // hook dependency) so a status change never tears down/recreates the draw effect below; it just
  // recolors the next frame. Reverts to 'idle' on its own via matrixStatusBus's auto-idle timers.
  const statusSnap = useSyncExternalStore(subscribeMatrixStatus, getMatrixStatusSnapshot, getMatrixStatusServerSnapshot)
  const statusRef = useRef({ kind: statusSnap.kind, channel: statusSnap.channel })
  useEffect(() => {
    statusRef.current = { kind: statusSnap.kind, channel: statusSnap.channel }
  }, [statusSnap.kind, statusSnap.channel, statusSnap.tick])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (reducedMotion) return
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d', { alpha: true })
    if (!context) return

    const maxDpr = 1
    const resize = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)

      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      streamsRef.current = makeStreams(width, height)
    }

    const targetFrameMs = 83
    const scheduleNext = (delay = targetFrameMs) => {
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null
        rafRef.current = window.requestAnimationFrame(draw)
      }, delay)
    }

    const draw = (time: number) => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        lastTimeRef.current = time
        scheduleNext(1000)
        return
      }

      const width = window.innerWidth
      const height = window.innerHeight
      const delta = Math.min(96, time - (lastTimeRef.current || time))
      lastTimeRef.current = time

      const isIdle = statusRef.current.kind === 'idle'
      const runtimeColor = isIdle ? null : matrixRuntimeRgb(statusRef.current.channel)
      const runtimeIntensity = isIdle ? 1 : matrixRuntimeIntensity(statusRef.current.channel)

      context.fillStyle = 'rgba(0, 0, 0, 0.11)'
      context.fillRect(0, 0, width, height)
      context.textAlign = 'center'
      context.textBaseline = 'middle'

      for (const stream of streamsRef.current) {
        stream.y += stream.speed * (delta / 1000)

        if (stream.y - stream.length * stream.fontSize > height + 80) {
          stream.y = -Math.random() * height * 0.35
          stream.speed = (34 + Math.random() * 58) * stream.depth
          stream.length = 8 + Math.floor(Math.random() * 18)
          stream.highlight = Math.random() < 0.08
        }

        context.font = `${stream.fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

        for (let i = 0; i < stream.length; i++) {
          const y = stream.y - i * stream.fontSize
          if (y < -stream.fontSize || y > height + stream.fontSize) continue

          const fade = Math.max(0, 1 - i / stream.length)
          const isHead = i === 0
          const useGold = !runtimeColor && stream.highlight && (isHead || i === 1)
          const alpha = (isHead ? 0.52 : 0.28 * fade) * stream.depth * runtimeIntensity
          const color = runtimeColor ?? (useGold ? GOLD : GREEN)

          context.shadowBlur = isHead ? 12 : 5
          context.shadowColor = `rgba(${color}, ${alpha})`
          context.fillStyle = `rgba(${color}, ${alpha})`
          context.fillText(pickChar(), stream.x, y)
        }
      }

      scheduleNext()
    }

    resize()
    window.addEventListener('resize', resize)
    rafRef.current = window.requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('resize', resize)
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    }
  }, [reducedMotion])

  if (reducedMotion) {
    // Reduced motion keeps the underlying state legible (Phase G) as a static tint -- no pulse,
    // no animation, just the current real color standing in place of the moving rain.
    const rgb = statusSnap.kind === 'idle' ? GREEN : matrixRuntimeRgb(statusSnap.channel)
    return (
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-screen w-screen"
        style={{ background: `radial-gradient(circle at top, rgba(${rgb}, 0.05), rgba(0, 0, 0, 0.2) 45%)` }}
      />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 h-screen w-screen"
      style={{
        background: 'rgba(0, 0, 0, 0.14)',
        mixBlendMode: 'screen',
        opacity: 'var(--war-room-matrix-opacity)',
      }}
    />
  )
})
