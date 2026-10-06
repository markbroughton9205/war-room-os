'use client'

import { useEffect, useRef, useState } from 'react'
import type { CustomDataSource, Entity, Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import type { TerraGeoFeature } from '@/lib/terra/types'
import { isFreshEarthquakePulse, prefersTerraReducedMotion } from '@/lib/terra/earthPulse'
import { terraEntityId } from '@/lib/terra/cesiumEntityId'

const PULSE_MS = 4200

export function TerraEarthquakePulseLayer({
  viewer,
  features,
  terraTime,
  enabled,
  minMagnitude = 0,
}: {
  viewer: CesiumViewer | null
  features: TerraGeoFeature[]
  terraTime: string
  enabled: boolean
  minMagnitude?: number
}) {
  const dataSourceRef = useRef<CustomDataSource | null>(null)
  const pulsedRef = useRef(new Set<string>())
  const terraTimeRef = useRef(terraTime)
  const timersRef = useRef<number[]>([])
  const [sourceEpoch, setSourceEpoch] = useState(0)

  useEffect(() => {
    terraTimeRef.current = terraTime
  }, [terraTime])

  useEffect(() => {
    if (!viewer) return
    const targetViewer = viewer
    let cancelled = false
    let created: CustomDataSource | null = null
    void loadCesium().then(Cesium => {
      if (cancelled || targetViewer.isDestroyed()) return
      created = new Cesium.CustomDataSource('terra-earth-pulse-quakes')
      targetViewer.dataSources.add(created)
      dataSourceRef.current = created
      setSourceEpoch(value => value + 1)
    })
    return () => {
      cancelled = true
      for (const timer of timersRef.current) window.clearTimeout(timer)
      timersRef.current = []
      if (created && !targetViewer.isDestroyed()) targetViewer.dataSources.remove(created, true)
      if (dataSourceRef.current === created) dataSourceRef.current = null
    }
  }, [viewer])

  useEffect(() => {
    const dataSource = dataSourceRef.current
    if (!dataSource) return
    let cancelled = false
    if (!enabled) {
      dataSource.entities.removeAll()
      return
    }

    void loadCesium().then(Cesium => {
      if (cancelled) return
      if (prefersTerraReducedMotion()) return
      const liveIds = new Set(features.filter(feature => feature.kind === 'earthquake').map(feature => feature.id))
      for (const id of pulsedRef.current) {
        if (!liveIds.has(id)) pulsedRef.current.delete(id)
      }
      const now = Date.now()
      for (const feature of features) {
        if (feature.kind !== 'earthquake' || !feature.timestamp) continue
        const mag = typeof feature.properties.mag === 'number' ? feature.properties.mag : 4.5
        if (mag < minMagnitude) continue
        if (!isFreshEarthquakePulse(feature.timestamp, terraTimeRef.current)) continue
        if (pulsedRef.current.has(feature.id)) continue
        pulsedRef.current.add(feature.id)
        const maxMeters = 40_000 + mag * 28_000
        const depthKm = feature.altitude !== null ? Math.abs(feature.altitude) / 1000 : null
        const color = depthKm !== null && depthKm > 70
          ? Cesium.Color.fromCssColorString('#A5F3FC')
          : Cesium.Color.fromCssColorString('#38BDF8')
        const started = now
        const entityId = terraEntityId(`usgs_earthquake_feed:${feature.id}:pulse`)
        const entity: Entity = dataSource.entities.add({
          id: entityId,
          position: Cesium.Cartesian3.fromDegrees(feature.longitude, feature.latitude),
          ellipse: {
            semiMajorAxis: new Cesium.CallbackProperty(() => {
              const t = Math.min(1, (Date.now() - started) / PULSE_MS)
              return 8_000 + t * maxMeters
            }, false),
            semiMinorAxis: new Cesium.CallbackProperty(() => {
              const t = Math.min(1, (Date.now() - started) / PULSE_MS)
              return 8_000 + t * maxMeters
            }, false),
            material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => {
              const t = Math.min(1, (Date.now() - started) / PULSE_MS)
              return color.withAlpha(0.35 * (1 - t))
            }, false)),
            height: 0,
            outline: false,
          },
        })
        const timer = window.setTimeout(() => {
          timersRef.current = timersRef.current.filter(id => id !== timer)
          if (!cancelled && dataSource.entities.contains(entity)) dataSource.entities.remove(entity)
        }, PULSE_MS + 50)
        timersRef.current.push(timer)
      }
    })
    return () => { cancelled = true }
  }, [features, enabled, sourceEpoch, minMagnitude])

  return null
}
