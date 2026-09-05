export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Coalesce bursty provider chunks onto animation frames. No fake sleep typewriter. */
export function createPresentationBuffer(onFlush: (text: string) => void): {
  push: (delta: string) => void
  flush: () => void
  dispose: () => void
} {
  let pending = ''
  let frame: number | null = null
  const reduced = prefersReducedMotion()

  const flush = () => {
    if (!pending) return
    const text = pending
    pending = ''
    onFlush(text)
  }

  return {
    push(delta: string) {
      if (!delta) return
      if (reduced) {
        onFlush(delta)
        return
      }
      pending += delta
      if (frame != null) return
      frame = requestAnimationFrame(() => {
        frame = null
        flush()
      })
    },
    flush: () => {
      if (frame != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frame)
        frame = null
      }
      flush()
    },
    dispose: () => {
      if (frame != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      frame = null
      pending = ''
    },
  }
}
