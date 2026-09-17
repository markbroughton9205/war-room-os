'use client'

/**
 * Additive Re:Earth Buildings 3D Tiles evaluation. OSM Buildings stay installed.
 * Starts hidden until the evaluation switch is on. Never the global default.
 */
import { useEffect, useRef } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import { RE_EARTH_BUILDINGS_TILESET_URL } from '@/lib/terra/godsEye/reEarth'
import type { TerraScaleLevel } from './useTerraCameraScale'

type Props = {
  viewer: CesiumViewer | null
  enabled: boolean
  scaleLevel: TerraScaleLevel
  onStatusChange?: (status: 'off' | 'loading' | 'evaluation_active' | 'unavailable') => void
}

export function TerraReEarthBuildings({ viewer, enabled, scaleLevel, onStatusChange }: Props) {
  const tilesetRef = useRef<import('cesium').Cesium3DTileset | null>(null)
  const onStatusChangeRef = useRef(onStatusChange)
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !enabled) {
      const tileset = tilesetRef.current
      if (tileset) {
        try { tileset.show = false } catch { /* viewer tearing down */ }
      }
      onStatusChangeRef.current?.('off')
      return
    }

    let cancelled = false
    async function load() {
      onStatusChangeRef.current?.('loading')
      const Cesium = await loadCesium()
      if (cancelled || viewer.isDestroyed()) return
      try {
        if (!tilesetRef.current) {
          const tileset = await Cesium.Cesium3DTileset.fromUrl(RE_EARTH_BUILDINGS_TILESET_URL)
          if (cancelled || viewer.isDestroyed()) {
            tileset.destroy()
            return
          }
          viewer.scene.primitives.add(tileset)
          tilesetRef.current = tileset
        }
        tilesetRef.current.show = scaleLevel === 'city' || scaleLevel === 'local' || scaleLevel === 'building'
        onStatusChangeRef.current?.('evaluation_active')
      } catch {
        onStatusChangeRef.current?.('unavailable')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [viewer, enabled, scaleLevel])

  useEffect(() => {
    return () => {
      const tileset = tilesetRef.current
      const target = viewer
      tilesetRef.current = null
      if (!tileset || !target || target.isDestroyed()) return
      try {
        target.scene.primitives.remove(tileset)
      } catch {
        // Viewer may already be tearing down.
      }
      try {
        if (!tileset.isDestroyed()) tileset.destroy()
      } catch {
        // Primitive already destroyed with the scene.
      }
    }
  }, [viewer])

  return null
}
