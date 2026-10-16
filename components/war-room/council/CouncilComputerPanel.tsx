'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type SessionRow = {
  sessionId: string
  owner: string
  kind: string
  controlState: string
  profileId: string | null
  tabs: Array<{ tabId: string; url: string; title: string; active: boolean }>
  hostname: string | null
  lastAction: string | null
  lastActionAt: string | null
}
type Activity = { at: string | null; actor: string | null; action: string | null; result: string | null; host: string | null }
type State = {
  broker: { state: string; chromiumState: string; chromiumSource: string | null; available: boolean; lastFailure: { code: string; at: string } | null }
  sessions: SessionRow[]
  activity: Activity[]
}

const HEADER = { 'Content-Type': 'application/json', 'x-wr-council-computer': '1' }

const OWNER_LABEL: Record<string, { text: string; cls: string }> = {
  AGENT_CONTROL: { text: 'COUNCIL IS IN CONTROL', cls: 'border-cyan-400/70 text-cyan-200' },
  COMMANDER_CONTROL: { text: 'YOU ARE IN CONTROL', cls: 'border-amber-400/80 text-amber-200' },
  HANDOFF_PENDING: { text: 'HAND-BACK IN PROGRESS', cls: 'border-slate-400/70 text-slate-200' },
}

/**
 * The visible Council computer: what the shared browser is showing right now, who holds control, and the Commander's takeover.
 * Frames come from the broker's own page (not a mock). While the Commander holds control, clicks and typing here go to that page;
 * credentials typed during a secure sign-in are never stored or shown to Council.
 */
export function CouncilComputerPanel({ conversationId, onPosted }: { conversationId: string | null; onPosted?: () => void }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<State | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [frameMeta, setFrameMeta] = useState<{ width: number; height: number; url: string; title: string } | null>(null)
  const [url, setUrl] = useState('https://example.com')
  const [typed, setTyped] = useState('')
  const [signinOrigin, setSigninOrigin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const frameRef = useRef<HTMLImageElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/council/computer${sessionId ? `?sessionId=${sessionId}` : ''}`, { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json() as State & { ok: boolean }
      setState(j)
      if (!sessionId && j.sessions.length) setSessionId(j.sessions[0].sessionId)
      if (sessionId && !j.sessions.some(s => s.sessionId === sessionId)) { setSessionId(j.sessions[0]?.sessionId ?? null) }
    } catch { /* optional */ }
  }, [sessionId])

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- poll starts with an immediate fetch
    void refresh()
    const t = window.setInterval(() => { void refresh() }, 2500)
    return () => window.clearInterval(t)
  }, [open, refresh])

  // live frame
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the frame when the view closes
    if (!open || !sessionId) { setFrameUrl(null); return }
    let stop = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/council/computer?frame=${sessionId}&t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok || stop) return
        const blob = await res.blob()
        const next = URL.createObjectURL(blob)
        setFrameMeta({
          width: Number(res.headers.get('x-council-frame-width') ?? 1280),
          height: Number(res.headers.get('x-council-frame-height') ?? 720),
          url: decodeURIComponent(res.headers.get('x-council-frame-url') ?? ''),
          title: decodeURIComponent(res.headers.get('x-council-frame-title') ?? ''),
        })
        setFrameUrl(prev => { if (prev) URL.revokeObjectURL(prev); return next })
      } catch { /* keep last frame */ }
    }
    void tick()
    const t = window.setInterval(() => { void tick() }, 1200)
    return () => { stop = true; window.clearInterval(t) }
  }, [open, sessionId])

  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/council/computer', { method: 'POST', headers: HEADER, body: JSON.stringify(body) })
      const j = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!res.ok || j.ok === false) { setError(typeof j.error === 'string' ? j.error : `Request failed (${res.status})`); return null }
      await refresh()
      return j
    } finally { setBusy(false) }
  }

  const session = state?.sessions.find(s => s.sessionId === sessionId) ?? null
  const control = session?.controlState ?? null
  const mine = control === 'COMMANDER_CONTROL'
  const badge = control ? OWNER_LABEL[control] ?? { text: control, cls: 'border-slate-400/70 text-slate-200' } : null

  const clickOnFrame = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!mine || !sessionId || !frameMeta || !frameRef.current) return
    const rect = frameRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * frameMeta.width
    const y = ((e.clientY - rect.top) / rect.height) * frameMeta.height
    await post({ action: 'click', sessionId, x, y })
  }

  return (
    <section className="mt-2 rounded-lg border border-sky-500/25 px-3 py-2" style={{ background: 'rgba(0,8,18,0.5)' }} data-testid="council-computer-panel" aria-label="Council computer">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-sky-300">Council computer</p>
        <div className="flex items-center gap-2">
          {badge ? <span className={`rounded border px-1.5 py-0.5 text-[8px] font-bold tracking-wider ${badge.cls}`} data-testid="council-computer-owner" data-control={control}>{badge.text}</span> : null}
          <button type="button" className="rounded border border-sky-400/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-200 hover:bg-sky-400/10"
            onClick={() => setOpen(o => !o)} data-testid="council-computer-toggle">{open ? 'Hide' : 'Open'}</button>
        </div>
      </div>

      {open ? (
        <div className="mt-2 space-y-2" data-testid="council-computer-body">
          {state && !state.broker.available ? (
            <p className="text-[10px] text-amber-300" data-testid="council-computer-unavailable">
              The browser engine is not available ({state.broker.state}, Chromium {state.broker.chromiumState}). Council cannot browse until a Chromium is installed.
            </p>
          ) : state ? (
            <p className="text-[9px] text-slate-500">Engine: {state.broker.state} · Chromium from {state.broker.chromiumSource ?? 'unknown'}</p>
          ) : null}

          <div className="flex gap-1">
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…"
              className="min-w-0 flex-1 rounded border border-sky-900/50 bg-black/40 px-2 py-1 text-[11px] text-sky-50 outline-none" data-testid="council-computer-url" />
            <button type="button" disabled={busy || !state?.broker.available}
              className="rounded border border-sky-400/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-100 hover:bg-sky-400/10 disabled:opacity-40"
              onClick={async () => {
                const res = await post(mine
                  ? { action: 'navigate', sessionId, as: 'commander', url }
                  : { action: 'browse', sessionId: sessionId ?? undefined, url, conversationId })
                if (res) { if (typeof res.sessionId === 'string') setSessionId(res.sessionId); setNote(mine ? 'You navigated.' : 'Council opened the page and reported what it read.'); if (!mine) onPosted?.() }
              }}
              data-testid="council-computer-go">
              {mine ? 'Go (you)' : 'Council: open and read'}
            </button>
          </div>

          {sessionId ? (
            <div className="space-y-1">
              <div className="relative overflow-hidden rounded border border-sky-900/50 bg-black" style={{ maxWidth: 640 }}>
                {frameUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img ref={frameRef} src={frameUrl} alt={`Live view of ${frameMeta?.url ?? 'the Council browser'}`}
                    className={`block w-full ${mine ? 'cursor-crosshair' : 'cursor-default'}`} onClick={e => void clickOnFrame(e)} data-testid="council-computer-frame" />
                ) : <p className="px-2 py-6 text-center text-[10px] text-slate-500">Waiting for the first frame…</p>}
              </div>
              <p className="truncate text-[9px] text-slate-400" data-testid="council-computer-page">{frameMeta?.title || '(untitled)'} — {frameMeta?.url || session?.hostname || ''}</p>
              <div className="flex flex-wrap items-center gap-1">
                {!mine ? (
                  <button type="button" disabled={busy} className="rounded border border-amber-400/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-200 hover:bg-amber-400/10 disabled:opacity-40"
                    onClick={() => void post({ action: 'takeover', sessionId })} data-testid="council-computer-takeover">Take over</button>
                ) : (
                  <button type="button" disabled={busy} className="rounded border border-emerald-400/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-200 hover:bg-emerald-400/10 disabled:opacity-40"
                    onClick={() => void post({ action: 'return', sessionId })} data-testid="council-computer-return">Return control to Council</button>
                )}
                <button type="button" disabled={busy} className="rounded border border-slate-500/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-300 hover:bg-slate-400/10 disabled:opacity-40"
                  onClick={async () => { await post({ action: 'close', sessionId }); setSessionId(null) }} data-testid="council-computer-close">Close session</button>
              </div>
              {mine ? (
                <div className="flex gap-1" data-testid="council-computer-controls">
                  <input value={typed} onChange={e => setTyped(e.target.value)} type="text" autoComplete="off" placeholder="Type into the focused field"
                    className="min-w-0 flex-1 rounded border border-amber-900/50 bg-black/40 px-2 py-1 text-[11px] text-amber-50 outline-none" data-testid="council-computer-type-input" />
                  <button type="button" disabled={busy || !typed} className="rounded border border-amber-400/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-100 hover:bg-amber-400/10 disabled:opacity-40"
                    onClick={async () => { const t = typed; setTyped(''); await post({ action: 'type', sessionId, text: t }) }} data-testid="council-computer-type">Type</button>
                  {['Enter', 'Tab', 'Backspace'].map(k => (
                    <button key={k} type="button" disabled={busy} className="rounded border border-amber-900/60 px-1.5 py-0.5 text-[9px] text-amber-200 hover:bg-amber-400/10 disabled:opacity-40"
                      onClick={() => void post({ action: 'press', sessionId, key: k })} data-testid={`council-computer-key-${k}`}>{k}</button>
                  ))}
                </div>
              ) : null}
              {mine ? <p className="text-[9px] text-amber-300/80">You hold control. Council cannot act on this page until you return control. Text typed here is never stored.</p> : null}
            </div>
          ) : null}

          <details className="rounded border border-sky-900/40 px-2 py-1">
            <summary className="cursor-pointer text-[9px] font-bold uppercase tracking-wider text-sky-300">Secure private sign-in</summary>
            <div className="mt-1 space-y-1">
              <p className="text-[9px] text-slate-400">Opens the site in a trusted, encrypted profile and gives you control. You type the credentials yourself in the view above; Council never sees them, only whether the profile is signed in.</p>
              <div className="flex gap-1">
                <input value={signinOrigin} onChange={e => setSigninOrigin(e.target.value)} placeholder="https://site.example/login"
                  className="min-w-0 flex-1 rounded border border-sky-900/50 bg-black/40 px-2 py-1 text-[11px] text-sky-50 outline-none" data-testid="council-computer-signin-origin" />
                <button type="button" disabled={busy || !signinOrigin} className="rounded border border-sky-400/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-100 hover:bg-sky-400/10 disabled:opacity-40"
                  onClick={async () => { const r = await post({ action: 'signin_start', origin: signinOrigin }); if (r && typeof r.sessionId === 'string') { setSessionId(r.sessionId); setNote('Sign-in session started. You are in control.') } }}
                  data-testid="council-computer-signin-start">Start sign-in</button>
              </div>
            </div>
          </details>

          {error ? <p className="text-[10px] text-red-300" data-testid="council-computer-error">{error}</p> : null}
          {note ? <p className="text-[10px] text-sky-300/80" data-testid="council-computer-note">{note}</p> : null}

          {state?.activity.length ? (
            <ul className="max-h-28 space-y-0.5 overflow-y-auto rounded border border-sky-900/40 px-2 py-1" data-testid="council-computer-activity">
              {state.activity.slice().reverse().map((a, i) => (
                <li key={`${a.at}-${i}`} className="text-[9px] text-slate-400">
                  <span className="text-slate-500">{a.at ? new Date(a.at).toLocaleTimeString() : ''}</span> <span className="text-sky-300">{a.actor}</span> {a.action}{a.host ? ` · ${a.host}` : ''}{a.result && a.result !== 'ok' ? ` · ${a.result}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
