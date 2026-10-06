/**
 * Frontend-only Live Intel inbox. Future event providers publish here.
 * This is not a backend event bus and never fabricates items on its own.
 */
import type { LiveIntelItem } from './types'

export type LiveIntelStoreSnapshot = {
  extras: LiveIntelItem[]
  toasts: LiveIntelItem[]
  tick: number
}

const EMPTY: LiveIntelStoreSnapshot = Object.freeze({
  extras: [],
  toasts: [],
  tick: 0,
})

let snapshot: LiveIntelStoreSnapshot = EMPTY
const listeners = new Set<() => void>()

function emit(next: LiveIntelStoreSnapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}

export function getLiveIntelStoreSnapshot(): LiveIntelStoreSnapshot {
  return snapshot
}

export function subscribeLiveIntelStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishLiveIntelItem(item: LiveIntelItem, options?: { toast?: boolean }): void {
  const extras = snapshot.extras.some(existing => existing.id === item.id)
    ? snapshot.extras.map(existing => (existing.id === item.id ? item : existing))
    : [...snapshot.extras, item]
  const toasts = options?.toast && item.toastEligible !== false
    ? [...snapshot.toasts.filter(existing => existing.id !== item.id), item].slice(-3)
    : snapshot.toasts
  emit({ extras, toasts, tick: snapshot.tick + 1 })
}

export function markLiveIntelRead(id: string): void {
  const extras = snapshot.extras.map(item => (item.id === id ? { ...item, read: true } : item))
  emit({ extras, toasts: snapshot.toasts, tick: snapshot.tick + 1 })
}

export function dismissLiveIntelToast(id: string): void {
  emit({
    extras: snapshot.extras,
    toasts: snapshot.toasts.filter(item => item.id !== id),
    tick: snapshot.tick + 1,
  })
}

/** Test helper — not used by production UI. */
export function resetLiveIntelStore(): void {
  snapshot = EMPTY
  listeners.clear()
}
