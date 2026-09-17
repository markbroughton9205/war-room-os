'use client'

import { useEffect, useState } from 'react'

export type TerraCommanderSessionState = 'CHECKING' | 'AUTHENTICATED' | 'AUTH_REQUIRED' | 'BOOTSTRAP_REQUIRED' | 'UNAVAILABLE'

export function commanderSessionNeedsAuth(state: TerraCommanderSessionState): boolean {
  return state === 'AUTH_REQUIRED' || state === 'BOOTSTRAP_REQUIRED'
}

export function useTerraCommanderSession(): TerraCommanderSessionState {
  const [state, setState] = useState<TerraCommanderSessionState>('CHECKING')

  useEffect(() => {
    let cancelled = false
    const readStatus = async () => {
      try {
        const response = await fetch('/api/sovereign/local-auth/status', { cache: 'no-store', credentials: 'include' })
        if (cancelled) return
        if (!response.ok) {
          setState('UNAVAILABLE')
          return
        }
        const body = await response.json() as { authenticated?: boolean; bootstrapped?: boolean }
        if (body.authenticated) {
          setState('AUTHENTICATED')
          return
        }
        setState(body.bootstrapped === false ? 'BOOTSTRAP_REQUIRED' : 'AUTH_REQUIRED')
      } catch {
        if (!cancelled) setState('UNAVAILABLE')
      }
    }
    void readStatus()
    const timer = window.setInterval(() => { void readStatus() }, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return state
}

export function TerraCommanderSessionChip() {
  const state = useTerraCommanderSession()

  const tone =
    state === 'AUTHENTICATED' ? 'text-emerald-300 border-emerald-400/40'
    : state === 'AUTH_REQUIRED' || state === 'BOOTSTRAP_REQUIRED' ? 'text-amber-300 border-amber-400/40'
    : 'text-slate-400 border-white/15'

  const href = state === 'AUTHENTICATED' || state === 'CHECKING' ? null : '/login?next=/terra'

  const chip = (
    <p
      className={`rounded border bg-black/55 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest ${tone} ${href ? 'pointer-events-auto hover:border-amber-300/70' : 'pointer-events-none'}`}
      data-testid="terra-commander-session-chip"
      data-session-state={state}
    >
      commander session · {state.replaceAll('_', ' ')}
    </p>
  )

  if (!href) return chip
  return (
    <a href={href} className="pointer-events-auto" title={state === 'BOOTSTRAP_REQUIRED' ? 'Open local Commander bootstrap' : 'Open local Commander sign in'}>
      {chip}
    </a>
  )
}
