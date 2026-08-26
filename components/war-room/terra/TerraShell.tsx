'use client'

/**
 * Terra Shell — Phase G/H (foundation) + Phase 1/2 (first live layer + event model) + Phase 3
 * (multi-layer spatial integration).
 *
 * Every entry in TERRA_LAYER_CATALOG (lib/terra/layerCatalog.ts) gets one TerraLayerRow: its own
 * enable toggle, its own useTerraLayer fetch, and its own headless TerraFeatureLayer renderer —
 * the same generic code path for every layer, never a per-provider branch here. Only
 * usgs_earthquake_feed starts enabled by default (preserving Phase 1/2's exact prior behavior);
 * the three newly-promoted layers start off so making a live external call is always a
 * deliberate Commander action.
 *
 * Remaining panels (Earth Knowledge, Live Council, time engine, Commander annotation
 * persistence) stay honestly-labeled PLACEHOLDERS — none of them are wired yet, matching this
 * repo's "no fake dashboards" standard.
 *
 * Selection state (a clicked coordinate or a clicked feature marker) is local component state
 * only — never written to war_room_audit_logs or anywhere else. Camera movement and exploratory
 * clicks are transient UI state, not War Room events.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import type { Viewer as CesiumViewer } from 'cesium'
import type { TerraGlobeStatus } from './TerraGlobe'
import { useTerraLayer } from './useTerraLayer'
import { TERRA_LAYER_CATALOG } from '@/lib/terra/layerCatalog'
import type { TerraClickPoint, TerraGeoFeature, TerraIntelligenceEventKind, TerraLayerDefinition } from '@/lib/terra/types'

const TerraGlobe = dynamic(() => import('./TerraGlobe').then(m => m.TerraGlobe), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-black">
      <p className="font-mono text-xs uppercase tracking-widest text-emerald-500/60">Loading globe engine…</p>
    </div>
  ),
})

const TerraFeatureLayer = dynamic(() => import('./TerraFeatureLayer').then(m => m.TerraFeatureLayer), { ssr: false })

type Selection =
  | { kind: 'none' }
  | { kind: 'miss' }
  | { kind: 'ground'; point: Extract<TerraClickPoint, { ok: true }> }
  | { kind: 'feature'; layerId: string; featureId: string }

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

const KIND_DETAIL_LABEL: Record<TerraIntelligenceEventKind, string> = {
  earthquake: 'Earthquake',
  water_gauge_reading: 'Water Gauge Reading',
  aircraft_state: 'Aircraft Position',
}

// Only usgs_earthquake_feed matches Phase 1/2's exact prior default (enabled on load); the three
// newly-promoted layers this phase start off.
const DEFAULT_ENABLED_LAYER_IDS = new Set<string>(['usgs_earthquake_feed'])

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className={mono ? 'font-mono text-slate-200' : 'text-slate-200'}>{value}</dd>
    </div>
  )
}

function FeatureDetailFields({ feature }: { feature: TerraGeoFeature }) {
  const coords = `${feature.latitude.toFixed(3)}°, ${feature.longitude.toFixed(3)}°`
  switch (feature.kind) {
    case 'earthquake':
      return (
        <>
          {typeof feature.properties.mag === 'number' && <Row label="Magnitude" value={String(feature.properties.mag)} />}
          <Row label="Coordinates" value={coords} mono />
          <Row label="Depth" value={feature.altitude !== null ? `${Math.abs(feature.altitude / 1000).toFixed(1)} km` : 'not reported'} />
          {feature.timestamp && <Row label="Time" value={new Date(feature.timestamp).toLocaleString()} />}
          {typeof feature.properties.status === 'string' && <Row label="Review status" value={feature.properties.status} />}
        </>
      )
    case 'water_gauge_reading':
      return (
        <>
          <Row label="Coordinates" value={coords} mono />
          {typeof feature.properties.latestValue === 'number' && (
            <Row label="Latest reading" value={`${feature.properties.latestValue}${feature.properties.unit ? ` ${feature.properties.unit}` : ''}`} />
          )}
          {typeof feature.properties.latestValueDate === 'string' && <Row label="Reading date" value={feature.properties.latestValueDate} />}
          {typeof feature.properties.pointCount === 'number' && <Row label="Recent readings" value={String(feature.properties.pointCount)} />}
        </>
      )
    case 'aircraft_state':
      return (
        <>
          <Row label="Coordinates" value={coords} mono />
          {typeof feature.properties.callsign === 'string' && <Row label="Callsign" value={feature.properties.callsign} />}
          {typeof feature.properties.icao24 === 'string' && <Row label="ICAO24" value={feature.properties.icao24} mono />}
          {feature.timestamp && <Row label="Last position report" value={new Date(feature.timestamp).toLocaleString()} />}
        </>
      )
    default:
      return <Row label="Coordinates" value={coords} mono />
  }
}

function TerraLayerRow({
  layer,
  viewer,
  selection,
  onFeaturesChange,
}: {
  layer: TerraLayerDefinition
  viewer: CesiumViewer | null
  selection: Selection
  onFeaturesChange: (layerId: string, features: TerraGeoFeature[]) => void
}) {
  const [enabled, setEnabled] = useState(() => DEFAULT_ENABLED_LAYER_IDS.has(layer.id))
  const feed = useTerraLayer(layer.id, enabled)

  useEffect(() => {
    onFeaturesChange(layer.id, feed.features)
  }, [layer.id, feed.features, onFeaturesChange])

  const feedStatus = FEED_STATE_LABEL[feed.state]
  const selectedId = selection.kind === 'feature' && selection.layerId === layer.id ? selection.featureId : null

  return (
    <div className="border-t border-white/10 pt-2 first:border-t-0 first:pt-0 first:mt-0 mt-2">
      <TerraFeatureLayer layerId={layer.id} viewer={viewer} enabled={enabled} features={feed.features} selectedId={selectedId} />
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-300">{layer.label}</span>
        <button
          type="button"
          onClick={() => setEnabled(prev => !prev)}
          className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
            enabled ? 'border-emerald-400/60 text-emerald-400' : 'border-white/20 text-slate-500'
          }`}
          aria-pressed={enabled}
        >
          {enabled ? 'On' : 'Off'}
        </button>
      </div>
      {enabled && (
        <div className="mt-1 space-y-1">
          <p className={`text-[10px] font-bold uppercase tracking-widest ${feedStatus.color}`}>{feedStatus.text}</p>
          <p className="text-[10.5px] text-slate-500">
            {feed.features.length} event{feed.features.length === 1 ? '' : 's'}
            {feed.skippedCount > 0 && ` · ${feed.skippedCount} unprojectable`}
          </p>
          {feed.lastFetchedAt && <p className="text-[10.5px] text-slate-500">Last fetched: {new Date(feed.lastFetchedAt).toLocaleTimeString()}</p>}
          {feed.lastErrorMessage && <p className="text-[10.5px] text-red-400">{feed.lastErrorMessage}</p>}
          <button
            type="button"
            onClick={feed.refresh}
            className="mt-0.5 rounded border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300 hover:border-emerald-400/60 hover:text-emerald-400"
          >
            Refresh now
          </button>
        </div>
      )}
    </div>
  )
}

export function TerraShell() {
  const [globeStatus, setGlobeStatus] = useState<TerraGlobeStatus>({ phase: 'loading' })
  const [viewer, setViewer] = useState<CesiumViewer | null>(null)
  const [selection, setSelection] = useState<Selection>({ kind: 'none' })
  const [layerFeatures, setLayerFeatures] = useState<Record<string, TerraGeoFeature[]>>({})

  const handleFeaturesChange = useCallback((layerId: string, features: TerraGeoFeature[]) => {
    setLayerFeatures(prev => (prev[layerId] === features ? prev : { ...prev, [layerId]: features }))
  }, [])

  const selectedFeature = useMemo(() => {
    if (selection.kind !== 'feature') return null
    return (layerFeatures[selection.layerId] ?? []).find(f => f.id === selection.featureId) ?? null
  }, [selection, layerFeatures])

  const handleGroundClick = useCallback((point: TerraClickPoint) => {
    setSelection(point.ok ? { kind: 'ground', point } : { kind: 'miss' })
  }, [])

  // TerraFeatureLayer composes each Cesium entity id as "{layerId}:{featureId}" (see
  // TerraFeatureLayer.tsx) specifically so a click can be resolved back to the correct layer even
  // when two layers happen to share a raw provider record id (e.g. the same real earthquake
  // appearing in both usgs_earthquake_feed and a usgs_earthquake catalog search covering the same
  // window) — without this, both layers' entities would collide under one ambiguous id.
  const handleEntityClick = useCallback((compositeId: string) => {
    const separatorIndex = compositeId.indexOf(':')
    if (separatorIndex === -1) return
    const layerId = compositeId.slice(0, separatorIndex)
    const featureId = compositeId.slice(separatorIndex + 1)
    setSelection({ kind: 'feature', layerId, featureId })
  }, [])

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black text-white">
      <TerraGlobe onStatusChange={setGlobeStatus} onViewerReady={setViewer} onEntityClick={handleEntityClick} onGroundClick={handleGroundClick} />

      {/* Top instrumentation bar — mission status + identity. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div className="pointer-events-auto rounded border border-white/10 bg-black/70 px-3 py-2 backdrop-blur-sm">
          <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-400">War Room · Terra</h1>
          <p className="mt-0.5 text-[10px] text-slate-500">Planetary Intelligence Environment — Phase 3: multi-layer spatial integration</p>
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
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-400/80">Data Layers</p>
          {TERRA_LAYER_CATALOG.map(layer => (
            <TerraLayerRow key={layer.id} layer={layer} viewer={viewer} selection={selection} onFeaturesChange={handleFeaturesChange} />
          ))}
        </div>

        <div className="pointer-events-auto">
          <PlaceholderPanel
            title="Earth Knowledge Panel"
            note="Not wired yet. Will consume War Room's existing Earth Knowledge Registry and Research Engine directly — no separate registry planned or built here (later phase)."
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

      {/* Right rail — Live Council dock + selected-feature / provenance panel. */}
      <div className="pointer-events-none absolute right-0 top-20 flex w-72 flex-col gap-2 p-4">
        <div className="pointer-events-auto">
          <PlaceholderPanel
            title="Live Council Dock"
            note="Not wired yet. Will reuse the existing Council/provider adapters — no second Council or provider system planned or built here (later phase)."
          />
        </div>

        {selectedFeature ? (
          <div className="pointer-events-auto rounded border border-cyan-400/30 bg-black/70 p-3 backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-400/80">Observed Data — {KIND_DETAIL_LABEL[selectedFeature.kind]}</p>
              <button type="button" onClick={() => setSelection({ kind: 'none' })} className="text-[10px] text-slate-500 hover:text-slate-300">
                dismiss
              </button>
            </div>
            <p className="text-[12px] font-semibold text-slate-100">{selectedFeature.title}</p>
            <dl className="mt-2 space-y-1 text-[11px] text-slate-400">
              <FeatureDetailFields feature={selectedFeature} />
              <Row label="Provider" value={selectedFeature.provenance.provider} />
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
              note="Click a feature marker to see its observed detail here. Future phases add Curated Earth Knowledge, Council Analysis, and Commander Annotation as distinct, never-blended panels."
            />
          </div>
        )}
      </div>

      {/* Bottom bar — time controls + Commander annotation placeholder. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4">
        <div className="pointer-events-auto">
          <PlaceholderPanel title="Time Controls" note="4D time engine not wired yet (later phase). Globe currently shows the present moment only." />
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
