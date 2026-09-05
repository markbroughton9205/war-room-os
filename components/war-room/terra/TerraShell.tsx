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
 * Earth Knowledge's active-location surface is wired to the existing Research Engine/Nominatim
 * boundary. Remaining Council and Commander annotation surfaces stay honestly-labeled
 * placeholders in the dedicated workspace, matching this repo's "no fake dashboards" standard.
 *
 * Selection state (a clicked coordinate or a clicked feature marker) is local component state
 * only — never written to war_room_audit_logs or anywhere else. Camera movement and exploratory
 * clicks are transient UI state, not War Room events.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import type { TerraGlobeStatus } from './TerraGlobe'
import { useTerraLayer } from './useTerraLayer'
import { useTerraClock } from './useTerraClock'
import { useTerraCinematicOrbit } from './useTerraCinematicOrbit'
import { useTerraCameraScale } from './useTerraCameraScale'
import { TerraTimeline } from './TerraTimeline'
import { TerraEarthImagery } from './TerraEarthImagery'
import { TERRA_LAYER_SUMMARIES, type TerraLayerSummary } from '@/lib/terra/layerCatalogSummary'
import { TERRA_TIME_WINDOW_PRESETS, filterTerraFeaturesByTime, shouldAutoRefreshTerraLayer, terraFeaturesShallowEqual } from '@/lib/terra/terraTime'
import type { TerraClickPoint, TerraGeoFeature, TerraIntelligenceEventKind, TerraTimeMode, TerraTimeWindow } from '@/lib/terra/types'
import type { TerraLocationTarget } from '@/lib/terra/locationCommand'
import type { TerraActiveLocation, TerraReverseLocationResolution } from '@/lib/terra/activeLocation'
import { TerraLocationCommandInput } from './TerraLocationCommandInput'
import { TerraEarthKnowledgePanel } from './TerraEarthKnowledgePanel'
import { useTerraActiveLocation } from './TerraActiveLocationContext'
import { TERRA_STREET_LEVEL_IMAGERY_MESSAGE } from '@/lib/terra/streetLevelImagery'
import {
  terraHighResAerialUnavailable,
  TERRA_HIGH_RES_AERIAL_UNAVAILABLE_MESSAGE,
  TERRA_OPEN_MAP_DETAIL_LABEL,
  TERRA_CLOSE_MAP_DETAIL_LABEL,
} from '@/lib/terra/aerialImagery'
import { buildTerraEventIntelligenceQuery } from '@/lib/terra/eventIntelligenceQuery'
import { resolveTerraEventCameraFraming } from '@/lib/terra/eventCameraFraming'
import { isTerraRequestStale } from '@/lib/terra/requestSequence'
import { useTerraRelatedIntelligence } from './useTerraRelatedIntelligence'
import { TerraRelatedIntelligencePanel } from './TerraRelatedIntelligencePanel'
import { useTerraCameraViewRectangle } from './useTerraCameraViewRectangle'
import { useTerraAircraftTrails } from './useTerraAircraftTrails'
import { useTerraVesselTrails } from './useTerraVesselTrails'
import { buildTerraAircraftBoundingBoxQuery } from '@/lib/terra/aircraftBoundingBox'
import { terraCameraRectSignature } from '@/lib/terra/cameraRectSignature'
import { summarizeTerraAircraftFeatures } from '@/lib/terra/aircraftRegionalSummary'
import { buildTerraMaritimeBoundingBoxQuery, terraCameraViewHasMaritimeCoverage } from '@/lib/terra/maritimeBoundingBox'
import { summarizeTerraVesselFeatures } from '@/lib/terra/vesselRegionalSummary'
import { resolveTerraMaritimeCoverageState, TERRA_MARITIME_COVERAGE_LABELS, type TerraMaritimeCoverageState } from '@/lib/terra/maritimeCoverage'
import type { TerraCoverageTruthState } from '@/lib/terra/coverageTruth'
import { TerraCoverageBadge } from './TerraCoverageBadge'
import { TerraTrafficLayer } from './TerraTrafficLayer'
import { TERRA_TRAFFIC_LAYER_DEFS } from './terraTrafficLayerDefs'
import { TerraCameraHoverCard } from './TerraCameraHoverCard'

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

function StatusLine({ status, aerialImageryActive }: { status: TerraGlobeStatus; aerialImageryActive: boolean }) {
  if (status.phase === 'loading') {
    return <span className="text-slate-500">Initializing…</span>
  }
  if (status.phase === 'error') {
    return <span className="text-amber-400">Globe failed to initialize: {status.message}</span>
  }
  return (
    <span className="text-emerald-400">
      Satellite imagery: NASA GIBS daily
      {aerialImageryActive
        ? <span className="text-cyan-400"> · ion World Imagery close-range</span>
        : <span className="text-amber-400"> · high-res aerial unavailable{status.hasIonToken ? '' : ' (Cesium ion account token required)'}</span>}
      <span className="text-slate-500"> · OSM map-detail available</span>
      {status.hasIonToken
        ? <span className="text-cyan-400"> · Terrain active</span>
        : <span className="text-amber-400"> · Terrain fallback (Cesium ion account token required for premium terrain)</span>}
      {status.hasIonToken && status.hasOsmBuildings
        ? <span className="text-cyan-400"> · 3D Buildings active</span>
        : <span className="text-amber-400"> · 3D Buildings unavailable{status.hasIonToken ? '' : ' (Cesium ion account token required)'}</span>}
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

function TerraProviderCapabilityDock({
  localDetailActive,
  buildingsActive,
  aerialImageryActive,
  mapDetailMode,
  onToggleMapDetail,
}: {
  localDetailActive: boolean
  buildingsActive: boolean
  aerialImageryActive: boolean
  mapDetailMode: boolean
  onToggleMapDetail: () => void
}) {
  return (
    <details className="group pointer-events-auto w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-white/10 bg-slate-950/80 shadow-2xl backdrop-blur-xl">
      <summary className="cursor-pointer list-none px-3 py-2 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-300">Layers &amp; provenance <span className="float-right text-cyan-300 group-open:rotate-45">+</span></summary>
      <div className="space-y-2 border-t border-white/10 px-3 py-3 text-[9px]">
        <div className="flex items-start justify-between gap-3">
          <span className="text-slate-400">Satellite / aerial</span>
          <span className={aerialImageryActive ? 'text-right text-emerald-300' : 'text-right text-amber-300'}>
            {aerialImageryActive ? 'NASA GIBS daily · ion World Imagery close-range' : 'NASA GIBS daily · aerial asset unavailable'}
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="text-slate-400">Map detail (OSM)</span>
          <span className="text-right">
            <button type="button" onClick={onToggleMapDetail} className={`rounded border px-1.5 py-0.5 font-bold uppercase tracking-wide ${mapDetailMode ? 'border-cyan-400/50 text-cyan-300' : 'border-white/20 text-slate-400 hover:text-slate-200'}`}>
              {mapDetailMode ? 'On · roads/labels/POIs' : 'Off · optional overlay'}
            </button>
          </span>
        </div>
        <div className="flex items-start justify-between gap-3"><span className="text-slate-400">Buildings</span><span className={buildingsActive ? 'text-right text-emerald-300' : 'text-right text-amber-300'}>{buildingsActive ? (localDetailActive ? 'Cesium OSM Buildings active' : 'Ready · zoom to local scale') : 'Provider token unavailable'}</span></div>
        <div className="flex items-start justify-between gap-3"><span className="text-slate-400">Street photography</span><span className="max-w-[13rem] text-right text-slate-400">External provider account and imagery terms required</span></div>
        <div className="flex items-start justify-between gap-3"><span className="text-slate-400">Road intelligence</span><span className="max-w-[13rem] text-right text-emerald-300">Government feeds enabled · events, weather, cameras, historical flow</span></div>
        <div className="flex items-start justify-between gap-3"><span className="text-slate-400">Public cameras</span><span className="max-w-[13rem] text-right text-emerald-300">Digitraffic (Finland) · Ontario 511 · Hong Kong TD · Québec 511</span></div>
        <p className="border-t border-white/10 pt-2 leading-relaxed text-slate-500">Unavailable layers never render invented markers, people, buildings, motion, or feeds.</p>
      </div>
    </details>
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
  vessel_position: 'Vessel Position',
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
  landmark_poi: 'Nearby Landmark',
  traffic_camera: 'Traffic Camera',
  traffic_event: 'Traffic Event',
  traffic_flow_observation: 'Traffic Flow Observation',
  road_weather_observation: 'Road Weather Observation',
}

// God's Eye Traffic phase truth doctrine — never call a still image live video, never call stale
// media live (see lib/terra/roadCameraStaleness.ts). Colors intentionally mirror this file's
// existing FEED_STATE_LABEL palette (emerald=current, amber=degraded, red=error) rather than
// inventing a second scheme.
const CAMERA_FRESHNESS_LABEL: Record<string, { text: string; color: string }> = {
  live_video: { text: 'LIVE VIDEO', color: 'text-emerald-400' },
  still_image: { text: 'STILL IMAGE — CURRENT', color: 'text-emerald-400' },
  stale: { text: 'STALE', color: 'text-amber-400' },
  offline: { text: 'OFFLINE', color: 'text-red-400' },
  unknown: { text: 'UNKNOWN', color: 'text-slate-400' },
}

// Phase 3: per-provider camera attribution (previously hardcoded to the two Phase 1/2 sources).
const CAMERA_ATTRIBUTION: Record<string, string> = {
  digitraffic_road_cameras: 'Fintraffic / digitraffic.fi, CC BY 4.0',
  ontario_511_cameras: 'Ontario 511 (511on.ca), Government of Ontario',
  hong_kong_td_cameras: 'Transport Department, Government of the Hong Kong SAR (data.gov.hk)',
  quebec_511_cameras: 'Québec 511 — Ministère des Transports et de la Mobilité durable',
}

// Maritime's richer bespoke resolver (lib/terra/maritimeCoverage.ts — RATE_LIMITED, DELAYED_DATA,
// NO_VESSELS_OBSERVED) keeps its own label text, but its states surface through the SAME shared
// TerraCoverageBadge as every traffic layer, mapped here onto the shared 7-state truth vocabulary
// (lib/terra/coverageTruth.ts) for color — one coherent visual model for the Commander.
const MARITIME_COVERAGE_BADGE_STATE: Record<TerraMaritimeCoverageState, TerraCoverageTruthState> = {
  PENDING: 'LOADING',
  LIVE_DATA_PRESENT: 'LIVE',
  NO_VESSELS_OBSERVED: 'NO_DATA',
  NO_COVERAGE: 'NO_COVERAGE',
  SOURCE_OFFLINE: 'OFFLINE',
  DELAYED_DATA: 'STALE',
  RATE_LIMITED: 'OFFLINE',
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
          {typeof feature.properties.originCountry === 'string' && <Row label="Origin country" value={feature.properties.originCountry} />}
          <Row label="Altitude" value={feature.altitude !== null ? `${Math.round(feature.altitude).toLocaleString()} m` : 'not reported'} />
          {typeof feature.properties.velocityMps === 'number' && <Row label="Ground speed" value={`${Math.round(feature.properties.velocityMps * 3.6)} km/h`} />}
          {typeof feature.properties.headingDeg === 'number' && <Row label="Heading" value={`${Math.round(feature.properties.headingDeg)}°`} />}
          {typeof feature.properties.verticalRateMps === 'number' && <Row label="Vertical rate" value={`${feature.properties.verticalRateMps.toFixed(1)} m/s`} />}
          <Row label="On ground" value={feature.properties.onGround === true ? 'Yes' : feature.properties.onGround === false ? 'No' : 'not reported'} />
          {feature.timestamp && <Row label="Last contact" value={new Date(feature.timestamp).toLocaleString()} />}
        </>
      )
    case 'vessel_position':
      return (
        <>
          <Row label="Coordinates" value={coords} mono />
          {typeof feature.properties.mmsi === 'string' && <Row label="MMSI" value={feature.properties.mmsi} mono />}
          {typeof feature.properties.imo === 'string' && <Row label="IMO" value={feature.properties.imo} mono />}
          {typeof feature.properties.callSign === 'string' && <Row label="Callsign" value={feature.properties.callSign} />}
          {typeof feature.properties.shipTypeLabel === 'string' && <Row label="Type" value={feature.properties.shipTypeLabel} />}
          {typeof feature.properties.speedKnots === 'number' && <Row label="Speed" value={`${feature.properties.speedKnots.toFixed(1)} kn`} />}
          {typeof feature.properties.courseDeg === 'number' && <Row label="Course" value={`${Math.round(feature.properties.courseDeg)}°`} />}
          {typeof feature.properties.headingDeg === 'number' && <Row label="Heading" value={`${Math.round(feature.properties.headingDeg)}°`} />}
          {typeof feature.properties.navStatLabel === 'string' && <Row label="Nav status" value={feature.properties.navStatLabel} />}
          {typeof feature.properties.destination === 'string' && <Row label="Destination" value={feature.properties.destination} />}
          {typeof feature.properties.draughtMeters === 'number' && <Row label="Draught" value={`${feature.properties.draughtMeters.toFixed(1)} m`} />}
          {feature.timestamp && <Row label="Last observed" value={new Date(feature.timestamp).toLocaleString()} />}
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
    case 'landmark_poi':
      return (
        <>
          <Row label="Coordinates" value={coords} mono />
          {Array.isArray(feature.properties.subjects) && feature.properties.subjects.length > 0 && (
            <Row label="OSM tags" value={feature.properties.subjects.filter((s): s is string => typeof s === 'string').join(', ')} />
          )}
          {typeof feature.properties.osm_id === 'string' && <Row label="OSM record" value={feature.properties.osm_id} mono />}
        </>
      )
    case 'traffic_camera': {
      const freshness = typeof feature.properties.freshness === 'string' ? feature.properties.freshness : 'unknown'
      const freshnessMeta = CAMERA_FRESHNESS_LABEL[freshness] ?? CAMERA_FRESHNESS_LABEL.unknown
      // Québec 511 publishes an HTML viewer page per camera, never a direct JPEG (see
      // lib/terra/normalizeQuebecTrafficCameras.ts) — a link, never an <img>.
      const viewerUrl = typeof feature.properties.viewerUrl === 'string' ? feature.properties.viewerUrl : null
      // Ontario 511 and Hong Kong TD images are proxied (app/api/terra/camera-image/route.ts)
      // rather than hotlinked directly — this phase's camera-image proxy boundary. Digitraffic's
      // imageUrl stays a direct hotlink, matching Phase 1's existing, unchanged behavior.
      const proxiedImageUrl =
        feature.providerId === 'ontario_511_cameras' && typeof feature.properties.viewId === 'string'
          ? `/api/terra/camera-image?provider=ontario_511_cameras&id=${encodeURIComponent(feature.properties.viewId)}`
          : feature.providerId === 'hong_kong_td_cameras' && typeof feature.properties.cameraId === 'string'
            ? `/api/terra/camera-image?provider=hong_kong_td_cameras&id=${encodeURIComponent(feature.properties.cameraId)}`
            : null
      const directImageUrl = feature.providerId === 'digitraffic_road_cameras' && typeof feature.properties.imageUrl === 'string' ? feature.properties.imageUrl : null
      return (
        <>
          <Row label="Coordinates" value={coords} mono />
          {typeof feature.properties.road === 'string' && <Row label="Road" value={feature.properties.road} />}
          {typeof feature.properties.direction === 'string' && <Row label="Direction" value={feature.properties.direction.replace(/_/g, ' ').toLowerCase()} />}
          <Row label="Feed type" value={viewerUrl ? 'HTML viewer at source (no direct still published)' : 'Still image (refreshing)'} />
          <div className="flex justify-between"><dt>Status</dt><dd className={freshnessMeta.color}>{freshnessMeta.text}</dd></div>
          {feature.timestamp && <Row label="Captured" value={new Date(feature.timestamp).toLocaleString()} />}
          {typeof feature.properties.collectionIntervalSec === 'number' && <Row label="Refresh interval" value={`${feature.properties.collectionIntervalSec}s`} />}
          {proxiedImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- proxied still image, not a Next-optimizable local asset.
            <img
              src={proxiedImageUrl}
              alt={`${feature.title} — road camera still image`}
              className="mt-1 w-full rounded border border-white/10"
              loading="lazy"
            />
          )}
          {directImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- external provider-hosted still image, refreshed at source cadence; not a Next-optimizable local asset.
            <img
              src={directImageUrl}
              alt={`${feature.title} — road camera still image`}
              className="mt-1 w-full rounded border border-white/10"
              loading="lazy"
            />
          )}
          {viewerUrl && (
            <a href={viewerUrl} target="_blank" rel="noreferrer" className="mt-1 block rounded border border-white/15 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:border-cyan-400/60">
              View at source (HTML viewer)
            </a>
          )}
          <Row label="Attribution" value={CAMERA_ATTRIBUTION[feature.providerId] ?? feature.provenance.provider} />
        </>
      )
    }
    case 'traffic_event':
      return (
        <>
          {typeof feature.properties.eventType === 'string' && <Row label="Event type" value={feature.properties.eventType} />}
          {typeof feature.properties.severity === 'string' && <Row label="Severity (source)" value={feature.properties.severity} />}
          {typeof feature.properties.status === 'string' && <Row label="Status" value={feature.properties.status} />}
          {typeof feature.properties.road === 'string' && <Row label="Road" value={feature.properties.road} />}
          {typeof feature.properties.direction === 'string' && <Row label="Direction" value={feature.properties.direction} />}
          {typeof feature.properties.laneState === 'string' && <Row label="Lane state" value={feature.properties.laneState} />}
          {typeof feature.properties.isFullClosure === 'boolean' && <Row label="Full closure" value={feature.properties.isFullClosure ? 'Yes' : 'No'} />}
          <Row label="Geometry" value={feature.geometryKind === 'line' ? `Corridor (${feature.pathCoordinates?.length ?? 0} vertices)` : coords} mono={feature.geometryKind !== 'line'} />
          {feature.timestamp && <Row label="Last updated" value={new Date(feature.timestamp).toLocaleString()} />}
        </>
      )
    case 'traffic_flow_observation':
      // Phase 3: JARTIC (Japan) is volume-only and hourly with a ~2h publication lag — no speed
      // field exists (the source publishes counts only; inventing one would be fabrication), and
      // the recency label follows WebTRIS's honest "never live" pattern below.
      if (feature.providerId === 'jartic_traffic_volumes') {
        return (
          <>
            <Row label="Coordinates" value={coords} mono />
            {typeof feature.properties.siteId === 'string' && <Row label="Site" value={feature.properties.siteId} mono />}
            {typeof feature.properties.vehicleFlowCountUp === 'number' && <Row label="Hourly volume (up)" value={String(feature.properties.vehicleFlowCountUp)} />}
            {typeof feature.properties.vehicleFlowCountDown === 'number' && <Row label="Hourly volume (down)" value={String(feature.properties.vehicleFlowCountDown)} />}
            {typeof feature.properties.observationDateJst === 'string' && (
              <Row
                label="Observation (JST)"
                value={`${feature.properties.observationDateJst}${typeof feature.properties.observationHourBandJst === 'string' ? ` ${feature.properties.observationHourBandJst}` : ''}`}
              />
            )}
            <div className="flex justify-between"><dt>Data recency</dt><dd className="text-amber-400">HOURLY DATA — LAGS REAL TIME (~2 HOURS), NOT LIVE</dd></div>
            <Row label="Attribution" value="JARTIC (Japan Road Traffic Information Center)" />
          </>
        )
      }
      return (
        <>
          <Row label="Coordinates" value={coords} mono />
          {typeof feature.properties.road === 'string' && <Row label="Road" value={feature.properties.road} />}
          {typeof feature.properties.direction === 'string' && <Row label="Direction" value={feature.properties.direction} />}
          {typeof feature.properties.speedMph === 'number' && <Row label="Observed speed" value={`${feature.properties.speedMph} mph`} />}
          {typeof feature.properties.vehicleFlowCount === 'number' && <Row label="Observed vehicle flow" value={String(feature.properties.vehicleFlowCount)} />}
          <Row label="Free-flow baseline" value="Not supplied by source" />
          <div className="flex justify-between"><dt>Data recency</dt><dd className="text-amber-400">HISTORICAL — NOT LIVE</dd></div>
          {typeof feature.properties.reportDate === 'string' && <Row label="Report date" value={feature.properties.reportDate} />}
          <Row label="Attribution" value="National Highways, UK Open Government Licence" />
        </>
      )
    case 'road_weather_observation':
      return (
        <>
          <Row label="Coordinates" value={coords} mono />
          {typeof feature.properties.airTemperatureC === 'number' && <Row label="Air temperature" value={`${feature.properties.airTemperatureC}°C`} />}
          {typeof feature.properties.roadSurfaceTemperatureC === 'number' && <Row label="Road surface temperature" value={`${feature.properties.roadSurfaceTemperatureC}°C`} />}
          {typeof feature.properties.relativeHumidityPct === 'number' && <Row label="Relative humidity" value={`${feature.properties.relativeHumidityPct}%`} />}
          {typeof feature.properties.visibilityKm === 'number' && <Row label="Visibility" value={`${feature.properties.visibilityKm} km`} />}
          {typeof feature.properties.windAverageMs === 'number' && <Row label="Average wind" value={`${feature.properties.windAverageMs} m/s`} />}
          {typeof feature.properties.windDirectionDeg === 'number' && <Row label="Wind direction" value={`${feature.properties.windDirectionDeg}°`} />}
          {typeof feature.properties.precipitationIntensityMmH === 'number' && <Row label="Precipitation intensity" value={`${feature.properties.precipitationIntensityMmH} mm/h`} />}
          {typeof feature.properties.frictionCoefficient === 'number' && <Row label="Friction coefficient" value={String(feature.properties.frictionCoefficient)} />}
          {feature.timestamp && <Row label="Observed" value={new Date(feature.timestamp).toLocaleString()} />}
          <Row label="Attribution" value="Fintraffic / digitraffic.fi, CC BY 4.0" />
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
  hideControls = false,
}: {
  layer: TerraLayerSummary
  viewer: CesiumViewer | null
  selection: Selection
  onFeaturesChange: (layerId: string, features: TerraGeoFeature[]) => void
  timeMode: TerraTimeMode
  selectedTime: string
  timeWindow: TerraTimeWindow
  /** God's Eye command-center mode has no room for the layer-toggle/status control chrome, but
   * event markers must still fetch and render there (mission section 15: event click must work on
   * both surfaces) — this suppresses only the visible control UI below, never the
   * useTerraLayer fetch or the TerraFeatureLayer render, so it's the same single layer
   * implementation in both presentations, not a second one. */
  hideControls?: boolean
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

  if (hideControls) {
    return <TerraFeatureLayer layerId={layer.id} viewer={viewer} enabled={enabled} features={visibleFeatures} selectedId={selectedId} />
  }

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

// God's Eye multi-scale phase, mission section 10: a handful of real countries (the United
// States, Russia, France, Fiji, New Zealand — anywhere with territory on both sides of the
// antimeridian) have a Nominatim bounding box whose longitude span is at or near the full -180..
// 180 range — technically correct (the United States really does span it, via the Aleutians and
// Pacific territories), but flying the camera to fit it shows the whole planet, not "the
// country." Confirmed live against the real API during browser verification (searching "United
// States" returned west=-180, east=180). Recentered on the resolved point with a capped span
// rather than discarded — still real data, just framed usefully instead of literally globally.
const DEGENERATE_LONGITUDE_SPAN_DEG = 350
const RECENTERED_LONGITUDE_SPAN_DEG = 60

// Confirmed live during browser verification: searching an exact single-building address (the
// White House) returns a real Nominatim bbox only ~34m x ~53m (its building footprint).
// Cesium.Rectangle.fromDegrees + camera.flyTo fits that so tightly the resulting camera height
// sits below OSM's actual raster tile resolution — the result was a blank viewport, not a usable
// close-up. Padded to a minimum span (still centered on the real resolved point, never a
// different coordinate) so a building-sized result still produces a real, tile-covered view.
const MIN_RECTANGLE_SPAN_DEG = 0.004

function terraFlyToRectangleDegrees(target: TerraLocationTarget, boundingBox: NonNullable<TerraLocationTarget['boundingBox']>): { west: number; south: number; east: number; north: number } {
  const { south, north, west, east } = boundingBox
  if (east - west >= DEGENERATE_LONGITUDE_SPAN_DEG) {
    const half = RECENTERED_LONGITUDE_SPAN_DEG / 2
    return { west: target.longitude - half, south, east: target.longitude + half, north }
  }
  const halfMin = MIN_RECTANGLE_SPAN_DEG / 2
  return {
    west: Math.min(west, target.longitude - halfMin),
    east: Math.max(east, target.longitude + halfMin),
    south: Math.min(south, target.latitude - halfMin),
    north: Math.max(north, target.latitude + halfMin),
  }
}

/** Plain top-level helper (not inline in the component/effect body) for the same reason
 * useTerraClock.ts's applyTerraTimeToViewerClock is one: this repo's react-hooks/immutability
 * lint rule flags mutating a Cesium object reachable from a hook argument/useState value when
 * done inline inside a hook or component body, even via a read-only-looking property set. A
 * differently-named local parameter on a plain function outside that scope is the established
 * escape hatch — see components/war-room/terra/useTerraClock.ts's own comment on this. */
function applyTerraBuildingsVisibility(tileset: import('cesium').Cesium3DTileset, visible: boolean): void {
  tileset.show = visible
}

function TerraShellComponent({ presentation = 'workspace' }: { presentation?: 'workspace' | 'command-center' }) {
  const [globeStatus, setGlobeStatus] = useState<TerraGlobeStatus>({ phase: 'loading' })
  const [viewer, setViewer] = useState<CesiumViewer | null>(null)
  const [selection, setSelection] = useState<Selection>({ kind: 'none' })
  const [layerFeatures, setLayerFeatures] = useState<Record<string, TerraGeoFeature[]>>({})
  const { activeLocation, setActiveLocation, setSelectedEvent, setAircraftSummary, setMaritimeSummary } = useTerraActiveLocation()
  const reverseRequestRef = useRef<{ sequence: number; controller: AbortController | null }>({ sequence: 0, controller: null })

  useEffect(() => () => reverseRequestRef.current.controller?.abort(), [])

  // Phase 6: Terra's 4D clock — real Earth orientation/lighting follows viewer.clock.currentTime
  // (see TerraGlobe.tsx's enableLighting + useTerraClock.ts), which this hook is the only thing
  // that ever sets.
  const clock = useTerraClock(viewer)
  // Camera-only, deliberately separate from clock/time state — see useTerraCinematicOrbit.ts.
  const cinematic = useTerraCinematicOrbit(viewer, clock.time.mode === 'live')

  // God's Eye multi-scale phase: the one discrete camera-altitude signal gating 3D Buildings
  // visibility and the nearby-landmarks layer below — see useTerraCameraScale.ts for the
  // documented threshold reasoning.
  const cameraScale = useTerraCameraScale(viewer)
  const [buildingsTileset, setBuildingsTileset] = useState<import('cesium').Cesium3DTileset | null>(null)
  const isLocalScale = cameraScale.level === 'local' || cameraScale.level === 'building'

  // God's Eye Terra imagery phase: real detected outcome of the Cesium ion World Imagery (Bing
  // Maps Aerial) asset request in TerraEarthImagery.tsx — never assumed from token presence alone.
  // `mapDetailMode` is the Commander's explicit escape hatch to the OSM raster base.
  const [aerialImageryAvailable, setAerialImageryAvailable] = useState(false)
  const [mapDetailMode, setMapDetailMode] = useState(false)
  const highResAerialUnavailable = terraHighResAerialUnavailable(aerialImageryAvailable, cameraScale.level)

  // Cesium OSM Buildings' own internal LOD (maximumScreenSpaceError) already limits detail at any
  // given screen size, but `.show` is still gated on our own scale signal so the tileset never
  // requests a single tile while the Commander is at global/regional altitude.
  useEffect(() => {
    if (!buildingsTileset) return
    applyTerraBuildingsVisibility(buildingsTileset, isLocalScale)
  }, [buildingsTileset, isLocalScale])

  const [selectedWindowId, setSelectedWindowId] = useState('all')
  const selectedWindow: TerraTimeWindow = useMemo(() => TERRA_TIME_WINDOW_PRESETS.find(p => p.id === selectedWindowId)?.window ?? null, [selectedWindowId])

  const handleFeaturesChange = useCallback((layerId: string, features: TerraGeoFeature[]) => {
    setLayerFeatures(prev => (terraFeaturesShallowEqual(prev[layerId], features) ? prev : { ...prev, [layerId]: features }))
  }, [])

  const selectedFeature = useMemo(() => {
    if (selection.kind !== 'feature') return null
    return (layerFeatures[selection.layerId] ?? []).find(f => f.id === selection.featureId) ?? null
  }, [selection, layerFeatures])

  // Event -> exact-location intelligence phase, mission section 7/8: a bounded semantic query
  // built from the selected event's own title/kind plus (once resolved) its reverse-resolved
  // region — see lib/terra/eventIntelligenceQuery.ts. `null` (no event selected) skips the fetch
  // entirely, matching nearbyLandmarksQuery's identical "null = don't fetch" convention below. The
  // query string only changes on a real selection change or the resolving->resolved transition, so
  // this never re-fetches on camera pan/zoom/orbit/clock ticks.
  const relatedIntelligenceQuery = useMemo(() => {
    if (!selectedFeature) return null
    return buildTerraEventIntelligenceQuery(selectedFeature, activeLocation)
  }, [selectedFeature, activeLocation])
  const relatedIntelligence = useTerraRelatedIntelligence(relatedIntelligenceQuery)

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

  // God's Eye multi-scale phase, mission section 8/9: nearby landmarks/attractions/POIs, bounded
  // to the Commander's active location (never a global query) and gated to city/local/building
  // camera scale (never fetched at global/regional altitude). Anchored to `activeLocation` — a
  // deliberate Commander click or search — rather than a continuously-recentering camera target,
  // matching Earth Knowledge's existing "active location" semantics and, as a direct consequence,
  // already satisfying "debounced camera-settle": panning the camera alone never changes
  // `activeLocation`, so this never issues a request while the camera is merely moving.
  const nearbyLandmarksQuery = useMemo(() => {
    if (!activeLocation) return null
    if (cameraScale.level !== 'city' && cameraScale.level !== 'local' && cameraScale.level !== 'building') return null
    const radiusKm = cameraScale.level === 'city' ? 5 : cameraScale.level === 'local' ? 1.5 : 0.5
    return `category:landmark near ${activeLocation.latitude},${activeLocation.longitude},${radiusKm}`
  }, [activeLocation, cameraScale.level])
  const nearbyLandmarksAutoRefreshAllowed = shouldAutoRefreshTerraLayer(clock.time.mode)
  const nearbyLandmarks = useTerraLayer('nearby_landmarks', nearbyLandmarksQuery !== null, undefined, nearbyLandmarksAutoRefreshAllowed, nearbyLandmarksQuery)
  useEffect(() => {
    // Deferred a tick — see useTerraLayer.ts's own identical kickoff pattern for why: this repo's
    // lint rules treat a setState call reachable by direct static analysis from an effect body as
    // a cascading-render risk (TerraLayerRow's analogous `onFeaturesChange(...)` call is exempt
    // only because it receives that setter through an opaque prop the analyzer can't see into).
    const timeout = setTimeout(() => handleFeaturesChange('nearby_landmarks', nearbyLandmarks.features), 0)
    return () => clearTimeout(timeout)
  }, [nearbyLandmarks.features, handleFeaturesChange])
  const nearbySelectedId = selection.kind === 'feature' && selection.layerId === 'nearby_landmarks' ? selection.featureId : null

  // Live-aviation phase, mission section 5: the Commander's live camera view rectangle, recomputed
  // only on a real camera.moveEnd (see useTerraCameraViewRectangle.ts) — the bbox-query analogue of
  // nearbyLandmarksQuery's point+radius above.
  const cameraViewRectangle = useTerraCameraViewRectangle(viewer)
  // Off by default in the full workspace (every non-earthquake layer's "deliberate Commander
  // action" convention — see DEFAULT_ENABLED_LAYER_IDS above); on by default in the God's Eye
  // command center specifically, since that surface has no Data Layers toggle UI at all and the
  // mission requires real aircraft visible there without a manual step (mirrors why
  // usgs_earthquake_feed alone is grandfathered into DEFAULT_ENABLED_LAYER_IDS).
  const [aircraftEnabled, setAircraftEnabled] = useState(() => presentation === 'command-center')
  // Gated off entirely at global camera scale (never a world-sized bbox query — mission section
  // 5/16) and null while the layer is off, matching every other layer's "null query = don't fetch"
  // convention. lib/terra/aircraftBoundingBox.ts applies its own span/validity backstop on top of
  // this scale gate.
  const aircraftBoundingBoxQuery = useMemo(() => {
    if (!aircraftEnabled) return null
    if (cameraScale.level === 'global') return null
    return buildTerraAircraftBoundingBoxQuery(cameraViewRectangle.rectangle)
  }, [aircraftEnabled, cameraScale.level, cameraViewRectangle.rectangle])
  const aircraftAutoRefreshAllowed = shouldAutoRefreshTerraLayer(clock.time.mode)
  // 60s — matched to (never faster than) the Research Engine's own live-feed cache TTL for
  // opensky and this repo's no-layer-faster-than-60s floor; see layerCatalog.ts's opensky entry.
  const aircraft = useTerraLayer('opensky', aircraftBoundingBoxQuery !== null, 60_000, aircraftAutoRefreshAllowed, aircraftBoundingBoxQuery)
  useEffect(() => {
    const timeout = setTimeout(() => handleFeaturesChange('opensky', aircraft.features), 0)
    return () => clearTimeout(timeout)
  }, [aircraft.features, handleFeaturesChange])
  const aircraftSelectedId = selection.kind === 'feature' && selection.layerId === 'opensky' ? selection.featureId : null
  // Session-only trail, never a provider historical track — see lib/terra/aircraftTrail.ts.
  const aircraftTrails = useTerraAircraftTrails(aircraft.features, aircraftBoundingBoxQuery !== null)
  // Bounded, honest Observed Data summary — never the raw feed itself — handed to the existing
  // Council semantic-context extension point below.
  const aircraftRegionalSummary = useMemo(
    () => summarizeTerraAircraftFeatures(aircraft.features, clock.time.currentTime),
    [aircraft.features, clock.time.currentTime],
  )
  useEffect(() => {
    const timeout = setTimeout(() => setAircraftSummary(aircraftBoundingBoxQuery !== null ? aircraftRegionalSummary : null), 0)
    return () => clearTimeout(timeout)
  }, [aircraftRegionalSummary, aircraftBoundingBoxQuery, setAircraftSummary])

  // Terra Phase 3 — Maritime Source Federation. Mirrors the aircraft block above exactly, with one
  // architectural addition: the Maritime Coverage Resolver (lib/terra/maritimeBoundingBox.ts's
  // terraCameraViewHasMaritimeCoverage + buildTerraMaritimeBoundingBoxQuery), since
  // digitraffic_marine's coverage is a specific, bounded region (Finnish waters), not a genuine
  // global feed like OpenSky — a camera view outside that region must produce NO_COVERAGE, never
  // "0 vessels observed" (see lib/terra/maritimeCoverage.ts).
  const [maritimeEnabled, setMaritimeEnabled] = useState(() => presentation === 'command-center')
  const maritimeHasCoverage = useMemo(() => terraCameraViewHasMaritimeCoverage(cameraViewRectangle.rectangle), [cameraViewRectangle.rectangle])
  const maritimeBoundingBoxQuery = useMemo(() => {
    if (!maritimeEnabled) return null
    if (cameraScale.level === 'global') return null
    return buildTerraMaritimeBoundingBoxQuery(cameraViewRectangle.rectangle)
  }, [maritimeEnabled, cameraScale.level, cameraViewRectangle.rectangle])
  const maritimeAutoRefreshAllowed = shouldAutoRefreshTerraLayer(clock.time.mode)
  // 60s — matched to (never faster than) the Research Engine's own live-feed cache TTL for
  // digitraffic_marine and this repo's no-layer-faster-than-60s floor; see layerCatalog.ts's
  // digitraffic_marine entry.
  const maritime = useTerraLayer('digitraffic_marine', maritimeBoundingBoxQuery !== null, 60_000, maritimeAutoRefreshAllowed, maritimeBoundingBoxQuery)
  useEffect(() => {
    const timeout = setTimeout(() => handleFeaturesChange('digitraffic_marine', maritime.features), 0)
    return () => clearTimeout(timeout)
  }, [maritime.features, handleFeaturesChange])
  const maritimeSelectedId = selection.kind === 'feature' && selection.layerId === 'digitraffic_marine' ? selection.featureId : null
  // Session-only trail, never a provider historical track — see lib/terra/aircraftTrail.ts (the
  // point-bounding logic useTerraVesselTrails.ts reuses).
  const maritimeTrails = useTerraVesselTrails(maritime.features, maritimeBoundingBoxQuery !== null)
  const maritimeCoverageState = useMemo(
    () => resolveTerraMaritimeCoverageState({
      hasKnownCoverage: maritimeHasCoverage,
      boundingBoxQuery: maritimeBoundingBoxQuery,
      feedState: maritime.state,
      lastErrorMessage: maritime.lastErrorMessage,
    }),
    [maritimeHasCoverage, maritimeBoundingBoxQuery, maritime.state, maritime.lastErrorMessage],
  )
  // Bounded, honest Observed Data summary — never the raw feed itself — handed to the existing
  // Council semantic-context extension point below, alongside the coverage-truth state so Council
  // can never mistake NO_COVERAGE for a genuinely empty region.
  const maritimeRegionalSummary = useMemo(
    () => summarizeTerraVesselFeatures(maritime.features, clock.time.currentTime),
    [maritime.features, clock.time.currentTime],
  )
  useEffect(() => {
    // Gated on maritimeBoundingBoxQuery !== null — the exact same condition the aircraft summary
    // effect above uses (never just the maritimeEnabled toggle). This matters beyond consistency:
    // useTerraLayer.ts returns a brand-new `[]` literal for `features` on every render while
    // `enabled` is false, so summarizeTerraVesselFeatures (and this object literal) would otherwise
    // never stop producing a fresh non-null value once maritimeEnabled is true, and setState would
    // never see two `Object.is`-equal values to stop re-rendering on — confirmed live during
    // browser verification as a real "Maximum update depth exceeded" loop before this fix.
    const timeout = setTimeout(() => setMaritimeSummary(maritimeBoundingBoxQuery !== null ? { regional: maritimeRegionalSummary, coverageState: maritimeCoverageState } : null), 0)
    return () => clearTimeout(timeout)
  }, [maritimeRegionalSummary, maritimeCoverageState, maritimeBoundingBoxQuery, setMaritimeSummary])

  // God's Eye Traffic & Camera Intelligence phases (1/2/3): all 13 bounded-coverage traffic
  // layers — including the 7 Phase 3 layers from lib/terra/PHASE3_HANDOFF_UI_LANE.md — are wired
  // through the single generic TerraTrafficLayer component (see terraTrafficLayerDefs.ts), each
  // owning its own enabled state, bbox-gated query, useTerraLayer fetch, coverage-truth badge,
  // and TerraFeatureLayer render. They report features up through the same handleFeaturesChange
  // every other layer uses, so selection, the hazard summary, and the hover preview below work
  // identically for all of them.

  // Phase 3 camera hover preview: raw hover signal from TerraGlobe's MOUSE_MOVE pick (composite
  // "{layerId}:{featureId}" + canvas-relative position), resolved to a real traffic_camera feature
  // below. Imagery fetch policy (dwell-gated, never preloaded) lives in TerraCameraHoverCard.
  const [cameraHover, setCameraHover] = useState<{ compositeId: string; x: number; y: number } | null>(null)
  const handleEntityHover = useCallback((compositeId: string | null, position: { x: number; y: number } | null) => {
    setCameraHover(compositeId && position ? { compositeId, x: position.x, y: position.y } : null)
  }, [])
  // A camera move invalidates the anchored screen position — dismiss rather than leave a stale
  // card. Compared by the rectangle's own value (not object identity) via a ref-guarded effect —
  // mirroring TerraTrafficLayer's layerCoverage publisher — so a wrapper object recreated without
  // the underlying view actually changing can never re-trigger this or cascade into a render loop.
  const cameraRectSignature = terraCameraRectSignature(cameraViewRectangle.rectangle)
  const lastCameraRectSignatureRef = useRef(cameraRectSignature)
  useEffect(() => {
    if (lastCameraRectSignatureRef.current === cameraRectSignature) return
    lastCameraRectSignatureRef.current = cameraRectSignature
    setCameraHover(prev => (prev !== null ? null : prev))
  }, [cameraRectSignature])
  const hoveredCameraFeature = useMemo(() => {
    if (!cameraHover) return null
    const separatorIndex = cameraHover.compositeId.indexOf(':')
    if (separatorIndex === -1) return null
    const layerId = cameraHover.compositeId.slice(0, separatorIndex)
    const featureId = cameraHover.compositeId.slice(separatorIndex + 1)
    const feature = (layerFeatures[layerId] ?? []).find(item => item.id === featureId)
    return feature && feature.kind === 'traffic_camera' ? feature : null
  }, [cameraHover, layerFeatures])

  const activateCoordinate = useCallback((point: Extract<TerraClickPoint, { ok: true }>) => {
    reverseRequestRef.current.controller?.abort()
    const controller = new AbortController()
    const sequence = reverseRequestRef.current.sequence + 1
    reverseRequestRef.current = { sequence, controller }
    const selectedAt = new Date().toISOString()
    const coordinateLabel = `${point.latitude.toFixed(4)}°, ${point.longitude.toFixed(4)}°`
    const pending: TerraActiveLocation = {
      latitude: point.latitude,
      longitude: point.longitude,
      height: point.height,
      hasTerrainHeight: point.hasTerrainHeight,
      label: coordinateLabel,
      place: null,
      address: null,
      region: null,
      source: 'coordinates',
      sourceLabel: 'Commander-selected coordinates',
      sourceUrl: null,
      status: 'resolving',
      confidence: 'coordinate_only',
      detail: 'Exact coordinate is active while reverse geocoding resolves the supported place or address.',
      selectedAt,
    }
    setActiveLocation(pending)

    const params = new URLSearchParams({ lat: String(point.latitude), lon: String(point.longitude) })
    if (point.height !== null) params.set('height', String(point.height))
    if (point.hasTerrainHeight) params.set('terrain', '1')
    void fetch(`/api/terra/resolve-location?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Resolver returned HTTP ${response.status}.`)
        return response.json() as Promise<TerraReverseLocationResolution>
      })
      .then(result => {
        if (isTerraRequestStale(sequence, reverseRequestRef.current.sequence)) return
        setActiveLocation({ ...result.location, selectedAt })
      })
      .catch(error => {
        if (controller.signal.aborted || isTerraRequestStale(sequence, reverseRequestRef.current.sequence)) return
        setActiveLocation({ ...pending, status: 'coordinate_only', detail: `Reverse geocoding unavailable: ${error instanceof Error ? error.message : String(error)}` })
      })
  }, [setActiveLocation])

  const handleGroundClick = useCallback((point: TerraClickPoint) => {
    setSelection(point.ok ? { kind: 'ground', point } : { kind: 'miss' })
    // A ground click is Earth Knowledge-only (mission section 14) — never the full
    // event-intelligence path, so any previously selected event/Related Intelligence context is
    // cleared rather than left stale alongside a now-unrelated active location.
    setSelectedEvent(null)
    if (point.ok) activateCoordinate(point)
  }, [activateCoordinate, setSelectedEvent])

  // Event -> exact-location intelligence phase: flies the Cesium camera to the event's own
  // observed coordinates (never a re-geocoded or inferred position — see
  // lib/terra/eventCameraFraming.ts), framed by kind/geometry rather than one fixed altitude for
  // every event. A destroyed/not-yet-ready viewer is a legitimate skip, not an error — the
  // observed-data panel and reverse-geocoded Earth Knowledge context remain available regardless.
  const flyToEventFeature = useCallback((feature: TerraGeoFeature) => {
    if (!viewer || viewer.isDestroyed()) return
    const framing = resolveTerraEventCameraFraming(feature)
    void loadCesium().then(Cesium => {
      if (viewer.isDestroyed()) return
      if (framing.mode === 'rectangle') {
        viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(framing.west, framing.south, framing.east, framing.north), duration: 1.8 })
      } else {
        viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(framing.longitude, framing.latitude, framing.altitudeMeters), duration: 1.8 })
      }
    })
  }, [viewer])

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
    const feature = (layerFeatures[layerId] ?? []).find(item => item.id === featureId)
    if (feature) {
      // The event's own observed coordinates remain authoritative for both Earth Knowledge
      // reverse-resolution and camera targeting — never re-geocoded or inferred from anywhere else.
      activateCoordinate({ ok: true, latitude: feature.latitude, longitude: feature.longitude, height: feature.altitude, hasTerrainHeight: false })
      setSelectedEvent(feature)
      flyToEventFeature(feature)
    }
  }, [activateCoordinate, layerFeatures, setSelectedEvent, flyToEventFeature])

  const handleResolvedLocation = useCallback((target: TerraLocationTarget) => {
    reverseRequestRef.current.controller?.abort()
    reverseRequestRef.current = { sequence: reverseRequestRef.current.sequence + 1, controller: null }
    setActiveLocation({
      latitude: target.latitude,
      longitude: target.longitude,
      height: null,
      hasTerrainHeight: false,
      label: target.label,
      place: target.source === 'nominatim' ? target.label : null,
      address: target.source === 'nominatim' ? target.label : null,
      region: null,
      source: target.source,
      sourceLabel: target.source === 'nominatim' ? 'OpenStreetMap Nominatim' : 'Commander-selected coordinates',
      sourceUrl: null,
      status: target.source === 'nominatim' ? 'resolved' : 'coordinate_only',
      confidence: target.source === 'nominatim' ? 'provider_supported' : 'coordinate_only',
      detail: target.source === 'nominatim' ? 'Provider-supported typed-location match; no numeric confidence was supplied.' : 'Exact typed coordinates; reverse place context was not requested.',
      selectedAt: new Date().toISOString(),
    })
    if (!viewer || viewer.isDestroyed()) return
    void loadCesium().then(Cesium => {
      if (viewer.isDestroyed()) return
      // God's Eye multi-scale phase, mission section 10: fly to a destination SIZED to what was
      // actually found, using Nominatim's own result bounding box — a real country's bbox is
      // large (camera settles far out), a single address/building's bbox is tiny (camera settles
      // close in) — rather than one fixed altitude for every search result. A typed bare
      // coordinate (no resolver involved, so no bbox) falls back to a close/local-scale altitude,
      // since a Commander typing exact lat,lon is almost always pointing at one specific spot.
      if (target.boundingBox) {
        const { west, south, east, north } = terraFlyToRectangleDegrees(target, target.boundingBox)
        viewer.camera.flyTo({
          destination: Cesium.Rectangle.fromDegrees(west, south, east, north),
          duration: 1.8,
        })
      } else {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(target.longitude, target.latitude, 3_000),
          duration: 1.8,
        })
      }
    })
  }, [setActiveLocation, viewer])

  const commandCenter = presentation === 'command-center'

  return (
    <div className={`relative w-full overflow-hidden bg-black text-white ${commandCenter ? 'h-full min-h-0' : 'h-screen'}`}>
      <TerraGlobe onStatusChange={setGlobeStatus} onViewerReady={setViewer} onBuildingsTilesetReady={setBuildingsTileset} onEntityClick={handleEntityClick} onGroundClick={handleGroundClick} onEntityHover={handleEntityHover} />
      <TerraEarthImagery
        viewer={viewer}
        selectedTime={clock.time.currentTime}
        hasIonToken={globeStatus.phase === 'ready' && globeStatus.hasIonToken}
        mapDetailMode={mapDetailMode}
        onAerialImageryAvailabilityChange={setAerialImageryAvailable}
      />
      <TerraFeatureLayer layerId="nearby_landmarks" viewer={viewer} enabled={nearbyLandmarksQuery !== null} features={nearbyLandmarks.features} selectedId={nearbySelectedId} cluster />
      {/* Live-aviation phase: rendered unconditionally in both presentations (mission section 15
          requires event click/selection to work on both the front-page God's Eye and the full
          /terra workspace) — `cluster` so a dense region simplifies at broad zoom instead of
          becoming an overlapping-marker mess (mission section 3/14). */}
      <TerraFeatureLayer layerId="opensky" viewer={viewer} enabled={aircraftBoundingBoxQuery !== null} features={aircraft.features} selectedId={aircraftSelectedId} cluster trails={aircraftTrails} />
      {/* Terra Phase 3 — Maritime Source Federation: same bespoke camera-bbox-driven pattern as
          aircraft above, rendered unconditionally in both presentations for the same reason. */}
      <TerraFeatureLayer layerId="digitraffic_marine" viewer={viewer} enabled={maritimeBoundingBoxQuery !== null} features={maritime.features} selectedId={maritimeSelectedId} cluster trails={maritimeTrails} />
      {/* God's Eye Traffic phases 1–3: all 13 bounded-coverage traffic layers render through the
          one generic TerraTrafficLayer (terraTrafficLayerDefs.ts). In the full workspace the
          toggle/status rows live in the Data Layers rail below (the {!commandCenter} mount);
          here in command-center mode the same components mount headless (hideControls) so event
          markers still fetch and render — the two mounts are mutually exclusive, so no layer is
          ever fetched twice. */}
      {commandCenter && TERRA_TRAFFIC_LAYER_DEFS.map(def => (
        <TerraTrafficLayer
          key={def.layerId}
          def={def}
          viewer={viewer}
          selection={selection}
          onFeaturesChange={handleFeaturesChange}
          timeMode={clock.time.mode}
          cameraScaleLevel={cameraScale.level}
          rectangle={cameraViewRectangle.rectangle}
          defaultEnabled
          hideControls
        />
      ))}
      {/* Phase 3 camera hover preview — screen-anchored card near the hovered traffic_camera
          entity; click-through opens the same full detail panel a marker click does. */}
      {hoveredCameraFeature && cameraHover && (
        <TerraCameraHoverCard
          key={hoveredCameraFeature.id}
          feature={hoveredCameraFeature}
          x={cameraHover.x}
          y={cameraHover.y}
          onOpen={() => {
            const compositeId = cameraHover.compositeId
            setCameraHover(null)
            handleEntityClick(compositeId)
          }}
          onDismiss={() => setCameraHover(null)}
        />
      )}

      {/* God's Eye command center has no Data Layers control panel (see the workspace-only left
          rail below), but its event markers must still fetch and render — otherwise there is
          nothing on the front-page globe to click, and the entire event-intelligence flow would
          be workspace-only despite mission section 15 requiring both surfaces. Same TerraLayerRow
          component as the workspace's own layer list, just headless (hideControls) here; the two
          mounts are mutually exclusive with `!commandCenter` below, so no layer is ever fetched
          twice. */}
      {commandCenter && TERRA_LAYER_SUMMARIES.filter(layer => layer.id !== 'opensky' && layer.id !== 'digitraffic_marine' && !TERRA_TRAFFIC_LAYER_DEFS.some(def => def.layerId === layer.id)).map(layer => (
        <TerraLayerRow
          key={layer.id}
          layer={layer}
          viewer={viewer}
          selection={selection}
          onFeaturesChange={handleFeaturesChange}
          timeMode={clock.time.mode}
          selectedTime={clock.time.currentTime}
          timeWindow={selectedWindow}
          hideControls
        />
      ))}

      {/* Top instrumentation bar — mission status + identity + real hazard summary. */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 ${commandCenter ? 'p-3 pr-[48%]' : 'p-4'}`}>
        <div className="pointer-events-auto rounded border border-white/10 bg-black/70 px-3 py-2 backdrop-blur-sm">
          <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-400">{commandCenter ? 'God’s Eye · Terra' : 'War Room · Terra'}</h1>
          <p className="mt-0.5 text-[10px] text-slate-500">{commandCenter ? 'Live planetary command center' : 'Planetary Intelligence Environment — Phase 6: real-time planet + 4D time engine'}</p>
          {highResAerialUnavailable && (
            <button
              type="button"
              onClick={() => setMapDetailMode(v => !v)}
              className="mt-1.5 flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-950/40 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-amber-300 hover:bg-amber-900/50"
              title="NASA GIBS is a real daily photograph capped at city-scale resolution; no ion-backed aerial asset is available at this zoom. Toggle the OSM map-detail base instead."
            >
              {TERRA_HIGH_RES_AERIAL_UNAVAILABLE_MESSAGE}
              <span className="text-cyan-300">{mapDetailMode ? TERRA_CLOSE_MAP_DETAIL_LABEL : TERRA_OPEN_MAP_DETAIL_LABEL}</span>
            </button>
          )}
        </div>
        {!commandCenter && <div className="pointer-events-auto flex flex-wrap justify-center gap-x-4 gap-y-1 rounded border border-white/10 bg-black/70 px-3 py-2 text-[10px] backdrop-blur-sm">
          {hazardSummary.map(item => (
            <span key={item.label} className="whitespace-nowrap">
              <span className="text-slate-500">{item.label} </span>
              <span className="font-mono font-bold text-emerald-400">{item.value}</span>
            </span>
          ))}
        </div>}
        {!commandCenter && <div className="pointer-events-auto rounded border border-white/10 bg-black/70 px-3 py-2 text-[11px] backdrop-blur-sm">
          <StatusLine status={globeStatus} aerialImageryActive={aerialImageryAvailable} />
        </div>}
      </div>

      <div className={`absolute left-3 top-[4.5rem] z-20 ${commandCenter ? 'w-[min(31rem,48%)]' : 'left-1/2 w-[min(34rem,44vw)] -translate-x-1/2'}`}>
        <TerraLocationCommandInput onResolvedLocation={handleResolvedLocation} />
        {commandCenter && <TerraEarthKnowledgePanel location={activeLocation} onDismiss={() => setActiveLocation(null)} nearby={{ active: nearbyLandmarksQuery !== null, state: nearbyLandmarks.state, features: nearbyLandmarks.features }} compact />}
        {/* God's Eye command center has no right rail (see below), so Related Intelligence for an
            event selection folds in here, directly under Earth Knowledge — same semantic behavior
            as the full /terra workspace's right-rail panel, just a different layout slot. */}
        {commandCenter && selectedFeature && (
          <div className="mt-2">
            <TerraRelatedIntelligencePanel feed={relatedIntelligence} active compact />
          </div>
        )}
      </div>

      {commandCenter ? (
        <div className="pointer-events-none absolute bottom-12 left-3 z-30">
          <TerraProviderCapabilityDock
            localDetailActive={isLocalScale}
            buildingsActive={globeStatus.phase === 'ready' && globeStatus.hasOsmBuildings}
            aerialImageryActive={aerialImageryAvailable}
            mapDetailMode={mapDetailMode}
            onToggleMapDetail={() => setMapDetailMode(v => !v)}
          />
        </div>
      ) : null}

      {/* Left rail — layer controls + Earth Knowledge placeholder. */}
      {!commandCenter && <div className="pointer-events-none absolute bottom-36 left-0 top-20 flex w-72 flex-col gap-2 overflow-y-auto overscroll-contain p-4">
        <div className="pointer-events-auto rounded border border-white/10 bg-black/60 p-3 backdrop-blur-sm">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-cyan-400/80">Layer Controls</p>
          <ul className="space-y-1 text-[11px] text-slate-400">
            <li className="flex items-center justify-between">
              <span>Camera scale</span>
              <span className="font-mono uppercase text-emerald-400">{cameraScale.level}</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Base imagery + clouds</span>
              <span className="text-emerald-400">NASA GIBS True Color · daily</span>
            </li>
            <li className={`flex items-center justify-between ${aerialImageryAvailable ? '' : 'opacity-40'}`}>
              <span>Aerial (ion World Imagery)</span>
              <span>{aerialImageryAvailable ? 'active · close-range' : 'unavailable'}</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Map detail (OSM)</span>
              <button type="button" onClick={() => setMapDetailMode(v => !v)} className={mapDetailMode ? 'font-bold text-cyan-300' : 'text-slate-400 hover:text-slate-200'}>
                {mapDetailMode ? 'on' : 'off'}
              </button>
            </li>
            <li className={`flex items-center justify-between ${globeStatus.phase === 'ready' && globeStatus.hasIonToken ? '' : 'opacity-40'}`}>
              <span>Terrain (Cesium World Terrain)</span>
              <span>{globeStatus.phase === 'ready' && globeStatus.hasIonToken ? 'active' : 'fallback'}</span>
            </li>
            <li className={`flex items-center justify-between ${globeStatus.phase === 'ready' && globeStatus.hasOsmBuildings ? '' : 'opacity-40'}`}>
              <span>3D Buildings (Cesium OSM Buildings)</span>
              <span>{globeStatus.phase === 'ready' && globeStatus.hasOsmBuildings ? (isLocalScale ? 'active' : 'ready · zoom in') : 'unavailable'}</span>
            </li>
            <li className={`flex items-center justify-between ${nearbyLandmarksQuery !== null ? '' : 'opacity-40'}`}>
              <span>Nearby Landmarks & POIs</span>
              <span>{nearbyLandmarksQuery === null ? 'zoom in + select a location' : nearbyLandmarks.state}</span>
            </li>
            <li className={`flex items-center justify-between opacity-40 ${isLocalScale ? '' : 'hidden'}`}>
              <span>Street-level photography</span>
              <span className="text-right text-[9px] leading-tight">{TERRA_STREET_LEVEL_IMAGERY_MESSAGE}</span>
            </li>
          </ul>
        </div>

        <div className="pointer-events-auto">
          <TerraEarthKnowledgePanel location={activeLocation} onDismiss={() => setActiveLocation(null)} nearby={{ active: nearbyLandmarksQuery !== null, state: nearbyLandmarks.state, features: nearbyLandmarks.features }} />
        </div>

        <div className="pointer-events-auto max-h-[34vh] overflow-y-auto rounded border border-white/10 bg-black/60 p-3 backdrop-blur-sm">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-400/80">Data Layers</p>
          {LAYER_GROUPS.map(group => {
            // 'opensky' and 'digitraffic_marine' are deliberately excluded here — each gets its
            // own bespoke, camera-bbox-driven section below (a fixed default-query toggle wouldn't
            // make sense for a layer whose whole point is following the Commander's live view),
            // never a second listing of the same layer.
            const layers = TERRA_LAYER_SUMMARIES.filter(layer => group.domains.includes(layer.domain) && layer.id !== 'opensky' && layer.id !== 'digitraffic_marine' && !TERRA_TRAFFIC_LAYER_DEFS.some(def => def.layerId === layer.id))
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

          {/* Live-aviation phase: bespoke, not a TerraLayerRow — its query is the Commander's live
              camera view (lib/terra/aircraftBoundingBox.ts), not a fixed defaultQueryText, so a
              generic on/off-against-one-default-query row doesn't fit this layer. */}
          <div className="mt-2 border-t border-white/10 pt-2">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Aviation</p>
            <div className="mt-1 border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300">Aircraft (OpenSky)</span>
                <button
                  type="button"
                  onClick={() => setAircraftEnabled(prev => !prev)}
                  className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                    aircraftEnabled ? 'border-emerald-400/60 text-emerald-400' : 'border-white/20 text-slate-500'
                  }`}
                  aria-pressed={aircraftEnabled}
                >
                  {aircraftEnabled ? 'On' : 'Off'}
                </button>
              </div>
              {aircraftEnabled && (
                <div className="mt-1 space-y-1">
                  {/* Checks the exact same condition useTerraLayer is actually gated on
                      (aircraftBoundingBoxQuery === null) — not just cameraScale.level === 'global'
                      — so this message can never claim "LIVE" while lib/terra/aircraftBoundingBox
                      .ts has honestly refused to build a query for some other reason (e.g. a
                      shallow viewing angle whose visible-region rectangle exceeds
                      MAX_BBOX_SPAN_DEG even at a non-global camera scale level). Confirmed live
                      during browser verification: this exact mismatch let the status line show
                      "LIVE" while no real query had ever been sent. */}
                  {aircraftBoundingBoxQuery === null ? (
                    <p className="text-[10.5px] text-amber-300/90">Zoom in, or pan to a smaller region — the current view is too wide for a bounded aircraft query.</p>
                  ) : (
                    <>
                      <p className={`text-[10px] font-bold uppercase tracking-widest ${FEED_STATE_LABEL[aircraft.state]?.color ?? 'text-slate-400'}`}>
                        {FEED_STATE_LABEL[aircraft.state]?.text ?? 'LOADING…'}
                      </p>
                      <p className="text-[10.5px] text-slate-500">
                        {aircraftRegionalSummary.totalCount} aircraft
                        {aircraftRegionalSummary.totalCount > 0 && ` · ${aircraftRegionalSummary.airborneCount} airborne · ${aircraftRegionalSummary.onGroundCount} on ground`}
                        {aircraftRegionalSummary.staleCount > 0 && ` · ${aircraftRegionalSummary.staleCount} stale`}
                      </p>
                      {aircraft.lastFetchedAt && <p className="text-[10.5px] text-slate-500">Last fetched: {new Date(aircraft.lastFetchedAt).toLocaleTimeString()}</p>}
                      {aircraft.lastErrorMessage && <p className="text-[10.5px] text-red-400">{aircraft.lastErrorMessage}</p>}
                      <button
                        type="button"
                        onClick={aircraft.refresh}
                        className="mt-0.5 rounded border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300 hover:border-emerald-400/60 hover:text-emerald-400"
                      >
                        Refresh now
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Terra Phase 3 — Maritime Source Federation: same bespoke pattern as Aviation above.
              The coverage-truth state (lib/terra/maritimeCoverage.ts) is checked and rendered
              FIRST, before the generic feed state — a NO_COVERAGE region must never be shown as
              "LIVE — NO EVENTS" the way FEED_STATE_LABEL's generic 'empty' mapping would read. */}
          <div className="mt-2 border-t border-white/10 pt-2">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Maritime</p>
            <div className="mt-1 border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300">Vessels (Digitraffic — Finnish Waters)</span>
                <button
                  type="button"
                  onClick={() => setMaritimeEnabled(prev => !prev)}
                  className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                    maritimeEnabled ? 'border-emerald-400/60 text-emerald-400' : 'border-white/20 text-slate-500'
                  }`}
                  aria-pressed={maritimeEnabled}
                >
                  {maritimeEnabled ? 'On' : 'Off'}
                </button>
              </div>
              {maritimeEnabled && (
                <div className="mt-1 space-y-1">
                  {cameraScale.level === 'global' ? (
                    <p className="text-[10.5px] text-amber-300/90">Zoom in, or pan to a smaller region — the current view is too wide for a bounded vessel query.</p>
                  ) : maritimeCoverageState === 'NO_COVERAGE' ? (
                    <p className="text-[10.5px] text-amber-300/90">No registered AIS source covers this region (currently: Finnish territorial waters/EEZ only). This is a coverage gap, not a claim that no vessels are present.</p>
                  ) : (
                    <>
                      {/* Maritime's richer bespoke states surface through the same shared badge
                          as every traffic layer — one coherent coverage-truth visual model. */}
                      <TerraCoverageBadge state={MARITIME_COVERAGE_BADGE_STATE[maritimeCoverageState]} label={TERRA_MARITIME_COVERAGE_LABELS[maritimeCoverageState]} />
                      <p className="text-[10.5px] text-slate-500">
                        {maritimeRegionalSummary.totalCount} vessel{maritimeRegionalSummary.totalCount === 1 ? '' : 's'}
                        {maritimeRegionalSummary.totalCount > 0 && ` · ${maritimeRegionalSummary.movingCount} moving · ${maritimeRegionalSummary.stationaryCount} stationary`}
                        {maritimeRegionalSummary.staleCount > 0 && ` · ${maritimeRegionalSummary.staleCount} stale`}
                      </p>
                      {maritime.lastFetchedAt && <p className="text-[10.5px] text-slate-500">Last fetched: {new Date(maritime.lastFetchedAt).toLocaleTimeString()}</p>}
                      {maritime.lastErrorMessage && <p className="text-[10.5px] text-red-400">{maritime.lastErrorMessage}</p>}
                      <button
                        type="button"
                        onClick={maritime.refresh}
                        className="mt-0.5 rounded border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300 hover:border-emerald-400/60 hover:text-emerald-400"
                      >
                        Refresh now
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* God's Eye Traffic phases 1–3: all 13 bounded-coverage traffic layers (6 Phase 1/2 +
              7 Phase 3) render through the one generic TerraTrafficLayer — each owns its own
              toggle, camera-view-bbox query (gated on camera scale AND the source's real coverage
              envelope), useTerraLayer fetch, shared coverage-truth badge, and TerraFeatureLayer
              render. The same components mount headless in command-center mode above; the two
              mounts are mutually exclusive, so no layer is ever fetched twice. */}
          <div className="mt-2 border-t border-white/10 pt-2">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Traffic</p>
            {TERRA_TRAFFIC_LAYER_DEFS.map(def => (
              <TerraTrafficLayer
                key={def.layerId}
                def={def}
                viewer={viewer}
                selection={selection}
                onFeaturesChange={handleFeaturesChange}
                timeMode={clock.time.mode}
                cameraScaleLevel={cameraScale.level}
                rectangle={cameraViewRectangle.rectangle}
                defaultEnabled={false}
              />
            ))}
          </div>
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
      </div>}

      {/* Right rail — Live Council dock + selected-feature / provenance panel. */}
      {!commandCenter && <div className="pointer-events-none absolute right-0 top-20 flex w-72 flex-col gap-2 p-4">
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
              <button type="button" onClick={() => { setSelection({ kind: 'none' }); setSelectedEvent(null) }} className="text-[10px] text-slate-500 hover:text-slate-300">
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

        {/* Related Intelligence — deliberately a separate, differently colored panel from Observed
            Data above; never blended into it. Only ever renders normalized results from the
            existing Research Engine (see lib/terra/relatedIntelligence.ts). */}
        {selectedFeature && (
          <div className="pointer-events-auto">
            <TerraRelatedIntelligencePanel feed={relatedIntelligence} active />
          </div>
        )}
      </div>}

      {/* Bottom bar — 4D timeline + Commander annotation placeholder. */}
      {!commandCenter && <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4">
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
      </div>}
    </div>
  )
}

// God's Eye command-center composer (app/page.tsx) recreates its own JSX (and every inline
// callback) on every Commander keystroke, which otherwise forces this entire Cesium-backed subtree
// through a full React re-render per keystroke purely from parent churn — `presentation` is this
// component's only prop, and it never changes after mount, so a shallow-props memo skips all of
// that unnecessary work without affecting any of TerraShell's own state/context-driven updates.
export const TerraShell = memo(TerraShellComponent)
