'use client'

/**
 * Cesium OSM Buildings — Commander opt-in only.
 * Never loaded on globe boot. IMAGERY_FIRST stays the default city presentation.
 * Footprint picking remains on OSM Overpass, not this tileset.
 */
import { useEffect, useRef } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'

type Props = {
  viewer: CesiumViewer | null
  enabled: boolean
}

export function TerraCesiumOsmBuildings({ viewer, enabled }: Props) {
  const tilesetRef = useRef<import('cesium').Cesium3DTileset | null>(null)

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const tileset = tilesetRef.current
    if (!enabled) {
      if (tileset) {
        try { tileset.show = false } catch { /* viewer tearing down */ }
      }
      return
    }

    let cancelled = false
    async function load() {
      const Cesium = await loadCesium()
      if (cancelled || viewer.isDestroyed()) return
      try {
        if (!tilesetRef.current) {
          const created = await Cesium.createOsmBuildingsAsync()
          if (cancelled || viewer.isDestroyed()) {
            created.destroy()
            return
          }
          created.show = true
          viewer.scene.primitives.add(created)
          tilesetRef.current = created
          return
        }
        tilesetRef.current.show = true
      } catch {
        /* Asset/entitlement failure degrades this overlay only. */
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [viewer, enabled])

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
