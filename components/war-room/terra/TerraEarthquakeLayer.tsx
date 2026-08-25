'use client'

/**
 * Renders TerraGeoFeature[] (already normalized by lib/terra/normalizeUsgsEarthquakeFeed.ts) as
 * Cesium point entities. This component knows nothing about USGS, HTTP, or the Research Engine —
 * it only turns already-normalized, already-provenance-carrying features into a Cesium
 * DataSource. Renders nothing itself (headless); the globe is the only visible surface.
 *
 * Marker size scales — mildly, capped — with the reported magnitude. Color is uniform (this
 * app's Observed Data cyan) rather than a red/yellow/green "severity" gradient: USGS magnitude is
 * a measurement, not a War Room risk assessment, and a danger-coded color scale would imply an
 * interpretation this layer does not make.
 */
import { useEffect, useRef } from 'react'
import type { CustomDataSource, Viewer as CesiumViewer } from 'cesium'
import { terraEntityId } from '@/lib/terra/cesiumEntityId'
import type { TerraGeoFeature } from '@/lib/terra/types'

type Props = {
  viewer: CesiumViewer | null
  enabled: boolean
  features: TerraGeoFeature[]
  selectedId: string | null
}

const MIN_PIXEL_SIZE = 7
const MAX_PIXEL_SIZE = 22
const SELECTED_OUTLINE_BOOST = 3

function magnitudeToPixelSize(magnitude: number | null): number {
  if (magnitude === null) return MIN_PIXEL_SIZE
  const scaled = MIN_PIXEL_SIZE + Math.max(0, magnitude) * 2.2
  return Math.min(MAX_PIXEL_SIZE, scaled)
}

export function TerraEarthquakeLayer({ viewer, enabled, features, selectedId }: Props) {
  const dataSourceRef = useRef<CustomDataSource | null>(null)

  // Owns the DataSource's lifecycle against this specific viewer instance only.
  useEffect(() => {
    if (!viewer) return
    let cancelled = false
    let created: CustomDataSource | null = null

    async function attach() {
      const Cesium = await import('cesium')
      if (cancelled) return
      created = new Cesium.CustomDataSource('terra-earthquakes')
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
  }, [viewer])

  // Redraws entities whenever the feature list, selection, or visibility changes. Cheap at this
  // phase's scale (tens of points, capped at 100 by the adapter) — full removeAll()+rebuild, not
  // an incremental diff, is the right amount of complexity for one layer of this size.
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
        const magnitude = typeof feature.properties.mag === 'number' ? feature.properties.mag : null
        const isSelected = feature.id === selectedId
        const pixelSize = magnitudeToPixelSize(magnitude) + (isSelected ? SELECTED_OUTLINE_BOOST : 0)

        dataSource!.entities.add({
          id: terraEntityId(feature.id),
          position: Cesium.Cartesian3.fromDegrees(feature.longitude, feature.latitude),
          point: {
            pixelSize,
            color: Cesium.Color.fromCssColorString('#38BDF8').withAlpha(0.85), // Observed Data cyan
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
  }, [features, selectedId, enabled])

  return null
}
