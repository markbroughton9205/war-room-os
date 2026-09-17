'use client'

/**
 * Terra Shell — Phase G/H (foundation) + Phase 1/2 (first live layer + event model) + Phase 3
 * (multi-layer spatial integration).
 *
 * Every entry in TERRA_LAYER_SUMMARIES (lib/terra/layerCatalogSummary.ts, a client-safe mirror of
 * lib/terra/layerCatalog.ts) gets one TerraLayerRow: its own
 * enable toggle, its own useTerraLayer fetch, and its own headless TerraFeatureLayer renderer —
 * the same generic code path for every layer, never a per-provider branch here. Only
 * usgs_earthquake_feed and nws_severe_weather_alerts start enabled by default (public Earth feeds).
 * Other layers start off so extra live calls stay a deliberate Commander action.
 *
 * Earth Knowledge's active-location surface is wired to the existing Research Engine/Nominatim
 * boundary. The Live Council Dock sends a Commander-selected object into the existing Council
 * pipeline. Commander annotation stays an honestly-labeled placeholder.
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
import { useTerraLiveIntel } from './useTerraLiveIntel'
import { useTerraClock } from './useTerraClock'
import { useTerraCinematicOrbit } from './useTerraCinematicOrbit'
import { useTerraCinematicFlight } from './useTerraCinematicFlight'
import { useCommanderLocation } from './CommanderLocationProvider'
import { TerraGpsControl } from './TerraGpsControl'
import { TerraGpsMarker } from './TerraGpsMarker'
import { TerraHazardCounters } from './TerraHazardCounters'
import { composeTerraHazardCounters } from '@/lib/terra/hazardStatus'
import { useTerraCameraScale } from './useTerraCameraScale'
import { TerraTimeline } from './TerraTimeline'
import { TerraEarthImagery } from './TerraEarthImagery'
import { TerraRadarImagery } from './TerraRadarImagery'
import { TerraRadarStatus } from './TerraRadarStatus'
import { useTerraRadar } from './useTerraRadar'
import { TERRA_LAYER_SUMMARIES, type TerraLayerSummary } from '@/lib/terra/layerCatalogSummary'
import { isLocationBoundTerraLayer, terraLayerQueryOverride } from '@/lib/terra/activeLocationQueries'
import { TERRA_LAYER_LIVE_STATUS_LABELS, type TerraLayerLiveStatus } from '@/lib/terra/layerLiveStatus'
import { TERRA_TIME_WINDOW_PRESETS, filterTerraFeaturesByTime, shouldAutoRefreshTerraLayer, terraFeaturesShallowEqual } from '@/lib/terra/terraTime'
import type { TerraClickPoint, TerraGeoFeature, TerraIntelligenceEventKind, TerraTimeMode, TerraTimeWindow } from '@/lib/terra/types'
import type { TerraLocationTarget } from '@/lib/terra/locationCommand'
import type { TerraActiveLocation, TerraContextType, TerraReverseLocationResolution } from '@/lib/terra/activeLocation'
import { enrichSearchWithReverse, promoteMeaningfulAdmin, selectedJurisdictionFromSearch } from '@/lib/terra/searchJurisdiction'
import { TerraLocationCommandInput } from './TerraLocationCommandInput'
import { TerraEarthKnowledgePanel } from './TerraEarthKnowledgePanel'
import { useTerraActiveLocation } from './TerraActiveLocationContext'
import { TERRA_STREET_LEVEL_IMAGERY_MESSAGE } from '@/lib/terra/streetLevelImagery'
import {
  terraHighResAerialUnavailable,
  TERRA_HIGH_RES_AERIAL_UNAVAILABLE_MESSAGE,
  TERRA_FALLBACK_IMAGERY_ACTIVE_MESSAGE,
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
import { buildTerraAircraftBoundingBoxQuery, type TerraDegreeRectangle } from '@/lib/terra/aircraftBoundingBox'
import { terraCameraRectSignature } from '@/lib/terra/cameraRectSignature'
import { summarizeTerraAircraftFeatures } from '@/lib/terra/aircraftRegionalSummary'
import { buildTerraLiveIntelBoundingBoxQuery, buildTerraMaritimeBoundingBoxQuery, terraCameraViewHasMaritimeCoverage } from '@/lib/terra/maritimeBoundingBox'
import { summarizeTerraVesselFeatures } from '@/lib/terra/vesselRegionalSummary'
import { resolveTerraMaritimeCoverageState, TERRA_MARITIME_COVERAGE_LABELS, type TerraMaritimeCoverageState } from '@/lib/terra/maritimeCoverage'
import type { TerraCoverageTruthState } from '@/lib/terra/coverageTruth'
import { TerraCoverageBadge } from './TerraCoverageBadge'
import { TerraTrafficLayer } from './TerraTrafficLayer'
import { TERRA_TRAFFIC_LAYER_DEFS } from './terraTrafficLayerDefs'
import { CommanderAgentDock } from './CommanderAgentDock'
import { TerraAgentEngineeringDetails } from './TerraAgentEngineeringDetails'
import { TerraInspectDetails } from './TerraInspectDetails'
import { TerraRightIntelDock } from './TerraRightIntelDock'
import { WarRoomBackControl } from '@/components/war-room/WarRoomBackControl'
import { TerraGodsEyeCoverageMatrix } from './TerraGodsEyeCoverageMatrix'
import { TerraUrbanDetail, type TerraUrbanDetailStatus } from './TerraUrbanDetail'
import { TerraReEarthBuildings } from './TerraReEarthBuildings'
import { TerraCesiumOsmBuildings } from './TerraCesiumOsmBuildings'
import { TerraReEarthTerrain } from './TerraReEarthTerrain'
import { TerraGodsEyeInspectCard } from './TerraGodsEyeInspectCard'
import { TerraStreetIntelligence } from './TerraStreetIntelligence'
import { TerraStreetViewPanel } from './TerraStreetViewPanel' // in-Terra STREET VIEW only
import { TerraWeatherAlertToast } from './TerraWeatherAlertToast'
import { TerraWeatherDetailDrawer } from './TerraWeatherDetailDrawer'
import { useTerraWeatherAlerts } from './useTerraWeatherAlerts'
import { TerraNearbyCameras } from './TerraNearbyCameras'
import { TerraNearbyGodsEye } from './TerraNearbyGodsEye'
import { TerraAreaLiveControl } from './TerraAreaLiveControl'
import { AreaLiveMediaViewer } from './AreaLiveMediaViewer'
import { TerraWorkspaceLayoutProvider, type LayoutApi } from './workspace/TerraWorkspaceLayoutProvider'
import { TerraWorkspacePanel } from './workspace/TerraWorkspacePanel'
import type { TerraSmartClickInteractionKind } from '@/lib/terra/workspace/panelIds'
import { TerraWorkspaceResetButton } from './workspace/TerraWorkspaceResetButton'
import { TerraWorkspaceControl } from './workspace/TerraWorkspaceControl'
import { TerraCameraHoverWorkspace } from './workspace/TerraCameraHoverWorkspace'
import { TerraCommanderSessionChip, commanderSessionNeedsAuth, useTerraCommanderSession } from './TerraCommanderSessionChip'
import { TerraCameraDiscoveryControl, type TerraCameraDiscoveryUiState } from './TerraCameraDiscoveryControl'
import { TerraGodsEyeViewMode } from './TerraGodsEyeViewMode'
import { TerraGodsEyeCameraDirectory } from './TerraGodsEyeCameraDirectory'
import { TerraCameraCoverageOverlay } from './TerraCameraCoverageOverlay'
import type { TerraUrbanRoad, TerraUrbanSelection, TerraUrbanSignal } from '@/lib/terra/urbanDetail/types'
import { TERRA_LIVE_SIGNAL_PHASE, TERRA_TERRAIN_REQUIRES_PROVIDER } from '@/lib/terra/urbanDetail/types'
import { urbanBuildingToSelection } from '@/lib/terra/urbanDetail/pick'
import { buildGodsEyeInspectCard } from '@/lib/terra/godsEye/buildInspectCard'
import { cameraPreviewHref } from '@/lib/terra/godsEye/trafficCamera'
import { inspectEnrichAppliesTo } from '@/lib/terra/godsEye/inspectRace'
import { trafficCameraRuntimeEvidenceFromFeatures } from '@/lib/terra/godsEye/cameraHealth'
import { godsEyeLodDensity } from '@/lib/terra/godsEye/lodRuntime'
import { emptyTerraLodTelemetry, sampleBrowserMemoryMb, type TerraLodTelemetry } from '@/lib/terra/godsEye/lodTelemetry'
import type { NearbyCameraIndexFeature, NearbyPublicCamera } from '@/lib/terra/godsEye/nearbyCameras'
import { nearbyPublicCameraCount, nearbyPublicCameras } from '@/lib/terra/godsEye/nearbyCameras'
import { nearbyCameraCoverageForPoint } from '@/lib/terra/godsEye/nearbyCameraCoverage'
import {
  buildAreaLiveCameraMedia,
  buildAreaLiveCouncilHandoff,
  buildAreaLiveIntelMedia,
  canSendAreaLiveToCouncil,
  isAreaLivePlayableVideo,
  type AreaLiveCameraMedia,
  type AreaLiveCategory,
} from '@/lib/terra/godsEye/areaLiveMedia'
import { composeAreaLiveWorkspace, isAreaLiveLocalIntelItem, type AreaLiveNearbyRow } from '@/lib/terra/godsEye/areaLiveWorkspace'
import { composeNearbyGodsEye } from '@/lib/terra/godsEye/nearbyGodsEye'
import { planCameraDiscovery, CAMERA_DISCOVERY_EXPANDED_RADIUS_KM, CAMERA_DISCOVERY_RADIUS_KM, DISCOVERY_CAMERA_LAYER_IDS } from '@/lib/terra/godsEye/cameraDiscovery'
import {
  actionSuspendsOrbit,
  CAMERA_CLUSTER_ALTITUDE_M,
  CAMERA_INSPECT_ALTITUDE_M,
  nextTerraNavState,
  orbitMayAutoResume,
  type TerraNavAction,
  type TerraNavState,
} from '@/lib/terra/godsEye/navigationOwnership'
import { cameraInspectSurvivesOriginChange, selectedCameraFitsActiveContext } from '@/lib/terra/godsEye/cameraInspectContext'
import { sourcedCameraBearingDegrees } from '@/lib/terra/godsEye/cameraBearing'
import type { TerraClusterPick } from '@/lib/terra/cesiumEntityId'
import {
  cameraProvidersForViewExtent,
  fetchableCameraLayerIds,
  godsEyeCameraLod,
  godsEyeCameraLodPolicy,
  type CameraDirectoryDistanceFilter,
  type CameraDirectoryStatusFilter,
  type GodsEyeViewMode,
} from '@/lib/terra/godsEye/cameraFederation'
import { isPublicTerraLayer } from '@/lib/terra/publicLayers'
import { shouldClusterIntel, godsEyeLodForTerraScale } from '@/lib/terra/godsEye/lod'
import { RE_EARTH_BUILDINGS_STATUS, RE_EARTH_TERRAIN_STATUS } from '@/lib/terra/godsEye/openStack'
import { godsEyeActiveRung, godsEyeZoomRungForTerraScale } from '@/lib/terra/godsEye/zoomLadder'
import {
  composeTerraLiveIntel,
  listMaritimeLiveProviderStatuses,
  normalizeLiveGeoFromFeature,
  type TerraLiveFreshness,
} from '@/lib/terra/liveGeoIntelligence'
import { composeLiveIntelPanel, findPanelItem, intelItemToGeoFeature, overlayFeaturesFromPanel, type TerraLiveIntelItem } from '@/lib/terra/liveIntelPanelModel'
import { resolveDigitrafficCameraFreshness } from '@/lib/terra/maritimeProviderStatus'
import {
  TERRA_CRUDE_EXTRUSION_DEFAULT,
  TERRA_ION_OSM_BUILDINGS_DEFAULT,
  TERRA_REEARTH_BUILDINGS_DEFAULT,
} from '@/lib/terra/buildingVisual'
import {
  type StreetViewItem,
  type StreetViewOrigin,
  type StreetViewOriginContext,
  type StreetViewState,
} from '@/lib/terra/streetView'
import {
  NWS_WEATHER_LAYER_ID,
  buildWeatherCouncilHandoff,
  resolveWeatherFlyPlan,
  weatherAlertFromFeature,
  type WeatherAlert,
} from '@/lib/terra/weather'
import {
  TERRA_HANDOFF_STORAGE_KEY,
  buildTerraCouncilHandoffFromIntelItem,
  buildTerraCouncilHandoffPayload,
  canSendTerraIntelItemToCouncil,
  canSendTerraObjectToCouncil,
  type TerraCouncilHandoffPayload,
} from '@/lib/terra/councilHandoff'
import { observedVesselFromSelection } from '@/lib/astra/observedVessel'
import {
  compactLocalLabel,
  contextMovedMaterially,
  followSuspendDistanceKm,
  haversineKm,
  rectangleCenter,
} from '@/lib/terra/geographicContext'
import {
  classifyLocationMovement,
  formatCoordinateFallback,
  metersBetween,
  shouldRefreshLocalIntel,
  shouldReverseGeocode,
} from '@/lib/terra/commanderLocation'

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
  | { kind: 'urban-building'; building: TerraUrbanSelection }
  | { kind: 'urban-road'; road: TerraUrbanRoad }
  | { kind: 'urban-signal'; signal: TerraUrbanSignal }

function StatusLine({ status, aerialImageryActive, osmBuildingsVisible }: { status: TerraGlobeStatus; aerialImageryActive: boolean; osmBuildingsVisible?: boolean }) {
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
        : <span className="text-amber-400"> · high-res aerial unavailable{status.hasIonToken ? '' : ' (Cesium ion account token required)'} · fallback map detail at city scale</span>}
      <span className="text-slate-500"> · OSM map-detail available</span>
      {status.hasRealTerrain
        ? <span className="text-cyan-400"> · Terrain active</span>
        : <span className="text-amber-400"> · Terrain unavailable ({TERRA_TERRAIN_REQUIRES_PROVIDER})</span>}
      {osmBuildingsVisible
        ? <span className="text-cyan-400"> · 3D Buildings on</span>
        : status.hasIonToken
          ? <span className="text-slate-500"> · 3D Buildings off</span>
          : <span className="text-amber-400"> · 3D Buildings unavailable (Cesium ion account token required)</span>}
    </span>
  )
}

const FEED_STATE_LABEL: Record<string, { text: string; color: string }> = {
  loading: { text: 'LOADING…', color: 'text-slate-400' },
  live: { text: 'LIVE', color: 'text-emerald-400' },
  empty: { text: 'LIVE_EMPTY', color: 'text-slate-400' },
  error: { text: 'ERROR_UPSTREAM', color: 'text-red-400' },
  stale: { text: 'STALE', color: 'text-amber-400' },
}

const LIVE_STATUS_COLOR: Record<TerraLayerLiveStatus, string> = {
  LIVE: 'text-emerald-400',
  LIVE_EMPTY: 'text-slate-400',
  CACHED: 'text-emerald-300',
  STALE: 'text-amber-400',
  PARTIAL: 'text-amber-300',
  NO_COVERAGE: 'text-amber-200',
  AUTH_REQUIRED: 'text-cyan-200',
  PROVIDER_AUTH_REQUIRED: 'text-amber-300',
  RATE_LIMITED: 'text-amber-300',
  UNAVAILABLE: 'text-slate-400',
  ERROR_UPSTREAM: 'text-red-400',
  ERROR_PARSE: 'text-red-400',
  LOADING: 'text-slate-400',
}

function coveringLabelForPlan(plan: ReturnType<typeof planCameraDiscovery>): string | null {
  return plan.coveringProviders
    .map(row => (row.id === 'ohgo' ? 'OHGO / ODOT' : row.id === '511ny' ? '511NY' : row.region))
    .filter(Boolean)
    .join(', ') || plan.cameraLayerIds.join(', ') || null
}

function officialViewerUrlForPlan(plan: ReturnType<typeof planCameraDiscovery>): string | null {
  return plan.viewerOnlyProviders.find(row => row.viewerUrl)?.viewerUrl ?? null
}

const LOCATION_FEDERATED_LAYER_IDS = new Set([
  'met_no', 'open_meteo', 'gbif', 'obis', 'ohm_overpass',
  'nominatim', 'osm_overpass',
  'idai_gazetteer', 'pleiades', 'whg', 'edh',
])
const COMMAND_CENTER_HAZARD_IDS = new Set([
  'usgs_earthquake_feed', 'usgs_earthquake', 'nhc_current_storms',
  'nasa_eonet_wildfires', 'nasa_eonet_volcanoes', 'nasa_eonet_floods',
  'nws_severe_weather_alerts', 'tsunami_gov',
])

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
  live_video: { text: 'AVAILABLE', color: 'text-cyan-300' },
  still_image: { text: 'AVAILABLE', color: 'text-cyan-300' },
  stale: { text: 'STALE', color: 'text-amber-400' },
  offline: { text: 'OFFLINE', color: 'text-red-400' },
  unknown: { text: 'UNAVAILABLE', color: 'text-slate-400' },
  UNAVAILABLE: { text: 'UNAVAILABLE', color: 'text-slate-400' },
  LIVE: { text: 'AVAILABLE', color: 'text-cyan-300' },
  STALE: { text: 'STALE', color: 'text-amber-400' },
  OFFLINE: { text: 'OFFLINE', color: 'text-red-400' },
  AVAILABLE: { text: 'AVAILABLE', color: 'text-cyan-300' },
}

// Phase 3: per-provider camera attribution (previously hardcoded to the two Phase 1/2 sources).
const CAMERA_ATTRIBUTION: Record<string, string> = {
  digitraffic_road_cameras: 'Fintraffic / digitraffic.fi, CC BY 4.0',
  ontario_511_cameras: 'Ontario 511 (511on.ca), Government of Ontario',
  hong_kong_td_cameras: 'Transport Department, Government of the Hong Kong SAR (data.gov.hk)',
  quebec_511_cameras: 'Québec 511 — Ministère des Transports et de la Mobilité durable',
  ohgo_cameras: 'OHGO / ODOT (Ohio)',
  caltrans_cctv: 'Caltrans CWWP2 (California)',
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
const DEFAULT_ENABLED_LAYER_IDS = new Set<string>(['usgs_earthquake_feed', 'nws_severe_weather_alerts'])

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
      const freshness = typeof feature.properties.freshnessState === 'string'
        ? feature.properties.freshnessState
        : typeof feature.properties.freshness === 'string' ? feature.properties.freshness : 'unknown'
      const freshnessMeta = CAMERA_FRESHNESS_LABEL[freshness] ?? CAMERA_FRESHNESS_LABEL.unknown
      const viewerUrl = typeof feature.properties.viewerUrl === 'string' ? feature.properties.viewerUrl : null
      const preview = cameraPreviewHref({ providerId: feature.providerId, properties: feature.properties })
      const proxiedImageUrl = preview.kind === 'still' && preview.href && !preview.href.startsWith('http') ? preview.href : null
      const directImageUrl = preview.kind === 'still' && preview.href && preview.href.startsWith('http') ? preview.href : null
      return (
        <>
          <Row label="Coordinates" value={coords} mono />
          {typeof feature.properties.locationName === 'string' && <Row label="Location" value={feature.properties.locationName} />}
          {typeof feature.properties.road === 'string' && <Row label="Road" value={feature.properties.road} />}
          {typeof feature.properties.direction === 'string' && <Row label="Direction" value={feature.properties.direction.replace(/_/g, ' ').toLowerCase()} />}
          {typeof feature.properties.bearing === 'number' && <Row label="Bearing" value={`${feature.properties.bearing}°`} />}
          <Row label="Agency" value={CAMERA_ATTRIBUTION[feature.providerId] ?? feature.provenance.provider} />
          <Row label="Feed type" value={viewerUrl ? 'HTML viewer at source (no direct still published)' : 'Still image (refreshing)'} />
          <div className="flex justify-between"><dt>Catalog status</dt><dd className="text-emerald-400">{feature.provenance.fromCache ? 'CACHED' : 'LIVE'}</dd></div>
          {typeof feature.properties.capturedAt === 'string' ? (
            <>
              <div className="flex justify-between"><dt>Image capture freshness</dt><dd className={freshnessMeta.color}>{freshnessMeta.text}</dd></div>
              <Row label="Captured" value={new Date(feature.properties.capturedAt).toLocaleString()} />
            </>
          ) : (
            <>
              <div className="flex justify-between"><dt>Image capture freshness</dt><dd className="text-slate-400">UNKNOWN</dd></div>
              <p className="text-[10.5px] text-slate-500">Source did not report capture time</p>
            </>
          )}
          {typeof feature.provenance.sourceUrl === 'string' && <Row label="Source" value={feature.provenance.sourceUrl} mono />}
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
              OPEN CAMERA VIEW
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
      // Phase 3: JARTIC (Japan) is volume-only hourly data. Catalog retrieval of the latest
      // published hour-band is LIVE TRAFFIC VOLUMES (~2h publication lag). That is not live signal phase.
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
            <div className="flex justify-between"><dt>Catalog status</dt><dd className="text-emerald-400">LIVE TRAFFIC VOLUMES</dd></div>
            <div className="flex justify-between"><dt>Observation recency</dt><dd className="text-amber-300">Latest published hour-band (typically ~2h behind wall clock)</dd></div>
            <div className="flex justify-between"><dt>Signal phase</dt><dd className="text-slate-500">NO_COVERAGE — volumes are not live signal phase</dd></div>
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
  const { activeLocation } = useTerraActiveLocation()
  const queryOverride = terraLayerQueryOverride(layer.id, activeLocation)
  const [enabled, setEnabled] = useState(() => DEFAULT_ENABLED_LAYER_IDS.has(layer.id) || (hideControls && COMMAND_CENTER_HAZARD_IDS.has(layer.id)))
  const autoRefreshAllowed = shouldAutoRefreshTerraLayer(timeMode)
  const feed = useTerraLayer(layer.id, enabled, layer.refreshIntervalMs, autoRefreshAllowed, queryOverride)

  useEffect(() => {
    if (queryOverride && (hideControls || LOCATION_FEDERATED_LAYER_IDS.has(layer.id))) {
      setEnabled(true)
    }
  }, [queryOverride, hideControls, layer.id])

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
  const liveLabel = TERRA_LAYER_LIVE_STATUS_LABELS[feed.liveStatus] ?? feedStatus.text
  const liveColor = LIVE_STATUS_COLOR[feed.liveStatus] ?? feedStatus.color
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
        <details className="terra-inspect mt-1">
          <summary className="cursor-pointer list-none text-[10px] font-bold uppercase tracking-widest text-slate-500 [&::-webkit-details-marker]:hidden">
            <span className={liveColor}>{liveLabel}</span>
            <span className="ml-2 font-normal normal-case tracking-normal text-slate-500">
              {feed.displayedDataStatus === 'STALE_LAST_GOOD'
                ? `STALE_LAST_GOOD · ${feed.features.length} retained · inspect`
                : `${feed.features.length} event${feed.features.length === 1 ? '' : 's'} · inspect`}
            </span>
          </summary>
          <div className="mt-1 space-y-1">
            <p className="text-[10.5px] text-slate-500">Provider status: {liveLabel}</p>
            <p className="text-[10.5px] text-slate-500">
              Displayed data: {feed.displayedDataStatus === 'STALE_LAST_GOOD' ? 'STALE_LAST_GOOD' : feed.displayedDataStatus === 'CURRENT' ? 'CURRENT' : 'NONE'}
            </p>
            {feed.rootCause && <p className="text-[10.5px] text-slate-500">Reason: {feed.rootCause}</p>}
            {isLocationBoundTerraLayer(layer.id) && queryOverride === null && <p className="text-[10.5px] text-slate-500">Waiting for an active Terra location.</p>}
            {feed.skippedCount > 0 && <p className="text-[10.5px] text-slate-500">{feed.skippedCount} unprojectable</p>}
            {feed.lastFetchedAt && (
              <p className="text-[10.5px] text-slate-500">
                {feed.displayedDataStatus === 'STALE_LAST_GOOD' ? 'Last success: ' : 'Last fetched: '}
                {new Date(feed.lastFetchedAt).toLocaleTimeString()}
              </p>
            )}
            {feed.displayedDataStatus === 'STALE_LAST_GOOD' && (
              <p className="text-[10.5px] text-amber-300">Item count: {feed.features.length} retained — last-good geometry, not currently LIVE</p>
            )}
            {feed.lastErrorMessage && <p className={`text-[10.5px] ${feed.lastErrorMessage === 'AUTH_REQUIRED' ? 'text-amber-300' : 'text-red-400'}`}>{feed.lastErrorMessage}</p>}
            <button
              type="button"
              onClick={feed.refresh}
              className="mt-0.5 rounded border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300 hover:border-emerald-400/60 hover:text-emerald-400"
            >
              Refresh now
            </button>
          </div>
        </details>
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

function attachTerraLodSampler(targetViewer: CesiumViewer, onSample: (sample: TerraLodTelemetry) => void): () => void {
  let frames = 0
  let last = performance.now()
  const remove = targetViewer.scene.postRender.addEventListener(() => {
    frames += 1
    const now = performance.now()
    if (now - last < 1000) return
    const fps = Math.round((frames * 1000) / (now - last))
    frames = 0
    last = now
    let entityCount = 0
    for (let index = 0; index < targetViewer.dataSources.length; index += 1) {
      entityCount += targetViewer.dataSources.get(index).entities.values.length
    }
    onSample({
      fps,
      primitiveCount: targetViewer.scene.primitives.length,
      dataSourceCount: targetViewer.dataSources.length,
      entityCount,
      memoryMb: sampleBrowserMemoryMb(),
    })
  })
  return () => remove()
}

function searchProvenance(source: TerraLocationTarget['source']): {
  source: TerraActiveLocation['source']
  sourceLabel: TerraActiveLocation['sourceLabel']
  resolved: boolean
} {
  if (source === 'nominatim') return { source, sourceLabel: 'OpenStreetMap Nominatim', resolved: true }
  if (source === 'open_meteo') return { source, sourceLabel: 'Open-Meteo Geocoding', resolved: true }
  if (source === 'geonames') return { source, sourceLabel: 'GeoNames', resolved: true }
  return { source: 'coordinates', sourceLabel: 'Commander-selected coordinates', resolved: false }
}

function TerraShellComponent({ presentation = 'workspace' }: { presentation?: 'workspace' | 'command-center' }) {
  const [globeStatus, setGlobeStatus] = useState<TerraGlobeStatus>({ phase: 'loading' })
  const [viewer, setViewer] = useState<CesiumViewer | null>(null)
  // Smart Click's escape hatch into the workspace layout store: TerraWorkspaceLayoutProvider is
  // rendered further down in this same component's JSX, so its context can't be consumed here —
  // onApiReady hands back the same store instance imperatively (see workspaceLayoutApiRef usage
  // below), never a second store/provider.
  const workspaceLayoutApiRef = useRef<LayoutApi | null>(null)
  const [selection, setSelection] = useState<Selection>({ kind: 'none' })
  const [layerFeatures, setLayerFeatures] = useState<Record<string, TerraGeoFeature[]>>({})
  const { activeLocation, setActiveLocation, selectedEvent, setSelectedEvent, setAircraftSummary, setMaritimeSummary } = useTerraActiveLocation()
  const activeLocationRef = useRef(activeLocation)
  activeLocationRef.current = activeLocation
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const selectedEventRef = useRef(selectedEvent)
  selectedEventRef.current = selectedEvent
  const layerFeaturesRef = useRef(layerFeatures)
  layerFeaturesRef.current = layerFeatures
  const reverseRequestRef = useRef<{ sequence: number; controller: AbortController | null }>({ sequence: 0, controller: null })
  const gpsAppliedRef = useRef<{ lat: number; lon: number; at: number } | null>(null)
  const gpsCenteredRef = useRef(false)
  const investigationLockRef = useRef(false)
  const reverseGeocodeAtRef = useRef<{ lat: number; lon: number; at: number } | null>(null)
  const deviceLocalityRef = useRef<{ label: string | null; status: 'ok' | 'pending' | 'stale' | 'unavailable' }>({ label: null, status: 'unavailable' })
  const lastViewportContextRef = useRef<{ lat: number; lon: number; zoomLevel: ReturnType<typeof godsEyeZoomRungForTerraScale> } | null>(null)
  const flyCompleteAtRef = useRef(0)
  const cameraMetaRef = useRef<{ zoom: ReturnType<typeof godsEyeZoomRungForTerraScale>; bbox: { west: number; south: number; east: number; north: number } | null }>({ zoom: 'CITY', bbox: null })
  const cameraCatalogByLocationRef = useRef<{ originKey: string; features: NearbyCameraIndexFeature[] } | null>(null)

  useEffect(() => () => reverseRequestRef.current.controller?.abort(), [])

  // Phase 6: Terra's 4D clock — real Earth orientation/lighting follows viewer.clock.currentTime
  // (see TerraGlobe.tsx's enableLighting + useTerraClock.ts), which this hook is the only thing
  // that ever sets.
  const clock = useTerraClock(viewer)

  // God's Eye multi-scale phase: the one discrete camera-altitude signal gating 3D Buildings
  // visibility and the nearby-landmarks layer below — see useTerraCameraScale.ts for the
  // documented threshold reasoning.
  const [navState, setNavState] = useState<TerraNavState>('IDLE')
  const navStateRef = useRef(navState)
  navStateRef.current = navState
  const applyNavAction = useCallback((action: TerraNavAction) => {
    setNavState(current => nextTerraNavState(current, action))
  }, [])
  const cameraScale = useTerraCameraScale(viewer)
  // Camera-only, deliberately separate from clock/time state — see useTerraCinematicOrbit.ts.
  const cinematic = useTerraCinematicOrbit(viewer, clock.time.mode === 'live', cameraScale.level, {
    autoResumeLocked: !orbitMayAutoResume(navState),
  })
  const handleManualFlightInterrupt = useCallback(() => {
    cinematic.pause()
    applyNavAction('MANUAL_DRAG')
  }, [applyNavAction, cinematic])
  const handleResumeCinematic = useCallback(() => {
    applyNavAction('RESUME_ORBIT')
    cinematic.resume()
  }, [applyNavAction, cinematic])
  const handleToggleCinematic = useCallback(() => {
    if (cinematic.orbiting) {
      cinematic.pause()
      applyNavAction('MANUAL_DRAG')
      return
    }
    applyNavAction('RESUME_ORBIT')
    cinematic.resume()
  }, [applyNavAction, cinematic])
  const cinematicFlight = useTerraCinematicFlight(viewer, cinematic.suppressedByReducedMotion, {
    onFlightStart: () => {
      cinematic.pause()
      cinematic.lockAutoResume(true)
    },
    onManualInterrupt: handleManualFlightInterrupt,
  })
  const commandNav = useCallback((action: TerraNavAction) => {
    if (actionSuspendsOrbit(action)) cinematic.pause()
    applyNavAction(action)
  }, [applyNavAction, cinematic])
  useEffect(() => {
    cinematic.lockAutoResume(cinematicFlight.flying || !orbitMayAutoResume(navState))
  }, [cinematic, cinematicFlight.flying, navState])
  useEffect(() => {
    if (!cinematic.orbiting) return
    applyNavAction('ORBIT_STARTED')
  }, [applyNavAction, cinematic.orbiting])
  const gps = useCommanderLocation()
  const nearbyCameraOrigin = activeLocation
    ? { latitude: activeLocation.latitude, longitude: activeLocation.longitude, label: activeLocation.label }
    : gps.location
      ? { latitude: gps.location.lat, longitude: gps.location.lon, label: 'Commander GPS (local only)' }
      : null
  const nearbyCameraOriginRef = useRef(nearbyCameraOrigin)
  nearbyCameraOriginRef.current = nearbyCameraOrigin
  const cameraContextOriginRef = useRef<{ key: string; latitude: number; longitude: number } | null>(null)
  const commanderSession = useTerraCommanderSession()
  const sessionAuthRequired = commanderSessionNeedsAuth(commanderSession)
  const [cameraLayerAuthById, setCameraLayerAuthById] = useState<Record<string, boolean>>({})
  const [cameraDiscovery, setCameraDiscovery] = useState<{
    active: boolean
    layerIds: string[]
    coveringLabel: string | null
    officialViewerUrl: string | null
    prompt: TerraCameraDiscoveryUiState
  }>({ active: false, layerIds: [], coveringLabel: null, officialViewerUrl: null, prompt: 'IDLE' })
  const cameraDiscoveryRef = useRef(cameraDiscovery)
  cameraDiscoveryRef.current = cameraDiscovery
  const [cameraDiscoveryRect, setCameraDiscoveryRect] = useState<TerraDegreeRectangle | null>(null)
  const [cameraStillNonce, setCameraStillNonce] = useState(0)
  const [cameraSearchRadiusKm, setCameraSearchRadiusKm] = useState(CAMERA_DISCOVERY_RADIUS_KM)
  const [areaLiveOpen, setAreaLiveOpen] = useState(false)
  const [areaLiveCategory, setAreaLiveCategory] = useState<AreaLiveCategory>('ALL')
  const [areaLiveMediaOpen, setAreaLiveMediaOpen] = useState(false)
  const [areaLiveMediaExpanded, setAreaLiveMediaExpanded] = useState(false)
  const [areaLiveOfficialOpen, setAreaLiveOfficialOpen] = useState(false)
  const [areaLiveIntelId, setAreaLiveIntelId] = useState<string | null>(null)
  const [areaLiveHoverRowId, setAreaLiveHoverRowId] = useState<string | null>(null)
  const [areaLiveIntelMedia, setAreaLiveIntelMedia] = useState<AreaLiveCameraMedia | null>(null)
  const areaLiveMediaOpenRef = useRef(false)
  areaLiveMediaOpenRef.current = areaLiveMediaOpen
  const [godsEyeViewMode, setGodsEyeViewMode] = useState<GodsEyeViewMode>('EARTH')
  const [cameraDirectoryQuery, setCameraDirectoryQuery] = useState('')
  const [cameraDirectoryProvider, setCameraDirectoryProvider] = useState('ALL')
  const [cameraDirectoryStatus, setCameraDirectoryStatus] = useState<CameraDirectoryStatusFilter>('ALL')
  const [cameraDirectoryDistance, setCameraDirectoryDistance] = useState<CameraDirectoryDistanceFilter>('NEAREST')
  const handleCameraLayerAuth = useCallback((layerId: string, required: boolean) => {
    if (!DISCOVERY_CAMERA_LAYER_IDS.includes(layerId)) return
    if (required && isPublicTerraLayer(layerId)) return
    setCameraLayerAuthById(prev => (prev[layerId] === required ? prev : { ...prev, [layerId]: required }))
  }, [])
  const cameraLayerAuthRequired = Object.values(cameraLayerAuthById).some(Boolean)
  const cameraAuthRequired = cameraLayerAuthRequired
  const [buildingsTileset, setBuildingsTileset] = useState<import('cesium').Cesium3DTileset | null>(null)
  const isLocalScale = cameraScale.level === 'local' || cameraScale.level === 'building'

  // God's Eye Terra imagery phase: real detected outcome of the Cesium ion World Imagery (Bing
  // Maps Aerial) asset request in TerraEarthImagery.tsx — never assumed from token presence alone.
  // `mapDetailMode` is the Commander's explicit escape hatch to the OSM raster base.
  const [aerialImageryAvailable, setAerialImageryAvailable] = useState(false)
  const [mapDetailMode, setMapDetailMode] = useState(false)
  const [urbanDetailEnabled, setUrbanDetailEnabled] = useState(true)
  const [buildingExtrusionEnabled, setBuildingExtrusionEnabled] = useState(TERRA_CRUDE_EXTRUSION_DEFAULT)
  const [ionOsmBuildingsEnabled, setIonOsmBuildingsEnabled] = useState(TERRA_ION_OSM_BUILDINGS_DEFAULT)
  const [reEarthBuildingsEnabled, setReEarthBuildingsEnabled] = useState(TERRA_REEARTH_BUILDINGS_DEFAULT)
  const [reEarthTerrainEnabled, setReEarthTerrainEnabled] = useState(false)
  const [reEarthBuildingsRuntime, setReEarthBuildingsRuntime] = useState<'off' | 'loading' | 'evaluation_active' | 'unavailable'>('off')
  const [reEarthTerrainRuntime, setReEarthTerrainRuntime] = useState<'off' | 'loading' | 'evaluation_active' | 'unavailable'>('off')
  const [streetIntelOpen, setStreetIntelOpen] = useState(false)
  const [streetViewOpen, setStreetViewOpen] = useState(false)
  const [streetViewOrigin, setStreetViewOrigin] = useState<StreetViewOrigin | null>(null)
  const [streetViewState, setStreetViewState] = useState<StreetViewState | 'IDLE' | 'LOADING'>('IDLE')
  const [weatherDrawerAlert, setWeatherDrawerAlert] = useState<WeatherAlert | null>(null)
  const [weatherOverlayAlert, setWeatherOverlayAlert] = useState<WeatherAlert | null>(null)
  const [inspectPinned, setInspectPinned] = useState(false)
  const [lodTelemetry, setLodTelemetry] = useState<TerraLodTelemetry>(() => emptyTerraLodTelemetry())
  const [urbanStatus, setUrbanStatus] = useState<TerraUrbanDetailStatus>({
    enabled: true,
    pending: false,
    lod: null,
    roads: 'UNAVAILABLE',
    buildings: 'UNAVAILABLE',
    signals: 'UNAVAILABLE',
    labels: 'UNAVAILABLE',
    terrain: 'UNAVAILABLE',
    source: null,
    buildingCount: 0,
    roadCount: 0,
    signalCount: 0,
    houseCount: 0,
    streetLabelCount: 0,
    houseLabelCount: 0,
    fromCache: false,
    truncated: false,
    error: null,
    loadMs: null,
    networkFetches: 0,
    rateLimited: false,
  })
  const highResAerialUnavailable = terraHighResAerialUnavailable(aerialImageryAvailable, cameraScale.level)
  const sovereignUrbanBuildingsActive = urbanStatus.buildings === 'LIVE' || urbanStatus.buildings === 'CACHED' || urbanStatus.buildings === 'DEGRADED' || urbanStatus.buildings === 'STALE'
  const ionBuildingsFallbackActive = ionOsmBuildingsEnabled && isLocalScale && globeStatus.phase === 'ready' && globeStatus.hasOsmBuildings

  useEffect(() => {
    if (!buildingsTileset) return
    applyTerraBuildingsVisibility(buildingsTileset, ionBuildingsFallbackActive)
  }, [buildingsTileset, ionBuildingsFallbackActive])

  const [selectedWindowId, setSelectedWindowId] = useState('all')
  const selectedWindow: TerraTimeWindow = useMemo(() => TERRA_TIME_WINDOW_PRESETS.find(p => p.id === selectedWindowId)?.window ?? null, [selectedWindowId])

  const handleFeaturesChange = useCallback((layerId: string, features: TerraGeoFeature[]) => {
    setLayerFeatures(prev => (terraFeaturesShallowEqual(prev[layerId], features) ? prev : { ...prev, [layerId]: features }))
  }, [])

  const selectedFeature = useMemo(() => {
    if (selection.kind !== 'feature') return null
    return (layerFeatures[selection.layerId] ?? []).find(f => f.id === selection.featureId) ?? null
  }, [selection, layerFeatures])
  const inspectCard = useMemo(() => buildGodsEyeInspectCard({
    selection,
    feature: selectedFeature,
    pinned: inspectPinned,
    asyncEnrichPending: activeLocation?.status === 'resolving',
    enrichError: activeLocation?.status === 'coordinate_only' ? activeLocation.detail : null,
    enrichLatitude: activeLocation?.latitude ?? null,
    enrichLongitude: activeLocation?.longitude ?? null,
    origin: activeLocation
      ? { latitude: activeLocation.latitude, longitude: activeLocation.longitude }
      : gps.location
        ? { latitude: gps.location.lat, longitude: gps.location.lon }
        : null,
  }), [selection, selectedFeature, inspectPinned, activeLocation, gps.location])
  const inspectCardForUi = useMemo(() => {
    if (!inspectCard?.preview || inspectCard.preview.kind !== 'still' || !inspectCard.preview.href || cameraStillNonce === 0) return inspectCard
    const href = inspectCard.preview.href
    const joiner = href.includes('?') ? '&' : '?'
    return { ...inspectCard, preview: { ...inspectCard.preview, href: `${href}${joiner}_=${cameraStillNonce}` } }
  }, [inspectCard, cameraStillNonce])
  const zoomRung = godsEyeActiveRung(cameraScale.level, selection.kind !== 'none' && selection.kind !== 'miss')
  const lodDensity = godsEyeLodDensity(zoomRung)
  const cameraHealthRuntime = useMemo(
    () => trafficCameraRuntimeEvidenceFromFeatures(
      Object.entries(layerFeatures).flatMap(([layerId, features]) =>
        features.map(feature => ({
          kind: feature.kind,
          layerId,
          providerId: feature.providerId,
          timestamp: feature.timestamp,
          properties: feature.properties,
          provenance: feature.provenance,
        })),
      ),
    ),
    [layerFeatures],
  )
  const cameraCount = useMemo(
    () => Object.values(layerFeatures).flat().filter(feature => feature.kind === 'traffic_camera').length,
    [layerFeatures],
  )
  const liveNearbyCameraIndex = useMemo<NearbyCameraIndexFeature[]>(
    () => Object.entries(layerFeatures).flatMap(([layerId, features]) =>
      features
        .filter(feature => feature.kind === 'traffic_camera')
        .map(feature => ({
          id: feature.id,
          layerId,
          kind: feature.kind,
          title: feature.title,
          latitude: feature.latitude,
          longitude: feature.longitude,
          properties: feature.properties,
          providerId: feature.providerId,
        })),
    ),
    [layerFeatures],
  )
  const nearbyCameraOriginKey = nearbyCameraOrigin
    ? `${nearbyCameraOrigin.latitude.toFixed(4)},${nearbyCameraOrigin.longitude.toFixed(4)}`
    : ''
  if (nearbyCameraOriginKey && liveNearbyCameraIndex.length > 0) {
    cameraCatalogByLocationRef.current = { originKey: nearbyCameraOriginKey, features: liveNearbyCameraIndex }
  }
  const nearbyCameraIndex = liveNearbyCameraIndex.length > 0
    ? liveNearbyCameraIndex
    : (cameraCatalogByLocationRef.current?.originKey === nearbyCameraOriginKey
      ? cameraCatalogByLocationRef.current.features
      : liveNearbyCameraIndex)
  const cameraIndexLoaded = cameraDiscovery.prompt === 'DISCOVERING'
    ? false
    : nearbyCameraIndex.length > 0
      || cameraDiscovery.prompt === 'READY'
      || cameraCatalogByLocationRef.current?.originKey === nearbyCameraOriginKey
  const areaLiveCameraCount = useMemo(() => {
    if (!nearbyCameraOrigin) return 0
    return nearbyPublicCameraCount({
      latitude: nearbyCameraOrigin.latitude,
      longitude: nearbyCameraOrigin.longitude,
      features: nearbyCameraIndex,
      maxKm: cameraSearchRadiusKm,
    })
  }, [nearbyCameraOrigin, nearbyCameraIndex, cameraSearchRadiusKm])
  const areaLiveNearbyCameras = useMemo(() => {
    if (!nearbyCameraOrigin) return []
    return nearbyPublicCameras({
      latitude: nearbyCameraOrigin.latitude,
      longitude: nearbyCameraOrigin.longitude,
      features: nearbyCameraIndex,
      maxKm: cameraSearchRadiusKm,
      maxResults: 40,
    })
  }, [nearbyCameraOrigin, nearbyCameraIndex, cameraSearchRadiusKm])
  const areaLiveCoverage = useMemo(() => {
    if (!nearbyCameraOrigin) return null
    return nearbyCameraCoverageForPoint({
      latitude: nearbyCameraOrigin.latitude,
      longitude: nearbyCameraOrigin.longitude,
      nearbyCount: areaLiveCameraCount,
      indexLoaded: cameraIndexLoaded,
      commanderAuthRequired: cameraAuthRequired,
      radiusKm: cameraSearchRadiusKm,
    })
  }, [nearbyCameraOrigin, areaLiveCameraCount, cameraIndexLoaded, cameraAuthRequired, cameraSearchRadiusKm])
  const areaLiveMedia = useMemo(() => {
    if (selectedFeature?.kind === 'traffic_camera' && selection.kind === 'feature') {
      return buildAreaLiveCameraMedia({
        feature: { ...selectedFeature, layerId: selection.layerId },
        stillNonce: cameraStillNonce,
      })
    }
    if (areaLiveIntelMedia) return areaLiveIntelMedia
    if (!areaLiveOfficialOpen) return null
    return buildAreaLiveCameraMedia({
      locationState: areaLiveCoverage?.locationState,
      coveringProviders: areaLiveCoverage?.coveringProviders,
      origin: nearbyCameraOrigin,
    })
  }, [selectedFeature, selection, cameraStillNonce, areaLiveOfficialOpen, areaLiveCoverage, nearbyCameraOrigin, areaLiveIntelMedia])
  const openAreaLiveOfficialViewer = useCallback(() => {
    commandNav('AREA_LIVE_MEDIA')
    setAreaLiveOpen(true)
    setAreaLiveCategory('CAMERAS')
    setAreaLiveOfficialOpen(true)
    setAreaLiveMediaOpen(true)
  }, [commandNav])
  const closeAreaLiveMediaViewer = useCallback(() => {
    setAreaLiveMediaOpen(false)
    setAreaLiveOfficialOpen(false)
    setAreaLiveMediaExpanded(false)
    setAreaLiveIntelId(null)
    setAreaLiveHoverRowId(null)
    setAreaLiveIntelMedia(null)
  }, [])

  const resolveStreetViewOrigin = useCallback((preferred?: StreetViewOriginContext): StreetViewOrigin | null => {
    if (preferred === 'AREA_LIVE' && areaLiveMedia && areaLiveMedia.latitude != null && areaLiveMedia.longitude != null) {
      return {
        latitude: areaLiveMedia.latitude,
        longitude: areaLiveMedia.longitude,
        label: areaLiveMedia.name,
        context: 'AREA_LIVE',
      }
    }
    if (inspectCard && inspectCard.latitude != null && inspectCard.longitude != null) {
      const fromFeature: StreetViewOriginContext = inspectCard.featureClass === 'building'
        ? 'BUILDING'
        : inspectCard.featureClass === 'ground'
          ? 'GROUND'
          : inspectCard.featureClass === 'street_camera'
            ? 'CAMERA'
            : 'LOCATION'
      return {
        latitude: inspectCard.latitude,
        longitude: inspectCard.longitude,
        label: inspectCard.title,
        context: preferred ?? fromFeature,
      }
    }
    if (areaLiveMedia && areaLiveMedia.latitude != null && areaLiveMedia.longitude != null) {
      return {
        latitude: areaLiveMedia.latitude,
        longitude: areaLiveMedia.longitude,
        label: areaLiveMedia.name,
        context: 'AREA_LIVE',
      }
    }
    if (activeLocation) {
      return {
        latitude: activeLocation.latitude,
        longitude: activeLocation.longitude,
        label: activeLocation.label,
        context: 'LOCATION',
      }
    }
    const viewCenter = rectangleCenter(cameraMetaRef.current.bbox)
    if (viewCenter) {
      return {
        latitude: viewCenter.latitude,
        longitude: viewCenter.longitude,
        label: 'Globe view',
        context: 'LOCATION',
      }
    }
    if (viewer && !viewer.isDestroyed()) {
      const carto = viewer.camera.positionCartographic
      if (carto) {
        return {
          latitude: (carto.latitude * 180) / Math.PI,
          longitude: (carto.longitude * 180) / Math.PI,
          label: 'Globe view',
          context: 'LOCATION',
        }
      }
    }
    return null
  }, [areaLiveMedia, inspectCard, activeLocation, viewer])

  const openStreetView = useCallback((preferred?: StreetViewOriginContext) => {
    const origin = resolveStreetViewOrigin(preferred)
    if (!origin) return
    setStreetViewOrigin(origin)
    setStreetViewOpen(true)
    setStreetViewState('LOADING')
  }, [resolveStreetViewOrigin])

  useEffect(() => {
    if (!streetViewOpen || !activeLocation) return
    setStreetViewOrigin(prev => {
      if (!prev) {
        return {
          latitude: activeLocation.latitude,
          longitude: activeLocation.longitude,
          label: activeLocation.label,
          context: 'LOCATION',
        }
      }
      const movedKm = haversineKm(prev.latitude, prev.longitude, activeLocation.latitude, activeLocation.longitude)
      if (movedKm < 0.08) return prev
      return {
        latitude: activeLocation.latitude,
        longitude: activeLocation.longitude,
        label: activeLocation.label,
        context: 'LOCATION',
      }
    })
  }, [streetViewOpen, activeLocation])

  const sendStreetViewToCouncil = useCallback((payload: TerraCouncilHandoffPayload | null) => {
    if (!payload) return
    try {
      sessionStorage.setItem(TERRA_HANDOFF_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      return
    }
    window.location.href = '/?terraAnalyze=1'
  }, [])

  const flyToStreetViewCapture = useCallback((item: StreetViewItem) => {
    commandNav('COMMANDER_INSPECT')
    cinematicFlight.flyTo({
      longitude: item.longitude,
      latitude: item.latitude,
      altitudeMeters: CAMERA_INSPECT_ALTITUDE_M,
      placeType: 'building',
    }, {
      purpose: 'inspect',
      label: `${item.provider} street image`,
      onComplete: () => commandNav('FLIGHT_COMPLETE'),
    })
  }, [cinematicFlight, commandNav])

  const applyCameraDiscoveryPlan = useCallback((origin: { latitude: number; longitude: number }, options?: { radiusKm?: number }) => {
    const radiusKm = options?.radiusKm ?? CAMERA_DISCOVERY_RADIUS_KM
    const plan = planCameraDiscovery(origin.latitude, origin.longitude, radiusKm)
    const coveringLabel = coveringLabelForPlan(plan)
    const officialViewerUrl = officialViewerUrlForPlan(plan)
    setCameraDiscoveryRect(plan.rectangle)
    const allowed = new Set(plan.cameraLayerIds)
    setLayerFeatures(prev => {
      let changed = false
      const next = { ...prev }
      for (const layerId of DISCOVERY_CAMERA_LAYER_IDS) {
        if (!allowed.has(layerId) && Object.prototype.hasOwnProperty.call(next, layerId)) {
          delete next[layerId]
          changed = true
        }
      }
      return changed ? next : prev
    })
    if (plan.requiresCommanderSession && sessionAuthRequired && !plan.hasApiCoverage) {
      setCameraDiscovery({
        active: true,
        layerIds: [],
        coveringLabel,
        officialViewerUrl,
        prompt: commanderSession === 'BOOTSTRAP_REQUIRED' ? 'BOOTSTRAP_REQUIRED' : 'AUTH_REQUIRED',
      })
      return plan
    }
    if (plan.providerAuthRequired) {
      setCameraDiscovery({ active: true, layerIds: [], coveringLabel, officialViewerUrl, prompt: 'PROVIDER_AUTH_REQUIRED' })
      return plan
    }
    if (!plan.hasApiCoverage) {
      setCameraDiscovery({ active: true, layerIds: [], coveringLabel, officialViewerUrl, prompt: 'NO_COVERAGE' })
      return plan
    }
    setCameraDiscovery({ active: true, layerIds: plan.cameraLayerIds, coveringLabel, officialViewerUrl, prompt: 'DISCOVERING' })
    return plan
  }, [commanderSession, sessionAuthRequired])

  const handleDiscoverCameras = useCallback(() => {
    if (!nearbyCameraOrigin) {
      setCameraDiscovery({ active: false, layerIds: [], coveringLabel: null, officialViewerUrl: null, prompt: 'NEED_LOCATION' })
      setCameraDiscoveryRect(null)
      return
    }
    setCameraSearchRadiusKm(CAMERA_DISCOVERY_RADIUS_KM)
    applyCameraDiscoveryPlan(nearbyCameraOrigin, { radiusKm: CAMERA_DISCOVERY_RADIUS_KM })
  }, [applyCameraDiscoveryPlan, nearbyCameraOrigin])

  useEffect(() => {
    if (!areaLiveOpen && godsEyeViewMode !== 'AREA_LIVE') return
    if (!nearbyCameraOrigin) return
    const discovery = cameraDiscoveryRef.current
    if (discovery.active && discovery.prompt !== 'NEED_LOCATION' && discovery.prompt !== 'IDLE') return
    handleDiscoverCameras()
  }, [areaLiveOpen, godsEyeViewMode, nearbyCameraOriginKey, handleDiscoverCameras, nearbyCameraOrigin])

  const handleGodsEyeViewModeChange = useCallback((mode: GodsEyeViewMode) => {
    setGodsEyeViewMode(mode)
    if (mode === 'AREA_LIVE') setAreaLiveOpen(true)
  }, [])

  const handleAreaLiveToggle = useCallback(() => {
    setAreaLiveOpen(value => {
      const next = !value
      if (next) setGodsEyeViewMode('AREA_LIVE')
      else setGodsEyeViewMode(current => (current === 'AREA_LIVE' ? 'EARTH' : current))
      return next
    })
  }, [])

  const handleExpandCameraSearch = useCallback(() => {
    if (!nearbyCameraOrigin) return
    setCameraSearchRadiusKm(CAMERA_DISCOVERY_EXPANDED_RADIUS_KM)
    const plan = planCameraDiscovery(nearbyCameraOrigin.latitude, nearbyCameraOrigin.longitude, CAMERA_DISCOVERY_EXPANDED_RADIUS_KM)
    const coveringLabel = coveringLabelForPlan(plan)
    const officialViewerUrl = officialViewerUrlForPlan(plan)
    setCameraDiscoveryRect(plan.rectangle)
    if (!plan.hasApiCoverage) return
    setCameraDiscovery({ active: true, layerIds: plan.cameraLayerIds, coveringLabel, officialViewerUrl, prompt: 'DISCOVERING' })
  }, [nearbyCameraOrigin])

  const focusNearbyCameras = useCallback(() => {
    document.querySelector('[data-testid="terra-nearby-cameras"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (!cameraDiscovery.active) return
    if (cameraDiscovery.prompt !== 'DISCOVERING') return
    const indexPresent = cameraDiscovery.layerIds.some(layerId => Object.prototype.hasOwnProperty.call(layerFeatures, layerId))
    if (cameraCount > 0 || indexPresent) {
      setCameraDiscovery(prev => (prev.prompt === 'READY' ? prev : { ...prev, prompt: 'READY' }))
    }
  }, [cameraCount, cameraDiscovery.active, cameraDiscovery.layerIds, cameraDiscovery.prompt, layerFeatures])

  useEffect(() => {
    if (!viewer) return
    return attachTerraLodSampler(viewer, setLodTelemetry)
  }, [viewer])

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
  useEffect(() => {
    cameraMetaRef.current = {
      zoom: godsEyeZoomRungForTerraScale(cameraScale.level),
      bbox: cameraViewRectangle.rectangle,
    }
  }, [cameraScale.level, cameraViewRectangle.rectangle])
  const camerasMode = godsEyeViewMode === 'CAMERAS' || godsEyeViewMode === 'AREA_LIVE' || areaLiveOpen
  const cameraLod = godsEyeCameraLod(cameraScale.level, cameraViewRectangle.rectangle)
  const cameraLodPolicy = godsEyeCameraLodPolicy(cameraLod)
  const cameraProvidersInView = useMemo(
    () => cameraProvidersForViewExtent(cameraViewRectangle.rectangle),
    [cameraViewRectangle.rectangle],
  )
  const federatedCameraIndex = useMemo(
    () => {
      const ids = new Set(fetchableCameraLayerIds())
      return Object.entries(layerFeatures).flatMap(([layerId, features]) =>
        ids.has(layerId)
          ? features.map(feature => ({
            id: feature.id,
            layerId,
            kind: feature.kind,
            title: feature.title,
            latitude: feature.latitude,
            longitude: feature.longitude,
            providerId: feature.providerId,
            timestamp: feature.timestamp,
            provenance: feature.provenance,
            properties: feature.properties,
          }))
          : [],
      )
    },
    [layerFeatures],
  )
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
  const [maritimeEnabled, setMaritimeEnabled] = useState(true)
  const maritimeHasCoverage = useMemo(() => terraCameraViewHasMaritimeCoverage(cameraViewRectangle.rectangle), [cameraViewRectangle.rectangle])
  const maritimeBoundingBoxQuery = useMemo(() => {
    if (!maritimeEnabled) return null
    if (cameraScale.level === 'global') return null
    return buildTerraMaritimeBoundingBoxQuery(cameraViewRectangle.rectangle)
  }, [maritimeEnabled, cameraScale.level, cameraViewRectangle.rectangle])
  const liveIntelBoundingBoxQuery = useMemo(() => {
    if (cameraScale.level === 'global') return null
    return buildTerraLiveIntelBoundingBoxQuery(cameraViewRectangle.rectangle)
  }, [cameraScale.level, cameraViewRectangle.rectangle])
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
  const remoteLiveIntel = useTerraLiveIntel({
    bbox: liveIntelBoundingBoxQuery,
    enabled: true,
    refreshMs: 120_000,
    latitude: activeLocation?.latitude ?? null,
    longitude: activeLocation?.longitude ?? null,
    place: activeLocation?.place ?? (activeLocation && activeLocation.contextType !== 'GPS' ? activeLocation.label : null),
    nativePlaceName: activeLocation?.nativePlaceName ?? null,
    englishPlaceName: activeLocation?.englishPlaceName ?? null,
    city: activeLocation?.city ?? null,
    county: activeLocation?.county ?? null,
    state: activeLocation?.state ?? null,
    country: activeLocation?.country ?? null,
    countryCode: activeLocation?.countryCode ?? null,
    reversePlace: activeLocation?.reverseSublocalityLabel ?? activeLocation?.locality ?? null,
    zoom: godsEyeZoomRungForTerraScale(cameraScale.level),
  })
  const localLiveIntelSnapshot = useMemo(() => {
    const features = Object.entries(layerFeatures)
      .filter(([layerId]) => layerId !== 'live_intel_overlay')
      .flatMap(([, rows]) => rows)
    const fromCache = maritime.features[0]?.provenance.fromCache === true
    const digitrafficFreshness: TerraLiveFreshness = resolveDigitrafficCameraFreshness({
      layerEnabled: maritimeEnabled,
      coverageState: maritimeCoverageState,
      feedState: maritime.state,
      fromCache,
      boundingBoxQuery: maritimeBoundingBoxQuery,
    })
    const quake = layerFeatures.usgs_earthquake_feed ?? []
    const quakeFreshness: TerraLiveFreshness = quake.length
      ? (quake[0]?.provenance.fromCache ? 'CACHED' : 'LIVE')
      : 'UNAVAILABLE'
    const composed = composeTerraLiveIntel({
      now: clock.time.currentTime,
      features,
      timeWindow: selectedWindow,
      freshnessDefaults: {
        implemented: true,
        configuredForLive: true,
        fetchOk: true,
        delayedFeed: false,
        now: clock.time.currentTime,
      },
      providerStatuses: [
        ...listMaritimeLiveProviderStatuses({
          digitrafficObjectCount: maritime.features.length,
          digitrafficFreshness,
        }),
        {
          id: 'usgs_earthquake_feed',
          displayName: 'USGS Real-Time Earthquake Feeds',
          layer: 'intelligence_events',
          implemented: true,
          configurationState: 'ENABLED',
          freshness: quakeFreshness,
          reason: quake.length ? 'USGS significant-earthquake feed' : 'No projectable earthquake features loaded yet',
          objectCount: quake.length,
        },
        {
          id: 'settlement_intelligence',
          displayName: 'Settlement Intelligence',
          layer: 'settlement_events',
          implemented: true,
          configurationState: 'ENABLED',
          freshness: 'UNAVAILABLE',
          reason: 'Settlement records have no projectable coordinates; coordinates are never invented.',
          objectCount: 0,
        },
      ],
    })
    return {
      ...composed,
      panel: composeLiveIntelPanel({
        now: clock.time.currentTime,
        objects: composed.objects,
        news: [],
        newsCoverage: remoteLiveIntel.authRequired ? 'AUTH_REQUIRED' : 'UNAVAILABLE',
        newsReason: remoteLiveIntel.authRequired
          ? 'AUTH_REQUIRED — Commander session missing for credentialed news. Public RSS loads from the live-intel route when available.'
          : 'Waiting for live-intel headlines.',
        conflictCoverage: 'NO_COVERAGE',
        conflictReason: 'Conflict reporting waits on ReliefWeb/public RSS from the live-intel route. No battlefield dataset is wired.',
        latitude: activeLocation?.latitude ?? null,
        longitude: activeLocation?.longitude ?? null,
        place: activeLocation?.place ?? (activeLocation && activeLocation.contextType !== 'GPS' ? activeLocation.label : null),
        nativePlaceName: activeLocation?.nativePlaceName ?? null,
        englishPlaceName: activeLocation?.englishPlaceName ?? null,
        city: activeLocation?.city ?? null,
        county: activeLocation?.county ?? null,
        state: activeLocation?.state ?? null,
        country: activeLocation?.country ?? null,
        countryCode: activeLocation?.countryCode ?? null,
        reverseSublocalityLabel: activeLocation?.reverseSublocalityLabel ?? activeLocation?.locality ?? null,
        zoomLevel: godsEyeZoomRungForTerraScale(cameraScale.level),
        bbox: cameraViewRectangle.rectangle,
        authState: remoteLiveIntel.authRequired ? 'AUTH_REQUIRED' as const : 'AUTHENTICATED' as const,
      }),
      authState: remoteLiveIntel.authRequired ? 'AUTH_REQUIRED' as const : 'AUTHENTICATED' as const,
    }
  }, [layerFeatures, maritime.features, maritime.state, maritimeEnabled, maritimeBoundingBoxQuery, maritimeCoverageState, clock.time.currentTime, selectedWindow, activeLocation, remoteLiveIntel.authRequired, cameraScale.level, cameraViewRectangle.rectangle])
  const liveIntelSnapshot = useMemo(() => {
    if (remoteLiveIntel.snapshot) {
      const remotePanel = remoteLiveIntel.snapshot.panel
      if (remotePanel) return remoteLiveIntel.snapshot
      return {
        ...remoteLiveIntel.snapshot,
        panel: localLiveIntelSnapshot.panel,
        authState: remoteLiveIntel.snapshot.authState ?? (remoteLiveIntel.authRequired ? 'AUTH_REQUIRED' as const : 'AUTHENTICATED' as const),
      }
    }
    if (!remoteLiveIntel.error && !remoteLiveIntel.authRequired) return localLiveIntelSnapshot
    const credentialedAis = new Set(['aisstream', 'barentswatch_ais', 'aishub_marine', 'exa'])
    return {
      ...localLiveIntelSnapshot,
      authState: 'AUTH_REQUIRED' as const,
      providers: localLiveIntelSnapshot.providers.map(provider => (
        credentialedAis.has(provider.id)
          ? { ...provider, freshness: 'AUTH_REQUIRED' as const, reason: remoteLiveIntel.error ?? 'AUTH_REQUIRED — Commander session missing.' }
          : provider
      )),
    }
  }, [remoteLiveIntel.snapshot, remoteLiveIntel.error, remoteLiveIntel.authRequired, localLiveIntelSnapshot])
  const liveIntelPanel = liveIntelSnapshot.panel ?? null
  const nwsWeatherFeatures = layerFeatures[NWS_WEATHER_LAYER_ID] ?? []
  const weatherIntelItems = useMemo(
    () => (liveIntelPanel?.sections.flatMap(section => section.items) ?? []).filter(item => item.eventType === 'severe_weather_alert'),
    [liveIntelPanel],
  )
  const weatherAlerts = useTerraWeatherAlerts({
    features: nwsWeatherFeatures,
    intelItems: weatherIntelItems,
    nowIso: clock.time.currentTime,
  })
  const radar = useTerraRadar({
    view: cameraViewRectangle.rectangle,
    nowIso: clock.time.currentTime,
    scaleLevel: cameraScale.level,
  })
  const areaLiveWorkspace = useMemo(() => {
    const items = liveIntelPanel?.sections.flatMap(section => section.items) ?? []
    const mediaItems = items.filter(isAreaLiveLocalIntelItem).map(item => ({
      id: item.id,
      headline: item.headline,
      originalHeadline: item.originalHeadline,
      englishHeadline: item.englishHeadline,
      source: item.source,
      provider: item.provider,
      sourceUrl: item.sourceUrl,
      location: item.location,
      lat: item.lat,
      lon: item.lon,
      originalLanguage: item.originalLanguage,
      verificationState: item.verificationState,
      timestamp: item.timestamp,
      retrievedAt: item.retrievedAt,
      category: item.category,
      locationRelevance: item.localRelevance ?? item.location ?? item.localServiceArea ?? null,
      freshnessState: item.freshnessState,
      freshnessLabel: item.freshnessLabel ?? null,
      mediaPreview: item.mediaPreview ?? null,
    }))
    const eventItems = items.filter(item => item.category === 'EVENTS').map(item => ({
      id: item.id,
      headline: item.headline,
      originalHeadline: item.originalHeadline,
      englishHeadline: item.englishHeadline,
      source: item.source,
      provider: item.provider,
      sourceUrl: item.sourceUrl,
      location: item.location,
      lat: item.lat,
      lon: item.lon,
      originalLanguage: item.originalLanguage,
      verificationState: item.verificationState,
      timestamp: item.timestamp,
      retrievedAt: item.retrievedAt,
      category: item.category,
      mediaPreview: item.mediaPreview ?? null,
    }))
    return composeAreaLiveWorkspace({
      originLabel: nearbyCameraOrigin?.label ?? activeLocation?.label ?? null,
      origin: nearbyCameraOrigin,
      cameras: areaLiveNearbyCameras,
      cameraCount: areaLiveCameraCount,
      cameraIndexLoaded,
      locationState: areaLiveCoverage?.locationState ?? cameraDiscovery.prompt,
      coveringLabel: cameraDiscovery.coveringLabel,
      coveringProviders: areaLiveCoverage?.coveringProviders,
      officialViewerUrl: cameraDiscovery.officialViewerUrl,
      intelPending: remoteLiveIntel.pending && !liveIntelPanel,
      mediaItems,
      eventItems,
      filter: areaLiveCategory,
    })
  }, [liveIntelPanel, nearbyCameraOrigin, activeLocation?.label, areaLiveNearbyCameras, areaLiveCameraCount, cameraIndexLoaded, areaLiveCoverage, cameraDiscovery.prompt, cameraDiscovery.coveringLabel, cameraDiscovery.officialViewerUrl, remoteLiveIntel.pending, areaLiveCategory])
  const nearbyGodsEyeSnapshot = useMemo(() => {
    if (!nearbyCameraOrigin) return null
    const local = liveIntelPanel?.sections.find(section => section.id === 'LOCAL')
    return composeNearbyGodsEye({
      latitude: nearbyCameraOrigin.latitude,
      longitude: nearbyCameraOrigin.longitude,
      originLabel: nearbyCameraOrigin.label,
      cameraFeatures: nearbyCameraIndex,
      cameraIndexLoaded,
      cameraAuthRequired,
      radiusKm: cameraSearchRadiusKm,
      features: Object.values(layerFeatures).flat(),
      localNewsCount: local?.count,
      localNewsState: local?.coverageState,
      landmarkCount: nearbyLandmarks.features.length,
    })
  }, [cameraDiscovery.prompt, cameraAuthRequired, cameraIndexLoaded, cameraSearchRadiusKm, layerFeatures, liveIntelPanel, nearbyCameraIndex, nearbyCameraOrigin, nearbyLandmarks.features.length])
  const hazardSummary = useMemo(() => composeTerraHazardCounters({
    providers: liveIntelSnapshot.providers,
    fetchedAt: liveIntelSnapshot.fetchedAt,
  }), [liveIntelSnapshot])
  const [inspectedIntelItem, setInspectedIntelItem] = useState<TerraLiveIntelItem | null>(null)
  const selectedLiveObject = useMemo(() => {
    if (!selectedFeature) return null
    return liveIntelSnapshot.objects.find(object => object.id === selectedFeature.id)
      ?? normalizeLiveGeoFromFeature(selectedFeature, {
        implemented: true,
        configuredForLive: true,
        fetchOk: true,
        delayedFeed: false,
        now: clock.time.currentTime,
      })
  }, [selectedFeature, liveIntelSnapshot.objects, clock.time.currentTime])
  const canSendSelectedToCouncil = areaLiveMedia && areaLiveMediaOpen
    ? canSendAreaLiveToCouncil(areaLiveMedia)
    : inspectedIntelItem
      ? canSendTerraIntelItemToCouncil(inspectedIntelItem)
      : canSendTerraObjectToCouncil(selectedLiveObject)
  const [commanderQuestion, setCommanderQuestion] = useState('')
  const [astraMission, setAstraMission] = useState<{
    id: string
    status: string
    error?: string | null
    outcomeSummary?: string | null
    councilConversationId?: string | null
    terraObjectId?: string | null
    terraProvider?: string | null
    terraEvidenceId?: string | null
  } | null>(null)
  const [astraBusy, setAstraBusy] = useState(false)
  const canCreateAstraMission = canSendSelectedToCouncil && commanderQuestion.trim().length >= 8 && !astraBusy
  const canRunAstraMission = Boolean(astraMission?.id) && astraMission?.status === 'planned' && !astraBusy
  const applyAstraMissionPayload = useCallback((mission: {
    id: string
    status: string
    error?: string | null
    outcomeSummary?: string | null
    councilConversationId?: string | null
    terraObjectId?: string | null
    terraProvider?: string | null
    terraEvidenceId?: string | null
  }) => {
    setAstraMission({
      id: mission.id,
      status: mission.status,
      error: mission.error ?? null,
      outcomeSummary: mission.outcomeSummary,
      councilConversationId: mission.councilConversationId,
      terraObjectId: mission.terraObjectId,
      terraProvider: mission.terraProvider,
      terraEvidenceId: mission.terraEvidenceId,
    })
  }, [])
  const createAstraMission = useCallback(async () => {
    const objective = commanderQuestion.trim()
    if (!canCreateAstraMission || !objective || !selectedLiveObject) return
    setAstraBusy(true)
    try {
      const terraSeed = buildTerraCouncilHandoffPayload({ object: selectedLiveObject, feature: selectedFeature, commanderPrompt: objective })
      const observedVessel = observedVesselFromSelection({ object: selectedLiveObject, feature: selectedFeature })
      const response = await fetch('/api/astra/missions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ objective, terraSeed, observedVessel }),
      })
      const body = await response.json().catch(() => ({})) as { mission?: {
        id: string
        status: string
        outcomeSummary?: string | null
        councilConversationId?: string | null
        error?: string | null
        terraObjectId?: string | null
        terraProvider?: string | null
        terraEvidenceId?: string | null
      }; error?: string }
      if (!response.ok || !body.mission) {
        setAstraMission({ id: '', status: 'failed', error: typeof body.error === 'string' ? body.error : 'ASTRA mission was not created.' })
        return
      }
      applyAstraMissionPayload(body.mission)
    } finally {
      setAstraBusy(false)
    }
  }, [applyAstraMissionPayload, canCreateAstraMission, commanderQuestion, selectedFeature, selectedLiveObject])
  const runAstraMission = useCallback(async () => {
    if (!canRunAstraMission || !astraMission?.id) return
    setAstraBusy(true)
    setAstraMission(prev => prev ? { ...prev, status: 'running', error: null } : prev)
    try {
      const response = await fetch(`/api/astra/missions/${astraMission.id}/execute`, { method: 'POST' })
      const body = await response.json().catch(() => ({})) as { mission?: {
        id: string
        status: string
        error?: string | null
        outcomeSummary?: string | null
        councilConversationId?: string | null
        terraObjectId?: string | null
        terraProvider?: string | null
        terraEvidenceId?: string | null
      }; error?: string }
      if (body.mission) {
        applyAstraMissionPayload(body.mission)
      } else {
        setAstraMission(prev => prev ? { ...prev, status: 'failed', error: typeof body.error === 'string' ? body.error : 'ASTRA execute failed.' } : prev)
      }
    } finally {
      setAstraBusy(false)
    }
  }, [applyAstraMissionPayload, astraMission?.id, canRunAstraMission])
  const sendSelectedObjectToCouncil = useCallback(() => {
    const payload = areaLiveMedia && areaLiveMediaOpen
      ? buildAreaLiveCouncilHandoff(areaLiveMedia, commanderQuestion)
      : inspectedIntelItem
        ? buildTerraCouncilHandoffFromIntelItem({
          item: inspectedIntelItem,
          commanderPrompt: commanderQuestion,
          terraScope: liveIntelPanel?.scope.label ?? null,
        })
        : selectedLiveObject
          ? buildTerraCouncilHandoffPayload({
            object: selectedLiveObject,
            feature: selectedFeature,
            commanderPrompt: commanderQuestion,
          })
          : null
    if (!payload) return
    try {
      sessionStorage.setItem(TERRA_HANDOFF_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      return
    }
    window.location.href = '/?terraAnalyze=1'
  }, [areaLiveMedia, areaLiveMediaOpen, inspectedIntelItem, selectedLiveObject, selectedFeature, commanderQuestion, liveIntelPanel?.scope.label])
  const sendAreaLiveRowToCouncil = useCallback((row: AreaLiveNearbyRow) => {
    if (!row.media) return
    const payload = buildAreaLiveCouncilHandoff(row.media, commanderQuestion)
    if (!payload) return
    try {
      sessionStorage.setItem(TERRA_HANDOFF_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      return
    }
    window.location.href = '/?terraAnalyze=1'
  }, [commanderQuestion])
  const openAreaLiveRowSource = useCallback((row: AreaLiveNearbyRow) => {
    const url = row.sourceUrl ?? row.media?.sourceUrl ?? row.media?.officialViewerUrl
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }, [])
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

  const clearCameraInspect = useCallback(() => {
    const current = selectionRef.current
    const feature = current.kind === 'feature'
      ? (layerFeaturesRef.current[current.layerId] ?? []).find(item => item.id === current.featureId)
      : undefined
    const isCameraSelection = feature?.kind === 'traffic_camera'
      || (current.kind === 'feature' && DISCOVERY_CAMERA_LAYER_IDS.includes(current.layerId))
    setInspectPinned(false)
    setCameraHover(null)
    setCameraStillNonce(0)
    setAreaLiveMediaOpen(false)
    setAreaLiveOfficialOpen(false)
    setAreaLiveIntelMedia(null)
    setAreaLiveIntelId(null)
    if (isCameraSelection) setSelection({ kind: 'none' })
    if (selectedEventRef.current?.kind === 'traffic_camera') setSelectedEvent(null)
  }, [setSelectedEvent])

  // Location jumps (search / GPS / click) can leave a prior region's camera inspect mounted.
  // Zoom and inspecting the same camera are not context changes and must not clear.
  useEffect(() => {
    const origin = nearbyCameraOriginRef.current
    const nextKey = nearbyCameraOriginKey
    const previous = cameraContextOriginRef.current
    if (origin && nextKey) {
      cameraContextOriginRef.current = { key: nextKey, latitude: origin.latitude, longitude: origin.longitude }
    } else {
      cameraContextOriginRef.current = null
    }
    if (!origin || !nextKey || !previous || previous.key === nextKey) return
    const current = selectionRef.current
    const selectedFeature = current.kind === 'feature'
      ? (layerFeaturesRef.current[current.layerId] ?? []).find(item => item.id === current.featureId)
      : undefined
    const isTrafficCamera = selectedFeature?.kind === 'traffic_camera' || (current.kind === 'feature' && DISCOVERY_CAMERA_LAYER_IDS.includes(current.layerId))
    const radiusKm = CAMERA_DISCOVERY_RADIUS_KM
    const movedKm = haversineKm(previous.latitude, previous.longitude, origin.latitude, origin.longitude)
    const plan = planCameraDiscovery(origin.latitude, origin.longitude, radiusKm)
    const newCameraContext = movedKm > 10
    if (newCameraContext && cameraDiscoveryRef.current.active) {
      setCameraSearchRadiusKm(CAMERA_DISCOVERY_RADIUS_KM)
      applyCameraDiscoveryPlan(origin, { radiusKm })
    }
    // Explicit SEARCH / JUMP is a new investigation context. Being in the discovery radius
    // does not keep a prior camera as the inspected object. Nearby catalog stays.
    if (!cameraInspectSurvivesOriginChange({
      contextType: activeLocationRef.current?.contextType,
      navState: navStateRef.current,
    })) {
      if (isTrafficCamera) clearCameraInspect()
      return
    }
    const holdingCameraView = selectedFeature?.kind === 'traffic_camera'
      && activeLocationRef.current?.contextType === 'EVENT'
    if (holdingCameraView) return
    if (current.kind !== 'feature') return
    if (!isTrafficCamera) return
    const keep = selectedFeature
      ? selectedCameraFitsActiveContext({
        camera: { layerId: current.layerId, latitude: selectedFeature.latitude, longitude: selectedFeature.longitude },
        origin,
        radiusKm,
        plan,
      })
      : false
    if (keep) return
    clearCameraInspect()
    cameraCatalogByLocationRef.current = null
  }, [applyCameraDiscoveryPlan, clearCameraInspect, nearbyCameraOriginKey, selectedEvent, setSelectedEvent])

  const activateCoordinate = useCallback((point: Extract<TerraClickPoint, { ok: true }>, options?: {
    contextType?: TerraContextType
    accuracyMeters?: number | null
    reverse?: boolean
  }) => {
    const contextType = options?.contextType ?? 'CLICK'
    const current = activeLocationRef.current
    const preserveSearchJurisdiction = Boolean(
      current?.contextType === 'SEARCH'
      && current.jurisdictionType
      && (contextType === 'SEARCH' || contextType === 'CAMERA'),
    )
    if (contextType === 'CLICK' || contextType === 'SEARCH' || contextType === 'EVENT') {
      investigationLockRef.current = true
    }
    reverseRequestRef.current.controller?.abort()
    const controller = new AbortController()
    const sequence = reverseRequestRef.current.sequence + 1
    reverseRequestRef.current = { sequence, controller }
    const selectedAt = preserveSearchJurisdiction ? (current?.selectedAt ?? new Date().toISOString()) : new Date().toISOString()
    const previousGps = contextType === 'GPS' ? current : null
    const coordinateLabel = contextType === 'GPS' && options?.accuracyMeters != null
      ? `GPS ±${Math.round(options.accuracyMeters)} m`
      : `${point.latitude.toFixed(4)}°, ${point.longitude.toFixed(4)}°`
    const pending: TerraActiveLocation = {
      latitude: point.latitude,
      longitude: point.longitude,
      height: point.height,
      hasTerrainHeight: point.hasTerrainHeight,
      label: previousGps?.label && previousGps.contextType === 'GPS' && previousGps.reverseGeocodeStatus === 'ok'
        ? previousGps.label
        : coordinateLabel,
      place: previousGps?.contextType === 'GPS' ? previousGps.place ?? null : null,
      address: previousGps?.contextType === 'GPS' ? previousGps.address ?? null : null,
      region: previousGps?.contextType === 'GPS' ? previousGps.region ?? null : null,
      source: 'coordinates',
      sourceLabel: contextType === 'GPS' ? 'Device geolocation' : 'Commander-selected coordinates',
      sourceUrl: null,
      nativePlaceName: previousGps?.contextType === 'GPS' ? previousGps.nativePlaceName ?? null : null,
      englishPlaceName: previousGps?.contextType === 'GPS' ? previousGps.englishPlaceName ?? null : null,
      status: options?.reverse === false ? 'coordinate_only' : 'resolving',
      confidence: 'coordinate_only',
      detail: contextType === 'GPS'
        ? 'Device geolocation with reported accuracy radius. Reverse geocoding is secondary enrichment and never supplies coordinates.'
        : 'Exact coordinate is active while reverse geocoding resolves the supported place or address.',
      selectedAt,
      contextType,
      accuracyMeters: options?.accuracyMeters ?? null,
      city: previousGps?.contextType === 'GPS' ? previousGps.city ?? null : null,
      county: previousGps?.contextType === 'GPS' ? previousGps.county ?? null : null,
      state: previousGps?.contextType === 'GPS' ? previousGps.state ?? null : null,
      country: previousGps?.contextType === 'GPS' ? previousGps.country ?? null : null,
      countryCode: previousGps?.contextType === 'GPS' ? previousGps.countryCode ?? null : null,
      reverseGeocodeStatus: options?.reverse === false
        ? (previousGps?.reverseGeocodeStatus === 'ok' ? 'ok' : previousGps?.reverseGeocodeStatus ?? 'unavailable')
        : 'pending',
    }
    if (!preserveSearchJurisdiction) setActiveLocation(pending)
    if (options?.reverse === false) return

    const params = new URLSearchParams({ lat: String(point.latitude), lon: String(point.longitude) })
    if (point.height !== null) params.set('height', String(point.height))
    if (point.hasTerrainHeight) params.set('terrain', '1')
    void fetch(`/api/terra/resolve-location?${params}`, { cache: 'no-store', credentials: 'include', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Resolver returned HTTP ${response.status}.`)
        return response.json() as Promise<TerraReverseLocationResolution>
      })
      .then(result => {
        if (isTerraRequestStale(sequence, reverseRequestRef.current.sequence)) return
        if (!inspectEnrichAppliesTo(
          { latitude: pending.latitude, longitude: pending.longitude },
          { latitude: result.location.latitude, longitude: result.location.longitude },
        )) return
        const current = activeLocationRef.current
        if (contextType === 'SEARCH' && current?.contextType === 'SEARCH' && current.jurisdictionType) {
          setActiveLocation(enrichSearchWithReverse(current, result.location))
          return
        }
        if (contextType === 'CAMERA' && current?.contextType === 'SEARCH') {
          setActiveLocation(enrichSearchWithReverse(current, result.location))
          return
        }
        const reverseFailed = result.status === 'coordinate_only'
        if (contextType === 'GPS' && reverseFailed && previousGps?.place) {
          deviceLocalityRef.current = { label: previousGps.place, status: 'stale' }
          setActiveLocation({
            ...pending,
            ...previousGps,
            latitude: pending.latitude,
            longitude: pending.longitude,
            height: pending.height,
            hasTerrainHeight: pending.hasTerrainHeight,
            accuracyMeters: pending.accuracyMeters,
            selectedAt,
            contextType: 'GPS',
            sourceLabel: 'Device geolocation',
            status: 'coordinate_only',
            reverseGeocodeStatus: 'stale',
            detail: `Coordinates remain valid. Reverse locality is STALE. ${result.location.detail}`,
          })
          return
        }
        if (contextType === 'GPS') {
          deviceLocalityRef.current = {
            label: reverseFailed ? formatCoordinateFallback(pending.latitude, pending.longitude) : (result.location.place ?? result.location.label),
            status: reverseFailed ? 'unavailable' : 'ok',
          }
        }
        const promoted = promoteMeaningfulAdmin({
          ...result.location,
          selectedAt,
          contextType,
          accuracyMeters: pending.accuracyMeters ?? null,
          sourceLabel: contextType === 'GPS' ? 'Device geolocation' : result.location.sourceLabel,
          zoomLevel: cameraMetaRef.current.zoom,
          bbox: cameraMetaRef.current.bbox,
          reverseGeocodeStatus: reverseFailed ? 'unavailable' : 'ok',
        })
        setActiveLocation(promoted)
      })
      .catch(error => {
        if (controller.signal.aborted || isTerraRequestStale(sequence, reverseRequestRef.current.sequence)) return
        if (contextType === 'GPS' && previousGps?.place) {
          deviceLocalityRef.current = { label: previousGps.place, status: 'stale' }
          setActiveLocation({
            ...pending,
            label: previousGps.label,
            place: previousGps.place,
            city: previousGps.city,
            county: previousGps.county,
            state: previousGps.state,
            country: previousGps.country,
            status: 'coordinate_only',
            reverseGeocodeStatus: 'stale',
            detail: `Coordinates remain valid. Reverse locality is STALE. ${error instanceof Error ? error.message : String(error)}`,
          })
          return
        }
        if (contextType === 'GPS') {
          deviceLocalityRef.current = { label: formatCoordinateFallback(pending.latitude, pending.longitude), status: 'unavailable' }
        }
        setActiveLocation({
          ...pending,
          status: 'coordinate_only',
          reverseGeocodeStatus: 'unavailable',
          detail: `Reverse geocoding unavailable: ${error instanceof Error ? error.message : String(error)}. Coordinates remain valid.`,
        })
      })
  }, [setActiveLocation])

  const handleGroundClick = useCallback((point: TerraClickPoint) => {
    commandNav('GROUND_INSPECT')
    setAreaLiveMediaOpen(false)
    setAreaLiveOfficialOpen(false)
    setSelection(point.ok ? { kind: 'ground', point } : { kind: 'miss' })
    // A ground click is Earth Knowledge-only (mission section 14) — never the full
    // event-intelligence path, so any previously selected event/Related Intelligence context is
    // cleared rather than left stale alongside a now-unrelated active location.
    setSelectedEvent(null)
    if (point.ok) activateCoordinate(point)
  }, [activateCoordinate, commandNav, setSelectedEvent])

  // Event -> exact-location intelligence phase: flies the Cesium camera to the event's own
  // observed coordinates (never a re-geocoded or inferred position — see
  // lib/terra/eventCameraFraming.ts), framed by kind/geometry rather than one fixed altitude for
  // every event. A destroyed/not-yet-ready viewer is a legitimate skip, not an error — the
  // observed-data panel and reverse-geocoded Earth Knowledge context remain available regardless.
  const flyToEventFeature = useCallback((feature: TerraGeoFeature) => {
    if (!viewer || viewer.isDestroyed()) return
    const isCamera = feature.kind === 'traffic_camera'
    commandNav(isCamera ? 'CAMERA_VIEW' : 'SEARCH_GO')
    const flightOptions = {
      purpose: isCamera ? 'camera' as const : 'event' as const,
      label: feature.title,
      onComplete: () => {
        commandNav('FLIGHT_COMPLETE')
        if (isCamera) setAreaLiveMediaOpen(true)
      },
    }
    if (isCamera) {
      cinematicFlight.flyTo({
        longitude: feature.longitude,
        latitude: feature.latitude,
        altitudeMeters: CAMERA_INSPECT_ALTITUDE_M,
        placeType: 'traffic_camera',
        headingDegrees: sourcedCameraBearingDegrees(feature.properties.bearing ?? feature.properties.direction),
      }, flightOptions)
      return
    }
    const framing = resolveTerraEventCameraFraming(feature)
    if (framing.mode === 'rectangle') {
      cinematicFlight.flyTo({
        longitude: feature.longitude,
        latitude: feature.latitude,
        boundingBox: { west: framing.west, south: framing.south, east: framing.east, north: framing.north },
        placeType: feature.kind,
      }, flightOptions)
      return
    }
    cinematicFlight.flyTo({
      longitude: framing.longitude,
      latitude: framing.latitude,
      altitudeMeters: framing.altitudeMeters,
      placeType: feature.kind,
    }, flightOptions)
  }, [cinematicFlight, commandNav, viewer])

  const closeWeatherDrawer = useCallback(() => {
    setWeatherDrawerAlert(null)
    setWeatherOverlayAlert(null)
  }, [])

  const viewWeatherAlert = useCallback((alert: WeatherAlert) => {
    setWeatherDrawerAlert(alert)
    setWeatherOverlayAlert(alert.rings?.length ? alert : null)
    weatherAlerts.dismissToast()
    setSelection({ kind: 'feature', layerId: NWS_WEATHER_LAYER_ID, featureId: alert.id })
    const plan = resolveWeatherFlyPlan(alert)
    if (plan.action !== 'fit-polygon' && plan.action !== 'fit-bbox') return
    if (!viewer || viewer.isDestroyed()) return
    commandNav('SEARCH_GO')
    cinematicFlight.flyTo({
      longitude: plan.longitude,
      latitude: plan.latitude,
      boundingBox: { west: plan.west, south: plan.south, east: plan.east, north: plan.north },
      placeType: 'severe_weather_alert',
    }, {
      purpose: 'event',
      label: alert.event ?? 'NWS weather alert',
      onComplete: () => commandNav('FLIGHT_COMPLETE'),
    })
  }, [cinematicFlight, commandNav, viewer, weatherAlerts.dismissToast])

  const sendWeatherToCouncil = useCallback((alert: WeatherAlert) => {
    const payload = buildWeatherCouncilHandoff(alert, commanderQuestion)
    try {
      sessionStorage.setItem(TERRA_HANDOFF_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      return
    }
    window.location.href = '/?terraAnalyze=1'
  }, [commanderQuestion])
  const flyToIntelItem = useCallback((item: TerraLiveIntelItem) => {
    const feature = intelItemToGeoFeature(item)
    if (!feature) return
    setInspectedIntelItem(item)
    activateCoordinate({ ok: true, latitude: feature.latitude, longitude: feature.longitude, height: feature.altitude, hasTerrainHeight: false }, { contextType: 'EVENT' })
    flyToEventFeature(feature)
  }, [activateCoordinate, flyToEventFeature])
  const inspectIntelItem = useCallback((item: TerraLiveIntelItem | null) => {
    if (!item) {
      setInspectedIntelItem(null)
      return
    }
    setInspectedIntelItem(item)
    commandNav('GROUND_INSPECT')
    if (item.lat !== null && item.lon !== null) {
      activateCoordinate({ ok: true, latitude: item.lat, longitude: item.lon, height: null, hasTerrainHeight: false }, { contextType: 'EVENT' })
    }
    const hosted = Object.entries(layerFeatures).find(([, features]) => features.some(feature => feature.id === item.id))
    setSelection({
      kind: 'feature',
      layerId: hosted?.[0] ?? 'live_intel_overlay',
      featureId: item.id,
    })
    if (item.eventType === 'severe_weather_alert') {
      const hostedFeature = hosted ? (layerFeatures[hosted[0]] ?? []).find(feature => feature.id === item.id) : null
      const alert = hostedFeature ? weatherAlertFromFeature(hostedFeature, new Date().toISOString()) : weatherAlerts.alerts.find(entry => entry.id === item.id)
      if (alert) {
        setWeatherDrawerAlert(alert)
        setWeatherOverlayAlert(alert.rings?.length ? alert : null)
      }
    }
  }, [activateCoordinate, commandNav, layerFeatures, weatherAlerts.alerts])
  const liveIntelOverlayFeatures = useMemo(() => {
    if (!liveIntelPanel) return []
    const existing = new Set(
      Object.entries(layerFeatures)
        .filter(([layerId]) => layerId !== 'live_intel_overlay')
        .flatMap(([, features]) => features.map(feature => feature.id)),
    )
    const features = overlayFeaturesFromPanel(liveIntelPanel, existing)
    return cameraScale.level === 'global' ? features.slice(0, 24) : features
  }, [liveIntelPanel, layerFeatures, cameraScale.level])
  const liveIntelOverlaySelectedId = selection.kind === 'feature' && selection.layerId === 'live_intel_overlay' ? selection.featureId : null
  const weatherOverlayFeatures = useMemo(() => {
    if (!weatherOverlayAlert?.rings?.length) return []
    return (layerFeatures[NWS_WEATHER_LAYER_ID] ?? []).filter(feature => feature.id === weatherOverlayAlert.id)
  }, [weatherOverlayAlert, layerFeatures])
  useEffect(() => {
    if (activeLocation?.contextType === 'SEARCH') {
      setWeatherOverlayAlert(null)
      setWeatherDrawerAlert(null)
    }
  }, [activeLocation?.contextType, activeLocation?.latitude, activeLocation?.longitude])
  useEffect(() => {
    if (!weatherDrawerAlert) return
    const next = weatherAlerts.alerts.find(entry => entry.id === weatherDrawerAlert.id)
    if (next && next.lifecycle !== weatherDrawerAlert.lifecycle) {
      setWeatherDrawerAlert(next)
      setWeatherOverlayAlert(next.rings?.length ? next : null)
    }
  }, [weatherAlerts.alerts, weatherDrawerAlert])
  useEffect(() => {
    const timeout = setTimeout(() => handleFeaturesChange('live_intel_overlay', liveIntelOverlayFeatures), 0)
    return () => clearTimeout(timeout)
  }, [liveIntelOverlayFeatures, handleFeaturesChange])

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
      activateCoordinate({ ok: true, latitude: feature.latitude, longitude: feature.longitude, height: feature.altitude, hasTerrainHeight: false }, { contextType: 'EVENT' })
      setSelectedEvent(feature)
      flyToEventFeature(feature)
      if (feature.kind === 'severe_weather_alert') {
        const alert = weatherAlertFromFeature(feature, new Date().toISOString())
        if (alert) {
          setWeatherDrawerAlert(alert)
          setWeatherOverlayAlert(alert.rings?.length ? alert : null)
        }
      }
      if (feature.kind === 'traffic_camera') {
        setInspectPinned(true)
        setAreaLiveOpen(true)
        setGodsEyeViewMode('AREA_LIVE')
        setAreaLiveCategory('CAMERAS')
        setAreaLiveOfficialOpen(false)
        setAreaLiveMediaOpen(false)
        setAreaLiveIntelMedia(null)
        setAreaLiveIntelId(null)
      } else if (areaLiveOpen || godsEyeViewMode === 'AREA_LIVE') {
        const item = findPanelItem(liveIntelPanel, feature.id)
        if (item) {
          setAreaLiveIntelId(item.id)
          setAreaLiveIntelMedia(buildAreaLiveIntelMedia(item))
          setAreaLiveOfficialOpen(false)
          setAreaLiveMediaOpen(true)
          commandNav('AREA_LIVE_MEDIA')
        } else {
          setAreaLiveMediaOpen(false)
          setAreaLiveOfficialOpen(false)
        }
      } else {
        setAreaLiveMediaOpen(false)
        setAreaLiveOfficialOpen(false)
      }
    }
  }, [activateCoordinate, areaLiveOpen, commandNav, godsEyeViewMode, layerFeatures, liveIntelPanel, setSelectedEvent, flyToEventFeature])
  const viewAreaLiveRow = useCallback((row: AreaLiveNearbyRow) => {
    setAreaLiveHoverRowId(null)
    setAreaLiveMediaExpanded(true)
    if (row.cameraRef) {
      handleEntityClick(`${row.cameraRef.layerId}:${row.cameraRef.id}`)
      return
    }
    if (row.media) {
      commandNav('AREA_LIVE_MEDIA')
      setAreaLiveIntelId(row.intelItemId)
      setAreaLiveIntelMedia(row.media)
      setAreaLiveMediaOpen(true)
      setAreaLiveOfficialOpen(false)
      if (row.latitude != null && row.longitude != null) {
        activateCoordinate({ ok: true, latitude: row.latitude, longitude: row.longitude, height: null, hasTerrainHeight: false }, { contextType: 'EVENT' })
        cinematicFlight.flyTo({
          longitude: row.longitude,
          latitude: row.latitude,
          altitudeMeters: CAMERA_INSPECT_ALTITUDE_M,
          placeType: 'place',
        }, {
          purpose: 'inspect',
          label: row.title,
          onComplete: () => commandNav('FLIGHT_COMPLETE'),
        })
      }
      if (row.intelItemId) {
        const item = findPanelItem(liveIntelPanel, row.intelItemId)
        if (item) inspectIntelItem(item)
      }
    }
  }, [activateCoordinate, cinematicFlight, commandNav, handleEntityClick, inspectIntelItem, liveIntelPanel])
  const previewAreaLiveRow = useCallback((row: AreaLiveNearbyRow) => {
    if (areaLiveMediaExpanded) return
    if (row.kind !== 'VIDEO' || !row.media || !isAreaLivePlayableVideo(row.media.kind)) return
    setAreaLiveHoverRowId(row.id)
    if (selectedFeature?.kind === 'traffic_camera') return
    setAreaLiveIntelId(row.intelItemId)
    setAreaLiveIntelMedia(row.media)
    setAreaLiveMediaOpen(true)
    setAreaLiveOfficialOpen(false)
  }, [areaLiveMediaExpanded, selectedFeature?.kind])
  const endAreaLivePreview = useCallback(() => {
    if (areaLiveMediaExpanded) return
    setAreaLiveHoverRowId(null)
  }, [areaLiveMediaExpanded])
  const handleClusterClick = useCallback((cluster: TerraClusterPick) => {
    clearCameraInspect()
    commandNav('SEARCH_GO')
    const hasBounds = typeof cluster.west === 'number' && typeof cluster.east === 'number'
      && typeof cluster.south === 'number' && typeof cluster.north === 'number'
      && Number.isFinite(cluster.west) && Number.isFinite(cluster.east)
      && Number.isFinite(cluster.south) && Number.isFinite(cluster.north)
    cinematicFlight.flyTo({
      longitude: cluster.longitude,
      latitude: cluster.latitude,
      altitudeMeters: CAMERA_CLUSTER_ALTITUDE_M,
      placeType: 'camera_cluster',
      boundingBox: hasBounds
        ? { west: cluster.west!, south: cluster.south!, east: cluster.east!, north: cluster.north! }
        : null,
    }, {
      purpose: 'inspect',
      label: `${cluster.count} cameras`,
      onComplete: () => commandNav('FLIGHT_COMPLETE'),
    })
  }, [cinematicFlight, clearCameraInspect, commandNav])
  const selectFederatedCamera = useCallback((row: { id: string; layerId: string }) => {
    handleEntityClick(`${row.layerId}:${row.id}`)
  }, [handleEntityClick])

  const handleUrbanBuildingClick = useCallback((building: Parameters<typeof urbanBuildingToSelection>[0]) => {
    commandNav('BUILDING_INSPECT')
    setSelection({ kind: 'urban-building', building: urbanBuildingToSelection(building) })
    setSelectedEvent(null)
    activateCoordinate({ ok: true, latitude: building.latitude, longitude: building.longitude, height: building.heightMeters, hasTerrainHeight: false })
  }, [activateCoordinate, commandNav, setSelectedEvent])

  const handleUrbanRoadClick = useCallback((road: TerraUrbanRoad) => {
    commandNav('BUILDING_INSPECT')
    setSelection({ kind: 'urban-road', road })
    setSelectedEvent(null)
    activateCoordinate({ ok: true, latitude: road.geometry[0]?.latitude ?? 0, longitude: road.geometry[0]?.longitude ?? 0, height: null, hasTerrainHeight: false })
  }, [activateCoordinate, commandNav, setSelectedEvent])

  const handleUrbanSignalClick = useCallback((signal: TerraUrbanSignal) => {
    commandNav('BUILDING_INSPECT')
    setSelection({ kind: 'urban-signal', signal })
    setSelectedEvent(null)
    activateCoordinate({ ok: true, latitude: signal.latitude, longitude: signal.longitude, height: null, hasTerrainHeight: false })
  }, [activateCoordinate, commandNav, setSelectedEvent])

  const handleOsmBuildingsFeatureClick = useCallback((building: TerraUrbanSelection) => {
    commandNav('BUILDING_INSPECT')
    setSelection({ kind: 'urban-building', building })
    setSelectedEvent(null)
    activateCoordinate({ ok: true, latitude: building.latitude, longitude: building.longitude, height: building.heightMeters, hasTerrainHeight: false })
  }, [activateCoordinate, commandNav, setSelectedEvent])

  const handleResolvedLocation = useCallback((target: TerraLocationTarget) => {
    reverseRequestRef.current.controller?.abort()
    reverseRequestRef.current = { sequence: reverseRequestRef.current.sequence + 1, controller: null }
    clearCameraInspect()
    const selectedAt = new Date().toISOString()
    const selected = selectedJurisdictionFromSearch({
      query: target.query?.trim() || target.label,
      label: target.label,
      latitude: target.latitude,
      longitude: target.longitude,
      nativeName: target.nativeName,
      englishName: target.englishName,
    })
    const provenance = searchProvenance(target.source)
    investigationLockRef.current = true
    gps.setFollowCamera(false)
    const searchLocation: TerraActiveLocation = {
      latitude: target.latitude,
      longitude: target.longitude,
      height: null,
      hasTerrainHeight: false,
      label: target.label,
      place: provenance.resolved ? target.label : null,
      address: provenance.resolved ? target.label : null,
      region: null,
      source: provenance.source,
      sourceLabel: provenance.sourceLabel,
      sourceUrl: target.sourceUrl,
      nativePlaceName: target.nativeName,
      englishPlaceName: target.englishName,
      status: provenance.resolved ? 'resolved' : 'coordinate_only',
      confidence: provenance.resolved ? 'provider_supported' : 'coordinate_only',
      detail: provenance.resolved
        ? 'Commander-selected jurisdiction is the LOCAL query context. Live GPS continues privately if FOLLOW ME is on.'
        : 'Exact typed coordinates; reverse place context was not requested.',
      selectedAt,
      contextType: 'SEARCH',
      city: selected.city,
      county: selected.county,
      state: selected.state,
      country: selected.country,
      countryCode: selected.countryCode,
      searchQuery: selected.searchQuery,
      jurisdictionType: selected.jurisdictionType,
      bbox: target.boundingBox
        ? { west: target.boundingBox.west, south: target.boundingBox.south, east: target.boundingBox.east, north: target.boundingBox.north }
        : null,
    }
    setActiveLocation(searchLocation)
    commandNav(target.instantRequested ? 'JUMP' : 'SEARCH_GO')
    cinematicFlight.flyTo({
      longitude: target.longitude,
      latitude: target.latitude,
      boundingBox: target.boundingBox,
      placeType: target.placeType,
      instantRequested: target.instantRequested,
    }, {
      purpose: target.instantRequested ? 'jump' : 'search',
      label: target.label,
      onComplete: () => {
      commandNav('FLIGHT_COMPLETE')
      flyCompleteAtRef.current = Date.now()
      lastViewportContextRef.current = {
        lat: target.latitude,
        lon: target.longitude,
        zoomLevel: godsEyeZoomRungForTerraScale(cameraScale.level),
      }
      if (!viewer || viewer.isDestroyed()) return
      const enrichController = new AbortController()
      reverseRequestRef.current = { sequence: reverseRequestRef.current.sequence + 1, controller: enrichController }
      const params = new URLSearchParams({ lat: String(target.latitude), lon: String(target.longitude) })
      void fetch(`/api/terra/resolve-location?${params}`, { cache: 'no-store', credentials: 'include', signal: enrichController.signal })
        .then(async response => {
          if (!response.ok) throw new Error(`Resolver returned HTTP ${response.status}.`)
          return response.json() as Promise<TerraReverseLocationResolution>
        })
        .then(result => {
          const current = activeLocationRef.current
          if (!current || current.contextType !== 'SEARCH' || current.selectedAt !== selectedAt) return
          setActiveLocation(enrichSearchWithReverse(current, result.location))
        })
        .catch(() => undefined)
      void loadCesium().then(Cesium => {
        if (viewer.isDestroyed()) return
        const carto = Cesium.Cartographic.fromDegrees(target.longitude, target.latitude)
        const sampled = viewer.scene.globe.getHeight(carto)
        if (typeof sampled !== 'number' || !Number.isFinite(sampled)) return
        const current = activeLocationRef.current
        if (current && current.contextType === 'SEARCH' && current.selectedAt === selectedAt) {
          setActiveLocation({ ...current, height: sampled, hasTerrainHeight: true })
        }
      })
      },
    })
  }, [cameraScale.level, cinematicFlight, clearCameraInspect, commandNav, gps, setActiveLocation, viewer])

  useEffect(() => {
    if (gps.tracking === 'OFF' && !gps.location) {
      gpsCenteredRef.current = false
      gpsAppliedRef.current = null
      reverseGeocodeAtRef.current = null
    }
    if (gps.tracking === 'OFF' && gps.mode === 'OFF' && !gps.location) {
      investigationLockRef.current = false
    }
  }, [gps.location, gps.mode, gps.tracking])

  const flyToCommander = useCallback((location: { lat: number; lon: number }) => {
    cinematic.pause()
    cinematicFlight.flyTo({
      longitude: location.lon,
      latitude: location.lat,
      placeType: 'place/local',
    }, {
      purpose: 'gps',
      label: 'Commander GPS',
      onComplete: () => {
        flyCompleteAtRef.current = Date.now()
        lastViewportContextRef.current = {
          lat: location.lat,
          lon: location.lon,
          zoomLevel: godsEyeZoomRungForTerraScale(cameraScale.level),
        }
      },
    })
  }, [cameraScale.level, cinematic, cinematicFlight])

  const returnToMe = useCallback(() => {
    if (!gps.location) return
    investigationLockRef.current = false
    gps.setFollowCamera(true)
    flyToCommander(gps.location)
    activateCoordinate({
      ok: true,
      latitude: gps.location.lat,
      longitude: gps.location.lon,
      height: gps.location.altitude,
      hasTerrainHeight: gps.location.altitude !== null,
    }, { contextType: 'GPS', accuracyMeters: gps.location.accuracyMeters })
  }, [activateCoordinate, flyToCommander, gps])

  useEffect(() => {
    if (!gps.location) return
    const investigating = investigationLockRef.current || (
      Boolean(activeLocationRef.current)
      && activeLocationRef.current?.contextType !== 'GPS'
      && (metersBetween(gps.location, { lat: activeLocationRef.current!.latitude, lon: activeLocationRef.current!.longitude }) ?? 0) > 400
    )
    if (investigating) {
      if (!gpsCenteredRef.current) gpsCenteredRef.current = true
      return
    }
    if (navState === 'COMMANDER_INSPECT' || navState === 'CAMERA_FLY' || navState === 'SEARCH_FLY') return
    const fix = gps.location
    const movement = classifyLocationMovement(gpsAppliedRef.current, fix)
    const firstFix = !gpsCenteredRef.current
    if (firstFix || (gps.followCamera && movement !== 'none')) {
      gpsCenteredRef.current = true
      flyToCommander(fix)
    }
    const refreshIntel = firstFix || shouldRefreshLocalIntel({ previous: gpsAppliedRef.current, next: fix })
    if (!refreshIntel) return
    gpsAppliedRef.current = { lat: fix.lat, lon: fix.lon, at: Date.now() }
    const reverse = shouldReverseGeocode({ previous: reverseGeocodeAtRef.current, next: fix })
    if (reverse) reverseGeocodeAtRef.current = { lat: fix.lat, lon: fix.lon, at: Date.now() }
    activateCoordinate({
      ok: true,
      latitude: fix.lat,
      longitude: fix.lon,
      height: fix.altitude,
      hasTerrainHeight: fix.altitude !== null,
    }, { contextType: 'GPS', accuracyMeters: fix.accuracyMeters, reverse })
  }, [activateCoordinate, flyToCommander, gps.followCamera, gps.location, navState])

  useEffect(() => {
    if (!cameraViewRectangle.settledAt) return
    if (cinematicFlight.flying) return
    const zoom = godsEyeZoomRungForTerraScale(cameraScale.level)
    const center = rectangleCenter(cameraViewRectangle.rectangle)
    if (!center) return
    if (gps.followCamera && gps.location) {
      const distanceKm = haversineKm(gps.location.lat, gps.location.lon, center.latitude, center.longitude)
      if (distanceKm > followSuspendDistanceKm(zoom) && Date.now() - flyCompleteAtRef.current > 1500) {
        gps.setFollowCamera(false)
      }
      return
    }
    if (gps.mode === 'FOLLOW_ME' && investigationLockRef.current) return
    if (zoom === 'PLANET') return
    if (Date.now() - flyCompleteAtRef.current < 4000) return
    if (activeLocationRef.current?.contextType === 'SEARCH') return
    if (navState === 'CAMERA_FLY' || navState === 'COMMANDER_INSPECT' || navState === 'SEARCH_FLY') return
    if (areaLiveMediaOpenRef.current) return
    const currentSel = selectionRef.current
    if (currentSel.kind === 'feature') {
      const selected = (layerFeaturesRef.current[currentSel.layerId] ?? []).find(item => item.id === currentSel.featureId)
      if (selected?.kind === 'traffic_camera') return
    }
    const next = { lat: center.latitude, lon: center.longitude, zoomLevel: zoom }
    if (!contextMovedMaterially(lastViewportContextRef.current, next)) return
    lastViewportContextRef.current = next
    if (gps.location && (metersBetween(gps.location, { lat: center.latitude, lon: center.longitude }) ?? 0) > 400) {
      investigationLockRef.current = true
    }
    activateCoordinate({
      ok: true,
      latitude: center.latitude,
      longitude: center.longitude,
      height: null,
      hasTerrainHeight: false,
    }, { contextType: 'CAMERA' })
  }, [activateCoordinate, cameraScale.level, cameraViewRectangle.rectangle, cameraViewRectangle.settledAt, cinematicFlight.flying, gps, navState])

  const commandCenter = presentation === 'command-center'

  // Smart Click's primary-panel router (mission section 6/11 of the Smart Click completion
  // brief): a real Commander click already drives `selection`/`selectedFeature` and
  // `streetViewOpen` — this just classifies what was actually clicked and asks the workspace
  // store to front/pulse the one relevant panel. Explicitly a no-op in command-center
  // presentation, since Smart Click only applies inside Terra Workspace (mission section 9).
  useEffect(() => {
    if (commandCenter) return
    const api = workspaceLayoutApiRef.current
    if (!api) return
    let kind: TerraSmartClickInteractionKind | null = null
    if (selection.kind === 'feature' && selectedFeature) {
      if (selectedFeature.kind === 'traffic_camera') kind = 'camera'
      else if (selectedFeature.kind === 'severe_weather_alert' || selectedFeature.kind === 'tsunami_alert') kind = 'weather_alert'
      else if (
        selectedFeature.kind === 'earthquake'
        || selectedFeature.kind === 'tropical_cyclone'
        || selectedFeature.kind === 'wildfire_incident'
        || selectedFeature.kind === 'volcano_event'
        || selectedFeature.kind === 'flood_event'
        || selectedFeature.kind === 'traffic_event'
      ) kind = 'hazard_or_event'
      else kind = 'building_or_object'
    } else if (selection.kind === 'ground') {
      kind = 'location'
    }
    if (!kind) return
    api.store.notifyInteraction(kind, api.getViewport(), api.getSizes())
  }, [commandCenter, selection, selectedFeature])

  useEffect(() => {
    if (commandCenter) return
    if (!streetViewOpen || !streetViewOrigin) return
    const api = workspaceLayoutApiRef.current
    if (!api) return
    api.store.notifyInteraction('street_view_point', api.getViewport(), api.getSizes())
  }, [commandCenter, streetViewOpen, streetViewOrigin])
  const viewingDetached = Boolean(
    gps.location
    && activeLocation
    && activeLocation.contextType !== 'GPS'
    && (metersBetween(gps.location, { lat: activeLocation.latitude, lon: activeLocation.longitude }) ?? 0) > 400,
  )
  const deviceLabel = deviceLocalityRef.current.label
    ?? (gps.location ? formatCoordinateFallback(gps.location.lat, gps.location.lon) : null)
  const viewingLabel = activeLocation
    ? compactLocalLabel({
      city: activeLocation.city,
      county: activeLocation.county,
      state: activeLocation.state,
      countryCode: activeLocation.countryCode,
      placeName: activeLocation.place ?? activeLocation.label,
    }) ?? activeLocation.label
    : null
  const locationControl = (
    <TerraGpsControl
      gps={gps}
      deviceLabel={deviceLabel}
      viewingLabel={viewingLabel}
      viewingDetached={viewingDetached}
      reverseGeocodeStatus={activeLocation?.contextType === 'GPS' ? activeLocation.reverseGeocodeStatus ?? deviceLocalityRef.current.status : deviceLocalityRef.current.status}
      onReturnToMe={returnToMe}
    />
  )

  return (
    <div className={`overflow-hidden bg-black text-white ${commandCenter ? 'relative h-full min-h-0' : 'flex h-screen w-full flex-col'}`}>
      {!commandCenter ? (
        <header
          data-testid="terra-workspace-header"
          className="relative isolate z-[80] flex shrink-0 items-center gap-3 border-b border-emerald-500/40 bg-black px-3 py-2"
        >
          <WarRoomBackControl variant="overlay" label="WAR ROOM" className="relative z-[1] shrink-0" />
          <div className="flex min-w-0 items-center gap-2">
            <span className="terra-live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            <h1 className="text-[12px] font-bold uppercase tracking-[0.22em] text-emerald-300">WAR ROOM · TERRA</h1>
            {cinematic.orbiting ? <span className="text-[8px] uppercase tracking-widest text-cyan-300/80">live orbit</span> : null}
          </div>
          {highResAerialUnavailable && (
            <button
              type="button"
              onClick={() => setMapDetailMode(v => !v)}
              className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-950/40 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-amber-300 hover:bg-amber-900/50"
              title="NASA GIBS is a real daily photograph capped at city-scale resolution; no ion-backed aerial asset is available at this zoom. OSM map-detail is already the visible fallback. Toggle still forces OSM at any altitude."
            >
              {TERRA_HIGH_RES_AERIAL_UNAVAILABLE_MESSAGE}
              <span className="text-cyan-300">{TERRA_FALLBACK_IMAGERY_ACTIVE_MESSAGE}</span>
              <span className="text-cyan-300">{mapDetailMode ? TERRA_CLOSE_MAP_DETAIL_LABEL : TERRA_OPEN_MAP_DETAIL_LABEL}</span>
            </button>
          )}
        </header>
      ) : null}
      <div className={commandCenter ? 'contents' : 'relative min-h-0 flex-1'}>
      <TerraGlobe onStatusChange={setGlobeStatus} onViewerReady={setViewer} onBuildingsTilesetReady={setBuildingsTileset} onEntityClick={handleEntityClick} onClusterClick={handleClusterClick} onUrbanBuildingClick={handleUrbanBuildingClick} onUrbanRoadClick={handleUrbanRoadClick} onUrbanSignalClick={handleUrbanSignalClick} onOsmBuildingsFeatureClick={handleOsmBuildingsFeatureClick} onGroundClick={handleGroundClick} onEntityHover={handleEntityHover} onDoubleClick={handleToggleCinematic} />
      <TerraGpsMarker viewer={viewer} location={gps.location} visible={Boolean(gps.location)} />
      <TerraEarthImagery
        viewer={viewer}
        selectedTime={clock.time.currentTime}
        hasIonToken={globeStatus.phase === 'ready' && globeStatus.hasIonToken}
        mapDetailMode={mapDetailMode}
        onAerialImageryAvailabilityChange={setAerialImageryAvailable}
      />
      <TerraRadarImagery
        viewer={viewer}
        enabled={radar.viewState.showLayer}
        urlTemplate={radar.selected?.tileUrlTemplate ?? null}
        opacity={radar.opacity}
      />
      <TerraUrbanDetail
        viewer={viewer}
        scaleLevel={cameraScale.level}
        rectangle={cameraViewRectangle.rectangle}
        enabled={urbanDetailEnabled}
        extrudeBuildings={buildingExtrusionEnabled}
        hasWorldTerrain={globeStatus.phase === 'ready' && globeStatus.hasRealTerrain}
        onStatusChange={setUrbanStatus}
      />
      <TerraCesiumOsmBuildings viewer={viewer} enabled={ionBuildingsFallbackActive} />
      <TerraReEarthBuildings viewer={viewer} enabled={reEarthBuildingsEnabled} scaleLevel={cameraScale.level} onStatusChange={setReEarthBuildingsRuntime} />
      <TerraReEarthTerrain viewer={viewer} enabled={reEarthTerrainEnabled} onStatusChange={setReEarthTerrainRuntime} />
      <TerraFeatureLayer layerId="nearby_landmarks" viewer={viewer} enabled={nearbyLandmarksQuery !== null} features={nearbyLandmarks.features} selectedId={nearbySelectedId} cluster />
      {/* Live-aviation phase: rendered unconditionally in both presentations (mission section 15
          requires event click/selection to work on both the front-page God's Eye and the full
          /terra workspace) — `cluster` so a dense region simplifies at broad zoom instead of
          becoming an overlapping-marker mess (mission section 3/14). */}
      <TerraFeatureLayer layerId="opensky" viewer={viewer} enabled={aircraftBoundingBoxQuery !== null} features={aircraft.features} selectedId={aircraftSelectedId} cluster trails={aircraftTrails} />
      {/* Terra Phase 3 — Maritime Source Federation: same bespoke camera-bbox-driven pattern as
          aircraft above, rendered unconditionally in both presentations for the same reason. */}
      <TerraFeatureLayer layerId="digitraffic_marine" viewer={viewer} enabled={maritimeBoundingBoxQuery !== null} features={maritime.features} selectedId={maritimeSelectedId} cluster trails={maritimeTrails} />
      <TerraFeatureLayer layerId="live_intel_overlay" viewer={viewer} enabled={liveIntelOverlayFeatures.length > 0} features={liveIntelOverlayFeatures} selectedId={liveIntelOverlaySelectedId} cluster={cameraScale.level === 'global' || cameraScale.level === 'regional'} />
      <TerraFeatureLayer layerId="weather_alert_overlay" viewer={viewer} enabled={weatherOverlayFeatures.length > 0} features={weatherOverlayFeatures} selectedId={weatherOverlayAlert?.id ?? null} />
      {/* God's Eye Traffic phases 1–3: all 13 bounded-coverage traffic layers render through the
          one generic TerraTrafficLayer (terraTrafficLayerDefs.ts). In the full workspace the
          toggle/status rows live in the Data Layers rail below (the {!commandCenter} mount);
          here in command-center mode the same components mount headless (hideControls) so event
          markers still fetch and render — the two mounts are mutually exclusive, so no layer is
          ever fetched twice. */}
      <TerraCameraCoverageOverlay
        viewer={viewer}
        enabled={camerasMode && cameraLodPolicy.showCoverageEnvelopes}
        providers={cameraProvidersInView}
      />
      {commandCenter && TERRA_TRAFFIC_LAYER_DEFS.map(def => (
        <TerraTrafficLayer
          key={def.layerId}
          def={def}
          viewer={viewer}
          selection={selection}
          onFeaturesChange={handleFeaturesChange}
          timeMode={clock.time.mode}
          cameraScaleLevel={cameraScale.level}
          rectangle={cameraDiscovery.active && cameraDiscovery.layerIds.includes(def.layerId) && cameraDiscoveryRect
            ? cameraDiscoveryRect
            : cameraViewRectangle.rectangle}
          defaultEnabled
          hideControls
          forceEnabled={(cameraDiscovery.active && cameraDiscovery.layerIds.includes(def.layerId)) || (camerasMode && def.unitNoun === 'camera' && cameraLodPolicy.fetchCatalog)}
          skipScaleGate={(cameraDiscovery.active && cameraDiscovery.layerIds.includes(def.layerId)) || (camerasMode && def.unitNoun === 'camera' && cameraLodPolicy.fetchCatalog)}
          clusterOverride={camerasMode && def.unitNoun === 'camera' ? cameraLodPolicy.clusterPins : undefined}
          onAuthRequired={handleCameraLayerAuth}
        />
      ))}
      <TerraWorkspaceLayoutProvider viewer={viewer} onApiReady={api => { workspaceLayoutApiRef.current = api }}>
        {hoveredCameraFeature && cameraHover && (
          <TerraCameraHoverWorkspace
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
        {!commandCenter && (
        <TerraWorkspacePanel id="workspace_control" title="Workspace" minimizable={false} dockable={false}>
          <TerraWorkspaceControl />
        </TerraWorkspacePanel>
        )}
        {!commandCenter && inspectCardForUi ? (
          <TerraWorkspacePanel id="gods_eye_inspect" title="Inspect">
            <TerraGodsEyeInspectCard
              model={inspectCardForUi}
              onClose={() => {
                setInspectPinned(false)
                setSelection({ kind: 'none' })
              }}
              onPin={() => setInspectPinned(value => !value)}
              onOpenStreetIntelligence={() => setStreetIntelOpen(true)}
              onOpenStreetView={() => openStreetView()}
              onFlyTo={selectedFeature ? () => flyToEventFeature(selectedFeature) : undefined}
              onMakeActive={inspectCardForUi.latitude !== null && inspectCardForUi.longitude !== null
                ? () => activateCoordinate({
                  ok: true,
                  latitude: inspectCardForUi.latitude as number,
                  longitude: inspectCardForUi.longitude as number,
                  height: null,
                  hasTerrainHeight: false,
                }, { contextType: 'CLICK' })
                : undefined}
              onSendToCouncil={sendSelectedObjectToCouncil}
              canSendToCouncil={canSendSelectedToCouncil}
              hidePreview={areaLiveMediaOpen}
              onRefresh={inspectCardForUi.featureClass === 'street_camera' ? () => setCameraStillNonce(value => value + 1) : undefined}
              onOpenSource={inspectCardForUi.featureClass === 'street_camera' ? () => {
                const url = selectedFeature?.rawReference.canonicalUrl ?? selectedFeature?.provenance.sourceUrl
                if (typeof url === 'string' && url) window.open(url, '_blank', 'noopener,noreferrer')
              } : undefined}
            />
          </TerraWorkspacePanel>
        ) : null}
        {!commandCenter && (
        <TerraWorkspacePanel id="nearby_cameras" title="Nearby Cameras">
          <div className="w-[min(22rem,86vw)] space-y-2">
            <TerraNearbyGodsEye snapshot={nearbyGodsEyeSnapshot} />
            {areaLiveOpen || godsEyeViewMode === 'AREA_LIVE' ? null : (
              <TerraNearbyCameras
                latitude={nearbyCameraOrigin?.latitude ?? null}
                longitude={nearbyCameraOrigin?.longitude ?? null}
                originLabel={nearbyCameraOrigin?.label ?? 'no Terra location'}
                features={nearbyCameraIndex}
                indexLoaded={cameraIndexLoaded}
                authRequired={cameraAuthRequired}
                radiusKm={cameraSearchRadiusKm}
                selectedId={selection.kind === 'feature' ? `${selection.layerId}:${selection.featureId}` : null}
                onSelect={(camera: NearbyPublicCamera) => handleEntityClick(`${camera.layerId}:${camera.id}`)}
                onExpandRadius={handleExpandCameraSearch}
                onOpenOfficialViewer={() => openAreaLiveOfficialViewer()}
              />
            )}
          </div>
        </TerraWorkspacePanel>
        )}
        {!commandCenter && camerasMode ? (
          <TerraWorkspacePanel id="camera_directory" title="Camera Directory">
            <TerraGodsEyeCameraDirectory
              lod={cameraLod}
              providers={cameraProvidersInView}
              features={federatedCameraIndex}
              origin={nearbyCameraOrigin}
              query={cameraDirectoryQuery}
              providerFilter={cameraDirectoryProvider}
              statusFilter={cameraDirectoryStatus}
              distanceFilter={cameraDirectoryDistance}
              onQueryChange={setCameraDirectoryQuery}
              onProviderFilterChange={setCameraDirectoryProvider}
              onStatusFilterChange={setCameraDirectoryStatus}
              onDistanceFilterChange={setCameraDirectoryDistance}
              onSelect={selectFederatedCamera}
            />
          </TerraWorkspacePanel>
        ) : null}
        {!commandCenter && streetIntelOpen ? (
          <TerraWorkspacePanel id="street_intel" title="Street Intelligence">
            <TerraStreetIntelligence
              open={streetIntelOpen}
              latitude={activeLocation?.latitude ?? inspectCard?.latitude ?? null}
              longitude={activeLocation?.longitude ?? inspectCard?.longitude ?? null}
              selectedPlace={activeLocation?.label ?? inspectCard?.title ?? null}
              localTime={inspectCard?.localTime ?? null}
              nearbyIdentity={inspectCard?.identity ?? null}
              onClose={() => setStreetIntelOpen(false)}
            />
          </TerraWorkspacePanel>
        ) : null}

      {!commandCenter && streetViewOpen && streetViewOrigin ? (
        <TerraWorkspacePanel id="street_view" title="Street View">
          <TerraStreetViewPanel
            key={`${streetViewOrigin.latitude.toFixed(5)},${streetViewOrigin.longitude.toFixed(5)},${streetViewOrigin.context}`}
            origin={streetViewOrigin}
            onClose={() => setStreetViewOpen(false)}
            onGoToLocation={flyToStreetViewCapture}
            onSendToCouncil={sendStreetViewToCouncil}
            canSendToCouncil
            onStateChange={setStreetViewState}
          />
        </TerraWorkspacePanel>
      ) : null}

      {!commandCenter && weatherAlerts.toast ? (
        <TerraWorkspacePanel id="weather_toast" title="Weather Alert" minimizable={false}>
          <TerraWeatherAlertToast
            toast={weatherAlerts.toast}
            nowIso={clock.time.currentTime}
            onView={() => viewWeatherAlert(weatherAlerts.toast!.alert)}
            onDismiss={weatherAlerts.dismissToast}
            onMute={weatherAlerts.muteAlerts}
          />
        </TerraWorkspacePanel>
      ) : null}

      {!commandCenter && weatherDrawerAlert ? (
        <TerraWorkspacePanel id="weather_drawer" title="Weather">
          <TerraWeatherDetailDrawer
            alert={weatherDrawerAlert}
            canSendToCouncil
            onClose={closeWeatherDrawer}
            onSendToCouncil={() => sendWeatherToCouncil(weatherDrawerAlert)}
            radar={{
              catalog: radar.catalog,
              state: radar.viewState.state,
              frame: radar.selected,
              frameAge: radar.frameAge,
              enabled: radar.enabled,
              onToggle: () => radar.setEnabled(!radar.enabled),
            }}
          />
        </TerraWorkspacePanel>
      ) : null}

      {!commandCenter && areaLiveMediaOpen && areaLiveMedia ? (
        <TerraWorkspacePanel id="area_live_viewer" title="Area Live">
          <AreaLiveMediaViewer
            media={areaLiveMedia}
            expanded={areaLiveMediaExpanded}
            playVideo={Boolean(areaLiveHoverRowId) && isAreaLivePlayableVideo(areaLiveMedia.kind)}
            onRefresh={areaLiveMedia.kind === 'CAMERA_STILL' || areaLiveMedia.kind === 'CAMERA_STREAM' ? () => setCameraStillNonce(value => value + 1) : undefined}
            onSource={() => {
              const url = areaLiveMedia.sourceUrl ?? areaLiveMedia.officialViewerUrl
              if (url) window.open(url, '_blank', 'noopener,noreferrer')
            }}
            onGoToLocation={selectedFeature?.kind === 'traffic_camera'
              ? () => flyToEventFeature(selectedFeature)
              : areaLiveMedia.latitude != null && areaLiveMedia.longitude != null
                ? () => {
                  commandNav('AREA_LIVE_MEDIA')
                  cinematicFlight.flyTo({
                    longitude: areaLiveMedia.longitude as number,
                    latitude: areaLiveMedia.latitude as number,
                    altitudeMeters: CAMERA_INSPECT_ALTITUDE_M,
                    placeType: 'traffic_camera',
                  }, {
                    purpose: 'camera',
                    label: areaLiveMedia.name,
                    onComplete: () => commandNav('FLIGHT_COMPLETE'),
                  })
                }
                : undefined}
            onStreetView={areaLiveMedia.latitude != null && areaLiveMedia.longitude != null
              ? () => openStreetView('AREA_LIVE')
              : undefined}
            onSendToCouncil={sendSelectedObjectToCouncil}
            canSendToCouncil={canSendSelectedToCouncil}
            onExpand={() => setAreaLiveMediaExpanded(value => !value)}
            onClose={closeAreaLiveMediaViewer}
          />
        </TerraWorkspacePanel>
      ) : null}

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

      {/* Top instrumentation — slim; globe stays the hero. Hidden in command-center. */}
      {!commandCenter ? (
      <>
        <TerraWorkspacePanel id="hazard_counters" title="Hazards" minimizable={false} dockable={false}>
          <TerraHazardCounters counters={hazardSummary} />
        </TerraWorkspacePanel>
        <TerraWorkspacePanel id="globe_status" title="Globe Status" dockable={false}>
          <TerraInspectDetails title="Globe status" badge={<span className="font-mono uppercase text-emerald-400/80">{cameraScale.level}</span>} className="max-w-[min(22rem,28vw)]">
            <p className="text-[11px] leading-snug text-slate-400">
              <StatusLine status={globeStatus} aerialImageryActive={aerialImageryAvailable} osmBuildingsVisible={ionBuildingsFallbackActive} />
            </p>
          </TerraInspectDetails>
        </TerraWorkspacePanel>
      </>
      ) : null}

      {!commandCenter ? (
      <>
      <TerraWorkspacePanel id="search_command" title="Search" minimizable={false}>
        <div className="w-[min(28rem,92vw)]">
          <span className="sr-only" data-testid="terra-nav-state">{navState}</span>
          <span className="sr-only" data-testid="terra-flight-outcome">{cinematicFlight.outcome}</span>
          <span className="sr-only" data-testid="terra-flight-label">{cinematicFlight.label}</span>
          <span className="sr-only" data-testid="terra-flight-dest-kind">{cinematicFlight.lastPlan?.destination.kind ?? ''}</span>
          <span className="sr-only" data-testid="terra-flight-dest-height">{cinematicFlight.lastPlan?.destination.kind === 'point' ? String(cinematicFlight.lastPlan.destination.heightMeters) : ''}</span>
          <TerraLocationCommandInput
            onResolvedLocation={handleResolvedLocation}
            flightOutcome={cinematicFlight.outcome}
            flightPurpose={cinematicFlight.purpose}
            flightLabel={cinematicFlight.label}
            streetViewState={streetViewState}
            streetViewDisabled={!resolveStreetViewOrigin()}
            onStreetView={() => openStreetView()}
            onNearby={focusNearbyCameras}
            onGps={gps.locateOnce}
          />
        </div>
      </TerraWorkspacePanel>
      <TerraWorkspacePanel id="location_gps" title="Location" minimizable={false}>
        {locationControl}
      </TerraWorkspacePanel>
      <TerraWorkspacePanel id="gods_eye_controls" title="God's Eye">
        <TerraGodsEyeViewMode mode={godsEyeViewMode} onChange={handleGodsEyeViewModeChange} />
      </TerraWorkspacePanel>
      <TerraWorkspacePanel id="camera_discovery" title="Camera Discovery" dockable={false}>
          <TerraCameraDiscoveryControl
            state={cameraDiscovery.prompt}
            coveringLabel={cameraDiscovery.coveringLabel}
            officialViewerUrl={cameraDiscovery.officialViewerUrl}
            onDiscover={handleDiscoverCameras}
            onFocusNearby={focusNearbyCameras}
          />
      </TerraWorkspacePanel>
      <TerraWorkspacePanel id="area_live_controls" title="Area Live Controls" dockable={false}>
          <TerraAreaLiveControl
            open={areaLiveOpen || godsEyeViewMode === 'AREA_LIVE'}
            category={areaLiveCategory}
            workspace={areaLiveWorkspace}
            selectedRowId={areaLiveIntelId ? `intel:${areaLiveIntelId}` : (selection.kind === 'feature' ? `camera:${selection.layerId}:${selection.featureId}` : null)}
            onToggle={handleAreaLiveToggle}
            onCategory={setAreaLiveCategory}
            onViewRow={viewAreaLiveRow}
            onPreviewRow={previewAreaLiveRow}
            onPreviewEnd={endAreaLivePreview}
            onOpenOfficialViewer={openAreaLiveOfficialViewer}
            onSourceRow={openAreaLiveRowSource}
            onSendRow={sendAreaLiveRowToCouncil}
          />
      </TerraWorkspacePanel>
      </>
      ) : null}

      {!commandCenter && (
      <TerraWorkspacePanel
        id="left_rail"
        title="Commander"
        className="w-56"
        sticky={(
          <div className="pointer-events-auto shrink-0 bg-gradient-to-b from-black/85 via-black/70 to-transparent pb-1.5">
            <CommanderAgentDock placement="rail" />
          </div>
        )}
      >
      <div className="flex max-h-[min(70vh,40rem)] w-56 min-h-0 flex-col gap-1.5 overflow-y-auto overscroll-contain">
        <TerraAgentEngineeringDetails />
        <TerraGodsEyeCoverageMatrix zoomRung={zoomRung} cameraRuntime={cameraHealthRuntime} />
        <TerraInspectDetails title="Layer controls" badge={<span className="font-mono uppercase text-emerald-400/80">{zoomRung}</span>}>
          <div className="mb-1 pointer-events-auto">
            <TerraCommanderSessionChip />
          </div>
          <div className="mb-2 pointer-events-auto">
            <TerraWorkspaceResetButton />
          </div>
          <ul className="space-y-1 text-[11px] text-slate-400">
            <li className="flex items-center justify-between">
              <span>Camera scale</span>
              <span className="font-mono uppercase text-emerald-400">{cameraScale.level}</span>
            </li>
            <li className="flex items-center justify-between">
              <span>God's Eye ladder</span>
              <span className="font-mono uppercase text-cyan-300">{zoomRung}</span>
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
              <span>Urban geography</span>
              <button type="button" onClick={() => setUrbanDetailEnabled(v => !v)} className={urbanDetailEnabled ? 'font-bold text-cyan-300' : 'text-slate-400 hover:text-slate-200'}>
                {urbanDetailEnabled ? 'auto' : 'off'}
              </button>
            </li>
            <li className="flex items-center justify-between">
              <span>Crude building extrusion</span>
              <button type="button" data-testid="terra-building-extrusion" onClick={() => setBuildingExtrusionEnabled(v => !v)} className={buildingExtrusionEnabled ? 'font-bold text-amber-200' : 'text-slate-400 hover:text-slate-200'}>
                {buildingExtrusionEnabled ? 'on' : 'off'}
              </button>
            </li>
            <li className="flex items-center justify-between">
              <span>Map detail (OSM raster)</span>
              <button type="button" onClick={() => setMapDetailMode(v => !v)} className={mapDetailMode || highResAerialUnavailable ? 'font-bold text-cyan-300' : 'text-slate-400 hover:text-slate-200'}>
                {mapDetailMode ? 'on' : highResAerialUnavailable ? 'fallback' : 'off'}
              </button>
            </li>
            <li className={`flex items-center justify-between ${globeStatus.phase === 'ready' && globeStatus.hasRealTerrain ? '' : 'opacity-40'}`}>
              <span>Terrain</span>
              <span>{globeStatus.phase === 'ready' && globeStatus.hasRealTerrain ? 'active' : 'unavailable'}</span>
            </li>
            <li className={`flex items-center justify-between ${globeStatus.phase === 'ready' && globeStatus.hasOsmBuildings ? '' : 'opacity-40'}`}>
              <span>3D Buildings (Cesium OSM Buildings)</span>
              <button type="button" data-testid="terra-ion-osm-buildings" disabled={!(globeStatus.phase === 'ready' && globeStatus.hasOsmBuildings)} onClick={() => setIonOsmBuildingsEnabled(v => !v)} className={ionBuildingsFallbackActive ? 'font-bold text-cyan-300' : 'text-slate-400 hover:text-slate-200'}>
                {ionBuildingsFallbackActive ? 'on' : globeStatus.phase === 'ready' && globeStatus.hasOsmBuildings ? 'off' : 'unavailable'}
              </button>
            </li>
            <li className="flex items-center justify-between">
              <span>Re:Earth Buildings (evaluation)</span>
              <button type="button" onClick={() => setReEarthBuildingsEnabled(v => !v)} className={reEarthBuildingsEnabled ? 'font-bold text-cyan-300' : 'text-slate-400 hover:text-slate-200'} data-testid="reearth-buildings-switch">
                {reEarthBuildingsEnabled ? `${RE_EARTH_BUILDINGS_STATUS.replaceAll('_', ' ')} · ${reEarthBuildingsRuntime}` : 'off'}
              </button>
            </li>
            <li className="flex items-center justify-between">
              <span>Re:Earth Terrain (evaluation)</span>
              <button type="button" onClick={() => setReEarthTerrainEnabled(v => !v)} className={reEarthTerrainEnabled ? 'font-bold text-cyan-300' : 'text-slate-400 hover:text-slate-200'} data-testid="reearth-terrain-switch">
                {reEarthTerrainEnabled ? `${RE_EARTH_TERRAIN_STATUS.replaceAll('_', ' ')} · ${reEarthTerrainRuntime}` : 'off'}
              </button>
            </li>
            <li>
              <details className="rounded border border-white/10 bg-black/40 p-2 text-[10px] text-slate-500">
              <summary className="cursor-pointer text-[9px] font-bold uppercase tracking-widest text-slate-400">Urban diagnostics</summary>
              <ul className="mt-1 space-y-0.5 font-mono">
                <li>terrain {urbanStatus.terrain}{urbanStatus.terrain === 'UNAVAILABLE' ? ` · ${TERRA_TERRAIN_REQUIRES_PROVIDER}` : ''}</li>
                <li>roads {urbanStatus.roads} · {urbanStatus.roadCount}</li>
                <li>buildings {urbanStatus.buildings} · {urbanStatus.buildingCount}</li>
                <li>signals {urbanStatus.signals} · {urbanStatus.signalCount} · live phase {TERRA_LIVE_SIGNAL_PHASE}</li>
                <li>houses {urbanStatus.houseCount}</li>
                <li>street labels {urbanStatus.streetLabelCount} · house numbers {urbanStatus.houseLabelCount}</li>
                <li>labels {urbanStatus.labels}</li>
                <li>cameras {cameraCount} · cluster intel {shouldClusterIntel(godsEyeLodForTerraScale(cameraScale.level)) ? 'on' : 'off'}</li>
                <li>lod {urbanStatus.lod ?? 'off'} · ladder {zoomRung}</li>
                <li data-testid="gods-eye-lod-density">density fetch {String(lodDensity.fetchUrban)} · buildings {String(lodDensity.buildings)} · signals {String(lodDensity.signals)} · names {lodDensity.streetNames} · houses {String(lodDensity.houseNumbers)}</li>
                <li data-testid="gods-eye-lod-runtime">fps {lodTelemetry.fps ?? 'UNAVAILABLE'} · primitives {lodTelemetry.primitiveCount ?? 'UNAVAILABLE'} · entities {lodTelemetry.entityCount ?? 'UNAVAILABLE'} · heap {lodTelemetry.memoryMb != null ? `${lodTelemetry.memoryMb} MB` : 'UNAVAILABLE'} · gpu UNAVAILABLE</li>
                <li>network fetches {urbanStatus.networkFetches}</li>
                {urbanStatus.source ? <li>source {urbanStatus.source}</li> : null}
                {urbanStatus.loadMs !== null ? <li>load {urbanStatus.loadMs}ms</li> : null}
                {urbanStatus.fromCache ? <li>cache hit</li> : null}
                {urbanStatus.rateLimited ? <li>rate limited</li> : null}
                {urbanStatus.truncated ? <li>truncated</li> : null}
                {urbanStatus.error ? <li className="text-amber-400">{urbanStatus.error}</li> : null}
              </ul>
            </details>
            </li>
            <li className={`flex items-center justify-between ${nearbyLandmarksQuery !== null ? '' : 'opacity-40'}`}>
              <span>Nearby Landmarks & POIs</span>
              <span>{nearbyLandmarksQuery === null ? 'zoom in + select a location' : nearbyLandmarks.state}</span>
            </li>
            <li className={`pointer-events-auto flex items-center justify-between ${isLocalScale ? '' : 'opacity-40'}`}>
              <span>Street Intelligence</span>
              <button type="button" data-testid="terra-street-intelligence-open" onClick={() => setStreetIntelOpen(true)} className="text-right text-[9px] leading-tight text-cyan-300 hover:text-cyan-200">
                {TERRA_STREET_LEVEL_IMAGERY_MESSAGE}
              </button>
            </li>
          </ul>
        </TerraInspectDetails>

        <TerraInspectDetails title="Earth knowledge" badge={activeLocation ? <span className="max-w-[7rem] truncate text-cyan-300">{activeLocation.label}</span> : <span className="text-slate-500">idle</span>}>
          <TerraEarthKnowledgePanel compact location={activeLocation} onDismiss={() => setActiveLocation(null)} nearby={{ active: nearbyLandmarksQuery !== null, state: nearbyLandmarks.state, features: nearbyLandmarks.features }} />
        </TerraInspectDetails>

        <TerraInspectDetails title="Data layers">
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
                      {aircraft.lastErrorMessage && <p className={`text-[10.5px] ${aircraft.lastErrorMessage === 'AUTH_REQUIRED' ? 'text-amber-300' : 'text-red-400'}`}>{aircraft.lastErrorMessage}</p>}
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
                      {maritime.lastErrorMessage && <p className={`text-[10.5px] ${maritime.lastErrorMessage === 'AUTH_REQUIRED' ? 'text-amber-300' : 'text-red-400'}`}>{maritime.lastErrorMessage}</p>}
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
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Traffic cameras · regional / agency dependent</p>
            {TERRA_TRAFFIC_LAYER_DEFS.map(def => (
              <TerraTrafficLayer
                key={def.layerId}
                def={def}
                viewer={viewer}
                selection={selection}
                onFeaturesChange={handleFeaturesChange}
                timeMode={clock.time.mode}
                cameraScaleLevel={cameraScale.level}
                rectangle={cameraDiscovery.active && cameraDiscovery.layerIds.includes(def.layerId) && cameraDiscoveryRect
                  ? cameraDiscoveryRect
                  : cameraViewRectangle.rectangle}
                defaultEnabled={def.unitNoun === 'camera'}
                forceEnabled={(cameraDiscovery.active && cameraDiscovery.layerIds.includes(def.layerId)) || (camerasMode && def.unitNoun === 'camera' && cameraLodPolicy.fetchCatalog)}
                skipScaleGate={(cameraDiscovery.active && cameraDiscovery.layerIds.includes(def.layerId)) || (camerasMode && def.unitNoun === 'camera' && cameraLodPolicy.fetchCatalog)}
                clusterOverride={camerasMode && def.unitNoun === 'camera' ? cameraLodPolicy.clusterPins : undefined}
                onAuthRequired={handleCameraLayerAuth}
              />
            ))}
          </div>
        </TerraInspectDetails>

        {selection.kind === 'miss' && (
          <div className="pointer-events-auto rounded border border-white/10 bg-black/60 p-3 backdrop-blur-sm">
            <p className="text-[10.5px] text-slate-500">Click missed the globe.</p>
          </div>
        )}
        <TerraInspectDetails title="Commander annotation">
          <p className="text-[11px] leading-snug text-slate-500">Not wired yet. Will be a distinct, clearly-labeled layer class — never merged with Observed Data or AI Analysis layers.</p>
        </TerraInspectDetails>
      </div>
      </TerraWorkspacePanel>
      )}

      {!commandCenter && (
        <TerraWorkspacePanel id="live_intel" title="Live Intel">
        <TerraRightIntelDock
          snapshot={liveIntelSnapshot}
          selected={selectedLiveObject}
          fetchError={remoteLiveIntel.error}
          authRequired={remoteLiveIntel.authRequired || liveIntelSnapshot.authState === 'AUTH_REQUIRED'}
          pending={remoteLiveIntel.pending && !remoteLiveIntel.snapshot}
          panel={liveIntelPanel}
          inspectedItem={inspectedIntelItem}
          onInspectItem={inspectIntelItem}
          onFlyToItem={flyToIntelItem}
          hasSelection={Boolean(selectedFeature || inspectedIntelItem)}
          commanderQuestion={commanderQuestion}
          onCommanderQuestionChange={setCommanderQuestion}
          onSendSelectedToCouncil={sendSelectedObjectToCouncil}
          canSendToCouncil={canSendSelectedToCouncil}
          onCreateAstraMission={() => { void createAstraMission() }}
          canCreateAstraMission={canCreateAstraMission}
          onRunAstraMission={() => { void runAstraMission() }}
          canRunAstraMission={canRunAstraMission}
          astraStatus={
            astraMission
              ? [
                  astraMission.id ? `${astraMission.status} · ${astraMission.id}` : astraMission.error,
                  astraMission.terraObjectId ? `terra ${astraMission.terraObjectId}` : null,
                  astraMission.terraProvider,
                  astraMission.terraEvidenceId,
                  astraMission.councilConversationId ? `council ${astraMission.councilConversationId}` : null,
                  astraMission.error,
                ].filter(Boolean).join(' · ')
              : null
          }
          observedDetail={
            selectedFeature ? (
              <div className="rounded border border-cyan-400/30 bg-black/50 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-cyan-400/80">Observed — {KIND_DETAIL_LABEL[selectedFeature.kind]}</p>
                  <button type="button" onClick={() => { setSelection({ kind: 'none' }); setSelectedEvent(null) }} className="text-[10px] text-slate-500 hover:text-slate-300">
                    dismiss
                  </button>
                </div>
                <p className="text-[12px] font-semibold text-slate-100">{selectedFeature.title}</p>
                <dl className="mt-2 space-y-1 text-[11px] text-slate-400">
                  <FeatureDetailFields feature={selectedFeature} />
                  <CoordinateOriginFields feature={selectedFeature} />
                  <Row label="Provider" value={selectedFeature.provenance.provider} />
                  {selectedLiveObject ? <Row label="Freshness" value={selectedLiveObject.freshness} /> : null}
                  {selectedLiveObject?.evidenceId ? <Row label="Evidence" value={selectedLiveObject.evidenceId} mono /> : null}
                  {selectedLiveObject?.sourceFamily ? <Row label="Source family" value={selectedLiveObject.sourceFamily} /> : null}
                </dl>
                {selectedFeature.rawReference.canonicalUrl && (
                  <a href={selectedFeature.rawReference.canonicalUrl} target="_blank" rel="noreferrer" className="mt-2 block truncate text-[10.5px] text-cyan-400 hover:underline">
                    {selectedFeature.rawReference.canonicalUrl}
                  </a>
                )}
              </div>
            ) : (
              <p className="px-1 text-[10px] text-slate-500">Click a feature marker to inspect observed detail.</p>
            )
          }
          relatedDetail={selectedFeature ? <TerraRelatedIntelligencePanel feed={relatedIntelligence} active compact /> : null}
        />
        </TerraWorkspacePanel>
      )}

      {!commandCenter && (
      <TerraWorkspacePanel id="radar" title="Radar" minimizable={false}>
        <TerraRadarStatus
          catalog={radar.catalog}
          state={radar.viewState.state}
          frame={radar.selected}
          frameAge={radar.frameAge}
          enabled={radar.enabled}
          playing={radar.playing}
          canAnimate={radar.canAnimate}
          onToggle={() => radar.setEnabled(!radar.enabled)}
          onSelectFrame={radar.selectFrame}
          onLatest={radar.selectLatest}
          onPlay={radar.setPlaying}
        />
      </TerraWorkspacePanel>
      )}
      {!commandCenter && (
        <TerraWorkspacePanel id="timeline" title="Timeline" minimizable={false}>
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
            onResumeCinematic={handleResumeCinematic}
          />
        </TerraWorkspacePanel>
      )}
      </TerraWorkspaceLayoutProvider>
      </div>
    </div>
  )
}

// God's Eye command-center composer (app/page.tsx) recreates its own JSX (and every inline
// callback) on every Commander keystroke, which otherwise forces this entire Cesium-backed subtree
// through a full React re-render per keystroke purely from parent churn — `presentation` is this
// component's only prop, and it never changes after mount, so a shallow-props memo skips all of
// that unnecessary work without affecting any of TerraShell's own state/context-driven updates.
export const TerraShell = memo(TerraShellComponent)
