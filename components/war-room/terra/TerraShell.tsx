'use client'

/**
 * Terra Shell — Phase G/H (foundation) + Phase 1/2 (first live layer + event model) + Phase 3
 * (multi-layer spatial integration).
 *
 * Every entry in TERRA_LAYER_SUMMARIES (lib/terra/layerCatalogSummary.ts, a client-safe mirror of
 * lib/terra/layerCatalog.ts) gets one TerraLayerRow: its own
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { Viewer as CesiumViewer } from 'cesium'
import type { TerraGlobeStatus } from './TerraGlobe'
import { useTerraLayer } from './useTerraLayer'
import { useTerraClock } from './useTerraClock'
import { useTerraCinematicOrbit } from './useTerraCinematicOrbit'
import { TerraTimeline } from './TerraTimeline'
import { TERRA_LAYER_SUMMARIES, type TerraLayerSummary } from '@/lib/terra/layerCatalogSummary'
import { TERRA_TIME_WINDOW_PRESETS, filterTerraFeaturesByTime, shouldAutoRefreshTerraLayer } from '@/lib/terra/terraTime'
import type { TerraClickPoint, TerraGeoFeature, TerraIntelligenceEventKind, TerraTimeMode, TerraTimeWindow } from '@/lib/terra/types'

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
  heritage_site: 'Heritage Site',
  place: 'Place',
  geographic_feature: 'Geographic Feature',
  weather_observation: 'Weather Observation',
  biodiversity_observation: 'Biodiversity Observation',
  tropical_cyclone: 'Tropical Cyclone',
  wildfire_incident: 'Wildfire Incident',
  volcano_event: 'Volcanic Activity',
  flood_event: 'Flood Event',
  severe_weather_alert: 'Severe Weather Alert',
  tsunami_alert: 'Tsunami Bulletin',
}

// Coordinate origin — Phase 4's explicit provenance requirement: a Commander must be able to
// tell an observed coordinate apart from an extracted one apart from a resolved one at a glance.
const COORDINATE_ORIGIN_LABEL: Record<TerraGeoFeature['coordinateOrigin'], string> = {
  observed: 'Observed (provider-reported)',
  source_embedded: 'Extracted (source-embedded)',
  resolved: 'Resolved (place-name lookup)',
}

// Only usgs_earthquake_feed matches Phase 1/2's exact prior default (enabled on load); every
// other layer starts off so making a live external call is always a deliberate Commander action.
const DEFAULT_ENABLED_LAYER_IDS = new Set<string>(['usgs_earthquake_feed'])

// Phase 4: the catalog is now large enough (15 layers) to warrant grouping rather than one flat
// list — grouped by TerraIntelligenceDomain, the same coarse grouping already on every event.
const LAYER_GROUPS: { label: string; domains: TerraLayerSummary['domain'][] }[] = [
  { label: 'Hazards', domains: ['hazards'] },
  { label: 'Weather', domains: ['weather'] },
  { label: 'Science', domains: ['science'] },
  { label: 'Research & Heritage', domains: ['research'] },
  { label: 'Other', domains: ['other', 'opportunity', 'threat', 'government'] },
]

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
    case 'heritage_site':
      return (
        <>
          <Row label="Coordinates" value={coords} mono />
          {typeof feature.properties.findspot === 'string' && <Row label="Findspot" value={feature.properties.findspot} />}
        </>
      )
    case 'place':
      return <Row label="Coordinates" value={coords} mono />
    case 'geographic_feature':
      return <Row label="Coordinates" value={coords} mono />
    case 'weather_observation':
      return <Row label="Coordinates" value={coords} mono />
    case 'biodiversity_observation':
      return (
        <>
          <Row label="Coordinates" value={coords} mono />
          {typeof feature.properties.water_body === 'string' && <Row label="Water body" value={feature.properties.water_body} />}
          {typeof feature.properties.country === 'string' && <Row label="Country" value={feature.properties.country} />}
        </>
      )
    case 'tropical_cyclone':
      return (
        <>
          {typeof feature.properties.classification === 'string' && <Row label="Classification" value={feature.properties.classification} />}
          <Row label="Position" value={coords} mono />
          {typeof feature.properties.intensityKt === 'number' && <Row label="Max sustained wind" value={`${feature.properties.intensityKt} kt`} />}
          {typeof feature.properties.pressureMb === 'number' && <Row label="Pressure" value={`${feature.properties.pressureMb} mb`} />}
          {typeof feature.properties.basin === 'string' && <Row label="Basin" value={feature.properties.basin} />}
          {typeof feature.properties.movementSpeedKt === 'number' && <Row label="Movement" value={`${feature.properties.movementSpeedKt} kt`} />}
          <Row label="Forecast track" value="Not rendered — real NHC KMZ link only" />
        </>
      )
    case 'wildfire_incident':
    case 'volcano_event':
    case 'flood_event':
      return (
        <>
          <Row label="Coordinates" value={coords} mono />
          {typeof feature.properties.magnitudeValue === 'number' && <Row label="Magnitude" value={`${feature.properties.magnitudeValue} ${typeof feature.properties.magnitudeUnit === 'string' ? feature.properties.magnitudeUnit : ''}`.trim()} />}
          {typeof feature.properties.date === 'string' && <Row label="Observed" value={new Date(feature.properties.date).toLocaleString()} />}
        </>
      )
    case 'severe_weather_alert':
      return (
        <>
          {typeof feature.properties.event === 'string' && <Row label="Alert type" value={feature.properties.event} />}
          {typeof feature.properties.severity === 'string' && <Row label="Severity (source)" value={feature.properties.severity} />}
          {typeof feature.properties.urgency === 'string' && <Row label="Urgency (source)" value={feature.properties.urgency} />}
          {typeof feature.properties.certainty === 'string' && <Row label="Certainty (source)" value={feature.properties.certainty} />}
          {typeof feature.properties.expires === 'string' && <Row label="Expires" value={new Date(feature.properties.expires).toLocaleString()} />}
        </>
      )
    case 'tsunami_alert':
      return (
        <>
          <Row label="Coordinates" value={coords} mono />
          {typeof feature.properties.category === 'string' && <Row label="NOAA category" value={feature.properties.category} />}
          {typeof feature.properties.preliminary_magnitude === 'string' && <Row label="Preliminary magnitude" value={feature.properties.preliminary_magnitude} />}
          {typeof feature.properties.affected_region === 'string' && <Row label="Affected region" value={feature.properties.affected_region} />}
        </>
      )
    default:
      return <Row label="Coordinates" value={coords} mono />
  }
}

function CoordinateOriginFields({ feature }: { feature: TerraGeoFeature }) {
  return (
    <>
      <Row label="Coordinate origin" value={COORDINATE_ORIGIN_LABEL[feature.coordinateOrigin]} />
      {feature.geoResolution && (
        <>
          <Row label="Resolved via" value={feature.geoResolution.resolverProviderId} />
          <Row label="Resolver query" value={feature.geoResolution.queryUsed} />
          {feature.geoResolution.quality === 'strong' || feature.geoResolution.quality === 'exact' ? (
            <Row label="Match" value={feature.geoResolution.matchTitle} />
          ) : null}
        </>
      )}
    </>
  )
}

function TerraLayerRow({
  layer,
  viewer,
  selection,
  onFeaturesChange,
  timeMode,
  selectedTime,
  timeWindow,
}: {
  layer: TerraLayerSummary
  viewer: CesiumViewer | null
  selection: Selection
  onFeaturesChange: (layerId: string, features: TerraGeoFeature[]) => void
  timeMode: TerraTimeMode
  selectedTime: string
  timeWindow: TerraTimeWindow
}) {
  const [enabled, setEnabled] = useState(() => DEFAULT_ENABLED_LAYER_IDS.has(layer.id))
  const autoRefreshAllowed = shouldAutoRefreshTerraLayer(timeMode)
  const feed = useTerraLayer(layer.id, enabled, layer.refreshIntervalMs, autoRefreshAllowed)

  // Mission section 7: returning to live must "refresh live-data layers where appropriate" — a
  // one-time explicit refresh on the historical->live edge, not a new continuous poll.
  const wasLiveRef = useRef(timeMode === 'live')
  useEffect(() => {
    if (timeMode === 'live' && !wasLiveRef.current && enabled) feed.refresh()
    wasLiveRef.current = timeMode === 'live'
  }, [timeMode, enabled, feed])

  // Section 8/9: 4D visibility filtering over already-loaded data — never a re-fetch. `window:
  // null` (the 'ALL' preset, the default) reproduces Phase 1-5's exact prior "show everything
  // loaded" behavior exactly, so no existing layer's visible output changes unless a Commander
  // deliberately narrows the window or scrubs into the past.
  const visibleFeatures = useMemo(() => filterTerraFeaturesByTime(feed.features, selectedTime, timeWindow), [feed.features, selectedTime, timeWindow])

  useEffect(() => {
    onFeaturesChange(layer.id, visibleFeatures)
  }, [layer.id, visibleFeatures, onFeaturesChange])

  const feedStatus = FEED_STATE_LABEL[feed.state]
  const selectedId = selection.kind === 'feature' && selection.layerId === layer.id ? selection.featureId : null

  return (
    <div className="border-t border-white/10 pt-2 first:border-t-0 first:pt-0 first:mt-0 mt-2">
      <TerraFeatureLayer layerId={layer.id} viewer={viewer} enabled={enabled} features={visibleFeatures} selectedId={selectedId} />
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

  // Phase 6: Terra's 4D clock — real Earth orientation/lighting follows viewer.clock.currentTime
  // (see TerraGlobe.tsx's enableLighting + useTerraClock.ts), which this hook is the only thing
  // that ever sets.
  const clock = useTerraClock(viewer)
  // Camera-only, deliberately separate from clock/time state — see useTerraCinematicOrbit.ts.
  const cinematic = useTerraCinematicOrbit(viewer, clock.time.mode === 'live')

  const [selectedWindowId, setSelectedWindowId] = useState('all')
  const selectedWindow: TerraTimeWindow = useMemo(() => TERRA_TIME_WINDOW_PRESETS.find(p => p.id === selectedWindowId)?.window ?? null, [selectedWindowId])

  const handleFeaturesChange = useCallback((layerId: string, features: TerraGeoFeature[]) => {
    setLayerFeatures(prev => (prev[layerId] === features ? prev : { ...prev, [layerId]: features }))
  }, [])

  const selectedFeature = useMemo(() => {
    if (selection.kind !== 'feature') return null
    return (layerFeatures[selection.layerId] ?? []).find(f => f.id === selection.featureId) ?? null
  }, [selection, layerFeatures])

  // Real counts from whichever hazard layers are actually enabled and loaded — never a static or
  // placeholder number. A layer that isn't enabled contributes 0, honestly (not "unknown"),
  // matching handleFeaturesChange's own per-layer state.
  const hazardSummary = useMemo(() => {
    const count = (layerId: string) => layerFeatures[layerId]?.length ?? 0
    return [
      { label: 'EARTHQUAKES', value: count('usgs_earthquake_feed') + count('usgs_earthquake') },
      { label: 'ACTIVE CYCLONES', value: count('nhc_current_storms') },
      { label: 'WILDFIRES', value: count('nasa_eonet_wildfires') },
      { label: 'VOLCANOES', value: count('nasa_eonet_volcanoes') },
      { label: 'WEATHER ALERTS', value: count('nws_severe_weather_alerts') },
      { label: 'TSUNAMI BULLETINS', value: count('tsunami_gov') },
    ]
  }, [layerFeatures])

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

      {/* Top instrumentation bar — mission status + identity + real hazard summary. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-4">
        <div className="pointer-events-auto rounded border border-white/10 bg-black/70 px-3 py-2 backdrop-blur-sm">
          <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-400">War Room · Terra</h1>
          <p className="mt-0.5 text-[10px] text-slate-500">Planetary Intelligence Environment — Phase 6: real-time planet + 4D time engine</p>
        </div>
        <div className="pointer-events-auto flex flex-wrap justify-center gap-x-4 gap-y-1 rounded border border-white/10 bg-black/70 px-3 py-2 text-[10px] backdrop-blur-sm">
          {hazardSummary.map(item => (
            <span key={item.label} className="whitespace-nowrap">
              <span className="text-slate-500">{item.label} </span>
              <span className="font-mono font-bold text-emerald-400">{item.value}</span>
            </span>
          ))}
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

        <div className="pointer-events-auto max-h-[52vh] overflow-y-auto rounded border border-white/10 bg-black/60 p-3 backdrop-blur-sm">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-400/80">Data Layers</p>
          {LAYER_GROUPS.map(group => {
            const layers = TERRA_LAYER_SUMMARIES.filter(layer => group.domains.includes(layer.domain))
            if (layers.length === 0) return null
            return (
              <div key={group.label} className="mt-2 first:mt-0">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{group.label}</p>
                {layers.map(layer => (
                  <TerraLayerRow
                    key={layer.id}
                    layer={layer}
                    viewer={viewer}
                    selection={selection}
                    onFeaturesChange={handleFeaturesChange}
                    timeMode={clock.time.mode}
                    selectedTime={clock.time.currentTime}
                    timeWindow={selectedWindow}
                  />
                ))}
              </div>
            )
          })}
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
              <CoordinateOriginFields feature={selectedFeature} />
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

      {/* Bottom bar — 4D timeline + Commander annotation placeholder. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4">
        <TerraTimeline
          time={clock.time}
          onGoLive={clock.goLive}
          onScrub={clock.scrub}
          onPlay={clock.play}
          onPause={clock.pause}
          onPlaybackRateChange={clock.setPlaybackRate}
          windowPresets={TERRA_TIME_WINDOW_PRESETS}
          selectedWindowId={selectedWindowId}
          onWindowChange={setSelectedWindowId}
          cinematicOrbiting={cinematic.orbiting}
          cinematicSuppressedByReducedMotion={cinematic.suppressedByReducedMotion}
          onResumeCinematic={cinematic.resume}
        />
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
