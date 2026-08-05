'use client'

import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import {
  getMatrixStatusServerSnapshot,
  getMatrixStatusSnapshot,
  subscribeMatrixStatus,
  type MatrixStatusKind,
} from '@/lib/ui/matrixStatusBus'

const CHARSET = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ0123456789ABCDEF'
const GREEN = '0, 255, 102'
const YELLOW = '234, 179, 8'
const RED = '248, 113, 113'

type Stream = {
  x: number
  y: number
  speed: number
  length: number
  fontSize: number
}

function pickChar() {
  return CHARSET[Math.floor(Math.random() * CHARSET.length)] ?? '0'
}

function makeStreams(width: number, height: number, mobile: boolean): Stream[] {
  const fontSize = mobile ? 11 : 13
  const columnWidth = fontSize * 1.8
  const columnCount = Math.min(mobile ? 18 : 42, Math.ceil(width / columnWidth))

  return Array.from({ length: columnCount }, (_, index) => ({
    x: index * columnWidth + Math.random() * fontSize,
    y: Math.random() * height,
    speed: 22 + Math.random() * 36,
    length: 6 + Math.floor(Math.random() * 12),
    fontSize,
  }))
}

function rgbForKind(kind: MatrixStatusKind, timeMs: number): string {
  switch (kind) {
    case 'working': {
      const pulse = 0.55 + 0.45 * Math.sin(timeMs * 0.006)
      return pulse > 0.5 ? YELLOW : GREEN
    }
    case 'success': {
      const pulse = 0.7 + 0.3 * Math.sin(timeMs * 0.01)
      return `0, ${Math.floor(220 + 35 * pulse)}, ${Math.floor(90 + 40 * pulse)}`
    }
    case 'warning':
      return YELLOW
    case 'error':
      return RED
    case 'idle':
    default:
      return GREEN
  }
}

function alphaScale(kind: MatrixStatusKind, mobile: boolean): number {
  const base = mobile ? 0.75 : 1
  switch (kind) {
    case 'success':
      return base * 1.35
    case 'warning':
      return base * 1.2
    case 'error':
      return base * 1.1
    case 'working':
      return base * 1.05
    default:
      return base
  }
}

function MatrixStatusCaption({ message, kind }: { message: string; kind: MatrixStatusKind }) {
  if (!message || kind === 'idle') return null

  const tone =
    kind === 'error'
      ? 'text-red-300/90'
      : kind === 'warning' || kind === 'working'
        ? 'text-amber-200/85'
        : 'text-emerald-300/90'

  return (
    <p
      className={`pointer-events-none absolute inset-x-0 z-[1] mx-auto max-w-md px-4 text-center text-[9px] font-semibold uppercase tracking-[0.28em] transition-opacity duration-300 sm:text-[10px] ${tone}`}
      style={{
        bottom: 'calc(var(--live-room-bottom-reserved, 7rem) + 0.35rem)',
        textShadow: '0 0 12px rgba(0,0,0,0.85)',
        opacity: 0.92,
      }}
      aria-live="polite"
      aria-atomic
    >
      {message}
    </p>
  )
}

export const MatrixRain = memo(function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const streamsRef = useRef<Stream[]>([])
  const lastTimeRef = useRef(0)
  const statusRef = useRef<MatrixStatusKind>('idle')
  const [reducedMotion, setReducedMotion] = useState(false)
  const [mobile, setMobile] = useState(false)

  const statusSnap = useSyncExternalStore(
    subscribeMatrixStatus,
    getMatrixStatusSnapshot,
    getMatrixStatusServerSnapshot,
  )

  useEffect(() => {
    statusRef.current = statusSnap.kind
  }, [statusSnap.kind, statusSnap.tick])

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const narrow = window.matchMedia('(max-width: 767px)')
    const sync = () => {
      setReducedMotion(motion.matches)
      setMobile(narrow.matches)
    }
    sync()
    motion.addEventListener('change', sync)
    narrow.addEventListener('change', sync)
    return () => {
      motion.removeEventListener('change', sync)
      narrow.removeEventListener('change', sync)
    }
  }, [])

  useEffect(() => {
    if (reducedMotion) return
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) return

    const maxDpr = mobile ? 1 : 1.25

    const resize = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      streamsRef.current = makeStreams(width, height, mobile)
    }

    const draw = (time: number) => {
      if (document.visibilityState !== 'visible') {
        lastTimeRef.current = time
        rafRef.current = window.requestAnimationFrame(draw)
        return
      }

      const width = window.innerWidth
      const height = window.innerHeight
      const delta = Math.min(64, time - (lastTimeRef.current || time))
      lastTimeRef.current = time

      const kind = statusRef.current
      const rgb = rgbForKind(kind, time)
      const scale = alphaScale(kind, mobile)
      const speedMul =
        kind === 'warning' ? 1.35 : kind === 'error' ? 1.15 : kind === 'success' ? 1.08 : 1
      const trailAlpha = kind === 'error' ? 0.2 : kind === 'success' ? 0.1 : 0.14

      context.fillStyle = `rgba(0, 0, 0, ${trailAlpha})`
      context.fillRect(0, 0, width, height)
      context.textAlign = 'center'
      context.font = `${streamsRef.current[0]?.fontSize ?? 13}px ui-monospace, monospace`

      for (const stream of streamsRef.current) {
        stream.y += stream.speed * speedMul * (delta / 1000)
        if (stream.y - stream.length * stream.fontSize > height + 40) {
          stream.y = -Math.random() * height * 0.25
        }

        for (let i = 0; i < stream.length; i++) {
          const y = stream.y - i * stream.fontSize
          if (y < -stream.fontSize || y > height + stream.fontSize) continue
          const fade = Math.max(0, 1 - i / stream.length)
          let headAlpha = (i === 0 ? 0.22 : 0.1 * fade) * scale
          if (kind === 'error' && i === 0 && Math.random() > 0.82) {
            headAlpha *= 0.35
          }
          const glitchX =
            kind === 'error' && i === 0 ? (Math.random() - 0.5) * (mobile ? 4 : 8) : 0
          context.fillStyle = `rgba(${rgb}, ${headAlpha})`
          context.fillText(pickChar(), stream.x + glitchX, y)
        }
      }

      rafRef.current = window.requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    rafRef.current = window.requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('resize', resize)
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    }
  }, [mobile, reducedMotion])

  if (reducedMotion) {
    const kind = statusSnap.kind
    const glow =
      kind === 'error'
        ? 'rgba(248,113,113,0.06)'
        : kind === 'warning' || kind === 'working'
          ? 'rgba(234,179,8,0.05)'
          : 'rgba(0,255,102,0.04)'
    return (
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(ellipse at 50% 0%, ${glow}, transparent 55%)` }}
        />
        <MatrixStatusCaption message={statusSnap.message} kind={kind} />
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-0 h-full w-full" aria-hidden>
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{ mixBlendMode: 'screen', opacity: 'var(--war-room-matrix-opacity)' }}
      />
      <MatrixStatusCaption message={statusSnap.message} kind={statusSnap.kind} />
    </div>
  )
})
