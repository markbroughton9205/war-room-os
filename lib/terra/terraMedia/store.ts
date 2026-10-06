import type { TerraMediaCandidate, TerraMediaStoreSnapshot } from './types'

const EMPTY: TerraMediaStoreSnapshot = {
  candidate: null,
  lastQueuedId: null,
}

type Listener = () => void

/**
 * Terra-owned candidate queue. Does not own audio.
 * Queuing a candidate never starts playback.
 */
export class TerraMediaStore {
  private snapshot: TerraMediaStoreSnapshot = EMPTY
  private listeners = new Set<Listener>()

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): TerraMediaStoreSnapshot => this.snapshot

  getServerSnapshot = (): TerraMediaStoreSnapshot => EMPTY

  /**
   * Queue a verified candidate. Same event id is a no-op (no extra pulse).
   * Returns true when Terra workspace should pulse/front Terra Media.
   */
  queue(candidate: TerraMediaCandidate): boolean {
    if (candidate.autoplay !== false) return false
    if (this.snapshot.candidate?.id === candidate.id) return false
    this.snapshot = { candidate, lastQueuedId: candidate.id }
    this.emit()
    return true
  }

  clear(): void {
    if (!this.snapshot.candidate && !this.snapshot.lastQueuedId) return
    this.snapshot = EMPTY
    this.emit()
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}

let browserStore: TerraMediaStore | null = null

export function getTerraMediaStore(): TerraMediaStore {
  if (typeof window === 'undefined') return new TerraMediaStore()
  if (!browserStore) browserStore = new TerraMediaStore()
  return browserStore
}
