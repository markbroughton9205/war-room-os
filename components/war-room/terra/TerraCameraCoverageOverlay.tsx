'use client'

import { useEffect, useRef } from 'react'
import type { CustomDataSource, Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import { terraEntityId } from '@/lib/terra/cesiumEntityId'
import type { CameraProviderAdapterContract } from '@/lib/terra/godsEye/cameraFederation'

export function TerraCameraCoverageOverlay({
  viewer,
  enabled,
  providers,
}: {
  viewer: CesiumViewer | null
  enabled: boolean
  providers: readonly CameraProviderAdapterContract[]
}) {
  const dataSourceRef = useRef<CustomDataSource | null>(null)

  useEffect(() => {
    if (!viewer) return
    let cancelled = false
    let created: CustomDataSource | null = null

    async function attach() {
      const Cesium = await loadCesium()
      if (cancelled || viewer!.isDestroyed()) return
      created = new Cesium.CustomDataSource('terra-camera-coverage')
      viewer!.dataSources.add(created)
      dataSourceRef.current = created
    }
    void attach()

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

    async function render() {
      const Cesium = await loadCesium()
      if (cancelled) return
      dataSource!.entities.removeAll()
      if (!enabled) return
      for (const provider of providers) {
        if (provider.coverage === 'GLOBAL') continue
        const { west, south, east, north } = provider.coverage
        const color = provider.authState === 'PROVIDER_AUTH_REQUIRED' ? '#FBBF24' : '#22D3EE'
        dataSource!.entities.add({
          id: terraEntityId(`camera-coverage:${provider.id}`),
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(west, south, east, north),
            material: Cesium.Color.fromCssColorString(color).withAlpha(0.12),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString(color).withAlpha(0.75),
            height: 0,
          },
        })
        dataSource!.entities.add({
          id: terraEntityId(`camera-coverage-label:${provider.id}`),
          position: Cesium.Cartesian3.fromDegrees((west + east) / 2, (south + north) / 2),
          label: {
            text: `${provider.displayName}\n${provider.catalogLabel}`,
            font: '11px monospace',
            fillColor: Cesium.Color.fromCssColorString('#ECFEFF'),
            outlineColor: Cesium.Color.fromCssColorString('#0B1A22'),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.72),
            pixelOffset: new Cesium.Cartesian2(0, -8),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
      }
    }
    void render()
    return () => {
      cancelled = true
    }
  }, [enabled, providers])

  return null
}
