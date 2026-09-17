'use client'

/**
 * Additive Re:Earth Terrain evaluation. Cesium World Terrain remains the default.
 * Only swaps the viewer terrain provider while the evaluation switch is on.
 */
import { useEffect, useRef } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import type { TerrainProvider } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import { RE_EARTH_TERRAIN_PROVIDER_URL } from '@/lib/terra/godsEye/reEarth'

type Props = {
  viewer: CesiumViewer | null
  enabled: boolean
  onStatusChange?: (status: 'off' | 'loading' | 'evaluation_active' | 'unavailable') => void
}

export function TerraReEarthTerrain({ viewer, enabled, onStatusChange }: Props) {
  const originalRef = useRef<TerrainProvider | null>(null)
  const evaluationRef = useRef<TerrainProvider | null>(null)
  const onStatusChangeRef = useRef(onStatusChange)
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    let cancelled = false

    async function apply() {
      if (!enabled) {
        if (originalRef.current && !viewer.isDestroyed()) {
          viewer.terrainProvider = originalRef.current
        }
        onStatusChangeRef.current?.('off')
        return
      }
      onStatusChangeRef.current?.('loading')
      const Cesium = await loadCesium()
      if (cancelled || viewer.isDestroyed()) return
      if (!originalRef.current) originalRef.current = viewer.terrainProvider
      try {
        if (!evaluationRef.current) {
          evaluationRef.current = await Cesium.CesiumTerrainProvider.fromUrl(RE_EARTH_TERRAIN_PROVIDER_URL, {
            requestVertexNormals: true,
          })
        }
        if (cancelled || viewer.isDestroyed()) return
        viewer.terrainProvider = evaluationRef.current
        onStatusChangeRef.current?.('evaluation_active')
      } catch {
        if (originalRef.current && !viewer.isDestroyed()) {
          viewer.terrainProvider = originalRef.current
        }
        onStatusChangeRef.current?.('unavailable')
      }
    }
    void apply()
    return () => {
      cancelled = true
    }
  }, [viewer, enabled])

  useEffect(() => {
    return () => {
      const target = viewer
      const original = originalRef.current
      originalRef.current = null
      evaluationRef.current = null
      if (!target || target.isDestroyed() || !original) return
      try {
        target.terrainProvider = original
      } catch {
        // Viewer may already be tearing down.
      }
    }
  }, [viewer])

  return null
}
