'use client'

import { useMemo } from 'react'
import type { LayerMode } from '@/lib/terra/layerGovernor'
import {
  ADMIN_SUBLAYER_IDS,
  hierarchyLines,
  type AdminIdentityPresentation,
  type AdminSublayerId,
} from '@/lib/terra/adminIdentity'
import { useTerraAdminIdentityPrefs } from './useTerraAdminIdentityPrefs'

const SUB_LABELS: Record<AdminSublayerId, string> = {
  countryBorders: 'Country borders',
  stateBorders: 'State/province',
  placeNames: 'Place names',
  identityFlag: 'Identity flag',
}

export function TerraAdminIdentityPanel({
  presentation,
  masterMode,
  onCycleMaster,
}: {
  presentation: AdminIdentityPresentation
  masterMode: LayerMode
  onCycleMaster: () => void
}) {
  const { prefs, cycleSub, setFlagOpacity } = useTerraAdminIdentityPrefs()
  const lines = useMemo(() => hierarchyLines(presentation.hierarchy), [presentation.hierarchy])
  const flag = presentation.flagTarget

  return (
    <div
      className="mb-2 space-y-1 border-t border-white/10 pt-1.5"
      data-testid="terra-admin-identity-panel"
      data-view-band={presentation.viewBand}
      data-country-lod={presentation.countryLod}
      data-state-lod={presentation.stateLod}
      data-flag-kind={flag?.kind ?? 'none'}
      data-flag-iso={flag?.isoCode ?? ''}
      data-country-flag-opacity={String(presentation.countryFlagOpacity)}
      data-state-flag-opacity={String(presentation.stateFlagOpacity)}
      data-hierarchy={lines.join(' | ')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Borders & identity</span>
        <button
          type="button"
          data-testid="terra-admin-identity-master"
          onClick={onCycleMaster}
          className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${
            masterMode === 'OFF' ? 'border-white/15 text-slate-400' : 'border-cyan-400/40 text-cyan-300'
          }`}
        >
          {masterMode}
        </button>
      </div>
      <p className="font-mono text-[8px] uppercase tracking-widest text-slate-500">Current</p>
      {lines.length === 0 ? (
        <p className="font-mono text-[9px] uppercase tracking-widest text-slate-600" data-testid="terra-admin-identity-hierarchy">
          No accepted location
        </p>
      ) : (
        <ul className="space-y-0.5" data-testid="terra-admin-identity-hierarchy">
          {lines.map((line, index) => {
            const emphasized =
              (presentation.hierarchy.emphasized === 'COUNTRY' && index === 0)
              || (presentation.hierarchy.emphasized === 'STATE' && index === 1)
              || (presentation.hierarchy.emphasized === 'COUNTY' && index === 2)
              || (presentation.hierarchy.emphasized === 'CITY' && index === lines.length - 1)
            return (
              <li
                key={line}
                className={`truncate font-mono text-[9px] uppercase tracking-widest ${emphasized ? 'text-cyan-200' : 'text-slate-500'}`}
              >
                {line}
              </li>
            )
          })}
        </ul>
      )}
      <ul className="space-y-0.5">
        {ADMIN_SUBLAYER_IDS.map(id => (
          <li key={id}>
            <button
              type="button"
              data-testid={`terra-admin-sub-${id}`}
              data-mode={prefs.subModes[id]}
              onClick={() => cycleSub(id)}
              className="flex w-full items-center justify-between gap-2 text-left text-[10px] text-slate-400 hover:text-slate-200"
            >
              <span>{SUB_LABELS[id]}</span>
              <span className="font-mono uppercase tracking-widest text-cyan-300/80">{prefs.subModes[id]}</span>
            </button>
          </li>
        ))}
      </ul>
      <label className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest text-slate-500">
        Flag opacity
        <input
          type="range"
          min={0}
          max={18}
          step={1}
          data-testid="terra-admin-flag-opacity"
          value={Math.round((prefs.flagOpacityOverride ?? 0.12) * 100)}
          onChange={event => setFlagOpacity(Number(event.target.value) / 100)}
          className="w-20 accent-cyan-400"
        />
      </label>
      <p className="truncate font-mono text-[8px] uppercase tracking-widest text-slate-600" title={presentation.reason}>
        {presentation.reason}
      </p>
    </div>
  )
}
