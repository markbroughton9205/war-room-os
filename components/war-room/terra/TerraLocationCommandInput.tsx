'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { TerraMediaIntelHandoff } from './TerraMediaIntelHandoff'
import type { TerraLocationResolution, TerraLocationTarget } from '@/lib/terra/locationCommand'
import {
  formatCinematicFlightStatus,
  type TerraCinematicFlightPurpose,
  type TerraCinematicFlightState,
} from '@/lib/terra/cinematicFlightOutcome'
import { TerraStreetViewControl } from './TerraStreetViewControl'
import type { StreetViewState } from '@/lib/terra/streetView/types'

export type TerraLocationCommandHandler = (target: TerraLocationTarget) => void

function labelFromStatus(message: string): string {
  for (const prefix of ['Flying to ', 'Jumping to ', 'Arrived · ', 'Superseded · ']) {
    if (message.startsWith(prefix)) return message.slice(prefix.length)
  }
  return message
}

export function TerraLocationCommandInput({
  onResolvedLocation,
  flightOutcome = 'IDLE',
  flightPurpose = null,
  flightLabel = '',
  streetViewState = 'IDLE',
  streetViewDisabled = false,
  onStreetView,
  onNearby,
  onGps,
}: {
  onResolvedLocation: TerraLocationCommandHandler
  flightOutcome?: TerraCinematicFlightState
  flightPurpose?: TerraCinematicFlightPurpose | null
  flightLabel?: string
  streetViewState?: StreetViewState | 'IDLE' | 'LOADING'
  streetViewDisabled?: boolean
  onStreetView?: () => void
  onNearby?: () => void
  onGps?: () => void
}) {
  const [command, setCommand] = useState('')
  const [state, setState] = useState<{ phase: 'idle' | 'resolving' | 'resolved' | 'error'; message: string }>({ phase: 'idle', message: '' })
  const [matches, setMatches] = useState<TerraLocationTarget[]>([])
  const requestRef = useRef<{ sequence: number; controller: AbortController | null }>({ sequence: 0, controller: null })

  useEffect(() => () => requestRef.current.controller?.abort(), [])

  useEffect(() => {
    if (flightOutcome === 'IDLE' || flightOutcome === 'SUPERSEDED') return
    setState(current => {
      const fromSearch = current.message.startsWith('Flying to ') || current.message.startsWith('Jumping to ') || current.message.startsWith('Arrived · ')
      const instant = current.message.startsWith('Jumping to ')
      const label = flightLabel.trim() || labelFromStatus(current.message) || 'destination'
      if (flightOutcome === 'FLYING') {
        if (flightPurpose === 'camera' || flightPurpose === 'event' || flightPurpose === 'gps' || flightPurpose === 'inspect') {
          return { phase: 'resolved', message: formatCinematicFlightStatus({ outcome: 'FLYING', label, instant: false }) }
        }
        return current
      }
      if (fromSearch || flightPurpose === 'search' || flightPurpose === 'jump' || flightPurpose === 'camera' || flightPurpose === 'event' || flightPurpose === 'gps' || flightPurpose === 'inspect') {
        return {
          phase: current.phase === 'error' ? current.phase : 'resolved',
          message: formatCinematicFlightStatus({ outcome: flightOutcome, label, instant }),
        }
      }
      return current
    })
  }, [flightOutcome, flightLabel, flightPurpose])

  function flyToTarget(target: TerraLocationTarget, instantRequested: boolean) {
    setMatches([])
    onResolvedLocation({ ...target, instantRequested, query: target.query?.trim() || command.trim() || target.label })
    setState({ phase: 'resolved', message: instantRequested ? `Jumping to ${target.label}` : `Flying to ${target.label}` })
  }

  async function resolve(instantRequested: boolean) {
    const query = command.trim()
    if (!query) return
    requestRef.current.controller?.abort()
    const controller = new AbortController()
    const sequence = requestRef.current.sequence + 1
    requestRef.current = { sequence, controller }
    setMatches([])
    setState({ phase: 'resolving', message: 'Resolving location…' })
    try {
      const response = await fetch(`/api/terra/resolve-location?q=${encodeURIComponent(query)}`, { cache: 'no-store', credentials: 'include', signal: controller.signal })
      const result = await response.json() as TerraLocationResolution
      if (requestRef.current.sequence !== sequence) return
      if (result.status === 'ambiguous') {
        setMatches(result.matches)
        setState({ phase: 'error', message: result.message })
        return
      }
      if (result.status !== 'resolved') {
        setState({ phase: 'error', message: result.message || 'Location search failed. GPS tracking is independent of this search.' })
        return
      }
      flyToTarget(result.target, instantRequested)
    } catch {
      if (controller.signal.aborted || requestRef.current.sequence !== sequence) return
      setState({ phase: 'error', message: 'Location resolver is unavailable. GPS tracking is independent of this search. No destination was selected.' })
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await resolve(false)
  }

  const statusError = state.phase === 'error' || flightOutcome === 'FAILED'
  const statusWarn = flightOutcome === 'INTERRUPTED' || flightOutcome === 'CANCELLED'

  return (
    <>
      <TerraMediaIntelHandoff
        onResolvedLocation={target => {
          setCommand(target.query || target.label)
          flyToTarget(target, false)
        }}
      />
    <form onSubmit={submit} className="w-full" data-testid="terra-location-command">
      <div className="flex flex-wrap items-center gap-2 rounded border border-cyan-400/35 bg-black/80 px-2 py-1.5 shadow-[0_0_22px_rgba(34,211,238,0.08)] backdrop-blur-md">
        <span aria-hidden="true" className="text-cyan-400">⌖</span>
        <label htmlFor="terra-location-command-input" className="sr-only">Fly Terra to an address, ZIP, city, landmark, or coordinates</label>
        <input
          id="terra-location-command-input"
          value={command}
          onChange={event => setCommand(event.target.value)}
          placeholder="Address, ZIP, city, landmark, or lat, lon"
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-500"
          autoComplete="off"
        />
        <button type="button" disabled={!command.trim() || state.phase === 'resolving'} onClick={() => { void resolve(true) }} className="rounded border border-white/20 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-300 disabled:opacity-40">
          Jump
        </button>
        <button type="submit" disabled={!command.trim() || state.phase === 'resolving'} className="rounded border border-emerald-500/50 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-300 disabled:opacity-40">
          {state.phase === 'resolving' ? 'Resolving' : 'Go'}
        </button>
        {onStreetView ? (
          <TerraStreetViewControl state={streetViewState} disabled={streetViewDisabled} onOpen={onStreetView} />
        ) : null}
        {onNearby ? (
          <button type="button" onClick={onNearby} className="rounded border border-white/20 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-300 hover:border-cyan-300/50 hover:text-cyan-200" data-testid="terra-location-nearby">
            Nearby
          </button>
        ) : null}
        {onGps ? (
          <button type="button" onClick={onGps} className="rounded border border-white/20 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-300 hover:border-emerald-300/50 hover:text-emerald-200" data-testid="terra-location-gps">
            GPS
          </button>
        ) : null}
      </div>
      <p
        aria-live="polite"
        data-flight-outcome={flightOutcome}
        className={`mt-1 min-h-4 px-1 text-[9px] ${statusError ? 'text-amber-300' : statusWarn ? 'text-cyan-300' : 'text-slate-400'}`}
      >
        {state.message}
      </p>
      {matches.length > 0 ? (
        <ul className="mt-1 max-h-40 space-y-1 overflow-auto px-1">
          {matches.map(match => (
            <li key={`${match.latitude},${match.longitude},${match.label}`}>
              <button
                type="button"
                className="w-full truncate rounded border border-white/10 bg-black/60 px-2 py-1 text-left text-[10px] text-cyan-100 hover:border-cyan-400/40"
                onClick={() => flyToTarget(match, false)}
              >
                {match.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
    </>
  )
}
