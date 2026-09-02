'use client'

/**
 * Terra's live camera view-rectangle — the Commander's currently visible region in degrees,
 * recomputed only on Cesium's own real `camera.moveEnd` (never per frame, never on `changed`),
 * mirroring useTerraCameraScale.ts's exact settle-only discipline and its "plain top-level helper,
 * not inline in the hook body" escape hatch for this repo's react-hooks/immutability lint rule.
 *
 * Aircraft (God's Eye live-aviation phase) is the first Terra layer that needs a bounding-box
 * query scoped to what's actually on screen, rather than a point+radius query like
 * nearby_landmarks' — this is the one new piece of camera-state plumbing that phase needs.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import type { TerraDegreeRectangle } from '@/lib/terra/aircraftBoundingBox'

export type TerraCameraViewRectangle = {
  rectangle: TerraDegreeRectangle | null
  /** Increments once per real Cesium `camera.moveEnd` — mirrors useTerraCameraScale's identical
   * field, for any future consumer that needs "the camera just settled" as a distinct signal from
   * the rectangle value itself. */
  settledAt: number
}

function isTerraCesiumViewerAlive(targetViewer: CesiumViewer): boolean {
  return !targetViewer.isDestroyed()
}

function computeTerraViewRectangleDegrees(targetViewer: CesiumViewer, CesiumModule: typeof import('cesium')): TerraDegreeRectangle | null {
  const rectangle = targetViewer.camera.computeViewRectangle(targetViewer.scene.globe.ellipsoid)
  if (!rectangle) return null
  return {
    west: CesiumModule.Math.toDegrees(rectangle.west),
    south: CesiumModule.Math.toDegrees(rectangle.south),
    east: CesiumModule.Math.toDegrees(rectangle.east),
    north: CesiumModule.Math.toDegrees(rectangle.north),
  }
}

function attachTerraViewRectangleListener(targetViewer: CesiumViewer, onMoveEnd: () => void): () => void {
  targetViewer.camera.moveEnd.addEventListener(onMoveEnd)
  return () => {
    // Same real-observed-in-testing guard every other Terra camera hook's cleanup already uses:
    // a sibling TerraGlobe remount can destroy this viewer before this cleanup runs.
    if (!isTerraCesiumViewerAlive(targetViewer)) return
    targetViewer.camera.moveEnd.removeEventListener(onMoveEnd)
  }
}

export function useTerraCameraViewRectangle(viewer: CesiumViewer | null): TerraCameraViewRectangle {
  const [rectangle, setRectangle] = useState<TerraDegreeRectangle | null>(null)
  const [settledAt, setSettledAt] = useState(0)

  useEffect(() => {
    if (!viewer) return
    const targetViewer = viewer
    let cancelled = false
    let detach: (() => void) | null = null

    async function attach() {
      const CesiumModule = await loadCesium()
      if (cancelled || !isTerraCesiumViewerAlive(targetViewer)) return

      const recompute = () => {
        if (!isTerraCesiumViewerAlive(targetViewer)) return
        setRectangle(computeTerraViewRectangleDegrees(targetViewer, CesiumModule))
        setSettledAt(Date.now())
      }
      recompute()
      detach = attachTerraViewRectangleListener(targetViewer, recompute)
    }
    void attach()

    return () => {
      cancelled = true
      detach?.()
    }
  }, [viewer])

  // Stable identity across renders that don't change either field — every consumer keys effects
  // and memos off this returned object (not just `.rectangle`), so a fresh wrapper on every call
  // would defeat their dependency-array comparisons even though the underlying value hasn't moved.
  return useMemo(() => ({ rectangle, settledAt }), [rectangle, settledAt])
}
