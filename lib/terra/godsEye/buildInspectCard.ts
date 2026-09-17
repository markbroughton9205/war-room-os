import { resolveTerraWorldTime } from '../worldTime'
import { TERRA_LIVE_SIGNAL_PHASE, TERRA_SIGNAL_INFRASTRUCTURE_STATUS, type TerraUrbanRoad, type TerraUrbanSelection, type TerraUrbanSignal } from '../urbanDetail/types'
import type { TerraClickPoint, TerraGeoFeature } from '../types'
import { sourceDataProvenance } from './provenance'
import type { GodsEyeLayerTruthState } from './coverageStates'
import type { GodsEyeInspectCardModel, GodsEyeInspectFeatureClass } from './inspect'
import { cameraPreviewHref } from './trafficCamera'
import { cameraInspectFreshness } from './cameraInspectFreshness'
import { inspectEnrichAppliesTo, inspectMustNotCopyNeighborAddress } from './inspectRace'
import { haversineKm } from '../geographicContext'

export type GodsEyeInspectSelection =
  | { kind: 'none' }
  | { kind: 'miss' }
  | { kind: 'ground'; point: Extract<TerraClickPoint, { ok: true }> }
  | { kind: 'feature'; layerId: string; featureId: string }
  | { kind: 'urban-building'; building: TerraUrbanSelection }
  | { kind: 'urban-road'; road: TerraUrbanRoad }
  | { kind: 'urban-signal'; signal: TerraUrbanSignal }

function worldClock(latitude: number | null, longitude: number | null) {
  return resolveTerraWorldTime({
    utcIso: new Date().toISOString(),
    latitude,
    longitude,
  })
}

function featureClassFromGeo(feature: TerraGeoFeature | null): GodsEyeInspectFeatureClass {
  if (!feature) return 'marker_event'
  if (feature.kind === 'traffic_camera') return 'street_camera'
  if (feature.kind === 'aircraft_state') return 'aircraft'
  if (feature.kind === 'vessel_position') return 'vessel'
  return 'marker_event'
}

export function buildGodsEyeInspectCard(input: {
  selection: GodsEyeInspectSelection
  feature?: TerraGeoFeature | null
  pinned: boolean
  asyncEnrichPending: boolean
  enrichError?: string | null
  enrichLatitude?: number | null
  enrichLongitude?: number | null
  origin?: { latitude: number; longitude: number } | null
}): GodsEyeInspectCardModel | null {
  const { selection, pinned } = input
  const feature = input.feature ?? null
  if (selection.kind === 'none' || selection.kind === 'miss') return null

  const selectionLat =
    selection.kind === 'ground' ? selection.point.latitude
    : selection.kind === 'urban-building' ? selection.building.latitude
    : selection.kind === 'urban-signal' ? selection.signal.latitude
    : selection.kind === 'urban-road' ? (selection.road.geometry[0]?.latitude ?? null)
    : feature?.latitude ?? null
  const selectionLon =
    selection.kind === 'ground' ? selection.point.longitude
    : selection.kind === 'urban-building' ? selection.building.longitude
    : selection.kind === 'urban-signal' ? selection.signal.longitude
    : selection.kind === 'urban-road' ? (selection.road.geometry[0]?.longitude ?? null)
    : feature?.longitude ?? null
  const enrichBound = inspectEnrichAppliesTo(
    { latitude: selectionLat, longitude: selectionLon },
    { latitude: input.enrichLatitude ?? null, longitude: input.enrichLongitude ?? null },
  )
  const asyncEnrichPending = enrichBound && input.asyncEnrichPending
  const enrichError = enrichBound ? (input.enrichError ?? null) : null

  if (selection.kind === 'urban-building') {
    const building = selection.building
    const clock = worldClock(building.latitude, building.longitude)
    return {
      featureClass: 'building',
      title: building.name ?? building.buildingType ?? 'building',
      identity: `${building.provider} ${building.osmType} ${building.osmId}`,
      latitude: building.latitude,
      longitude: building.longitude,
      source: building.provider === 'reearth_buildings' ? 'Re:Earth Buildings / Overture / OSM' : 'OpenStreetMap',
      localTime: clock.localTime,
      timeZone: clock.timeZone,
      coverageState: 'PARTIAL',
      pinned,
      asyncEnrichPending,
      enrichError,
      sections: {
        IDENTITY: [
          { label: 'name', value: building.name ?? 'unnamed' },
          { label: 'type', value: building.buildingType ?? 'unknown' },
          { label: 'osm id', value: building.osmId },
          { label: 'osm type', value: building.osmType },
          { label: 'provider', value: building.provider },
          ...(building.houseNumber ? [{ label: 'house number', value: inspectMustNotCopyNeighborAddress(building.houseNumber, null) ?? building.houseNumber }] : []),
          ...(building.streetName ? [{ label: 'street', value: building.streetName }] : []),
          ...(building.entrance ? [{ label: 'entrance', value: building.entrance }] : []),
          ...(building.address ? [{ label: 'address', value: building.address }] : []),
          ...(building.overtureId ? [{ label: 'overture', value: building.overtureId }] : []),
          ...(building.gersId ? [{ label: 'gers', value: building.gersId }] : []),
        ],
        LOCATION: [
          { label: 'lat', value: building.latitude.toFixed(5) },
          { label: 'lon', value: building.longitude.toFixed(5) },
        ],
        URBAN: [
          ...(building.levels !== null ? [{ label: 'levels', value: String(building.levels) }] : []),
          ...(building.heightMeters !== null ? [{ label: 'height', value: `${building.heightMeters} m · ${building.heightSource ?? 'unknown'}` }] : []),
        ],
        PROVENANCE: [
          { label: 'layer', value: 'SOURCE DATA' },
          { label: 'license', value: 'ODbL-1.0' },
          { label: 'source', value: 'https://www.openstreetmap.org/copyright' },
        ],
      },
      provenance: sourceDataProvenance({
        source: 'OpenStreetMap',
        provider: building.provider,
        coverageState: 'PARTIAL',
        license: 'ODbL-1.0',
        sourceUrl: 'https://www.openstreetmap.org/copyright',
      }),
    }
  }

  if (selection.kind === 'urban-road') {
    const road = selection.road
    const point = road.geometry[0]
    const clock = worldClock(point?.latitude ?? null, point?.longitude ?? null)
    return {
      featureClass: 'road',
      title: road.name ?? road.highway,
      identity: `osm ${road.osmType} ${road.osmId}`,
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
      source: 'OpenStreetMap',
      localTime: clock.localTime,
      timeZone: clock.timeZone,
      coverageState: 'PARTIAL',
      pinned,
      asyncEnrichPending,
      enrichError,
      sections: {
        IDENTITY: [
          { label: 'class', value: road.highway },
          { label: 'status', value: 'STATIC INFRASTRUCTURE' },
          ...(road.lanes ? [{ label: 'lanes', value: road.lanes }] : []),
          ...(road.maxspeed ? [{ label: 'maxspeed', value: road.maxspeed }] : []),
        ],
        MOBILITY: [{ label: 'live traffic', value: 'NO_COVERAGE on this geometry' }],
        PROVENANCE: [{ label: 'license', value: 'ODbL-1.0' }],
      },
      provenance: sourceDataProvenance({
        source: 'OpenStreetMap',
        provider: 'osm_overpass',
        coverageState: 'PARTIAL',
        license: 'ODbL-1.0',
      }),
    }
  }

  if (selection.kind === 'urban-signal') {
    const signal = selection.signal
    const clock = worldClock(signal.latitude, signal.longitude)
    return {
      featureClass: 'traffic_signal',
      title: signal.name ?? signal.nodeKind.replaceAll('_', ' '),
      identity: `osm node ${signal.osmId}`,
      latitude: signal.latitude,
      longitude: signal.longitude,
      source: 'OpenStreetMap',
      localTime: clock.localTime,
      timeZone: clock.timeZone,
      coverageState: 'PARTIAL',
      pinned,
      asyncEnrichPending,
      enrichError,
      sections: {
        IDENTITY: [
          { label: 'kind', value: signal.nodeKind.replaceAll('_', ' ') },
          { label: 'status', value: TERRA_SIGNAL_INFRASTRUCTURE_STATUS },
        ],
        MOBILITY: [{ label: 'live phase', value: TERRA_LIVE_SIGNAL_PHASE }],
        URBAN: signal.direction ? [{ label: 'direction', value: signal.direction }] : [],
        PROVENANCE: [{ label: 'license', value: 'ODbL-1.0' }],
      },
      provenance: sourceDataProvenance({
        source: 'OpenStreetMap',
        provider: 'osm_overpass',
        coverageState: 'PARTIAL',
        license: 'ODbL-1.0',
      }),
    }
  }

  if (selection.kind === 'ground') {
    const clock = worldClock(selection.point.latitude, selection.point.longitude)
    return {
      featureClass: 'ground',
      title: 'Ground coordinate',
      identity: 'terrain pick',
      latitude: selection.point.latitude,
      longitude: selection.point.longitude,
      source: selection.point.hasTerrainHeight ? 'Cesium terrain pick' : 'ellipsoid pick',
      localTime: clock.localTime,
      timeZone: clock.timeZone,
      coverageState: selection.point.hasTerrainHeight ? 'LIVE' : 'PARTIAL',
      pinned,
      asyncEnrichPending,
      enrichError,
      sections: {
        LOCATION: [
          { label: 'lat', value: selection.point.latitude.toFixed(5) },
          { label: 'lon', value: selection.point.longitude.toFixed(5) },
          {
            label: 'elevation',
            value: selection.point.hasTerrainHeight && selection.point.height !== null
              ? `${selection.point.height.toFixed(0)} m`
              : 'UNAVAILABLE',
          },
        ],
        PROVENANCE: [{ label: 'layer', value: 'SOURCE DATA' }],
      },
      provenance: sourceDataProvenance({
        source: 'Cesium globe pick',
        provider: 'cesium',
        coverageState: selection.point.hasTerrainHeight ? 'LIVE' : 'PARTIAL',
      }),
    }
  }

  const clock = worldClock(feature?.latitude ?? null, feature?.longitude ?? null)
  const featureClass = featureClassFromGeo(feature)
  const coverage: GodsEyeLayerTruthState = feature ? 'PARTIAL' : 'NO_COVERAGE'
  const preview = featureClass === 'street_camera' && feature
    ? cameraPreviewHref({ providerId: feature.providerId, properties: feature.properties })
    : undefined
  const inspectFreshness = featureClass === 'street_camera' ? cameraInspectFreshness(feature) : null
  const lastModified = typeof feature?.properties.lastModified === 'string' ? feature.properties.lastModified
    : typeof feature?.properties.lastUpdated === 'string' ? feature.properties.lastUpdated
    : typeof feature?.properties.capturedAt === 'string' ? feature.properties.capturedAt
    : feature?.timestamp ?? null
  const sourceUrl = feature?.rawReference.canonicalUrl ?? feature?.provenance.sourceUrl ?? (typeof feature?.properties.sourceUrl === 'string' ? feature.properties.sourceUrl : null)
  const distanceKm = feature && input.origin
    ? haversineKm(input.origin.latitude, input.origin.longitude, feature.latitude, feature.longitude)
    : null
  const distanceLabel = distanceKm === null ? null
    : distanceKm * 0.621371 < 0.1 ? `${Math.round(distanceKm * 1000)} m`
    : `${(distanceKm * 0.621371).toFixed(1)} mi`
  return {
    featureClass,
    title: feature?.title ?? selection.featureId,
    identity: `${selection.layerId}:${selection.featureId}`,
    latitude: feature?.latitude ?? null,
    longitude: feature?.longitude ?? null,
    source: feature?.provenance.provider ?? selection.layerId,
    localTime: clock.localTime,
    timeZone: clock.timeZone,
    coverageState: coverage,
    pinned,
    asyncEnrichPending,
    enrichError,
    preview,
    sections: {
      IDENTITY: [
        { label: 'kind', value: feature?.kind ?? 'marker' },
        ...(typeof feature?.properties?.event === 'string' && feature.properties.event ? [{ label: 'event', value: String(feature.properties.event) }] : []),
        ...(typeof feature?.properties?.status === 'string' && feature.properties.status ? [{ label: 'status', value: String(feature.properties.status) }] : []),
        ...(typeof feature?.properties?.severity === 'string' && feature.properties.severity ? [{ label: 'severity', value: String(feature.properties.severity) }] : []),
        ...(typeof feature?.properties?.mag === 'number' ? [{ label: 'magnitude', value: String(feature.properties.mag) }] : []),
        ...(typeof feature?.properties?.classification === 'string' && feature.properties.classification ? [{ label: 'classification', value: String(feature.properties.classification) }] : []),
      ],
      LOCATION: [
        { label: 'lat', value: feature?.latitude != null ? feature.latitude.toFixed(5) : 'not reported' },
        { label: 'lon', value: feature?.longitude != null ? feature.longitude.toFixed(5) : 'not reported' },
      ],
      STREET: featureClass === 'street_camera' ? [
        { label: 'provider', value: feature?.providerId ?? selection.layerId },
        { label: 'agency', value: (typeof feature?.properties.agency === 'string' ? feature.properties.agency : null) ?? feature?.provenance.provider ?? selection.layerId },
        ...(typeof feature?.properties.locationName === 'string' ? [{ label: 'location', value: String(feature.properties.locationName) }] : []),
        ...(typeof feature?.properties.road === 'string' ? [{ label: 'road', value: String(feature.properties.road) }] : []),
        ...(typeof feature?.properties.direction === 'string' ? [{ label: 'direction', value: String(feature.properties.direction) }] : []),
        ...(typeof feature?.properties.bearing === 'number' ? [{ label: 'bearing', value: `${feature.properties.bearing}°` }] : []),
        ...(distanceLabel ? [{ label: 'distance', value: distanceLabel }] : []),
        { label: 'catalog status', value: inspectFreshness?.catalogStatus ?? 'UNAVAILABLE' },
        { label: 'catalog', value: inspectFreshness?.catalogNote ?? 'Catalog retrieval not reported' },
        { label: 'camera image', value: inspectFreshness?.imageFreshness ?? 'UNKNOWN' },
        { label: 'image freshness', value: inspectFreshness?.imageNote ?? 'Source did not report capture time' },
        { label: 'last updated', value: lastModified ?? 'not reported by source' },
        { label: 'coverage', value: typeof feature?.properties.coverage === 'string' ? String(feature.properties.coverage) : 'REGIONAL / AGENCY_DEPENDENT' },
        { label: 'attribution', value: typeof feature?.properties.attribution === 'string' ? String(feature.properties.attribution) : (feature?.provenance.provider ?? selection.layerId) },
        { label: 'source', value: sourceUrl ?? 'source URL not reported' },
        { label: 'preview', value: preview?.kind === 'still' ? 'still on inspect' : preview?.kind === 'html_viewer' ? 'HTML viewer at source' : 'none' },
      ] : [],
      LIVE_INTEL: feature && featureClass !== 'street_camera' ? [
        { label: 'title', value: feature.title },
        ...(feature.timestamp ? [{ label: 'time', value: feature.timestamp }] : []),
        ...(typeof feature.properties.trackConeKmz === 'string' ? [{ label: 'cone GIS', value: String(feature.properties.trackConeKmz) }] : []),
        ...(typeof feature.properties.forecastTrackKmz === 'string' ? [{ label: 'track GIS', value: String(feature.properties.forecastTrackKmz) }] : []),
      ] : [],
      PROVENANCE: [
        { label: 'layer', value: 'SOURCE DATA' },
        { label: 'provider', value: feature?.provenance.provider ?? selection.layerId },
        ...(inspectFreshness ? [
          { label: 'catalog status', value: inspectFreshness.catalogStatus },
          { label: 'catalog', value: inspectFreshness.catalogNote },
          { label: 'image freshness', value: inspectFreshness.imageFreshness },
          { label: 'camera image', value: inspectFreshness.imageNote },
        ] : [
          { label: 'freshness', value: feature?.provenance.fromCache ? 'CACHED' : (feature?.provenance.isHistorical ? 'HISTORICAL' : 'LIVE') },
        ]),
        { label: 'retrieved', value: feature?.provenance.retrievedAt ?? 'not reported' },
        { label: 'source URL', value: feature?.rawReference.canonicalUrl ?? feature?.provenance.sourceUrl ?? 'none' },
      ],
    },
    provenance: sourceDataProvenance({
      source: feature?.provenance.provider ?? selection.layerId,
      provider: feature?.provenance.provider ?? selection.layerId,
      coverageState: coverage,
      sourceUrl: feature?.rawReference.canonicalUrl ?? feature?.provenance.sourceUrl ?? null,
    }),
  }
}
