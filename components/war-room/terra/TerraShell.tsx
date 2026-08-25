'use client'

/**
 * Terra Shell — Phase G (foundation) + Phase 1 (first live intelligence layer, usgs_earthquake_feed).
 *
 * Phase H/I/J/K panels (Earth Knowledge, Live Council, time engine, Commander annotation
 * persistence) remain honestly-labeled PLACEHOLDERS — none of them are wired yet, matching this
 * repo's "no fake dashboards" standard. The earthquake layer below them is the one real,
 * end-to-end data path this phase adds: Research Engine -> lib/terra normalization -> Cesium.
 *
 * Selection state (a clicked coordinate or a clicked earthquake marker) is local component
 * state only — never written to war_room_audit_logs or anywhere else. Camera movement and
 * exploratory clicks are transient UI state, not War Room events.
 */
import { useCallback, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import type { Viewer as CesiumViewer } from 'cesium'
import type { TerraGlobeStatus } from './TerraGlobe'
import { useTerraEarthquakeFeed } from './useTerraEarthquakeFeed'
import type { TerraClickPoint } from '@/lib/terra/types'

const TerraGlobe = dynamic(() => import('./TerraGlobe').then(m => m.TerraGlobe), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-black">
      <p className="font-mono text-xs uppercase tracking-widest text-emerald-500/60">Loading globe engine…</p>
    </div>
  ),
})

const TerraEarthquakeLayer = dynamic(() => import('./TerraEarthquakeLayer').then(m => m.TerraEarthquakeLayer), { ssr: false })

type Selection =
  | { kind: 'none' }
  | { kind: 'miss' }
  | { kind: 'ground'; point: Extract<TerraClickPoint, { ok: true }> }
  | { kind: 'earthquake'; featureId: string }

function StatusLine({ status }: { status: TerraGlobeStatus }) {
  if (status.phase === 'loading') {
    return <span className="text-slate-500">Initializing…</span>
  }
  if (status.phase === 'error') {
    return <span className="text-amber-400">Globe failed to initialize: {status.message}</span>
  }
  const imageryLabel = status.imageryTier === 'photorealistic_3d_tiles' ? 'Google Photorealistic 3D Tiles' : 'OpenStreetMap (no credential required)'
  return (
    <span className="text-emerald-400">
      Base imagery: {imageryLabel}
      {!status.hasIonToken && <span className="text-slate-500"> · Cesium ion token not configured — terrain/Bing tiers unavailable</span>}
    </span>
  )
}

function PlaceholderPanel({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/60 p-3 backdrop-blur-sm">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400/80">{title}</p>
      <p className="text-[11px] leading-snug text-slate-500">{note}</p>
    </div>
  )
}

const FEED_STATE_LABEL: Record<string, { text: string; color: string }> = {
  loading: { text: 'LOADING…', color: 'text-slate-400' },
  live: { text: 'LIVE', color: 'text-emerald-400' },
  empty: { text: 'LIVE — NO EVENTS', color: 'text-slate-400' },
  error: { text: 'ERROR — NO DATA', color: 'text-red-400' },
  stale: { text: 'STALE — LAST SUCCESSFUL DATA', color: 'text-amber-400' },
}

export function TerraShell() {
  const [globeStatus, setGlobeStatus] = useState<TerraGlobeStatus>({ phase: 'loading' })
  const [viewer, setViewer] = useState<CesiumViewer | null>(null)
  const [earthquakesEnabled, setEarthquakesEnabled] = useState(true)
  const [selection, setSelection] = useState<Selection>({ kind: 'none' })

  const feed = useTerraEarthquakeFeed(earthquakesEnabled)

  const selectedFeature = useMemo(
    () => (selection.kind === 'earthquake' ? feed.features.find(f => f.id === selection.featureId) ?? null : null),
    [selection, feed.features],
  )

  const handleGroundClick = useCallback((point: TerraClickPoint) => {
    setSelection(point.ok ? { kind: 'ground', point } : { kind: 'miss' })
  }, [])

  const handleEntityClick = useCallback((featureId: string) => {
    setSelection({ kind: 'earthquake', featureId })
  }, [])

  const feedStatus = FEED_STATE_LABEL[feed.state]

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black text-white">
      <TerraGlobe onStatusChange={setGlobeStatus} onViewerReady={setViewer} onEntityClick={handleEntityClick} onGroundClick={handleGroundClick} />
      <TerraEarthquakeLayer viewer={viewer} enabled={earthquakesEnabled} features={feed.features} selectedId={selection.kind === 'earthquake' ? selection.featureId : null} />

      {/* Top instrumentation bar — mission status + identity. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div className="pointer-events-auto rounded border border-white/10 bg-black/70 px-3 py-2 backdrop-blur-sm">
          <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-400">War Room · Terra</h1>
          <p className="mt-0.5 text-[10px] text-slate-500">Planetary Intelligence Environment — Phase 1: first live layer</p>
        </div>
        <div className="pointer-events-auto rounded border border-white/10 bg-black/70 px-3 py-2 text-[11px] backdrop-blur-sm">
          <StatusLine status={globeStatus} />
        </div>
      </div>

      {/* Left rail — layer controls + Earth Knowledge placeholder. */}
      <div className="pointer-events-none absolute left-0 top-20 flex w-72 flex-col gap-2 p-4">
        <div className="pointer-events-auto rounded border border-white/10 bg-black/60 p-3 backdrop-blur-sm">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-cyan-400/80">Layer Controls</p>
          <ul className="space-y-1 text-[11px] text-slate-400">
            <li className="flex items-center justify-between">
              <span>Base imagery</span>
              <span className="text-emerald-400">OSM</span>
            </li>
            <li className="flex items-center justify-between opacity-40">
              <span>Photorealistic 3D Tiles</span>
              <span>no key</span>
            </li>
            <li className="flex items-center justify-between opacity-40">
              <span>Terrain (Cesium World Terrain)</span>
              <span>no token</span>
            </li>
          </ul>
        </div>

        <div className="pointer-events-auto rounded border border-white/10 bg-black/60 p-3 backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-400/80">Data Layers</p>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-300">Earthquakes (USGS)</span>
            <button
              type="button"
              onClick={() => setEarthquakesEnabled(prev => !prev)}
              className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                earthquakesEnabled ? 'border-emerald-400/60 text-emerald-400' : 'border-white/20 text-slate-500'
              }`}
              aria-pressed={earthquakesEnabled}
            >
              {earthquakesEnabled ? 'On' : 'Off'}
            </button>
          </div>
          {earthquakesEnabled && (
            <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
              <p className={`text-[10px] font-bold uppercase tracking-widest ${feedStatus.color}`}>{feedStatus.text}</p>
              <p className="text-[10.5px] text-slate-500">
                {feed.features.length} event{feed.features.length === 1 ? '' : 's'}
                {feed.skippedCount > 0 && ` · ${feed.skippedCount} unprojectable`}
              </p>
              {feed.lastFetchedAt && (
                <p className="text-[10.5px] text-slate-500">Last fetched: {new Date(feed.lastFetchedAt).toLocaleTimeString()}</p>
              )}
              {feed.lastErrorMessage && <p className="text-[10.5px] text-red-400">{feed.lastErrorMessage}</p>}
              <button type="button" onClick={feed.refresh} className="mt-1 rounded border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300 hover:border-emerald-400/60 hover:text-emerald-400">
                Refresh now
              </button>
            </div>
          )}
        </div>

        <div className="pointer-events-auto">
          <PlaceholderPanel
            title="Earth Knowledge Panel"
            note="Not wired yet. Will consume War Room's existing Earth Knowledge Registry and Research Engine directly — no separate registry planned or built here (Phase 3)."
          />
        </div>

        {selection.kind === 'ground' && (
          <div className="pointer-events-auto rounded border border-cyan-400/30 bg-black/70 p-3 backdrop-blur-sm">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-400/80">Selected Coordinate</p>
              <button type="button" onClick={() => setSelection({ kind: 'none' })} className="text-[10px] text-slate-500 hover:text-slate-300">
                dismiss
              </button>
            </div>
            <p className="font-mono text-[11px] text-slate-200">{selection.point.latitude.toFixed(4)}°, {selection.point.longitude.toFixed(4)}°</p>
            <p className="mt-1 text-[10.5px] text-slate-500">
              {selection.point.hasTerrainHeight && selection.point.height !== null
                ? `Terrain height: ${selection.point.height.toFixed(0)} m`
                : 'Terrain height unavailable (no Cesium World Terrain configured this build)'}
            </p>
          </div>
        )}
        {selection.kind === 'miss' && (
          <div className="pointer-events-auto rounded border border-white/10 bg-black/60 p-3 backdrop-blur-sm">
            <p className="text-[10.5px] text-slate-500">Click missed the globe.</p>
          </div>
        )}
      </div>

      {/* Right rail — Live Council dock + selected-earthquake / provenance panel. */}
      <div className="pointer-events-none absolute right-0 top-20 flex w-72 flex-col gap-2 p-4">
        <div className="pointer-events-auto">
          <PlaceholderPanel
            title="Live Council Dock"
            note="Not wired yet. Will reuse the existing Council/provider adapters — no second Council or provider system planned or built here (Phase 6)."
          />
        </div>

        {selectedFeature ? (
          <div className="pointer-events-auto rounded border border-cyan-400/30 bg-black/70 p-3 backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-400/80">Observed Data — Earthquake</p>
              <button type="button" onClick={() => setSelection({ kind: 'none' })} className="text-[10px] text-slate-500 hover:text-slate-300">
                dismiss
              </button>
            </div>
            <p className="text-[12px] font-semibold text-slate-100">{selectedFeature.title}</p>
            <dl className="mt-2 space-y-1 text-[11px] text-slate-400">
              {typeof selectedFeature.properties.mag === 'number' && (
                <div className="flex justify-between"><dt>Magnitude</dt><dd className="text-slate-200">{selectedFeature.properties.mag}</dd></div>
              )}
              <div className="flex justify-between"><dt>Coordinates</dt><dd className="font-mono text-slate-200">{selectedFeature.latitude.toFixed(3)}°, {selectedFeature.longitude.toFixed(3)}°</dd></div>
              <div className="flex justify-between"><dt>Depth</dt><dd className="text-slate-200">{selectedFeature.altitude !== null ? `${Math.abs(selectedFeature.altitude / 1000).toFixed(1)} km` : 'not reported'}</dd></div>
              {selectedFeature.timestamp && (
                <div className="flex justify-between"><dt>Time</dt><dd className="text-slate-200">{new Date(selectedFeature.timestamp).toLocaleString()}</dd></div>
              )}
              {typeof selectedFeature.properties.status === 'string' && (
                <div className="flex justify-between"><dt>Review status</dt><dd className="text-slate-200">{selectedFeature.properties.status}</dd></div>
              )}
              <div className="flex justify-between"><dt>Provider</dt><dd className="text-slate-200">{selectedFeature.provenance.provider}</dd></div>
            </dl>
            {selectedFeature.rawReference.canonicalUrl && (
              <a href={selectedFeature.rawReference.canonicalUrl} target="_blank" rel="noreferrer" className="mt-2 block truncate text-[10.5px] text-cyan-400 hover:underline">
                {selectedFeature.rawReference.canonicalUrl}
              </a>
            )}
          </div>
        ) : (
          <div className="pointer-events-auto">
            <PlaceholderPanel
              title="Provenance / Source Panel"
              note="Click an earthquake marker to see its observed detail here. Future phases add Curated Earth Knowledge, Council Analysis, and Commander Annotation as distinct, never-blended panels."
            />
          </div>
        )}
      </div>

      {/* Bottom bar — time controls + Commander annotation placeholder. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4">
        <div className="pointer-events-auto">
          <PlaceholderPanel title="Time Controls" note="4D time engine not wired yet (Phase 5). Globe currently shows the present moment only." />
        </div>
        <div className="pointer-events-auto">
          <PlaceholderPanel
            title="Commander Annotation"
            note="Not wired yet. Will be a distinct, clearly-labeled layer class — never merged with Observed Data or AI Analysis layers."
          />
        </div>
      </div>
    </div>
  )
}
