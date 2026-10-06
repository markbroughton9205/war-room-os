'use client'

/**
 * Terra's generic Cesium feature renderer (Phase 3, extended Phase 5). Renders any
 * TerraGeoFeature[] as Cesium point entities — or, for `geometryKind: 'region'` (Phase 5's real
 * polygon warning areas), a Cesium polygon entity — branching only on geometry/kind, never on
 * providerId. Still headless (renders nothing itself; the globe is the only visible surface), and
 * still one component for every layer — no TerraHurricaneLayer.tsx/TerraWildfireLayer.tsx/etc.
 *
 * Every style stays restrained and non-sensational: no red/yellow/green severity gradient, since
 * none of these observed-data sources supply a War Room risk assessment for this layer to imply.
 * Color varies only enough to let a Commander visually tell layers apart on the globe at once —
 * including for the new Phase 5 hazard kinds, whose color is chosen by domain grouping (hazards),
 * not by any source-supplied severity value.
 */
import { useEffect, useRef } from 'react'
import type { CustomDataSource, Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import { terraEntityId } from '@/lib/terra/cesiumEntityId'
import type { TerraGeoFeature, TerraIntelligenceEventKind } from '@/lib/terra/types'
import { sourcedCameraBearingDegrees } from '@/lib/terra/godsEye/cameraBearing'
import { cameraInspectFreshness } from '@/lib/terra/godsEye/cameraInspectFreshness'
import { cameraPinColor, cameraPinStateFromImageFreshness } from '@/lib/terra/godsEye/cameraFederation'
import { terraAircraftBillboardRotationRadians } from '@/lib/terra/aircraftOrientation'
import {
  vehicleBillboardRotationRadians,
  vehicleClusterMinimumSize,
  vehicleClusterPixelRange,
  vehicleColor,
  vehicleIconScale,
  vehicleShowHeadingTick,
  vehicleSilhouetteDataUri,
  sourcedVehicleHeadingDeg,
} from '@/lib/terra/vehicleIcons'
import type { TerraViewBand } from '@/lib/terra/layerGovernor/viewBands'
import type { TerraAircraftTrailPoint } from '@/lib/terra/aircraftTrail'
import { terraWorkerPool } from '@/lib/terra/worker/pool'
import { TERRA_JOB_PRIORITIES, type TerraViewBandName } from '@/lib/terra/worker/types'
import { canReuseVehicleEntities, staleEntityIds, terraLiveFeatureIds } from '@/lib/terra/stability/featureEntityReuse'
import { assignTrackedAircraft } from '@/lib/terra/flightIntelligence/cameraFollow'

type Props = {
  layerId: string
  viewer: CesiumViewer | null
  enabled: boolean
  features: TerraGeoFeature[]
  selectedId: string | null
  followId?: string | null
  /** God's Eye multi-scale phase: enables Cesium's own built-in entity clustering
   * (DataSource.clustering) — real, standard Cesium API, not a hand-rolled clustering
   * implementation. Off by default (every existing hazard layer keeps rendering one marker per
   * feature, unclustered) — a merged blob is wrong for "how many distinct earthquakes are here,"
   * but right for "roughly how many landmarks are in this area" at broad zoom. */
  cluster?: boolean
  /** Camera federation: cluster billboard uses the camera glyph and a numeric count label. */
  clusterKind?: 'camera'
  /** Bounded session-only trails, keyed by icao24 (aircraft,
   * components/war-room/terra/useTerraAircraftTrails.ts) or MMSI (vessels,
   * useTerraVesselTrails.ts) — each TerraFeatureLayer instance only ever renders its own layer's
   * features, so the key namespace never collides across layers; every other layer passes nothing
   * and renders exactly as before. */
  trails?: Record<string, TerraAircraftTrailPoint[]>
  viewBand?: TerraViewBand
  clusterPixelRange?: number
  clusterMinimumSize?: number
}

// Top-down map camera glyph: compact equipment silhouette, never a generic dot or giant pin.
const CAMERA_GLYPH_DATA_URI = `data:image/svg+xml;base64,${btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="28" viewBox="0 0 36 28"><rect x="4" y="7" width="20" height="14" rx="3" fill="white"/><path d="M24 10 L34 5 V23 L24 18 Z" fill="white"/><circle cx="13" cy="14" r="5" fill="#0B1A22"/><circle cx="13" cy="14" r="2.5" fill="white"/><rect x="8" y="22" width="12" height="3" rx="1.5" fill="white"/></svg>',
)}`

const CAMERA_OFFLINE_GLYPH_DATA_URI = `data:image/svg+xml;base64,${btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="28" viewBox="0 0 36 28"><rect x="4" y="7" width="20" height="14" rx="3" fill="white"/><path d="M24 10 L34 5 V23 L24 18 Z" fill="white"/><path d="M3 3 L33 25 M33 3 L3 25" stroke="#0B1A22" stroke-width="4"/></svg>',
)}`

const MIN_PIXEL_SIZE = 7
const MAX_PIXEL_SIZE = 22
const SELECTED_OUTLINE_BOOST = 3

// Observed Data cyan (this app's four-layer provenance model) for the hazards domain's original
// two kinds, kept as distinguishable shades rather than one identical color; a neutral slate for
// the one non-hazards kind wired in Phase 3 (aircraft); amber/orange-family shades for Phase 5's
// hazard kinds, chosen only to keep six new hazard layers visually distinguishable from each
// other and from the pre-existing cyan/teal hazard layers — never a severity gradient tied to any
// source-supplied value. Magnitude scaling (earthquake only) remains the sole data-driven size
// variation.
function resolveStyle(kind: TerraIntelligenceEventKind, feature: TerraGeoFeature): { color: string; pixelSize: number } {
  switch (kind) {
    case 'earthquake': {
      const magnitude = typeof feature.properties.mag === 'number' ? feature.properties.mag : null
      const pixelSize = magnitude === null ? MIN_PIXEL_SIZE : Math.min(MAX_PIXEL_SIZE, MIN_PIXEL_SIZE + Math.max(0, magnitude) * 2.2)
      return { color: '#38BDF8', pixelSize }
    }
    case 'water_gauge_reading':
      return { color: '#2DD4BF', pixelSize: 10 }
    case 'aircraft_state':
      return { color: '#94A3B8', pixelSize: 8 }
    case 'vessel_position':
      return { color: '#38E1C6', pixelSize: 8 }
    case 'tropical_cyclone':
      return { color: '#FB923C', pixelSize: 16 }
    case 'wildfire_incident':
      return { color: '#F97316', pixelSize: 11 }
    case 'volcano_event':
      return { color: '#EF4444', pixelSize: 11 }
    case 'flood_event':
      return { color: '#60A5FA', pixelSize: 11 }
    case 'severe_weather_alert':
      return { color: '#FACC15', pixelSize: 10 }
    case 'tsunami_alert':
      return { color: '#22D3EE', pixelSize: 10 }
    case 'landmark_poi':
      return { color: '#A78BFA', pixelSize: 9 }
    case 'traffic_camera': {
      const inspect = cameraInspectFreshness(feature)
      const pinState = cameraPinStateFromImageFreshness(inspect.imageFreshness)
      return { color: cameraPinColor(pinState), pixelSize: 12 }
    }
    case 'traffic_event': {
      // Visual weight only varies by real source-reported severity (Open511's own MAJOR/MODERATE/
      // MINOR/UNKNOWN vocabulary, preserved verbatim in properties.severity) — never a War
      // Room-invented risk score, matching this file's existing "no severity gradient we made up"
      // rule for every other kind.
      const severity = typeof feature.properties.severity === 'string' ? feature.properties.severity : null
      const pixelSize = severity === 'MAJOR' ? 13 : severity === 'MODERATE' ? 11 : 9
      return { color: '#F87171', pixelSize }
    }
    default:
      return { color: '#38BDF8', pixelSize: MIN_PIXEL_SIZE }
  }
}

const CLUSTER_PIXEL_RANGE = 60
const CLUSTER_MINIMUM_SIZE = 3

export function TerraFeatureLayer({
  layerId,
  viewer,
  enabled,
  features,
  selectedId,
  followId = null,
  cluster = false,
  clusterKind,
  trails,
  viewBand,
  clusterPixelRange,
  clusterMinimumSize,
}: Props) {
  const dataSourceRef = useRef<CustomDataSource | null>(null)
  const hoveredIdRef = useRef<string | null>(null)
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const workerPool = terraWorkerPool()
  const clusterSettingsRef = useRef({ clusterPixelRange, clusterMinimumSize, viewBand })
  useEffect(() => {
    clusterSettingsRef.current = { clusterPixelRange, clusterMinimumSize, viewBand }
  }, [clusterPixelRange, clusterMinimumSize, viewBand])

  // Owns the DataSource's lifecycle against this specific viewer instance only. Recreated per
  // layerId so each layer's entities live in their own named DataSource (matters for future
  // per-layer Cesium operations like independent clustering, never shared/merged across layers).
  useEffect(() => {
    if (!viewer || !enabled) return
    let cancelled = false
    let created: CustomDataSource | null = null

    async function attach() {
      const Cesium = await loadCesium()
      // The dynamic import is the async gap where a sibling TerraGlobe remount (observed under
      // React StrictMode's dev-only double-invoke, and possible on any fast-refresh reload) can
      // destroy this exact `viewer` before this closure resumes — `cancelled` alone only tracks
      // this effect's own unmount, not a viewer torn down out from under it.
      if (cancelled || viewer!.isDestroyed()) return
      created = new Cesium.CustomDataSource(`terra-layer-${layerId}`)
      if (cluster) {
        const settings = clusterSettingsRef.current
        created.clustering.enabled = true
        created.clustering.pixelRange = settings.clusterPixelRange ?? CLUSTER_PIXEL_RANGE
        created.clustering.minimumClusterSize = settings.clusterMinimumSize ?? CLUSTER_MINIMUM_SIZE
        created.clustering.clusterLabels = true
        created.clustering.clusterBillboards = true
        created.clustering.clusterEvent.addEventListener((clusteredEntities, cluster) => {
          const count = Array.isArray(clusteredEntities) ? clusteredEntities.length : 0
          cluster.label.show = true
          cluster.label.text = String(count)
          cluster.label.font = 'bold 12px monospace'
          cluster.label.fillColor = Cesium.Color.fromCssColorString('#ECFEFF')
          cluster.label.outlineColor = Cesium.Color.fromCssColorString('#0B1A22')
          cluster.label.outlineWidth = 4
          cluster.label.style = Cesium.LabelStyle.FILL_AND_OUTLINE
          cluster.label.pixelOffset = new Cesium.Cartesian2(0, -18)
          cluster.label.disableDepthTestDistance = Number.POSITIVE_INFINITY
          cluster.billboard.show = true
          cluster.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY
          if (clusterKind === 'camera') {
            cluster.billboard.image = CAMERA_GLYPH_DATA_URI
            cluster.billboard.color = Cesium.Color.fromCssColorString('#22D3EE')
            cluster.point.show = false
          } else if (layerId === 'opensky' || layerId === 'digitraffic_marine') {
            const activeViewBand = clusterSettingsRef.current.viewBand
            cluster.billboard.image = vehicleSilhouetteDataUri(layerId === 'digitraffic_marine' ? 'vessel_position' : 'aircraft_state', {}, false)
            cluster.billboard.color = Cesium.Color.fromCssColorString(layerId === 'digitraffic_marine' ? '#67E8F9' : '#E2E8F0')
            cluster.billboard.scale = vehicleIconScale(activeViewBand ?? 'GLOBAL')
            cluster.point.show = false
          }
          let sumLat = 0
          let sumLon = 0
          let west = Infinity
          let east = -Infinity
          let south = Infinity
          let north = -Infinity
          let samples = 0
          const now = viewer!.clock.currentTime
          for (const entity of clusteredEntities) {
            const position = entity.position?.getValue(now)
            if (!position) continue
            const cartographic = Cesium.Cartographic.fromCartesian(position)
            const lat = Cesium.Math.toDegrees(cartographic.latitude)
            const lon = Cesium.Math.toDegrees(cartographic.longitude)
            sumLat += lat
            sumLon += lon
            west = Math.min(west, lon)
            east = Math.max(east, lon)
            south = Math.min(south, lat)
            north = Math.max(north, lat)
            samples += 1
          }
          if (samples > 0) {
            cluster.billboard.id = {
              terraCluster: true,
              layerId,
              count,
              latitude: sumLat / samples,
              longitude: sumLon / samples,
              west,
              south,
              east,
              north,
            }
          }
        })
      }
      viewer!.dataSources.add(created)
      dataSourceRef.current = created
    }
    void attach()

    return () => {
      cancelled = true
      // Cesium's Viewer getters (dataSources, clock, ...) throw once the viewer itself has been
      // destroyed — real behavior observed in authenticated browser testing during React
      // StrictMode's dev-only double-invoke of this cleanup around a torn-down TerraGlobe. Every
      // other viewer-touching cleanup in Terra checks this first; this one didn't.
      if (created && !viewer.isDestroyed()) {
        viewer.dataSources.remove(created, true)
      }
      if (dataSourceRef.current === created) dataSourceRef.current = null
    }
  }, [viewer, layerId, cluster, clusterKind, enabled])

  useEffect(() => {
    const dataSource = dataSourceRef.current
    if (!dataSource || !cluster) return
    dataSource.clustering.pixelRange = clusterPixelRange ?? (viewBand ? vehicleClusterPixelRange(viewBand) : CLUSTER_PIXEL_RANGE)
    dataSource.clustering.minimumClusterSize = clusterMinimumSize ?? (viewBand ? vehicleClusterMinimumSize(viewBand) : CLUSTER_MINIMUM_SIZE)
  }, [cluster, clusterPixelRange, clusterMinimumSize, viewBand])

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    if (layerId !== 'opensky' && layerId !== 'digitraffic_marine') return
    let cancelled = false
    let handler: { destroy: () => void; setInputAction: (action: (movement: { endPosition: unknown }) => void, type: number) => void } | null = null
    void loadCesium().then(Cesium => {
      if (cancelled || viewer.isDestroyed()) return
      handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
      handler.setInputAction((movement) => {
        const picked = viewer.scene.pick(movement.endPosition as import('cesium').Cartesian2)
        const pickedId = picked?.id && typeof picked.id.id === 'string' ? picked.id.id : null
        const prefix = terraEntityId(`${layerId}:`)
        const next = pickedId && pickedId.startsWith(prefix) ? pickedId.slice(prefix.length) : null
        if (next !== hoveredIdRef.current) {
          const dataSource = dataSourceRef.current
          const previous = hoveredIdRef.current
          hoveredIdRef.current = next
          if (dataSource) {
            const paint = (featureId: string | null, hovered: boolean) => {
              if (!featureId) return
              const entity = dataSource.entities.getById(terraEntityId(`${layerId}:${featureId}`))
              if (!entity?.billboard) return
              const selected = featureId === selectedIdRef.current
              const kind = layerId === 'digitraffic_marine' ? 'vessel_position' : 'aircraft_state'
              entity.billboard.color = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString(vehicleColor(kind, selected, hovered)))
            }
            paint(previous, false)
            paint(next, true)
          }
        }
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
    })
    return () => {
      cancelled = true
      handler?.destroy()
    }
  }, [viewer, layerId])

  // Vehicle layers upsert stable billboard entities. Other layers still rebuild on feature-list
  // change. Camera-settle worker generations and hover no longer force a full removeAll().
  useEffect(() => {
    const dataSource = dataSourceRef.current
    if (!dataSource) return
    let cancelled = false
    const controller = new AbortController()
    const generation = workerPool.getSnapshot().generation

    async function render() {
      const Cesium = await loadCesium()
      if (cancelled) return
      if (workerPool.getSnapshot().smoothMode) return
      if (!enabled) {
        dataSource!.entities.removeAll()
        return
      }

      let renderFeatures = features
      try {
        const task = clusterKind === 'camera'
          ? 'CAMERA_CLUSTER'
          : layerId === 'opensky' || layerId === 'digitraffic_marine'
            ? 'VEHICLE_CLUSTER'
            : 'FEATURE_FILTER'
        const prepared = await workerPool.prepareFeatures(features, {
          layerId,
          viewBand: (viewBand ?? 'GLOBAL') as TerraViewBandName,
          priority: TERRA_JOB_PRIORITIES.P1_CURRENT_VIEW,
          task,
          signal: controller.signal,
        })
        if (cancelled || generation !== workerPool.getSnapshot().generation) return
        renderFeatures = prepared.flatMap(chunk => Array.from(chunk.featureIndices).flatMap((index, outputIndex) => {
          const feature = features[index]
          if (!feature) return []
          const count = chunk.clusterCounts[outputIndex] ?? 1
          if (count <= 1 || chunk.geometryKinds[outputIndex] !== 0) return [feature]
          const coordinateIndex = chunk.offsets[outputIndex] * 2
          return [{
            ...feature,
            longitude: chunk.coordinates[coordinateIndex],
            latitude: chunk.coordinates[coordinateIndex + 1],
            properties: { ...feature.properties, _terraWorkerClusterCount: count },
          }]
        }))
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return
        // Worker failure degrades only this layer to its existing bounded main-thread renderer.
        renderFeatures = features
      }

      if (cancelled || workerPool.getSnapshot().smoothMode) return
      const reuseVehicles = canReuseVehicleEntities(renderFeatures) && dataSource!.entities.values.length > 0
      if (!reuseVehicles) {
        dataSource!.entities.removeAll()
      } else {
        const existingIds = Array.from(dataSource!.entities.values, entity => entity.id)
        const prefix = terraEntityId(`${layerId}:`)
        const liveIds = terraLiveFeatureIds(renderFeatures)
        for (const staleId of staleEntityIds(existingIds, liveIds, prefix)) {
          const entity = dataSource!.entities.getById(staleId)
          if (entity) dataSource!.entities.remove(entity)
        }
      }

      const addFeature = (feature: TerraGeoFeature) => {
        if (cancelled || !dataSource) return
        const isSelected = feature.id === selectedId
        const { color, pixelSize } = resolveStyle(feature.kind, feature)
        // Composite "{layerId}:{featureId}" — not just featureId — so a click resolves back to
        // the correct layer even when two layers share a raw provider record id (e.g. the same
        // real earthquake appearing in both usgs_earthquake_feed and a usgs_earthquake catalog
        // search covering the same window). Parsed back apart in TerraShell's handleEntityClick.
        const entityId = terraEntityId(`${layerId}:${feature.id}`)

        if (feature.geometryKind === 'region' && feature.regionRings && feature.regionRings[0]) {
          // The real exterior ring only — holes (further rings) are not rendered this phase; no
          // Phase 5 source's warning areas actually carry one, and Cesium's PolygonHierarchy hole
          // support would be speculative complexity for data that doesn't exist yet.
          const flatDegrees = feature.regionRings[0].flatMap(([lon, lat]) => [lon, lat])
          dataSource!.entities.add({
            id: entityId,
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flatDegrees)),
              material: Cesium.Color.fromCssColorString(color).withAlpha(isSelected ? 0.35 : 0.18),
              outline: true,
              outlineColor: isSelected ? Cesium.Color.WHITE : Cesium.Color.fromCssColorString(color).withAlpha(0.9),
              outlineWidth: isSelected ? 2 : 1,
              height: 0,
              // A real warning polygon on the US mainland is easily large enough to render as a
              // filled shape at any reasonable globe zoom; unlike the sparse point layers, no
              // "stays visible through the globe" override is needed or wanted here.
              classificationType: Cesium.ClassificationType.TERRAIN,
            },
          })
          return
        }

        // God's Eye Traffic phase: a real LineString-backed road-event corridor (drivebc_events)
        // renders as an actual line, not a collapsed point — mission requirement. Distinct from
        // the aircraft/vessel session-only trail polylines below (this is the event's own real
        // geometry, not a derived recent-position history).
        if (feature.geometryKind === 'line' && feature.pathCoordinates && feature.pathCoordinates.length >= 2) {
          const flatDegrees = feature.pathCoordinates.flatMap(([lon, lat]) => [lon, lat])
          dataSource!.entities.add({
            id: entityId,
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(flatDegrees),
              width: isSelected ? 6 : 4,
              material: Cesium.Color.fromCssColorString(color).withAlpha(isSelected ? 0.95 : 0.75),
              clampToGround: true,
            },
          })
          return
        }

        const workerClusterCount = typeof feature.properties._terraWorkerClusterCount === 'number'
          ? feature.properties._terraWorkerClusterCount
          : 0
        if (workerClusterCount > 1) {
          dataSource!.entities.add({
            id: entityId,
            position: Cesium.Cartesian3.fromDegrees(feature.longitude, feature.latitude, feature.altitude ?? 0),
            point: {
              pixelSize: Math.min(24, 10 + Math.log2(workerClusterCount) * 2),
              color: Cesium.Color.fromCssColorString(color).withAlpha(0.9),
              outlineColor: Cesium.Color.fromCssColorString('#0B1A22'),
              outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: String(workerClusterCount),
              font: 'bold 11px monospace',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.fromCssColorString('#0B1A22'),
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -18),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          })
          return
        }

        // Live aircraft/vessels always use a type-aware north-up silhouette. Rotation is applied
        // only when the source supplied heading (aircraft true_track) or heading/COG (AIS). Missing
        // heading stays neutral — never a fabricated direction, and no separate giant arrow.
        if (feature.kind === 'aircraft_state' || feature.kind === 'vessel_position') {
          const headingDeg = sourcedVehicleHeadingDeg(feature.kind, feature.properties)
          const isHovered = feature.id === hoveredIdRef.current
          const tint = vehicleColor(feature.kind, isSelected, isHovered)
          const tick = vehicleShowHeadingTick(viewBand ?? 'REGIONAL')
          const position = Cesium.Cartesian3.fromDegrees(feature.longitude, feature.latitude, feature.altitude ?? 0)
          const image = vehicleSilhouetteDataUri(feature.kind, feature.properties, tick)
          const rotation = vehicleBillboardRotationRadians(headingDeg)
          const scale = vehicleIconScale(viewBand ?? 'REGIONAL', isSelected, isHovered)
          const existing = dataSource!.entities.getById(entityId)
          if (existing?.billboard) {
            existing.position = new Cesium.ConstantPositionProperty(position)
            existing.billboard.image = new Cesium.ConstantProperty(image)
            existing.billboard.color = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString(tint))
            existing.billboard.scale = new Cesium.ConstantProperty(scale)
            existing.billboard.rotation = new Cesium.ConstantProperty(rotation)
            return
          }
          dataSource!.entities.add({
            id: entityId,
            position,
            billboard: {
              image,
              color: Cesium.Color.fromCssColorString(tint),
              scale,
              rotation,
              alignedAxis: Cesium.Cartesian3.ZERO,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            point: isSelected
              ? {
                  pixelSize: 18,
                  color: Cesium.Color.TRANSPARENT,
                  outlineColor: Cesium.Color.fromCssColorString('#FDE68A').withAlpha(0.9),
                  outlineWidth: 2,
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                }
              : undefined,
          })
          return
        }
        const cameraBearing = feature.kind === 'traffic_camera' ? sourcedCameraBearingDegrees(feature.properties.direction) : null
        if (feature.kind === 'traffic_camera') {
          const cameraState = cameraPinStateFromImageFreshness(cameraInspectFreshness(feature).imageFreshness)
          dataSource!.entities.add({
            id: entityId,
            position: Cesium.Cartesian3.fromDegrees(feature.longitude, feature.latitude),
            billboard: {
              image: cameraState === 'OFFLINE' ? CAMERA_OFFLINE_GLYPH_DATA_URI : CAMERA_GLYPH_DATA_URI,
              color: Cesium.Color.fromCssColorString(isSelected ? '#FFFFFF' : color),
              scale: isSelected ? 1.35 : 1,
              rotation: cameraBearing !== null ? terraAircraftBillboardRotationRadians(cameraBearing) : 0,
              alignedAxis: Cesium.Cartesian3.ZERO,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            },
          })
          return
        }

        const isHistoricalQuake = feature.kind === 'earthquake' && feature.timestamp
          && Number.isFinite(Date.parse(feature.timestamp))
          && Date.now() - Date.parse(feature.timestamp) > 6 * 60 * 60_000
        dataSource!.entities.add({
          id: entityId,
          position: Cesium.Cartesian3.fromDegrees(feature.longitude, feature.latitude),
          point: {
            pixelSize: pixelSize + (isSelected ? SELECTED_OUTLINE_BOOST : 0) - (isHistoricalQuake ? 2 : 0),
            color: Cesium.Color.fromCssColorString(color).withAlpha(isHistoricalQuake ? 0.4 : 0.85),
            outlineColor: isSelected ? Cesium.Color.WHITE : Cesium.Color.fromCssColorString('#0B1A22').withAlpha(0.8),
            outlineWidth: isSelected ? 3 : 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY, // stays visible through the globe at any zoom, matching the "don't let markers vanish behind the horizon" need for a sparse global layer
          },
        })
      }

      // Result integration is deliberately bounded. Each callback is measured against the
      // scheduler's current frame budget; Living Orbit reduces that budget automatically.
      const integrationBatchSize = workerPool.getSnapshot().smoothMode ? 8 : 24
      for (let start = 0; start < renderFeatures.length; start += integrationBatchSize) {
        if (cancelled || workerPool.getSnapshot().smoothMode) return
        const batch = renderFeatures.slice(start, start + integrationBatchSize)
        await new Promise<void>(resolve => {
          const accepted = workerPool.renderScheduler.enqueue({
            id: `${layerId}:${generation}:${start}`,
            generation,
            priority: TERRA_JOB_PRIORITIES.P1_CURRENT_VIEW,
            layerId,
            run: () => {
              for (const feature of batch) addFeature(feature)
              resolve()
            },
            drop: resolve,
          })
          if (!accepted) resolve()
        })
      }

      // Live-aviation phase: a short session-only trail per aircraft (never a fabricated or
      // provider-historical track — see lib/terra/aircraftTrail.ts) rendered as a thin polyline
      // through its own real recent observed positions only.
      if (trails) {
        for (const [trailKey, points] of Object.entries(trails)) {
          if (points.length < 2) continue
          const flatDegrees = points.flatMap(point => [point.longitude, point.latitude])
          dataSource!.entities.add({
            id: terraEntityId(`${layerId}:trail:${trailKey}`),
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(flatDegrees),
              width: 1.5,
              material: Cesium.Color.fromCssColorString('#94A3B8').withAlpha(0.45),
              clampToGround: false,
            },
          })
        }
      }
    }
    void render()

    return () => {
      cancelled = true
      controller.abort()
      workerPool.cancelLayer(layerId)
    }
  }, [features, selectedId, enabled, layerId, trails, viewBand, clusterKind, workerPool])

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    if (!followId) {
      assignTrackedAircraft(viewer, undefined)
      return
    }
    const entity = dataSourceRef.current?.entities.getById(terraEntityId(`${layerId}:${followId}`))
    if (entity) assignTrackedAircraft(viewer, entity)
  }, [followId, features, layerId, viewer])

  return null
}
