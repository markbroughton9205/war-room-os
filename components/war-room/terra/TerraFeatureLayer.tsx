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

type Props = {
  layerId: string
  viewer: CesiumViewer | null
  enabled: boolean
  features: TerraGeoFeature[]
  selectedId: string | null
}

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
    default:
      return { color: '#38BDF8', pixelSize: MIN_PIXEL_SIZE }
  }
}

export function TerraFeatureLayer({ layerId, viewer, enabled, features, selectedId }: Props) {
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
      if (cancelled) return
      created = new Cesium.CustomDataSource(`terra-layer-${layerId}`)
      viewer!.dataSources.add(created)
      dataSourceRef.current = created
    }
    void attach()

    return () => {
      cancelled = true
      if (created) {
        viewer.dataSources.remove(created, true)
        if (dataSourceRef.current === created) dataSourceRef.current = null
      }
    }
  }, [viewer, layerId])

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
    }
    void render()

    return () => {
      cancelled = true
    }
  }, [features, selectedId, enabled, layerId])

  return null
}
