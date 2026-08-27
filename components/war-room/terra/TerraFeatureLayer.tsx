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
import { terraEntityId } from '@/lib/terra/cesiumEntityId'
import type { TerraGeoFeature, TerraIntelligenceEventKind } from '@/lib/terra/types'
import { terraAircraftBillboardRotationRadians } from '@/lib/terra/aircraftOrientation'
import type { TerraAircraftTrailPoint } from '@/lib/terra/aircraftTrail'

type Props = {
  layerId: string
  viewer: CesiumViewer | null
  enabled: boolean
  features: TerraGeoFeature[]
  selectedId: string | null
  /** God's Eye multi-scale phase: enables Cesium's own built-in entity clustering
   * (DataSource.clustering) — real, standard Cesium API, not a hand-rolled clustering
   * implementation. Off by default (every existing hazard layer keeps rendering one marker per
   * feature, unclustered) — a merged blob is wrong for "how many distinct earthquakes are here,"
   * but right for "roughly how many landmarks are in this area" at broad zoom. */
  cluster?: boolean
  /** Live-aviation phase: bounded session-only trails, keyed by icao24
   * (components/war-room/terra/useTerraAircraftTrails.ts) — only ever read for `kind ===
   * 'aircraft_state'` features; every other layer passes nothing and renders exactly as before. */
  trails?: Record<string, TerraAircraftTrailPoint[]>
}

// A minimal upward-pointing glyph (drawn in white so Cesium's billboard `color` tint reproduces
// resolveStyle's exact aircraft color) — authored pointing north at rotation 0, matching
// terraAircraftBillboardRotationRadians' documented convention. Base64-encoded inline (not a
// public/ asset file, and deliberately not a plain URL-encoded `data:` URI — confirmed live during
// browser verification that Cesium's own billboard image loader silently fails to resolve a
// `data:image/svg+xml;charset=utf-8,<url-encoded>` URI, even though a plain `<img>` tag loads it
// fine, whereas the base64 form loads correctly in both).
const AIRCRAFT_GLYPH_DATA_URI = `data:image/svg+xml;base64,${btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M14 1 L20 19 L14 15 L8 19 Z" fill="white"/></svg>',
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
    default:
      return { color: '#38BDF8', pixelSize: MIN_PIXEL_SIZE }
  }
}

const CLUSTER_PIXEL_RANGE = 60
const CLUSTER_MINIMUM_SIZE = 3

export function TerraFeatureLayer({ layerId, viewer, enabled, features, selectedId, cluster = false, trails }: Props) {
  const dataSourceRef = useRef<CustomDataSource | null>(null)

  // Owns the DataSource's lifecycle against this specific viewer instance only. Recreated per
  // layerId so each layer's entities live in their own named DataSource (matters for future
  // per-layer Cesium operations like independent clustering, never shared/merged across layers).
  useEffect(() => {
    if (!viewer) return
    let cancelled = false
    let created: CustomDataSource | null = null

    async function attach() {
      const Cesium = await import('cesium')
      // The dynamic import is the async gap where a sibling TerraGlobe remount (observed under
      // React StrictMode's dev-only double-invoke, and possible on any fast-refresh reload) can
      // destroy this exact `viewer` before this closure resumes — `cancelled` alone only tracks
      // this effect's own unmount, not a viewer torn down out from under it.
      if (cancelled || viewer!.isDestroyed()) return
      created = new Cesium.CustomDataSource(`terra-layer-${layerId}`)
      if (cluster) {
        created.clustering.enabled = true
        created.clustering.pixelRange = CLUSTER_PIXEL_RANGE
        created.clustering.minimumClusterSize = CLUSTER_MINIMUM_SIZE
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
  }, [viewer, layerId, cluster])

  // Redraws entities whenever the feature list, selection, or visibility changes. Cheap at this
  // phase's scale (tens of points, capped at 100 by the adapter) — full removeAll()+rebuild, not
  // an incremental diff, is the right amount of complexity for layers of this size.
  useEffect(() => {
    const dataSource = dataSourceRef.current
    if (!dataSource) return
    let cancelled = false

    async function render() {
      const Cesium = await import('cesium')
      if (cancelled) return
      dataSource!.entities.removeAll()
      if (!enabled) return

      for (const feature of features) {
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
          continue
        }

        // Live-aviation phase: an aircraft with a real reported heading gets a directional glyph
        // instead of a plain dot — orientation only reflects a heading the source actually
        // supplied (mission requirement: never fabricate one). An aircraft with no heading (e.g.
        // some on-ground reports) falls through to the same plain point every other kind uses.
        const headingDeg = feature.kind === 'aircraft_state' && typeof feature.properties.headingDeg === 'number' ? feature.properties.headingDeg : null
        if (headingDeg !== null) {
          dataSource!.entities.add({
            id: entityId,
            position: Cesium.Cartesian3.fromDegrees(feature.longitude, feature.latitude, feature.altitude ?? 0),
            billboard: {
              image: AIRCRAFT_GLYPH_DATA_URI,
              color: Cesium.Color.fromCssColorString(isSelected ? '#FFFFFF' : color),
              scale: isSelected ? 1.35 : 1,
              rotation: terraAircraftBillboardRotationRadians(headingDeg),
              alignedAxis: Cesium.Cartesian3.ZERO, // screen-space rotation, not geographic — see aircraftOrientation.ts
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          })
          continue
        }

        dataSource!.entities.add({
          id: entityId,
          position: Cesium.Cartesian3.fromDegrees(feature.longitude, feature.latitude),
          point: {
            pixelSize: pixelSize + (isSelected ? SELECTED_OUTLINE_BOOST : 0),
            color: Cesium.Color.fromCssColorString(color).withAlpha(0.85),
            outlineColor: isSelected ? Cesium.Color.WHITE : Cesium.Color.fromCssColorString('#0B1A22').withAlpha(0.8),
            outlineWidth: isSelected ? 3 : 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY, // stays visible through the globe at any zoom, matching the "don't let markers vanish behind the horizon" need for a sparse global layer
          },
        })
      }

      // Live-aviation phase: a short session-only trail per aircraft (never a fabricated or
      // provider-historical track — see lib/terra/aircraftTrail.ts) rendered as a thin polyline
      // through its own real recent observed positions only.
      if (trails) {
        for (const [icao24, points] of Object.entries(trails)) {
          if (points.length < 2) continue
          const flatDegrees = points.flatMap(point => [point.longitude, point.latitude])
          dataSource!.entities.add({
            id: terraEntityId(`${layerId}:trail:${icao24}`),
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
    }
  }, [features, selectedId, enabled, layerId, trails])

  return null
}
