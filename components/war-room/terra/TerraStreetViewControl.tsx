'use client'

import { streetViewButtonLabel } from '@/lib/terra/streetView/buttonLabel'
import type { StreetViewState } from '@/lib/terra/streetView/types'

export function TerraStreetViewControl({
  state,
  disabled,
  onOpen,
}: {
  state: StreetViewState | 'IDLE' | 'LOADING'
  disabled?: boolean
  onOpen: () => void
}) {
  const label = streetViewButtonLabel(state)
  const inactive = state === 'NO_COVERAGE' || state === 'UNAVAILABLE' || state === 'ERROR_UPSTREAM' || state === 'AUTH_REQUIRED' || state === 'PROVIDER_AUTH_REQUIRED'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      data-testid="terra-street-view"
      data-street-view-state={state}
      title={disabled ? 'Select a location or object first. Coordinates are enough — Nominatim is not required.' : 'Open lawful public street-level imagery for the active coordinates'}
      className={`rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-widest disabled:opacity-40 ${
        state === 'AVAILABLE'
          ? 'border-cyan-300 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.18)]'
          : inactive
            ? 'border-amber-400/60 text-amber-100'
            : 'border-cyan-400/70 text-cyan-200 hover:border-cyan-300 hover:text-cyan-100'
      }`}
    >
      {label.primary}
      {label.secondary ? <span className="ml-1 font-normal normal-case tracking-normal opacity-80">/ {label.secondary}</span> : null}
    </button>
  )
}
