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
import { featureIdFromTerraEntityId } from '@/lib/terra/cesiumEntityId'
import type { TerraClickPoint } from '@/lib/terra/types'

export type TerraImageryTier = 'nasa_gibs_with_osm_fallback'

export type TerraGlobeStatus =
  | { phase: 'loading' }
  | { phase: 'ready'; imageryTier: TerraImageryTier; hasIonToken: boolean; hasOsmBuildings: boolean }
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
   * feature's raw id, not a bare coordinate. */
  onEntityClick?: (featureId: string) => void
  /** A left-click that did NOT hit a Terra entity — either a real ground coordinate or a
   * confirmed miss (clicked past the globe's edge). Never fires for entity clicks. */
  onGroundClick?: (point: TerraClickPoint) => void
}

const OSM_ATTRIBUTION_URL = 'https://tile.openstreetmap.org/'

export function TerraGlobe({ onStatusChange, onViewerReady, onBuildingsTilesetReady, onEntityClick, onGroundClick }: TerraGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<TerraGlobeStatus>({ phase: 'loading' })

  // The boot effect below intentionally runs once (Cesium initialization is expensive and must
  // not re-run on every parent render) — these refs let the click handler it installs always see
  // the latest callback identity without that effect depending on them.
  const onEntityClickRef = useRef(onEntityClick)
  const onGroundClickRef = useRef(onGroundClick)
  const onViewerReadyRef = useRef(onViewerReady)
  const onBuildingsTilesetReadyRef = useRef(onBuildingsTilesetReady)
  useEffect(() => {
    onEntityClickRef.current = onEntityClick
    onGroundClickRef.current = onGroundClick
    onViewerReadyRef.current = onViewerReady
    onBuildingsTilesetReadyRef.current = onBuildingsTilesetReady
  }, [onEntityClick, onGroundClick, onViewerReady, onBuildingsTilesetReady])

  useEffect(() => {
    onStatusChange?.(status)
  }, [status, onStatusChange])

  useEffect(() => {
    let cancelled = false
    let viewerHandle: { destroy: () => void } | null = null
    let clickHandler: { destroy: () => void } | null = null

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

        const Cesium = await import('cesium')
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
        const terrainProvider = hasIonToken ? await Cesium.createWorldTerrainAsync() : undefined
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

        // Required attribution stays visible (ODbL) — styled to match Terra's instrumentation
        // aesthetic in globals via #terra-globe-root, never hidden.
        // Phase 6: real sun-relative lighting, computed by Cesium purely from viewer.clock's
        // current time — no separate astronomy/rotation logic exists anywhere in Terra. This is
        // the entire "real day/night terminator" implementation; components/war-room/terra/
        // useTerraClock.ts only ever sets viewer.clock.currentTime, never touches lighting
        // directly.
        viewer.scene.globe.enableLighting = true
        if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true
        viewer.scene.fog.enabled = true
        viewer.targetFrameRate = 60

        viewer.camera.flyHome(0)

        if (cancelled) {
          viewer.destroy()
          return
        }

        // Real, detected fact — not assumed from hasIonToken alone — so a terrainProvider added or
        // changed for any reason is picked up automatically without touching this handler.
        const hasRealTerrain = !(viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider)

        // God's Eye multi-scale phase: Cesium OSM Buildings (real ODbL-licensed OSM building
        // footprints extruded to real reported heights, hosted as Cesium ion's global asset) —
        // only requested when a real ion token is configured, matching the same honest-degradation
        // rule as Cesium World Terrain above. A configured token doesn't guarantee asset access
        // (account/entitlement issues are real and independent of network health), so this is its
        // own try/catch: a failure here degrades only "3D Buildings unavailable," never the whole
        // globe. Starts hidden — TerraShell shows it only once the camera is at local/building
        // scale (see useTerraCameraScale.ts), so no building tiles are requested at global/
        // regional altitude before that gating effect runs.
        let osmBuildingsTileset: import('cesium').Cesium3DTileset | null = null
        if (hasIonToken) {
          try {
            const tileset = await Cesium.createOsmBuildingsAsync()
            if (cancelled) {
              tileset.destroy()
            } else {
              tileset.show = false
              viewer.scene.primitives.add(tileset)
              osmBuildingsTileset = tileset
            }
          } catch {
            osmBuildingsTileset = null
          }
        }
        if (cancelled) {
          viewer.destroy()
          return
        }

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
        handler.setInputAction((click: { position: import('cesium').Cartesian2 }) => {
          const picked = viewer.scene.pick(click.position)
          if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
            const featureId = featureIdFromTerraEntityId(picked.id.id)
            if (featureId) {
              onEntityClickRef.current?.(featureId)
              return
            }
          }

          const cartesian = hasRealTerrain
            ? (viewer.scene.pickPosition(click.position) ?? viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid))
            : viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid)

          if (!cartesian) {
            onGroundClickRef.current?.({ ok: false }) // click missed the globe entirely (e.g. clicked past the limb into space)
            return
          }
          const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
          onGroundClickRef.current?.({
            ok: true,
            longitude: Cesium.Math.toDegrees(cartographic.longitude),
            latitude: Cesium.Math.toDegrees(cartographic.latitude),
            height: hasRealTerrain ? cartographic.height : null,
            hasTerrainHeight: hasRealTerrain,
          })
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
        clickHandler = handler

        onViewerReadyRef.current?.(viewer)
        onBuildingsTilesetReadyRef.current?.(osmBuildingsTileset)

        setStatus({
          phase: 'ready',
          imageryTier: 'nasa_gibs_with_osm_fallback',
          hasIonToken,
          hasOsmBuildings: osmBuildingsTileset !== null,
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
      clickHandler?.destroy()
      viewerHandle?.destroy()
    }
  }, [])

  return (
    <div
      id="terra-globe-root"
      ref={containerRef}
      className="absolute inset-0 h-full w-full bg-black"
      role="application"
      aria-label="Terra planetary globe"
    />
  )
}
