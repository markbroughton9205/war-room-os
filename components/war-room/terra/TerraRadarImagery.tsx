'use client'

import { useEffect, useRef } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import { DEFAULT_RADAR_OPACITY, RADAR_MAX_TILE_LEVEL } from '@/lib/terra/weather'

export function TerraRadarImagery({
  viewer,
  enabled,
  urlTemplate,
  opacity = DEFAULT_RADAR_OPACITY,
}: {
  viewer: CesiumViewer | null
  enabled: boolean
  urlTemplate: string | null
  opacity?: number
}) {
  const layerRef = useRef<import('cesium').ImageryLayer | null>(null)

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const targetViewer = viewer
    let cancelled = false
    let removeAdded: (() => void) | null = null

    void loadCesium().then(Cesium => {
      if (cancelled || targetViewer.isDestroyed()) return
      const raise = () => {
        const layer = layerRef.current
        if (!layer || targetViewer.isDestroyed()) return
        const layers = targetViewer.imageryLayers
        if (layers.contains(layer) && layers.indexOf(layer) < layers.length - 1) {
          layers.raiseToTop(layer)
        }
      }
      const listener = () => raise()
      targetViewer.imageryLayers.layerAdded.addEventListener(listener)
      removeAdded = () => {
        if (!targetViewer.isDestroyed()) {
          targetViewer.imageryLayers.layerAdded.removeEventListener(listener)
        }
      }

      if (!enabled || !urlTemplate) {
        if (layerRef.current && !targetViewer.isDestroyed()) {
          targetViewer.imageryLayers.remove(layerRef.current, true)
          layerRef.current = null
        }
        return
      }

      const provider = new Cesium.UrlTemplateImageryProvider({
        url: urlTemplate,
        maximumLevel: RADAR_MAX_TILE_LEVEL,
        tileWidth: 256,
        tileHeight: 256,
        credit: new Cesium.Credit('IEM / Iowa State University · NOAA/NWS NEXRAD'),
      })
      if (layerRef.current && !targetViewer.isDestroyed()) {
        targetViewer.imageryLayers.remove(layerRef.current, true)
        layerRef.current = null
      }
      const layer = targetViewer.imageryLayers.addImageryProvider(provider)
      layer.alpha = opacity
      layerRef.current = layer
      raise()
    })

    return () => {
      cancelled = true
      removeAdded?.()
      if (!targetViewer.isDestroyed() && layerRef.current) {
        targetViewer.imageryLayers.remove(layerRef.current, true)
        layerRef.current = null
      }
    }
  }, [viewer, enabled, urlTemplate, opacity])

  return null
}
