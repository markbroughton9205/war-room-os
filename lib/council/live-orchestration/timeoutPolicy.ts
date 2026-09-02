export type StreamTimeoutBudget = {
  firstTokenMs: number
  idleMs: number
  overallMs: number
}

/** Provider-appropriate budgets. Greeting/social replies are short but first-token can still be slow. */
export function resolveStreamTimeoutBudget(kind: 'social' | 'council' | 'research'): StreamTimeoutBudget {
  if (kind === 'social') {
    return { firstTokenMs: 20_000, idleMs: 12_000, overallMs: 32_000 }
  }
  if (kind === 'research') {
    return { firstTokenMs: 25_000, idleMs: 20_000, overallMs: 50_000 }
  }
  return { firstTokenMs: 20_000, idleMs: 18_000, overallMs: 45_000 }
}

export type StreamAbortReason = 'first_token' | 'idle' | 'overall' | 'client' | 'none'

export function createStreamTimeoutController(budget: StreamTimeoutBudget, parent?: AbortSignal): {
  signal: AbortSignal
  reason: () => StreamAbortReason
  markFirstToken: () => void
  dispose: () => void
} {
  const controller = new AbortController()
  let abortReason: StreamAbortReason = 'none'
  let firstToken = false
  const timers: ReturnType<typeof setTimeout>[] = []

  const abort = (reason: StreamAbortReason) => {
    if (controller.signal.aborted) return
    abortReason = reason
    controller.abort()
  }

  const onParentAbort = () => abort('client')
  parent?.addEventListener('abort', onParentAbort, { once: true })

  timers.push(setTimeout(() => {
    if (!firstToken) abort('first_token')
  }, budget.firstTokenMs))
  timers.push(setTimeout(() => abort('overall'), budget.overallMs))

  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const bumpIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => abort('idle'), budget.idleMs)
    timers.push(idleTimer)
  }

  return {
    signal: controller.signal,
    reason: () => abortReason,
    markFirstToken: () => {
      firstToken = true
      bumpIdle()
    },
    dispose: () => {
      parent?.removeEventListener('abort', onParentAbort)
      for (const timer of timers) clearTimeout(timer)
    },
  }
}
