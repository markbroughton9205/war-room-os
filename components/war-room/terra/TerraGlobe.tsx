'use client'

/**
 * Terra Foundation (Phase G) — the CesiumJS globe surface.
 *
 * God's Eye View V1 (MIT, github.com/bilawalsidhu/gods-eye-view) is the origin of the decision to
 * use CesiumJS for the WebGL globe/photorealistic-3D-tiles engine — see
 * docs/terra/phase-g-repository-license-analysis.md for the full KEEP/ADAPT/REPLACE/REJECT
 * rationale. No source code from that repository is copied here: this component is original
 * TypeScript/React written against CesiumJS's own public API (CesiumJS itself is Apache-2.0,
 * developed by Cesium GS, Inc. — a separate project from, and a dependency of, God's Eye View).
 *
 * Client-only by construction (Cesium requires `window`/WebGL) — always render this inside a
 * dynamic import with `ssr: false` from a Server Component page.
 *
 * Honest degradation, matching this codebase's "no fake data" standard: NASA GIBS supplies the
 * credential-free photographic surface through TerraEarthImagery, OSM stays beneath it as the
 * network fallback, and Cesium World Terrain activates only when a real public ion token is
 * configured. Status reporting never labels a missing credential as a connection outage.
 */
import { useEffect, useRef, useState } from 'react'
// Cesium's own base stylesheet (canvas sizing, credit container, cesium-viewer/-widget classes).
// Needed even with every default UI widget disabled — Cesium's internal DOM structure depends on
// these classes existing. Importing the package's own CSS (not a copy) — standard Cesium+Next.js
// integration practice.
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import { featureIdFromTerraEntityId, isTerraClusterPick, type TerraClusterPick } from '@/lib/terra/cesiumEntityId'
import { findUrbanBuildingAt, findUrbanRoadAt, findUrbanSignalAt, resolveTerraUrbanBuildingFromPick, resolveTerraUrbanRoadFromPick, resolveTerraUrbanSignalFromPick } from '@/lib/terra/urbanDetail/pick'
import { isTerraWorkspacePanelDragging } from './workspace/isolateTerraGlobeInputs'
import type { TerraUrbanBuilding, TerraUrbanRoad, TerraUrbanSelection, TerraUrbanSignal } from '@/lib/terra/urbanDetail/types'
import type { TerraClickPoint } from '@/lib/terra/types'

export type TerraImageryTier = 'nasa_gibs_with_osm_fallback'

export type TerraGlobeStatus =
  | { phase: 'loading' }
  | { phase: 'ready'; imageryTier: TerraImageryTier; hasIonToken: boolean; hasOsmBuildings: boolean; hasRealTerrain: boolean }
  | { phase: 'error'; message: string }

type TerraGlobeProps = {
  onStatusChange?: (status: TerraGlobeStatus) => void
  /** Fires once, right after the Cesium Viewer is constructed — the hand-off point for any
   * layer component (e.g. the earthquake layer) that needs to add its own DataSource. */
  onViewerReady?: (viewer: CesiumViewer) => void
  /** Fires once, after Cesium OSM Buildings has been attached to the scene (a real ion global
   * asset, only requested when hasIonToken) — `null` when no ion token is configured or the
   * asset request failed, so a caller can gate a "3D Buildings" visibility toggle without probing
   * the scene's primitives itself. God's Eye multi-scale phase. */
  onBuildingsTilesetReady?: (tileset: import('cesium').Cesium3DTileset | null) => void
  /** A left-click that hit a Terra-managed entity (see lib/terra/cesiumEntityId.ts) — the
   * feature's raw id, not a bare coordinate. Intelligence markers always win over urban buildings. */
  onEntityClick?: (featureId: string) => void
  /** Camera/media cluster click — zoom into the cluster rather than inventing a merged pin. */
  onClusterClick?: (cluster: TerraClusterPick) => void
  /** A left-click on an OSM-derived urban building primitive (sovereign extrusion). */
  onUrbanBuildingClick?: (building: TerraUrbanBuilding) => void
  /** A left-click on an OSM road polyline. */
  onUrbanRoadClick?: (road: TerraUrbanRoad) => void
  /** A left-click on OSM traffic-signal infrastructure (never a live phase). */
  onUrbanSignalClick?: (signal: TerraUrbanSignal) => void
  /** A left-click on Cesium OSM Buildings 3D Tiles (ion fallback) — only known feature properties. */
  /** Double-click the globe to pause/resume cinematic rotation. Single-click inspect is delayed so a double-click does not also pick. */
  onDoubleClick?: () => void
  onOsmBuildingsFeatureClick?: (selection: TerraUrbanSelection) => void
  /** A left-click that did NOT hit a Terra entity — either a real ground coordinate or a
   * confirmed miss (clicked past the globe's edge). Never fires for entity clicks. */
  onGroundClick?: (point: TerraClickPoint) => void
  /** Pointer hover over a Terra-managed entity (composite "{layerId}:{featureId}", same id shape
   * as onEntityClick) plus the cursor's canvas-relative screen position — or nulls when the
   * pointer is over no entity. Fires on entity change immediately; position-only updates are
   * throttled (~80ms) so a resting pointer doesn't re-render the shell every frame. Powers the
   * traffic-camera hover preview (TerraCameraHoverCard). */
  onEntityHover?: (compositeId: string | null, position: { x: number; y: number } | null) => void
}

const HOVER_POSITION_THROTTLE_MS = 80

const OSM_ATTRIBUTION_URL = 'https://tile.openstreetmap.org/'

function readNumberProperty(feature: { getProperty: (name: string) => unknown }, names: string[]): number | null {
  for (const name of names) {
    const value = feature.getProperty(name)
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function readStringProperty(feature: { getProperty: (name: string) => unknown }, names: string[]): string | null {
  for (const name of names) {
    const value = feature.getProperty(name)
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function selectionFromOsmBuildingsFeature(
  picked: unknown,
  longitude: number,
  latitude: number,
): TerraUrbanSelection | null {
  if (!picked || typeof picked !== 'object' || typeof (picked as { getProperty?: unknown }).getProperty !== 'function') return null
  const feature = picked as { getProperty: (name: string) => unknown }
  const sourceHeight = readNumberProperty(feature, ['height'])
  const estimatedHeight = readNumberProperty(feature, ['cesium#estimatedHeight'])
  const height = sourceHeight ?? estimatedHeight
  const levels = readNumberProperty(feature, ['building:levels', 'levels'])
  const osmNumericId = readNumberProperty(feature, ['elementId', 'osm_id', 'id'])
  const elementType = readStringProperty(feature, ['elementType', 'osm_type'])
  return {
    osmId: osmNumericId !== null ? String(osmNumericId) : 'cesium-osm-buildings',
    osmType: elementType === 'relation' || elementType === 'way' ? elementType : 'cesium_osm_buildings',
    buildingType: readStringProperty(feature, ['building']),
    name: readStringProperty(feature, ['name', 'name:en']),
    address: null,
    houseNumber: readStringProperty(feature, ['addr:housenumber', 'housenumber']),
    streetName: readStringProperty(feature, ['addr:street', 'street']),
    entrance: readStringProperty(feature, ['entrance']),
    overtureId: readStringProperty(feature, ['overture_id', 'id']),
    gersId: readStringProperty(feature, ['gers_id', 'gersId']),
    levels,
    heightMeters: height,
    heightSource: sourceHeight !== null ? 'SOURCE' : estimatedHeight !== null ? 'INFERRED' : null,
    heightMethod: sourceHeight !== null ? 'height_tag' : estimatedHeight !== null ? 'type_default' : null,
    footprint: null,
    longitude,
    latitude,
    provider: tilesetUrlIncludesReEarth(picked) ? 'reearth_buildings' : 'cesium_osm_buildings',
  }
}

function tilesetUrlIncludesReEarth(picked: unknown): boolean {
  if (!picked || typeof picked !== 'object') return false
  const tileset = (picked as { tileset?: { resource?: { url?: string }; url?: string } }).tileset
  const url = tileset?.resource?.url ?? tileset?.url ?? ''
  return String(url).includes('buildings.reearth.land')
}

function applyOsmBuildingsSelectionProvider(selection: TerraUrbanSelection, picked: unknown): TerraUrbanSelection {
  if (!tilesetUrlIncludesReEarth(picked)) return selection
  return {
    ...selection,
    osmType: 'reearth_buildings',
    provider: 'reearth_buildings',
  }
}

export function TerraGlobe({
  onStatusChange,
  onViewerReady,
  onBuildingsTilesetReady,
  onEntityClick,
  onClusterClick,
  onUrbanBuildingClick,
  onUrbanRoadClick,
  onUrbanSignalClick,
  onOsmBuildingsFeatureClick,
  onGroundClick,
  onEntityHover,
  onDoubleClick,
}: TerraGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<TerraGlobeStatus>({ phase: 'loading' })

  // The boot effect below intentionally runs once (Cesium initialization is expensive and must
  // not re-run on every parent render) — these refs let the click handler it installs always see
  // the latest callback identity without that effect depending on them.
  const onEntityClickRef = useRef(onEntityClick)
  const onClusterClickRef = useRef(onClusterClick)
  const onUrbanBuildingClickRef = useRef(onUrbanBuildingClick)
  const onUrbanRoadClickRef = useRef(onUrbanRoadClick)
  const onUrbanSignalClickRef = useRef(onUrbanSignalClick)
  const onOsmBuildingsFeatureClickRef = useRef(onOsmBuildingsFeatureClick)
  const onGroundClickRef = useRef(onGroundClick)
  const onViewerReadyRef = useRef(onViewerReady)
  const onBuildingsTilesetReadyRef = useRef(onBuildingsTilesetReady)
  const onEntityHoverRef = useRef(onEntityHover)
  const onDoubleClickRef = useRef(onDoubleClick)
  useEffect(() => {
    onEntityClickRef.current = onEntityClick
    onClusterClickRef.current = onClusterClick
    onUrbanBuildingClickRef.current = onUrbanBuildingClick
    onUrbanRoadClickRef.current = onUrbanRoadClick
    onUrbanSignalClickRef.current = onUrbanSignalClick
    onOsmBuildingsFeatureClickRef.current = onOsmBuildingsFeatureClick
    onGroundClickRef.current = onGroundClick
    onViewerReadyRef.current = onViewerReady
    onBuildingsTilesetReadyRef.current = onBuildingsTilesetReady
    onEntityHoverRef.current = onEntityHover
    onDoubleClickRef.current = onDoubleClick
  }, [onEntityClick, onClusterClick, onUrbanBuildingClick, onUrbanRoadClick, onUrbanSignalClick, onOsmBuildingsFeatureClick, onGroundClick, onViewerReady, onBuildingsTilesetReady, onEntityHover, onDoubleClick])

  useEffect(() => {
    onStatusChange?.(status)
  }, [status, onStatusChange])

  useEffect(() => {
    let cancelled = false
    let viewerHandle: { destroy: () => void } | null = null
    let clickHandler: { destroy: () => void } | null = null
    let resizeObserver: ResizeObserver | null = null

    async function boot() {
      const container = containerRef.current
      if (!container) return

      try {
        // CesiumJS resolves its Workers/Assets/ThirdParty/Widgets from this global at import
        // time — must be set before the first `cesium` import executes. See
        // scripts/copy-cesium-assets.mjs, which populates /public/cesium/ from the installed
        // cesium package at dev/build time (standard CesiumJS deployment requirement, not
        // specific to this app).
        ;(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = '/cesium/'

        const Cesium = await loadCesium()
        if (cancelled) return

        const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN
        const hasIonToken = Boolean(ionToken && ionToken.trim())
        if (hasIonToken) {
          Cesium.Ion.defaultAccessToken = ionToken!.trim()
        }

        // Credential-free fallback remains available beneath the NASA GIBS photographic layers.
        const osmProvider = new Cesium.OpenStreetMapImageryProvider({ url: OSM_ATTRIBUTION_URL })

        // A configured public token enables the real Cesium World Terrain service. The token is
        // read only from Next's public environment at build time and is never hardcoded here.
        // Asset 403/entitlement failures must not abort Viewer construction — same honest
        // degradation already applied to OSM Buildings below.
        let terrainProvider: Awaited<ReturnType<typeof Cesium.createWorldTerrainAsync>> | undefined
        if (hasIonToken) {
          try {
            terrainProvider = await Cesium.createWorldTerrainAsync()
          } catch {
            terrainProvider = undefined
          }
        }
        if (cancelled) return

        const viewer = new Cesium.Viewer(container, {
          baseLayer: new Cesium.ImageryLayer(osmProvider),
          ...(terrainProvider ? { terrainProvider } : {}),
          // War Room builds its own instrumentation chrome around this surface (see
          // TerraShell.tsx) rather than Cesium's default widget set — matches the "high-density
          // but readable controls" direction, not Cesium's stock UI.
          timeline: false,
          animation: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          vrButton: false,
          selectionIndicator: false,
          infoBox: false,
          shouldAnimate: true,
        })
        viewerHandle = viewer

        // Required OSM/NASA text attribution stays visible (ODbL) — restyled via #terra-globe-root
        // in globals.css. The default Cesium ion mark is a dark-blue circular logo composited on
        // the globe canvas; that is an artifact, not a Terra marker, so it is removed here. Polar
        // imagery gaps otherwise reveal Globe.baseColor, whose Cesium default is Color(0,0,0.5) —
        // a dark-blue disc sitting on the north pole. Match space instead of advertising blue.
        try {
          const ionLogo = Cesium.CreditDisplay.cesiumCredit
          if (ionLogo) viewer.creditDisplay.removeStaticCredit(ionLogo)
        } catch {
          /* CSS also hides .cesium-credit-logoContainer */
        }
        // Polar imagery holes (GIBS/OSM do not cover the poles) reveal Globe.baseColor.
        // Cesium's default Color(0,0,0.5) and even a navy "#020810" read as a dark-blue
        // disc on the north pole. True black matches the surrounding space.
        viewer.scene.globe.baseColor = Cesium.Color.BLACK
        viewer.scene.globe.undergroundColor = Cesium.Color.BLACK
        viewer.scene.backgroundColor = Cesium.Color.BLACK

        // Phase 6: real sun-relative lighting, computed by Cesium purely from viewer.clock's
        // current time — no separate astronomy/rotation logic exists anywhere in Terra. This is
        // the entire "real day/night terminator" implementation; components/war-room/terra/
        // useTerraClock.ts only ever sets viewer.clock.currentTime, never touches lighting
        // directly.
        viewer.scene.globe.enableLighting = true
        if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true
        if (viewer.scene.skyBox) viewer.scene.skyBox.show = true
        if (viewer.scene.sun) viewer.scene.sun.show = true
        if (viewer.scene.moon) viewer.scene.moon.show = true
        viewer.scene.highDynamicRange = true
        viewer.scene.fog.enabled = true
        // Translucent urban extrusions otherwise lose LEFT_CLICK to the globe (no depth write).
        viewer.scene.pickTranslucentDepth = true
        viewer.targetFrameRate = 60

        viewer.camera.flyHome(0)
        viewer.resize()

        if (cancelled) {
          viewer.destroy()
          return
        }

        // Real, detected fact — not assumed from hasIonToken alone — so a terrainProvider added or
        // changed for any reason is picked up automatically without touching this handler.
        const hasRealTerrain = !(viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider)

        // Cesium OSM Buildings are Commander opt-in (TerraCesiumOsmBuildings). Never autoload
        // the brown 3D masses onto the default imagery-first globe.

        try {
          viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
        } catch {
          /* Viewer may not expose the default handler in every Cesium build. */
        }

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
        let pendingInspect: ReturnType<typeof setTimeout> | null = null
        const inspectFromClick = (click: { position: import('cesium').Cartesian2 }) => {
          if (cancelled || viewer.isDestroyed() || isTerraWorkspacePanelDragging()) return
          const pickedList = viewer.scene.drillPick(click.position, 12)
          const picked = pickedList[0]

          for (const candidate of pickedList) {
            if (Cesium.defined(candidate) && candidate.id instanceof Cesium.Entity) {
              const featureId = featureIdFromTerraEntityId(candidate.id.id)
              if (featureId) {
                onEntityClickRef.current?.(featureId)
                return
              }
            }
            if (Cesium.defined(candidate) && isTerraClusterPick(candidate.id)) {
              onClusterClickRef.current?.(candidate.id)
              return
            }
          }

          for (const candidate of pickedList) {
            if (!Cesium.defined(candidate)) continue
            const building = resolveTerraUrbanBuildingFromPick(candidate.id)
            if (building) {
              onUrbanBuildingClickRef.current?.(building)
              return
            }
            const signal = resolveTerraUrbanSignalFromPick(candidate.id)
            if (signal) {
              onUrbanSignalClickRef.current?.(signal)
              return
            }
            const road = resolveTerraUrbanRoadFromPick(candidate.id)
            if (road) {
              onUrbanRoadClickRef.current?.(road)
              return
            }
          }

          const cartesian = hasRealTerrain
            ? (viewer.scene.pickPosition(click.position) ?? viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid))
            : viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid)

          if (Cesium.defined(picked) && typeof picked.getProperty === 'function' && cartesian) {
            const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
            const selection = selectionFromOsmBuildingsFeature(
              picked,
              Cesium.Math.toDegrees(cartographic.longitude),
              Cesium.Math.toDegrees(cartographic.latitude),
            )
            if (selection) {
              onOsmBuildingsFeatureClickRef.current?.(applyOsmBuildingsSelectionProvider(selection, picked))
              return
            }
          }

          if (!cartesian) {
            onGroundClickRef.current?.({ ok: false }) // click missed the globe entirely (e.g. clicked past the limb into space)
            return
          }
          const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
          const lon = Cesium.Math.toDegrees(cartographic.longitude)
          const lat = Cesium.Math.toDegrees(cartographic.latitude)
          const urbanBuilding = findUrbanBuildingAt(lon, lat)
          if (urbanBuilding) {
            onUrbanBuildingClickRef.current?.(urbanBuilding)
            return
          }
          const urbanSignal = findUrbanSignalAt(lon, lat)
          if (urbanSignal) {
            onUrbanSignalClickRef.current?.(urbanSignal)
            return
          }
          const urbanRoad = findUrbanRoadAt(lon, lat)
          if (urbanRoad) {
            onUrbanRoadClickRef.current?.(urbanRoad)
            return
          }
          onGroundClickRef.current?.({
            ok: true,
            longitude: lon,
            latitude: lat,
            height: hasRealTerrain ? cartographic.height : null,
            hasTerrainHeight: hasRealTerrain,
          })
        }
        handler.setInputAction((click: { position: import('cesium').Cartesian2 }) => {
          if (pendingInspect !== null) {
            clearTimeout(pendingInspect)
            pendingInspect = null
            return
          }
          pendingInspect = setTimeout(() => {
            pendingInspect = null
            inspectFromClick(click)
          }, 240)
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
        handler.setInputAction(() => {
          if (pendingInspect !== null) {
            clearTimeout(pendingInspect)
            pendingInspect = null
          }
          onDoubleClickRef.current?.()
        }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

        // Hover pick (Phase 3 camera preview): entity changes fire immediately; same-entity
        // position updates are throttled so a moving pointer doesn't re-render the shell per frame.
        let lastHoverId: string | null = null
        let lastHoverFireAt = 0
        handler.setInputAction((movement: { endPosition: import('cesium').Cartesian2 }) => {
          if (!onEntityHoverRef.current) return
          const picked = viewer.scene.pick(movement.endPosition)
          let hoverId: string | null = null
          if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
            hoverId = featureIdFromTerraEntityId(picked.id.id)
          }
          const now = Date.now()
          if (hoverId !== lastHoverId) {
            lastHoverId = hoverId
            lastHoverFireAt = now
          } else if (now - lastHoverFireAt < HOVER_POSITION_THROTTLE_MS) {
            return
          } else {
            lastHoverFireAt = now
          }
          onEntityHoverRef.current(hoverId, { x: movement.endPosition.x, y: movement.endPosition.y })
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
        clickHandler = handler

        resizeObserver = new ResizeObserver(() => {
          if (!viewer.isDestroyed()) viewer.resize()
        })
        resizeObserver.observe(container)

        onViewerReadyRef.current?.(viewer)
        onBuildingsTilesetReadyRef.current?.(null)

        setStatus({
          phase: 'ready',
          imageryTier: 'nasa_gibs_with_osm_fallback',
          hasIonToken,
          hasOsmBuildings: hasIonToken,
          hasRealTerrain,
        })
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ phase: 'error', message })
      }
    }

    void boot()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      clickHandler?.destroy()
      viewerHandle?.destroy()
    }
  }, [])

  return (
    <div
      id="terra-globe-root"
      ref={containerRef}
      className="absolute inset-0 z-0 h-full w-full bg-black"
      role="application"
      aria-label="Terra planetary globe"
    />
  )
}
