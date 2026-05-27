'use client'

export type MatrixStatusKind = 'idle' | 'working' | 'success' | 'warning' | 'error'

export type MatrixStatusSnapshot = {
  kind: MatrixStatusKind
  message: string
  /** Monotonic tick for subscribers; changes on each emission. */
  tick: number
}

/** Stable idle snapshot for SSR / getServerSnapshot (must not allocate per call). */
export const MATRIX_IDLE_SNAPSHOT: MatrixStatusSnapshot = Object.freeze({
  kind: 'idle',
  message: '',
  tick: 0,
})

const THROTTLE_MS = 380
const AUTO_IDLE_MS: Record<Exclude<MatrixStatusKind, 'idle'>, number> = {
  working: 0,
  success: 1_400,
  warning: 1_100,
  error: 1_800,
}

const PRIORITY: Record<MatrixStatusKind, number> = {
  idle: 0,
  working: 1,
  warning: 2,
  success: 3,
  error: 4,
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

function scheduleIdle(kind: Exclude<MatrixStatusKind, 'idle'>) {
  const delay = AUTO_IDLE_MS[kind]
  if (delay <= 0) return
  clearIdleTimer()
  idleTimer = setTimeout(() => {
    idleTimer = null
    emit({ kind: 'idle', message: '', tick: snapshot.tick + 1 })
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

/** Publish matrix rain + caption feedback (client-only bus). */
export function matrixStatus(
  kind: Exclude<MatrixStatusKind, 'idle'>,
  message: string,
): void {
  if (typeof window === 'undefined') return
  const trimmed = message.trim()
  if (!trimmed) return

  const now = Date.now()
  const incomingPriority = PRIORITY[kind]
  const currentPriority = PRIORITY[snapshot.kind]
  const withinThrottle = now - lastEmitAt < THROTTLE_MS

  if (withinThrottle && incomingPriority <= currentPriority && kind !== 'error') {
    return
  }

  lastEmitAt = now
  clearIdleTimer()
  emit({ kind, message: trimmed, tick: snapshot.tick + 1 })
  scheduleIdle(kind)
}

export function matrixStatusIdle(): void {
  if (typeof window === 'undefined') return
  clearIdleTimer()
  if (snapshot.kind === 'idle') return
  emit({ kind: 'idle', message: '', tick: snapshot.tick + 1 })
}
