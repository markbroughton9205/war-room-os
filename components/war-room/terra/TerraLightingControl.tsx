'use client'

import type { TerraLightingMode, TerraSolarLighting } from '@/lib/terra/solarLighting'
import {
  displayedLightingState,
  lightingStateLabel,
} from '@/lib/terra/solarLighting'

export function TerraLightingControl({
  mode,
  solar,
  onMode,
}: {
  mode: TerraLightingMode
  solar: TerraSolarLighting | null
  onMode: (mode: TerraLightingMode) => void
}) {
  const displayed = displayedLightingState(mode, solar)
  const manual = mode !== 'AUTO'
  return (
    <div className="mt-1.5 space-y-1" data-testid="terra-lighting-control">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Lighting</span>
        <span
          className={`font-mono text-[10px] uppercase tracking-widest ${manual ? 'text-amber-300' : 'text-cyan-300'}`}
          data-testid="terra-lighting-state"
          data-mode={mode}
          data-auto-state={solar?.lightingState ?? ''}
          data-elevation={solar ? String(solar.elevationDegrees) : ''}
          data-manual={manual ? '1' : '0'}
        >
          {lightingStateLabel(displayed)}{manual ? ' · MANUAL' : ''}
        </span>
      </div>
      <div className="flex gap-1">
        {(['AUTO', 'DAY', 'NIGHT'] as const).map(row => (
          <button
            key={row}
            type="button"
            data-testid={`terra-lighting-mode-${row.toLowerCase()}`}
            onClick={() => onMode(row)}
            className={`rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest ${
              mode === row
                ? 'border-cyan-400/60 text-cyan-200'
                : 'border-white/10 text-slate-500 hover:border-white/25 hover:text-slate-300'
            }`}
          >
            {row}
          </button>
        ))}
      </div>
      {solar?.sunriseLocal || solar?.sunsetLocal ? (
        <p className="font-mono text-[9px] uppercase tracking-widest text-slate-500" data-testid="terra-lighting-sun-times">
          {solar.sunriseLocal ? `Sunrise ${solar.sunriseLocal}` : null}
          {solar.sunriseLocal && solar.sunsetLocal ? ' · ' : null}
          {solar.sunsetLocal ? `Sunset ${solar.sunsetLocal}` : null}
        </p>
      ) : null}
      {solar ? (
        <p className="sr-only" data-testid="terra-lighting-solar-meta">
          {`${solar.latitude.toFixed(4)},${solar.longitude.toFixed(4)} ${solar.terraTime} ${solar.elevationDegrees.toFixed(2)} ${solar.lightingState}`}
        </p>
      ) : (
        <p className="sr-only" data-testid="terra-lighting-solar-meta">no-active-location</p>
      )}
    </div>
  )
}
