'use client'

import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import {
  getMatrixStatusServerSnapshot,
  getMatrixStatusSnapshot,
  subscribeMatrixStatus,
  type MatrixChannel,
} from '@/lib/ui/matrixStatusBus'

const CHARSET = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ0123456789ABCDEF'
const GREEN = '0, 255, 102'
const RED = '248, 113, 113'

/** White flash-decay window: how long a white burst stays at elevated brightness. */
const WHITE_FLASH_DECAY_MS = 1_400

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

/**
 * Per-channel color behavior. Every channel must be visually distinct:
 * - cyan   inflow shimmer (fast brightness oscillation sweeping toward teal)
 * - violet outbound (slow hue drift between violet and indigo)
 * - amber  processing pulse (sinusoidal brightness pulse)
 * - green  healthy baseline (gentle glow)
 * - red    failure (glitch handled at the head glyph below)
 * - white  verified completion (bright flash that decays since emission)
 */
function rgbForChannel(channel: MatrixChannel, timeMs: number, emittedAtMs: number): string {
  switch (channel) {
    case 'cyan': {
      const shimmer = 0.5 + 0.5 * Math.sin(timeMs * 0.012)
      return `${Math.floor(20 + 14 * shimmer)}, ${Math.floor(190 + 60 * shimmer)}, ${Math.floor(220 + 35 * shimmer)}`
    }
    case 'violet': {
      const drift = 0.5 + 0.5 * Math.sin(timeMs * 0.003)
      return `${Math.floor(150 + 30 * drift)}, ${Math.floor(120 + 20 * (1 - drift))}, 250`
    }
    case 'amber': {
      const pulse = 0.55 + 0.45 * Math.sin(timeMs * 0.006)
      return `${Math.floor(200 + 55 * pulse)}, ${Math.floor(150 + 45 * pulse)}, 8`
    }
    case 'red':
      return RED
    case 'white': {
      const elapsed = emittedAtMs > 0 ? timeMs - emittedAtMs : WHITE_FLASH_DECAY_MS
      const decay = Math.max(0, Math.min(1, 1 - elapsed / WHITE_FLASH_DECAY_MS))
      const level = Math.floor(180 + 75 * decay)
      return `${level}, ${Math.floor(level * 0.97)}, ${Math.floor(level * 1.04) > 255 ? 255 : Math.floor(level * 1.04)}`
    }
    case 'green':
    default:
      return GREEN
  }
}

function alphaScale(channel: MatrixChannel, mobile: boolean): number {
  const base = mobile ? 0.75 : 1
  switch (channel) {
    case 'white':
      return base * 1.45
    case 'cyan':
      return base * 1.25
    case 'violet':
      return base * 1.15
    case 'amber':
      return base * 1.05
    case 'red':
      return base * 1.1
    default:
      return base
  }
}

function speedMultiplier(channel: MatrixChannel): number {
  switch (channel) {
    case 'cyan':
      return 1.25 // inflow accelerates the rain
    case 'violet':
      return 0.85 // outbound slows to a deliberate drift
    case 'amber':
      return 1.35
    case 'white':
      return 1.5
    case 'red':
      return 1.15
    default:
      return 1
  }
}

function trailAlpha(channel: MatrixChannel): number {
  switch (channel) {
    case 'red':
      return 0.2
    case 'white':
      return 0.08
    case 'cyan':
      return 0.11
    default:
      return 0.14
  }
}

function captionTone(channel: MatrixChannel): string {
  switch (channel) {
    case 'cyan':
      return 'text-cyan-300/90'
    case 'violet':
      return 'text-violet-300/90'
    case 'amber':
      return 'text-amber-200/85'
    case 'red':
      return 'text-red-300/90'
    case 'white':
      return 'text-slate-100/95'
    case 'green':
    default:
      return 'text-emerald-300/90'
  }
}

function reducedMotionGlow(channel: MatrixChannel): string {
  switch (channel) {
    case 'cyan':
      return 'rgba(34,211,238,0.05)'
    case 'violet':
      return 'rgba(167,139,250,0.05)'
    case 'amber':
      return 'rgba(234,179,8,0.05)'
    case 'red':
      return 'rgba(248,113,113,0.06)'
    case 'white':
      return 'rgba(226,232,240,0.06)'
    case 'green':
    default:
      return 'rgba(0,255,102,0.04)'
  }
}

function MatrixStatusCaption({ message, channel }: { message: string; channel: MatrixChannel }) {
  if (!message) return null

  return (
    <p
      className={`pointer-events-none absolute inset-x-0 z-[1] mx-auto max-w-md px-4 text-center text-[9px] font-semibold uppercase tracking-[0.28em] transition-opacity duration-300 sm:text-[10px] ${captionTone(channel)}`}
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
  const channelRef = useRef<MatrixChannel>('green')
  const emittedAtRef = useRef(0)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [mobile, setMobile] = useState(false)

  const statusSnap = useSyncExternalStore(
    subscribeMatrixStatus,
    getMatrixStatusSnapshot,
    getMatrixStatusServerSnapshot,
  )

  useEffect(() => {
    channelRef.current = statusSnap.channel
    emittedAtRef.current = statusSnap.emittedAtMs
  }, [statusSnap.channel, statusSnap.emittedAtMs, statusSnap.tick])

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

      const channel = channelRef.current
      const rgb = rgbForChannel(channel, time, emittedAtRef.current)
      const scale = alphaScale(channel, mobile)
      const speedMul = speedMultiplier(channel)
      const trail = trailAlpha(channel)

      context.fillStyle = `rgba(0, 0, 0, ${trail})`
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
          if (channel === 'red' && i === 0 && Math.random() > 0.82) {
            headAlpha *= 0.35
          }
          const glitchX =
            channel === 'red' && i === 0 ? (Math.random() - 0.5) * (mobile ? 4 : 8) : 0
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
    const channel = statusSnap.channel
    return (
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at 50% 0%, ${reducedMotionGlow(channel)}, transparent 55%)`,
          }}
        />
        <MatrixStatusCaption message={statusSnap.message} channel={channel} />
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
      <MatrixStatusCaption message={statusSnap.message} channel={statusSnap.channel} />
    </div>
  )
})
