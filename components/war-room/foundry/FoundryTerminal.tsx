'use client'

import { useEffect, useRef, useState } from 'react'

type Session = {
  id: string
  cwd: string
  output: string
  running: boolean
}

export function FoundryTerminal({
  cwd,
  projectRoot,
  projectId: _projectId,
  onClose,
}: {
  cwd?: string
  projectRoot?: string | null
  projectId?: string | null
  onClose?: () => void
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [command, setCommand] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLPreElement>(null)
  const sessionIdRef = useRef<string | null>(null)
  const root = projectRoot ?? cwd

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    void (async () => {
      const res = await fetch('/api/foundry/terminal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start', cwd: root }),
      })
      const json = await res.json() as { session?: Session; error?: string }
      if (cancelled) {
        if (json.session?.id) {
          void fetch('/api/foundry/terminal', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'close', id: json.session.id }),
          })
        }
        return
      }
      if (!res.ok || !json.session) {
        setError(json.error ?? 'Could not start terminal')
        return
      }
      sessionIdRef.current = json.session.id
      setSession(json.session)
      timer = setInterval(async () => {
        const id = sessionIdRef.current
        if (!id) return
        const next = await fetch(`/api/foundry/terminal?id=${encodeURIComponent(id)}`)
        const body = await next.json() as { session?: Session }
        if (body.session) setSession(body.session)
      }, 400)
    })()
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      const id = sessionIdRef.current
      if (id) {
        void fetch('/api/foundry/terminal', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'close', id }),
        })
        sessionIdRef.current = null
      }
    }
  }, [root])

  useEffect(() => {
    scroller.current?.scrollTo(0, scroller.current.scrollHeight)
  }, [session?.output])

  const send = async (text: string) => {
    const id = sessionIdRef.current
    if (!id || !text.trim()) return
    await fetch('/api/foundry/terminal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'write', id, data: text.endsWith('\n') ? text : `${text}\n` }),
    })
  }

  const stop = () => {
    const id = sessionIdRef.current
    if (id) {
      void fetch('/api/foundry/terminal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'close', id }),
      })
      sessionIdRef.current = null
    }
    onClose?.()
  }

  return (
    <div className="flex h-full min-h-[12rem] flex-col" data-testid="foundry-real-terminal" data-terminal="real" id="foundry-terminal">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500">
        <span data-testid="foundry-terminal-cwd" className="font-mono normal-case tracking-normal text-emerald-300">{session?.cwd ?? root ?? 'starting'}</span>
        <span className="flex gap-1">
          <button type="button" className="rounded border border-white/15 px-1.5 py-0.5" data-testid="foundry-terminal-stop" onClick={stop}>Stop</button>
          <button type="button" className="rounded border border-white/15 px-1.5 py-0.5" data-testid="foundry-terminal-close" onClick={stop}>Close</button>
        </span>
      </div>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      <pre ref={scroller} className="max-h-48 flex-1 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-emerald-100" data-testid="foundry-terminal-output">
        {session?.output || '(starting shell)'}
      </pre>
      <form
        className="mt-1 flex gap-1"
        onSubmit={event => {
          event.preventDefault()
          const next = command
          setCommand('')
          void send(next)
        }}
      >
        <input
          value={command}
          onChange={event => setCommand(event.target.value)}
          aria-label="Command"
          data-testid="foundry-terminal-input"
          className="min-w-0 flex-1 rounded border border-emerald-400/25 bg-black/50 px-2 py-1 font-mono text-[11px] text-emerald-50 outline-none"
          placeholder="pwd"
        />
        <button type="submit" className="rounded border border-emerald-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-emerald-200">Run</button>
      </form>
    </div>
  )
}
