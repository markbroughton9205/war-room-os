'use client'

/**
 * Terra's generic Cesium feature renderer (Phase 3) — replaces the Phase 1/2
 * TerraEarthquakeLayer.tsx, which was hardwired to one kind. Renders any TerraGeoFeature[] as
 * Cesium point entities; the only kind-specific logic is `resolveStyle`, a small pure function
 * mapping a feature's `kind` to a size/color — never a separate Cesium component per provider.
 * Renders nothing itself (headless); the globe is the only visible surface.
 *
 * Every style stays restrained and non-sensational: no red/yellow/green severity gradient, since
 * none of these observed-data sources supply a War Room risk assessment for this layer to imply.
 * Color varies only enough to let a Commander visually tell layers apart on the globe at once.
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

// Observed Data cyan (this app's four-layer provenance model) for the hazards domain's two
// kinds, kept as two distinguishable shades rather than one identical color, plus a neutral slate
// for the one non-hazards kind wired this phase (aircraft). None of these encode severity —
// magnitude scaling (earthquake only) is the sole data-driven visual variation.
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

        dataSource!.entities.add({
          // Composite "{layerId}:{featureId}" — not just featureId — so a click resolves back to
          // the correct layer even when two layers share a raw provider record id (e.g. the same
          // real earthquake appearing in both usgs_earthquake_feed and a usgs_earthquake catalog
          // search covering the same window). Parsed back apart in TerraShell's handleEntityClick.
          id: terraEntityId(`${layerId}:${feature.id}`),
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
