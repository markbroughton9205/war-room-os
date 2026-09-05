'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { TerraLocationResolution, TerraLocationTarget } from '@/lib/terra/locationCommand'

export type TerraLocationCommandHandler = (target: TerraLocationTarget) => void

export function TerraLocationCommandInput({ onResolvedLocation }: { onResolvedLocation: TerraLocationCommandHandler }) {
  const [command, setCommand] = useState('')
  const [state, setState] = useState<{ phase: 'idle' | 'resolving' | 'resolved' | 'error'; message: string }>({ phase: 'idle', message: '' })
  const requestRef = useRef<{ sequence: number; controller: AbortController | null }>({ sequence: 0, controller: null })

  useEffect(() => () => requestRef.current.controller?.abort(), [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const query = command.trim()
    if (!query) return
    requestRef.current.controller?.abort()
    const controller = new AbortController()
    const sequence = requestRef.current.sequence + 1
    requestRef.current = { sequence, controller }
    setState({ phase: 'resolving', message: 'Resolving location…' })
    try {
      const response = await fetch(`/api/terra/resolve-location?q=${encodeURIComponent(query)}`, { cache: 'no-store', signal: controller.signal })
      const result = await response.json() as TerraLocationResolution
      if (requestRef.current.sequence !== sequence) return
      if (result.status !== 'resolved') {
        setState({ phase: 'error', message: result.message })
        return
      }
      onResolvedLocation(result.target)
      setState({ phase: 'resolved', message: `Flying to ${result.target.label}` })
    } catch {
      if (controller.signal.aborted || requestRef.current.sequence !== sequence) return
      setState({ phase: 'error', message: 'Location resolver is unavailable. No destination was selected.' })
    }
  }

  return (
    <form onSubmit={submit} className="w-full" data-testid="terra-location-command">
      <div className="flex items-center gap-2 rounded border border-cyan-400/35 bg-black/80 px-2 py-1.5 shadow-[0_0_22px_rgba(34,211,238,0.08)] backdrop-blur-md">
        <span aria-hidden="true" className="text-cyan-400">⌖</span>
        <label htmlFor="terra-location-command-input" className="sr-only">Fly Terra to a place, address, or coordinates</label>
        <input
          id="terra-location-command-input"
          value={command}
          onChange={event => setCommand(event.target.value)}
          placeholder="Fly to a place, address, or lat, lon"
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-500"
          autoComplete="off"
        />
        <button type="submit" disabled={!command.trim() || state.phase === 'resolving'} className="rounded border border-emerald-500/50 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-300 disabled:opacity-40">
          {state.phase === 'resolving' ? 'Resolving' : 'Go'}
        </button>
      </div>
      <p aria-live="polite" className={`mt-1 min-h-4 px-1 text-[9px] ${state.phase === 'error' ? 'text-amber-300' : 'text-slate-400'}`}>{state.message}</p>
    </form>
  )
}
