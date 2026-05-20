'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import styles from './intro.module.css'

export const WAR_ROOM_INTRO_DISMISSED_KEY = 'war_room_intro_dismissed'

const CODE_LINES = [
  'SYSTEM ONLINE',
  'COUNCIL ACTIVE',
  'SIGNALS SYNCING',
  "RA'EL IN COMMAND",
  'WAR ROOM OS',
  'TRUTH LAYER ACTIVE',
] as const

const BIT_CHARS = '01{}[]<>/\\|#$%+=*'

/** Full cinematic intro ~2.6s; reduced motion ~0.85s */
const TIMING = {
  pulseAt: 420,
  dissolveAt: 980,
  exitAt: 1900,
  dismissAt: 2600,
} as const

const REDUCED_TIMING = {
  exitAt: 520,
  dismissAt: 850,
} as const

type IntroPhase = 'symbol' | 'pulse' | 'dissolve' | 'exit'

type Particle = {
  id: number
  left: string
  delay: string
  duration: string
  distance: string
  text: string
  kind: 'line' | 'bit'
}

function readShouldShowIntro(): boolean {
  try {
    return sessionStorage.getItem(WAR_ROOM_INTRO_DISMISSED_KEY) !== '1'
  } catch {
    return false
  }
}

function readReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function makeParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, index) => {
    const isLine = index < CODE_LINES.length
    const bit =
      BIT_CHARS[Math.floor(Math.random() * BIT_CHARS.length)] ??
      '0'

    return {
      id: index,
      left: `${6 + Math.random() * 88}%`,
      delay: `${Math.random() * 0.45}s`,
      duration: `${0.65 + Math.random() * 0.55}s`,
      distance: `${34 + Math.random() * 22}vh`,
      text: isLine ? CODE_LINES[index]! : bit,
      kind: isLine ? 'line' : 'bit',
    }
  })
}

export type WarRoomIntroProps = {
  onDismiss?: () => void
}

export function WarRoomIntro({ onDismiss }: WarRoomIntroProps) {
  const [visible, setVisible] = useState(readShouldShowIntro)
  const [phase, setPhase] = useState<IntroPhase>('symbol')
  const reducedMotion = useMemo(() => readReducedMotion(), [])
  const particles = useMemo(() => makeParticles(32), [])
  const dismissedRef = useRef(false)

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return
    dismissedRef.current = true
    try {
      sessionStorage.setItem(WAR_ROOM_INTRO_DISMISSED_KEY, '1')
    } catch {
      /* sessionStorage may be unavailable in private mode */
    }
    setVisible(false)
    onDismiss?.()
  }, [onDismiss])

  useEffect(() => {
    if (!visible) return

    let cancelled = false
    const schedule = reducedMotion ? REDUCED_TIMING : TIMING
    const timers: number[] = []

    if (!reducedMotion) {
      timers.push(window.setTimeout(() => { if (!cancelled) setPhase('pulse') }, TIMING.pulseAt))
      timers.push(window.setTimeout(() => { if (!cancelled) setPhase('dissolve') }, TIMING.dissolveAt))
    }

    timers.push(window.setTimeout(() => { if (!cancelled) setPhase('exit') }, schedule.exitAt))
    timers.push(window.setTimeout(() => { if (!cancelled) dismiss() }, schedule.dismissAt))

    return () => {
      cancelled = true
      timers.forEach(window.clearTimeout)
    }
  }, [dismiss, reducedMotion, visible])

  if (!visible) return null

  const symbolClass = [
    styles.symbol,
    phase === 'pulse' ? styles.symbolPulse : '',
    phase === 'dissolve' || phase === 'exit' ? styles.symbolDissolve : '',
  ]
    .filter(Boolean)
    .join(' ')

  const overlayClass = [
    styles.overlay,
    phase === 'exit' ? styles.overlayExiting : '',
    reducedMotion ? styles.reducedMotion : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={overlayClass}
      aria-hidden={phase === 'exit'}
      data-testid="war-room-intro-overlay"
    >
      <button
        type="button"
        className={styles.skip}
        aria-label="Skip intro animation"
        onClick={dismiss}
      >
        Skip Intro
      </button>

      <div className={styles.stage}>
        <div className={symbolClass}>
          <span className={styles.symbolIcon} aria-hidden>
            ⚔
          </span>
          <span className={styles.symbolText}>WAR ROOM</span>
        </div>

        {!reducedMotion ? (
          <div
            className={[
              styles.particles,
              phase === 'dissolve' || phase === 'exit' ? styles.particlesActive : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-hidden
          >
            {particles.map(particle => (
              <span
                key={particle.id}
                className={[
                  styles.particle,
                  particle.kind === 'line' ? styles.particleLine : styles.particleBit,
                ].join(' ')}
                style={{
                  left: particle.left,
                  ['--fall-delay' as string]: particle.delay,
                  ['--fall-duration' as string]: particle.duration,
                  ['--fall-distance' as string]: particle.distance,
                }}
              >
                {particle.text}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
