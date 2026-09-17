'use client'

/**
 * Automatic urban geography on the existing Terra Cesium scene.
 *
 * IMAGERY_FIRST. Viewport-bounded OSM roads + building footprints, fetched once per camera settle.
 * Crude 3D extrusion is Commander opt-in (CRUDE_EXTRUSION = DISABLED_BY_DEFAULT). Footprints stay
 * pickable without brown/olive block masses. Failures degrade this overlay only.
 */
import { useEffect, useRef } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import type { TerraScaleLevel } from './useTerraCameraScale'
import type { TerraDegreeRectangle } from '@/lib/terra/aircraftBoundingBox'
import {
  highwayWidthPx,
  isHouseBuildingType,
  TERRA_URBAN_TILE_ZOOM,
  urbanLodForScaleLevel,
  urbanViewportIsFetchable,
} from '@/lib/terra/urbanDetail/lod'
import {
  TERRA_URBAN_CAMERA_DEBOUNCE_MS,
  hasUsableUrbanGeometry,
  sameUrbanViewportKey,
} from '@/lib/terra/urbanDetail/requestControl'
import {
  clearUrbanBuildingsForPick,
  registerUrbanGeometryForPick,
  TERRA_URBAN_BUILDING_ENTITY_PREFIX,
  TERRA_URBAN_SIGNAL_ENTITY_PREFIX,
} from '@/lib/terra/urbanDetail/pick'
import { expandBounds, tilesForBounds, urbanTileId } from '@/lib/terra/urbanDetail/tiles'
import type {
  TerraUrbanBuilding,
  TerraUrbanDiagnosticState,
  TerraUrbanLod,
  TerraUrbanTilePayload,
} from '@/lib/terra/urbanDetail/types'

export type TerraUrbanDetailStatus = {
  enabled: boolean
  pending: boolean
  lod: TerraUrbanLod | null
  roads: TerraUrbanDiagnosticState
  buildings: TerraUrbanDiagnosticState
  signals: TerraUrbanDiagnosticState
  labels: TerraUrbanDiagnosticState
  terrain: TerraUrbanDiagnosticState
  source: string | null
  buildingCount: number
  roadCount: number
  signalCount: number
  houseCount: number
  streetLabelCount: number
  houseLabelCount: number
  fromCache: boolean
  truncated: boolean
  error: string | null
  loadMs: number | null
  networkFetches: number
  rateLimited: boolean
}

const IDLE_STATUS: TerraUrbanDetailStatus = {
  enabled: false,
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
}

type CesiumNS = typeof import('cesium')
type Destroyable = { destroy?: () => void; isDestroyed?: () => boolean }

type UrbanSceneHandles = {
  roadPrimitive: Destroyable | null
  buildingDataSource: { name?: string } | null
  signalDataSource: { name?: string } | null
  labelCollection: Destroyable | null
}

const clientTileCache = new Map<string, TerraUrbanTilePayload>()
const CLIENT_CACHE_MAX = 48
const clientInflight = new Map<string, Promise<TerraUrbanTilePayload>>()
let urbanNetworkFetches = 0
let clientRetryBlockedUntil = 0

function rememberTile(cacheKey: string, tile: TerraUrbanTilePayload): void {
  if (!hasUsableUrbanGeometry(tile)) return
  if (clientTileCache.has(cacheKey)) clientTileCache.delete(cacheKey)
  clientTileCache.set(cacheKey, tile)
  while (clientTileCache.size > CLIENT_CACHE_MAX) {
    const oldest = clientTileCache.keys().next().value
    if (oldest === undefined) break
    clientTileCache.delete(oldest)
  }
}

async function fetchUrbanViewportTile(cacheKey: string, params: URLSearchParams, signal: AbortSignal): Promise<TerraUrbanTilePayload> {
  const existing = clientInflight.get(cacheKey)
  if (existing) return existing
  const pending = (async () => {
    urbanNetworkFetches += 1
    const response = await fetch(`/api/terra/urban-tiles?${params}`, { cache: 'no-store', credentials: 'include', signal })
    if (!response.ok) {
      const error = new Error(response.status === 401 || response.status === 403 ? 'AUTH_REQUIRED' : `Urban tile request HTTP ${response.status}`)
      ;(error as Error & { status?: number }).status = response.status
      throw error
    }
    const body = await response.json() as { tile?: TerraUrbanTilePayload }
    if (!body.tile) throw new Error('Urban tile payload missing.')
    return body.tile
  })()
  clientInflight.set(cacheKey, pending)
  try {
    return await pending
  } finally {
    if (clientInflight.get(cacheKey) === pending) clientInflight.delete(cacheKey)
  }
}

function isViewerAlive(viewer: CesiumViewer): boolean {
  return !viewer.isDestroyed()
}

function viewportCacheKey(lod: TerraUrbanLod, rectangle: TerraDegreeRectangle): string {
  const tiles = tilesForBounds(expandBounds(rectangle), TERRA_URBAN_TILE_ZOOM[lod], lod)
  return tiles.map(tile => urbanTileId(tile)).sort().join('|')
}

function roadColor(Cesium: CesiumNS, highway: string): import('cesium').Color {
  if (highway.startsWith('motorway') || highway.startsWith('trunk')) return Cesium.Color.fromCssColorString('#f2d083').withAlpha(0.95)
  if (highway.startsWith('primary')) return Cesium.Color.fromCssColorString('#f0e0a8').withAlpha(0.92)
  if (highway.startsWith('secondary') || highway.startsWith('tertiary')) return Cesium.Color.fromCssColorString('#efe6c4').withAlpha(0.9)
  return Cesium.Color.fromCssColorString('#f7f1d8').withAlpha(0.86)
}

function buildingColor(Cesium: CesiumNS, building: TerraUrbanBuilding): import('cesium').Color {
  const type = building.buildingType
  if (isHouseBuildingType(type)) return Cesium.Color.fromCssColorString('#e6d0a8').withAlpha(0.96)
  if (type === 'apartments') return Cesium.Color.fromCssColorString('#d3b48c').withAlpha(0.96)
  if (type === 'commercial' || type === 'retail' || type === 'office' || type === 'hotel') return Cesium.Color.fromCssColorString('#b9c4d1').withAlpha(0.96)
  if (type === 'industrial' || type === 'warehouse' || type === 'hangar') return Cesium.Color.fromCssColorString('#9aa3ad').withAlpha(0.96)
  if (type === 'garage' || type === 'shed' || type === 'carport') return Cesium.Color.fromCssColorString('#cfc3ae').withAlpha(0.94)
  return Cesium.Color.fromCssColorString('#d9cbb3').withAlpha(0.96)
}

function destroyHandle(handle: Destroyable | null, collection: { remove: (value: unknown) => boolean } | null): void {
  if (!handle) return
  try {
    collection?.remove(handle)
  } catch {
    // Viewer may already be tearing down.
  }
  try {
    if (!handle.isDestroyed?.()) handle.destroy?.()
  } catch {
    // Primitive already destroyed with the scene.
  }
}

function clearUrbanScene(viewer: CesiumViewer, handles: UrbanSceneHandles): UrbanSceneHandles {
  if (!isViewerAlive(viewer)) {
    clearUrbanBuildingsForPick()
    return { roadPrimitive: null, buildingDataSource: null, signalDataSource: null, labelCollection: null }
  }
  destroyHandle(handles.roadPrimitive, viewer.scene.groundPrimitives)
  if (handles.buildingDataSource) {
    try {
      viewer.dataSources.remove(handles.buildingDataSource as never, true)
    } catch {
      // Viewer may already be tearing down.
    }
  }
  if (handles.signalDataSource) {
    try {
      viewer.dataSources.remove(handles.signalDataSource as never, true)
    } catch {
      // Viewer may already be tearing down.
    }
  }
  destroyHandle(handles.labelCollection, viewer.scene.primitives)
  clearUrbanBuildingsForPick()
  return { roadPrimitive: null, buildingDataSource: null, signalDataSource: null, labelCollection: null }
}

async function sampleTerrainHeights(
  Cesium: CesiumNS,
  viewer: CesiumViewer,
  buildings: TerraUrbanBuilding[],
): Promise<number[]> {
  if (buildings.length === 0) return []
  if (viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) {
    return buildings.map(() => 0)
  }
  try {
    const cartographics = buildings.map(building => Cesium.Cartographic.fromDegrees(building.longitude, building.latitude))
    const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics)
    return sampled.map(point => (point && Number.isFinite(point.height) ? point.height : 0))
  } catch {
    return buildings.map(() => 0)
  }
}

function uniqueCoordinates(coords: { longitude: number; latitude: number }[]): { longitude: number; latitude: number }[] {
  const unique: { longitude: number; latitude: number }[] = []
  for (const coord of coords) {
    const last = unique[unique.length - 1]
    if (last && Math.abs(last.longitude - coord.longitude) < 1e-10 && Math.abs(last.latitude - coord.latitude) < 1e-10) continue
    unique.push(coord)
  }
  if (unique.length >= 2) {
    const first = unique[0]
    const last = unique[unique.length - 1]
    if (Math.abs(first.longitude - last.longitude) < 1e-10 && Math.abs(first.latitude - last.latitude) < 1e-10) unique.pop()
  }
  return unique
}

async function renderUrbanTile(
  Cesium: CesiumNS,
  viewer: CesiumViewer,
  tile: TerraUrbanTilePayload,
  previous: UrbanSceneHandles,
  extrudeBuildings: boolean,
): Promise<UrbanSceneHandles> {
  const handles = clearUrbanScene(viewer, previous)
  if (!isViewerAlive(viewer) || !viewer.scene?.globe) return handles

  try {
    if (tile.roads.length > 0) {
      const groundSupported = typeof Cesium.GroundPolylinePrimitive?.isSupported === 'function' && Cesium.GroundPolylinePrimitive.isSupported(viewer.scene)
      if (groundSupported) {
        const instances = tile.roads.flatMap(road => {
          const geometry = uniqueCoordinates(road.geometry)
          if (geometry.length < 2) return []
          try {
            const positions = Cesium.Cartesian3.fromDegreesArray(geometry.flatMap(coord => [coord.longitude, coord.latitude]))
            return [new Cesium.GeometryInstance({
              id: { terraUrban: true, kind: 'road', roadId: road.id },
              geometry: new Cesium.GroundPolylineGeometry({ positions, width: highwayWidthPx(road.highway) }),
              attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(roadColor(Cesium, road.highway)) },
            })]
          } catch {
            return []
          }
        })
        if (instances.length > 0) {
          const primitive = new Cesium.GroundPolylinePrimitive({
            geometryInstances: instances,
            appearance: new Cesium.PolylineColorAppearance(),
            asynchronous: false,
          })
          viewer.scene.groundPrimitives.add(primitive)
          handles.roadPrimitive = primitive
        }
      } else {
        const collection = new Cesium.PolylineCollection()
        for (const road of tile.roads) {
          const geometry = uniqueCoordinates(road.geometry)
          if (geometry.length < 2) continue
          collection.add({
            positions: Cesium.Cartesian3.fromDegreesArray(geometry.flatMap(coord => [coord.longitude, coord.latitude])),
            width: highwayWidthPx(road.highway),
            material: Cesium.Material.fromType('Color', { color: roadColor(Cesium, road.highway) }),
          })
        }
        viewer.scene.primitives.add(collection)
        handles.roadPrimitive = collection
      }
    }

    if (tile.buildings.length > 0) {
      const terrainHeights = extrudeBuildings ? await sampleTerrainHeights(Cesium, viewer, tile.buildings) : []
      if (!isViewerAlive(viewer) || !viewer.scene?.globe) return handles
      const dataSource = new Cesium.CustomDataSource('terra-urban-buildings')
      for (let index = 0; index < tile.buildings.length; index++) {
        const building = tile.buildings[index]
        const ring = uniqueCoordinates(building.footprint)
        if (ring.length < 3) continue
        try {
          if (extrudeBuildings) {
            const terrainHeight = terrainHeights[index] ?? 0
            dataSource.entities.add({
              id: `${TERRA_URBAN_BUILDING_ENTITY_PREFIX}${building.id}`,
              name: building.name ?? building.buildingType,
              polygon: {
                hierarchy: Cesium.Cartesian3.fromDegreesArray(ring.flatMap(coord => [coord.longitude, coord.latitude])),
                height: terrainHeight,
                extrudedHeight: terrainHeight + Math.max(2.2, building.heightMeters),
                material: buildingColor(Cesium, building),
                outline: false,
              },
            })
          } else {
            // IMAGERY_FIRST footprint — no height / no extrudedHeight. Ground classification stays
            // pickable (OSM id + inspect) without a 3D mass over the photograph.
            dataSource.entities.add({
              id: `${TERRA_URBAN_BUILDING_ENTITY_PREFIX}${building.id}`,
              name: building.name ?? building.buildingType,
              polygon: {
                hierarchy: Cesium.Cartesian3.fromDegreesArray(ring.flatMap(coord => [coord.longitude, coord.latitude])),
                material: Cesium.Color.fromCssColorString('#67e8f9').withAlpha(0.03),
                outline: false,
                classificationType: Cesium.ClassificationType.TERRAIN,
              },
            })
          }
        } catch {
          // Skip a single malformed footprint; keep the rest of the tile.
        }
      }
      if (dataSource.entities.values.length > 0) {
        await viewer.dataSources.add(dataSource)
        handles.buildingDataSource = dataSource
      }
    }

    if ((tile.signals ?? []).length > 0) {
      const signalSource = new Cesium.CustomDataSource('terra-urban-signals')
      const signalColor = Cesium.Color.fromCssColorString('#94a3b8')
      const signalOutline = Cesium.Color.fromCssColorString('#0f172a')
      for (const signal of tile.signals) {
        try {
          signalSource.entities.add({
            id: `${TERRA_URBAN_SIGNAL_ENTITY_PREFIX}${signal.id}`,
            name: signal.name ?? 'traffic signal',
            position: Cesium.Cartesian3.fromDegrees(signal.longitude, signal.latitude),
            point: {
              pixelSize: 7,
              color: signalColor,
              outlineColor: signalOutline,
              outlineWidth: 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
          })
        } catch {
          // Skip a single malformed node; keep the rest of the tile.
        }
      }
      if (signalSource.entities.values.length > 0) {
        await viewer.dataSources.add(signalSource)
        handles.signalDataSource = signalSource
      }
    }

    registerUrbanGeometryForPick({
      buildings: tile.buildings,
      roads: tile.roads,
      signals: tile.signals ?? [],
    })

    if (tile.labels.length > 0) {
      const collection = new Cesium.LabelCollection({ scene: viewer.scene })
      for (const label of tile.labels) {
        const houseNumber = label.kind === 'house_number'
        collection.add({
          position: Cesium.Cartesian3.fromDegrees(label.longitude, label.latitude, houseNumber ? 6 : 12),
          text: label.text,
          font: houseNumber ? '10px sans-serif' : '11px sans-serif',
          fillColor: houseNumber ? Cesium.Color.fromCssColorString('#fde68a') : Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, houseNumber ? 1400 : 22000),
        })
      }
      viewer.scene.primitives.add(collection)
      handles.labelCollection = collection
    }
  } catch {
    return clearUrbanScene(viewer, handles)
  }

  return handles
}

function statusFromTile(tile: TerraUrbanTilePayload, lod: TerraUrbanLod, enabled: boolean, loadMs: number | null, terrain: TerraUrbanDiagnosticState): TerraUrbanDetailStatus {
  const rateLimited = Boolean(tile.rateLimited) || tile.diagnostics.roads === 'RATE_LIMITED' || tile.diagnostics.buildings === 'RATE_LIMITED'
  return {
    enabled,
    pending: false,
    lod,
    roads: tile.diagnostics.roads,
    buildings: tile.diagnostics.buildings,
    signals: tile.diagnostics.signals ?? 'UNAVAILABLE',
    labels: tile.diagnostics.labels,
    terrain,
    source: tile.source,
    buildingCount: tile.buildings.length,
    roadCount: tile.roads.length,
    signalCount: tile.signals?.length ?? 0,
    houseCount: tile.buildings.filter(building => isHouseBuildingType(building.buildingType)).length,
    streetLabelCount: (tile.labels ?? []).filter(label => label.kind === 'street').length,
    houseLabelCount: (tile.labels ?? []).filter(label => label.kind === 'house_number').length,
    fromCache: tile.fromCache,
    truncated: tile.truncated,
    error: tile.error,
    loadMs,
    networkFetches: urbanNetworkFetches,
    rateLimited,
  }
}

type Props = {
  viewer: CesiumViewer | null
  scaleLevel: TerraScaleLevel
  rectangle: TerraDegreeRectangle | null
  enabled: boolean
  extrudeBuildings?: boolean
  hasWorldTerrain: boolean
  onStatusChange?: (status: TerraUrbanDetailStatus) => void
}

export function TerraUrbanDetail({
  viewer,
  scaleLevel,
  rectangle,
  enabled,
  // CRUDE_EXTRUSION = DISABLED_BY_DEFAULT. Building identities/footprints still fetch and remain pickable.
  extrudeBuildings = false,
  hasWorldTerrain,
  onStatusChange,
}: Props) {
  const handlesRef = useRef<UrbanSceneHandles>({ roadPrimitive: null, buildingDataSource: null, signalDataSource: null, labelCollection: null })
  const onStatusChangeRef = useRef(onStatusChange)
  const lastViewportKeyRef = useRef<string | null>(null)
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  const west = rectangle?.west
  const south = rectangle?.south
  const east = rectangle?.east
  const north = rectangle?.north

  useEffect(() => {
    if (!viewer) return
    const targetViewer = viewer
    let cancelled = false
    const controller = new AbortController()

    async function applyTile(Cesium: CesiumNS, tile: TerraUrbanTilePayload, lod: TerraUrbanLod, terrain: TerraUrbanDiagnosticState, loadMs: number | null, cacheKey: string) {
      if (cancelled || !isViewerAlive(targetViewer)) return
      if (hasUsableUrbanGeometry(tile)) {
        handlesRef.current = await renderUrbanTile(Cesium, targetViewer, tile, handlesRef.current, extrudeBuildings)
        lastViewportKeyRef.current = cacheKey
      } else if (!sameUrbanViewportKey(lastViewportKeyRef.current, cacheKey)) {
        handlesRef.current = clearUrbanScene(targetViewer, handlesRef.current)
        lastViewportKeyRef.current = cacheKey
      }
      if (cancelled) return
      onStatusChangeRef.current?.(statusFromTile(tile, lod, enabled, loadMs, terrain))
    }

    async function run() {
      const Cesium = await loadCesium()
      if (cancelled || !isViewerAlive(targetViewer)) return
      const lod = enabled ? urbanLodForScaleLevel(scaleLevel) : null
      const terrain: TerraUrbanDiagnosticState = hasWorldTerrain ? 'LIVE' : 'UNAVAILABLE'
      if (!lod || west == null || south == null || east == null || north == null) {
        handlesRef.current = clearUrbanScene(targetViewer, handlesRef.current)
        lastViewportKeyRef.current = null
        onStatusChangeRef.current?.({ ...IDLE_STATUS, enabled, terrain, lod, networkFetches: urbanNetworkFetches })
        return
      }
      const view = { west, south, east, north }
      if (!urbanViewportIsFetchable(view, lod)) {
        handlesRef.current = clearUrbanScene(targetViewer, handlesRef.current)
        lastViewportKeyRef.current = null
        onStatusChangeRef.current?.({ ...IDLE_STATUS, enabled, terrain, lod, networkFetches: urbanNetworkFetches })
        return
      }

      const cacheKey = viewportCacheKey(lod, view)
      const cached = clientTileCache.get(cacheKey)
      if (cached && hasUsableUrbanGeometry(cached)) {
        lastViewportKeyRef.current = cacheKey
        await applyTile(Cesium, {
          ...cached,
          fromCache: true,
          diagnostics: {
            roads: cached.diagnostics.roads === 'UNAVAILABLE' || cached.diagnostics.roads === 'RATE_LIMITED' ? cached.diagnostics.roads : 'CACHED',
            buildings: cached.diagnostics.buildings === 'UNAVAILABLE' || cached.diagnostics.buildings === 'RATE_LIMITED' ? cached.diagnostics.buildings : 'CACHED',
            signals: cached.diagnostics.signals === 'UNAVAILABLE' || cached.diagnostics.signals === 'RATE_LIMITED' ? cached.diagnostics.signals : 'CACHED',
            labels: cached.diagnostics.labels === 'UNAVAILABLE' || cached.diagnostics.labels === 'RATE_LIMITED' ? cached.diagnostics.labels : 'CACHED',
          },
        }, lod, terrain, 0, cacheKey)
        return
      }

      if (sameUrbanViewportKey(lastViewportKeyRef.current, cacheKey) && Date.now() < clientRetryBlockedUntil) {
        onStatusChangeRef.current?.({
          ...IDLE_STATUS,
          enabled,
          lod,
          terrain,
          pending: false,
          roads: 'RATE_LIMITED',
          buildings: lod === 'city' ? 'UNAVAILABLE' : 'RATE_LIMITED',
          error: `Overpass retry suppressed until camera movement or backoff expires.`,
          networkFetches: urbanNetworkFetches,
          rateLimited: true,
        })
        return
      }

      onStatusChangeRef.current?.({ ...IDLE_STATUS, enabled, pending: true, lod, terrain, networkFetches: urbanNetworkFetches })
      const started = performance.now()
      const params = new URLSearchParams({
        lod,
        west: String(west),
        south: String(south),
        east: String(east),
        north: String(north),
      })
      try {
        const tile = await fetchUrbanViewportTile(cacheKey, params, controller.signal)
        if (cancelled || !isViewerAlive(targetViewer)) return
        rememberTile(cacheKey, tile)
        if (tile.rateLimited || tile.diagnostics.roads === 'RATE_LIMITED') {
          clientRetryBlockedUntil = Date.now() + Math.max(8_000, tile.retryAfterMs ?? 8_000)
        }
        await applyTile(Cesium, tile, lod, terrain, Math.round(performance.now() - started), cacheKey)
      } catch (error) {
        if (cancelled || controller.signal.aborted || !isViewerAlive(targetViewer)) return
        const status = (error as { status?: number }).status
        if (status === 429 || status === 503) {
          clientRetryBlockedUntil = Date.now() + 8_000
          if (cached && hasUsableUrbanGeometry(cached)) {
            await applyTile(Cesium, { ...cached, fromCache: true, rateLimited: true, error: 'Overpass rate limited; serving cached geometry.' }, lod, terrain, 0, cacheKey)
            return
          }
          onStatusChangeRef.current?.({
            ...IDLE_STATUS,
            enabled,
            lod,
            terrain,
            roads: 'RATE_LIMITED',
            buildings: lod === 'city' ? 'UNAVAILABLE' : 'RATE_LIMITED',
            error: error instanceof Error ? error.message : String(error),
            networkFetches: urbanNetworkFetches,
            rateLimited: true,
          })
          return
        }
        onStatusChangeRef.current?.({
          ...IDLE_STATUS,
          enabled,
          lod,
          terrain,
          error: error instanceof Error ? error.message : String(error),
          networkFetches: urbanNetworkFetches,
        })
      }
    }

    const timer = window.setTimeout(() => { void run() }, TERRA_URBAN_CAMERA_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [viewer, scaleLevel, west, south, east, north, enabled, extrudeBuildings, hasWorldTerrain])

  useEffect(() => {
    return () => {
      const targetViewer = viewer
      if (!targetViewer || !isViewerAlive(targetViewer)) return
      handlesRef.current = clearUrbanScene(targetViewer, handlesRef.current)
    }
  }, [viewer])

  return null
}

export { urbanBuildingToSelection } from '@/lib/terra/urbanDetail/pick'
