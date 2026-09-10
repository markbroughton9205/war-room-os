'use client'

import type { TerraLiveFreshness, TerraLiveIntelSnapshot, TerraLiveGeoObject, TerraLiveLayerId } from '@/lib/terra/liveGeoIntelligence'
import { TERRA_PROVIDER_STATUS_LABELS } from '@/lib/terra/maritimeProviderStatus'

const FRESHNESS_CLASS: Record<TerraLiveFreshness, string> = {
  LIVE: 'text-emerald-400',
  DELAYED: 'text-amber-300',
  CACHED: 'text-cyan-300',
  STALE: 'text-amber-500',
  EMPTY: 'text-slate-300',
  NO_COVERAGE: 'text-amber-200',
  READY: 'text-cyan-200',
  NEEDS_CREDENTIALS: 'text-amber-300',
  NEEDS_LOCAL_SENSOR: 'text-amber-300',
  NEEDS_COMMERCIAL_ACCOUNT: 'text-amber-300',
  HISTORICAL: 'text-amber-500',
  NOT_IMPLEMENTED: 'text-slate-500',
  DISABLED: 'text-slate-500',
  UNAVAILABLE: 'text-rose-400',
  NOT_CONFIGURED: 'text-slate-500',
}

const LAYER_LABEL: Record<TerraLiveLayerId, string> = {
  vessels: 'Vessels',
  intelligence_events: 'Intelligence events',
  settlement_events: 'Settlement events',
  other: 'Other geolocated',
}

export function TerraLiveIntelPanel({
  snapshot,
  selected,
  compact,
  onSendSelectedToCouncil,
  canSendToCouncil,
  commanderQuestion,
  onCommanderQuestionChange,
}: {
  snapshot: TerraLiveIntelSnapshot
  selected: TerraLiveGeoObject | null
  compact?: boolean
  onSendSelectedToCouncil?: () => void
  canSendToCouncil?: boolean
  commanderQuestion?: string
  onCommanderQuestionChange?: (value: string) => void
}) {
  return (
    <div className={`pointer-events-auto rounded border border-cyan-400/25 bg-black/75 backdrop-blur-sm ${compact ? 'p-2' : 'p-3'}`}>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Live globe intel</p>
      <ul className="space-y-1 text-[11px]">
        {snapshot.layers.map(layer => (
          <li key={layer.id} className="flex items-center justify-between gap-2">
            <span className="text-slate-300">{LAYER_LABEL[layer.id]}</span>
            <span
              className={`font-mono text-[10px] font-bold uppercase tracking-widest ${FRESHNESS_CLASS[layer.freshness]}`}
              title={layer.reason}
            >
              {TERRA_PROVIDER_STATUS_LABELS[layer.freshness]}{layer.objectCount ? ` · ${layer.objectCount}` : ''}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 border-t border-white/10 pt-2">
        <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Providers</p>
        <ul className="max-h-28 space-y-0.5 overflow-y-auto text-[10px] text-slate-400">
          {snapshot.providers.map(provider => (
            <li key={provider.id} className="flex items-center justify-between gap-2">
              <span className="truncate" title={provider.reason}>{provider.displayName}</span>
              <span
                className={`shrink-0 font-mono uppercase ${FRESHNESS_CLASS[provider.freshness]}`}
                title={provider.reason}
              >
                {TERRA_PROVIDER_STATUS_LABELS[provider.freshness]}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {selected ? (
        <dl className="mt-2 space-y-0.5 border-t border-white/10 pt-2 text-[10px] text-slate-400">
          <div className="flex justify-between gap-2"><dt>Selected</dt><dd className="truncate text-slate-100">{selected.title}</dd></div>
          <div className="flex justify-between gap-2"><dt>Type</dt><dd className="text-cyan-200">{selected.type}</dd></div>
          <div className="flex justify-between gap-2"><dt>Time</dt><dd className="font-mono text-slate-200">{selected.observedAt ?? 'not reported'}</dd></div>
          <div className="flex justify-between gap-2"><dt>Source</dt><dd className="truncate text-slate-200">{selected.provider}</dd></div>
          <div className="flex justify-between gap-2"><dt>Freshness</dt><dd className={FRESHNESS_CLASS[selected.freshness]}>{TERRA_PROVIDER_STATUS_LABELS[selected.freshness]}</dd></div>
          <div className="flex justify-between gap-2"><dt>Evidence</dt><dd className="truncate font-mono text-slate-200">{selected.evidenceId ?? 'none'}</dd></div>
          {selected.discoveryProvenance.alsoDiscoveredVia.length > 0 ? (
            <div className="flex justify-between gap-2"><dt>Also via</dt><dd className="truncate text-slate-200">{selected.discoveryProvenance.alsoDiscoveredVia.join(', ')}</dd></div>
          ) : null}
          {selected.sourceUrl ? (
            <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-cyan-400 hover:underline">
              Open source
            </a>
          ) : null}
        </dl>
      ) : (
        <p className="mt-2 text-[10px] text-slate-500">Select a vessel or event for provenance.</p>
      )}
      {onSendSelectedToCouncil ? (
        <>
          {onCommanderQuestionChange ? (
            <label className="mt-2 block text-[9px] font-bold uppercase tracking-widest text-slate-500">
              Commander question
              <textarea
                value={commanderQuestion ?? ''}
                onChange={event => onCommanderQuestionChange(event.target.value)}
                rows={compact ? 3 : 4}
                placeholder="Analyze this vessel's current observed activity using only the supplied Terra intelligence. Clearly separate observed AIS facts from inference and uncertainty."
                className="mt-1 w-full resize-y rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] font-normal normal-case tracking-normal text-slate-200 placeholder:text-slate-600"
              />
            </label>
          ) : null}
          <button
            type="button"
            onClick={onSendSelectedToCouncil}
            disabled={!canSendToCouncil}
            className="mt-2 w-full rounded border border-emerald-400/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-300 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-600"
          >
            Send selected object to Council
          </button>
        </>
      ) : null}
    </div>
  )
}
