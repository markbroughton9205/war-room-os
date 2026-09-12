'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Status = {
  bootstrapped?: boolean
  authenticated?: boolean
  identity?: { display_name?: string; id?: string } | null
}

/**
 * Phase 11C — Local War Room Commander login (loopback only).
 * Distinct from remote Supabase LoginForm.
 */
export function LocalCommanderLoginPanel({ next }: { next: string }) {
  const router = useRouter()
  const [status, setStatus] = useState<Status | null>(null)
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('Local Commander')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [mode, setMode] = useState<'login' | 'bootstrap'>('login')

  useEffect(() => {
    void fetch('/api/sovereign/local-auth/status', { credentials: 'include' })
      .then(r => r.json())
      .then((j: Status & { ok?: boolean; bootstrapped?: boolean }) => {
        setStatus(j)
        setMode(j.bootstrapped ? 'login' : 'bootstrap')
        if (j.authenticated) router.replace(next || '/')
      })
      .catch(() => setStatus({ bootstrapped: false }))
  }, [next, router])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const path = mode === 'bootstrap' ? '/api/sovereign/local-auth/bootstrap' : '/api/sovereign/local-auth/login'
      const body =
        mode === 'bootstrap'
          ? { password, display_name: displayName }
          : { password }
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await res.json()) as { ok?: boolean; error?: string; reason?: string }
      if (!res.ok || !j.ok) {
        setError(j.error || j.reason || 'Authentication failed.')
        return
      }
      router.replace(next || '/')
      router.refresh()
    } catch {
      setError('Local auth unavailable.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-6 w-full max-w-sm rounded px-6 py-6"
      style={{ border: '1px solid #1e3a5f', background: 'rgba(0,20,40,0.55)' }}
    >
      <p className="text-[10px] font-bold tracking-widest" style={{ color: '#7dd3fc' }}>
        LOCAL WAR ROOM
      </p>
      <p className="mt-1 text-[10px] tracking-wide" style={{ color: '#64748b' }}>
        Offline Commander identity — no Supabase required.
      </p>

      {mode === 'bootstrap' ? (
        <label className="mt-4 block text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>
          DISPLAY NAME
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            className="mt-1 w-full rounded px-3 py-2 text-sm font-mono text-white outline-none"
            style={{ border: '1px solid rgba(125,211,252,0.35)', background: 'rgba(0,0,0,0.6)' }}
          />
        </label>
      ) : null}

      <label className="mt-4 block text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>
        LOCAL PASSWORD
        <input
          type="password"
          autoComplete={mode === 'bootstrap' ? 'new-password' : 'current-password'}
          required
          minLength={10}
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="mt-1 w-full rounded px-3 py-2 text-sm font-mono text-white outline-none"
          style={{ border: '1px solid rgba(125,211,252,0.35)', background: 'rgba(0,0,0,0.6)' }}
        />
      </label>

      {error ? (
        <p className="mt-4 text-[10px] font-bold tracking-widest" style={{ color: '#F87171' }} role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded px-3 py-2 text-xs font-bold tracking-widest disabled:opacity-50"
        style={{ border: '1px solid rgba(125,211,252,0.55)', color: '#7dd3fc', background: 'rgba(0,0,0,0.28)' }}
      >
        {pending
          ? 'AUTHENTICATING…'
          : mode === 'bootstrap'
            ? 'CREATE LOCAL COMMANDER'
            : 'LOCAL SIGN IN'}
      </button>

      {status?.bootstrapped ? (
        <button
          type="button"
          className="mt-3 w-full text-center text-[10px] font-bold tracking-widest"
          style={{ color: '#64748b' }}
          onClick={() => setMode(mode === 'login' ? 'bootstrap' : 'login')}
        >
          {mode === 'login' ? 'Need first-run setup?' : 'Back to local sign in'}
        </button>
      ) : null}

      <p className="mt-4 text-center text-[9px] tracking-wide" style={{ color: '#475569' }}>
        Recovery: NOT_IMPLEMENTED · Remote account remains separate below
      </p>
    </form>
  )
}
