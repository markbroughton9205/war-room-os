'use client'

import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  getMatrixStatusServerSnapshot,
  getMatrixStatusSnapshot,
  MATRIX_IDLE_SNAPSHOT,
  subscribeMatrixStatus,
  type MatrixChannel,
} from '@/lib/ui/matrixStatusBus'
import { matrixRuntimeIntensity, matrixRuntimeRgb } from '@/lib/ui/matrixRuntimeColors'

function isolatedSubscribe() {
  return () => {}
}

function isolatedSnapshot() {
  return MATRIX_IDLE_SNAPSHOT
}

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

export const MatrixCodeRain = memo(function MatrixCodeRain({
  contained = false,
  channelOverride = null,
  intensity = 'normal',
}: {
  contained?: boolean
  channelOverride?: MatrixChannel | null
  intensity?: 'dim' | 'normal' | 'active'
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const streamsRef = useRef<Stream[]>([])
  const lastTimeRef = useRef(0)
  const sizeRef = useRef({ width: 0, height: 0 })
  const [reducedMotion, setReducedMotion] = useState(false)

  const isolated = contained || channelOverride != null
  const statusSnap = useSyncExternalStore(
    isolated ? isolatedSubscribe : subscribeMatrixStatus,
    isolated ? isolatedSnapshot : getMatrixStatusSnapshot,
    getMatrixStatusServerSnapshot,
  )
  const statusRef = useRef({
    kind: channelOverride ?? statusSnap.kind,
    channel: (channelOverride ?? statusSnap.channel) as MatrixChannel,
    intensity,
    forced: isolated,
  })
  useEffect(() => {
    statusRef.current = {
      kind: channelOverride ?? statusSnap.kind,
      channel: (channelOverride ?? statusSnap.channel) as MatrixChannel,
      intensity,
      forced: isolated,
    }
  }, [statusSnap.kind, statusSnap.channel, statusSnap.tick, channelOverride, intensity, isolated])

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
    const readSize = () => {
      const parent = contained ? canvas.parentElement : null
      const width = contained ? (parent?.clientWidth || canvas.clientWidth || 1) : window.innerWidth
      const height = contained ? (parent?.clientHeight || canvas.clientHeight || 1) : window.innerHeight
      sizeRef.current = { width, height }
      return sizeRef.current
    }
    const resize = () => {
      const { width, height } = readSize()
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

      const { width, height } = sizeRef.current
      if (!width || !height) {
        scheduleNext()
        return
      }
      const delta = Math.min(96, time - (lastTimeRef.current || time))
      lastTimeRef.current = time

      const snap = statusRef.current
      const isIdle = !snap.forced && snap.kind === 'idle'
      const runtimeColor = isIdle && !snap.forced ? null : matrixRuntimeRgb(snap.channel)
      const dimFactor = snap.intensity === 'dim' ? 0.55 : snap.intensity === 'active' ? 1.08 : 1
      const runtimeIntensity = (isIdle && !snap.forced ? 1 : matrixRuntimeIntensity(snap.channel)) * dimFactor

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
    const observer = contained && canvas.parentElement ? new ResizeObserver(() => resize()) : null
    if (observer && canvas.parentElement) observer.observe(canvas.parentElement)
    rafRef.current = window.requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('resize', resize)
      observer?.disconnect()
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    }
  }, [reducedMotion, contained])

  const hostClass = contained
    ? 'pointer-events-none absolute inset-0 z-0 h-full w-full'
    : 'pointer-events-none fixed inset-0 z-0 h-screen w-screen'

  if (reducedMotion) {
    const rgb = channelOverride
      ? matrixRuntimeRgb(channelOverride)
      : (statusSnap.kind === 'idle' ? GREEN : matrixRuntimeRgb(statusSnap.channel))
    return (
      <div
        aria-hidden
        className={hostClass}
        style={{ background: `radial-gradient(circle at top, rgba(${rgb}, 0.05), rgba(0, 0, 0, 0.2) 45%)` }}
      />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={hostClass}
      style={{
        background: 'rgba(0, 0, 0, 0.14)',
        mixBlendMode: 'screen',
        opacity: intensity === 'dim' ? 'calc(var(--war-room-matrix-opacity) * 0.55)' : 'var(--war-room-matrix-opacity)',
      }}
    />
  )
})
