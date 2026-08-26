'use client'

import type { TerraActiveLocation } from '@/lib/terra/activeLocation'

export function TerraEarthKnowledgePanel({ location, onDismiss, compact = false }: {
  location: TerraActiveLocation | null
  onDismiss: () => void
  compact?: boolean
}) {
  return (
    <section className="rounded border border-cyan-400/30 bg-black/75 p-3 backdrop-blur-sm" aria-label="Earth Knowledge active location" aria-live="polite" data-testid="terra-earth-knowledge">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-400/80">Earth Knowledge · Active Location</p>
        {location && <button type="button" onClick={onDismiss} className="text-[10px] text-slate-500 hover:text-slate-300">dismiss</button>}
      </div>
      {!location ? (
        <p className="mt-1 text-[11px] leading-snug text-slate-500">Click Earth or use location search to establish geographic context.</p>
      ) : (
        <div className="mt-1.5">
          <p className="line-clamp-2 text-[12px] font-semibold text-slate-100">{location.label}</p>
          <dl className={`mt-2 space-y-1 text-[10.5px] text-slate-400 ${compact ? 'hidden sm:block' : ''}`}>
            {location.place && <div className="flex justify-between gap-3"><dt>Place</dt><dd className="text-right text-slate-200">{location.place}</dd></div>}
            {location.address && <div className="flex justify-between gap-3"><dt>Address</dt><dd className="max-w-[65%] text-right text-slate-200">{location.address}</dd></div>}
            {location.region && <div className="flex justify-between gap-3"><dt>Region</dt><dd className="text-right text-slate-200">{location.region}</dd></div>}
            <div className="flex justify-between gap-3"><dt>Coordinates</dt><dd className="font-mono text-right text-slate-200">{location.latitude.toFixed(5)}°, {location.longitude.toFixed(5)}°</dd></div>
            <div className="flex justify-between gap-3"><dt>Height</dt><dd className="text-right text-slate-200">{location.hasTerrainHeight && location.height !== null ? `${location.height.toFixed(0)} m terrain` : 'unavailable'}</dd></div>
            <div className="flex justify-between gap-3"><dt>Status</dt><dd className={location.status === 'resolved' ? 'text-emerald-300' : location.status === 'resolving' ? 'text-cyan-300' : 'text-amber-300'}>{location.status === 'coordinate_only' ? 'coordinate-only / unresolved' : location.status}</dd></div>
            <div className="flex justify-between gap-3"><dt>Confidence</dt><dd className="text-right text-slate-200">{location.confidence === 'provider_supported' ? 'provider-supported' : 'exact coordinate only'}</dd></div>
            <div className="flex justify-between gap-3"><dt>Source</dt><dd className="text-right text-slate-200">{location.sourceLabel}</dd></div>
          </dl>
          <p className={`mt-1.5 text-[10px] leading-snug ${location.status === 'coordinate_only' ? 'text-amber-300/90' : 'text-slate-500'} ${compact ? 'hidden sm:block' : ''}`}>{location.detail}</p>
          {location.sourceUrl && <a href={location.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[10px] text-cyan-400 hover:underline">Open provenance source ↗</a>}
        </div>
      )}
    </section>
  )
}
