'use client'

/**
 * Matrix status bus — single client-side sink for the MatrixRain visual system.
 *
 * Channel model (full War Room palette):
 * - cyan   — incoming intelligence / provider data arriving
 * - violet — outgoing requests / provider queries
 * - amber  — processing / synthesis / waiting
 * - green  — successful completion / healthy baseline (idle maps here)
 * - red    — failure / disconnect / critical
 * - white  — important verified completion / high-confidence intelligence arrival
 *
 * Backward compatibility: the legacy `matrixStatus(kind, message)` kinds
 * (idle/working/success/warning/error) are unchanged at call sites and map onto
 * channels via LEGACY_KIND_CHANNEL. New code should call
 * `matrixChannelStatus(channel, message)` directly (see lib/ui/runtimeEventBridge.ts).
 */

export type MatrixChannel = 'cyan' | 'violet' | 'amber' | 'green' | 'red' | 'white'

export type MatrixLegacyKind = 'idle' | 'working' | 'success' | 'warning' | 'error'

/** Snapshot kind: legacy kinds are preserved for old call sites; channel emissions carry the channel name. */
export type MatrixStatusKind = MatrixLegacyKind | MatrixChannel

export const MATRIX_CHANNELS = ['cyan', 'violet', 'amber', 'green', 'red', 'white'] as const

/** Legacy kind → channel mapping (working→amber, warning→amber, success→green, error→red, idle→green baseline). */
export const LEGACY_KIND_CHANNEL: Record<MatrixLegacyKind, MatrixChannel> = {
  idle: 'green',
  working: 'amber',
  success: 'green',
  warning: 'amber',
  error: 'red',
}

export type MatrixStatusSnapshot = {
  kind: MatrixStatusKind
  /** Resolved palette channel; this is what the visual system renders. */
  channel: MatrixChannel
  message: string
  /** Monotonic tick for subscribers; changes on each emission. */
  tick: number
  /** Client clock of the emission; 0 for the SSR/idle snapshot. Used for flash-decay rendering. */
  emittedAtMs: number
}

/** Stable idle snapshot for SSR / getServerSnapshot (must not allocate per call). */
export const MATRIX_IDLE_SNAPSHOT: MatrixStatusSnapshot = Object.freeze({
  kind: 'idle',
  channel: 'green',
  message: '',
  tick: 0,
  emittedAtMs: 0,
})

const THROTTLE_MS = 380

/** Auto-idle delay per channel; 0 means "sticky until explicitly replaced". */
const AUTO_IDLE_MS: Record<MatrixChannel, number> = {
  cyan: 900,
  violet: 900,
  amber: 0,
  green: 1_400,
  red: 1_800,
  white: 1_200,
}

/**
 * Simultaneous-emission priority: red > white > violet/cyan > amber > green baseline.
 * Higher number wins when a lower-priority signal arrives inside the throttle window.
 */
export const MATRIX_CHANNEL_PRIORITY: Record<MatrixChannel, number> = {
  green: 0,
  amber: 1,
  cyan: 2,
  violet: 2,
  white: 3,
  red: 4,
}

export function isMatrixChannel(value: string): value is MatrixChannel {
  return (MATRIX_CHANNELS as readonly string[]).includes(value)
}

/** Resolve any status kind (legacy or channel) to its palette channel. */
export function resolveMatrixChannel(kind: MatrixStatusKind): MatrixChannel {
  if (isMatrixChannel(kind)) return kind
  return LEGACY_KIND_CHANNEL[kind]
}

let snapshot: MatrixStatusSnapshot = MATRIX_IDLE_SNAPSHOT
const listeners = new Set<() => void>()
let lastEmitAt = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null

function emit(next: MatrixStatusSnapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}

function clearIdleTimer() {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

function scheduleIdle(channel: MatrixChannel) {
  const delay = AUTO_IDLE_MS[channel]
  if (delay <= 0) return
  clearIdleTimer()
  idleTimer = setTimeout(() => {
    idleTimer = null
    emit({ kind: 'idle', channel: 'green', message: '', tick: snapshot.tick + 1, emittedAtMs: Date.now() })
  }, delay)
}

export function getMatrixStatusSnapshot(): MatrixStatusSnapshot {
  return snapshot
}

export function getMatrixStatusServerSnapshot(): MatrixStatusSnapshot {
  return MATRIX_IDLE_SNAPSHOT
}

export function subscribeMatrixStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(kind: MatrixStatusKind, message: string): void {
  if (typeof window === 'undefined') return
  const trimmed = message.trim()
  if (!trimmed) return

  const channel = resolveMatrixChannel(kind)
  const now = Date.now()
  const incomingPriority = MATRIX_CHANNEL_PRIORITY[channel]
  const currentPriority = MATRIX_CHANNEL_PRIORITY[snapshot.channel]
  const withinThrottle = now - lastEmitAt < THROTTLE_MS

  if (withinThrottle && incomingPriority <= currentPriority && channel !== 'red') {
    return
  }

  lastEmitAt = now
  clearIdleTimer()
  emit({ kind, channel, message: trimmed, tick: snapshot.tick + 1, emittedAtMs: now })
  scheduleIdle(channel)
}

/** Publish matrix rain + caption feedback using a legacy kind (client-only bus). */
export function matrixStatus(
  kind: Exclude<MatrixLegacyKind, 'idle'>,
  message: string,
): void {
  publish(kind, message)
}

/** Publish matrix rain + caption feedback using a palette channel directly. */
export function matrixChannelStatus(channel: MatrixChannel, message: string): void {
  publish(channel, message)
}

export function matrixStatusIdle(): void {
  if (typeof window === 'undefined') return
  clearIdleTimer()
  if (snapshot.kind === 'idle') return
  emit({ kind: 'idle', channel: 'green', message: '', tick: snapshot.tick + 1, emittedAtMs: Date.now() })
}
