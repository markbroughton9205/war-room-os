'use client'

import { useEffect, useRef } from 'react'
import type { CustomDataSource, Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import { selectAuroraVisuals, type EarthPulseAuroraCell } from '@/lib/terra/earthPulse'
import {
  AURORA_CLOSE_CAP,
  AURORA_GLOBE_CAP,
  AURORA_OVAL_ABS_LAT,
  AURORA_PRESENTATION_COLOR,
  AURORA_PRESENTATION_MIN,
} from '@/lib/terra/layerGovernor'

export function TerraAuroraLayer({
  viewer,
  cells,
  enabled,
  globalLod,
  opacity = 0.22,
}: {
  viewer: CesiumViewer | null
  cells: EarthPulseAuroraCell[]
  enabled: boolean
  globalLod: boolean
  opacity?: number
}) {
  const dataSourceRef = useRef<CustomDataSource | null>(null)

  useEffect(() => {
    if (!viewer) return
    let cancelled = false
    let created: CustomDataSource | null = null
    void loadCesium().then(Cesium => {
      if (cancelled || viewer.isDestroyed()) return
      created = new Cesium.CustomDataSource('terra-earth-pulse-aurora')
      viewer.dataSources.add(created)
      dataSourceRef.current = created
    })
    return () => {
      cancelled = true
      if (created && !viewer.isDestroyed()) viewer.dataSources.remove(created, true)
      if (dataSourceRef.current === created) dataSourceRef.current = null
    }
  }, [viewer])

  useEffect(() => {
    const dataSource = dataSourceRef.current
    if (!dataSource) return
    let cancelled = false
    void loadCesium().then(Cesium => {
      if (cancelled) return
      dataSource.entities.removeAll()
      if (!enabled || opacity <= 0) return
      const visible = selectAuroraVisuals({
        cells,
        globalLod,
        min: AURORA_PRESENTATION_MIN,
        ovalAbsLat: AURORA_OVAL_ABS_LAT,
        cap: globalLod ? AURORA_GLOBE_CAP : AURORA_CLOSE_CAP,
      })
      const color = Cesium.Color.fromCssColorString(AURORA_PRESENTATION_COLOR)
      for (const cell of visible) {
        const cellAlpha = Math.min(opacity, 0.06 + (cell.aurora / 100) * opacity)
        dataSource.entities.add({
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(cell.longitude - 0.5, cell.latitude - 0.5, cell.longitude + 0.5, cell.latitude + 0.5),
            material: color.withAlpha(cellAlpha),
            height: 0,
          },
        })
      }
    })
    return () => { cancelled = true }
  }, [cells, enabled, globalLod, opacity])

  return null
}
