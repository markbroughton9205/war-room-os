'use client'

/**
 * God's Eye multi-scale local detail phase — the single discrete camera-altitude signal every
 * scale-gated feature (3D buildings visibility, the nearby-landmarks layer, the scale-level
 * status badge) reads from, instead of each one independently polling `viewer.camera`.
 *
 * Deliberately separate from the continuous, per-frame-adjacent imagery crossfade in
 * TerraEarthImagery.tsx: that consumer reads camera height directly and mutates a Cesium
 * ImageryLayer's alpha imperatively (no React state, so it can update as smoothly as Cesium's own
 * `camera.changed` firing allows). This hook instead exposes a DISCRETE level and only calls
 * setState on a real level transition — the same "React learns about state edges, not every raw
 * sample" discipline already established by useTerraCinematicOrbit.ts's `orbitingRef` pattern —
 * because level-gated consumers (an effect toggling a 3D tileset's `.show`, a layer's `enabled`
 * flag) only care when the bucket actually changes, not every intermediate meter of camera height.
 *
 * Thresholds (documented, not arbitrary): Cesium's own camera height is meters above the WGS84
 * ellipsoid at the camera's ground target. These bands were calibrated against a real measurement
 * taken during authenticated browser verification, not guessed: flying to Nominatim's real
 * California bounding box (~1,000 km across) via `Cesium.Rectangle.fromDegrees` + `camera.flyTo`
 * settles the camera at roughly 1.9M m — a whole-US-state view, which the mission explicitly
 * calls "regional," not "global." The GLOBAL floor was raised from an initial 1.5M m guess to 3M m
 * specifically so that measured case lands in REGIONAL, not GLOBAL.
 *   - GLOBAL    (>= 3,000,000 m): most of a continent or more is visible; still recognizably
 *     "the planet," where NASA GIBS' photographic imagery is the right visual treatment.
 *   - REGIONAL  (>= 200,000 m):  a large country/state is in view (the measured California case
 *     above); terrain relief and coastline shape read clearly.
 *   - CITY      (>= 20,000 m):   a metro area's street grid and major roads become individually
 *     legible in OSM's raster tiles.
 *   - LOCAL     (>= 2,000 m):    individual streets, blocks, and building footprints are legible.
 *   - BUILDING  (< 2,000 m):     near-ground; individual named structures/landmarks are the
 *     dominant visual content — where Cesium OSM Buildings (when ion-configured) adds real
 *     massing.
 */
import { useEffect, useRef, useState } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'

export type TerraScaleLevel = 'global' | 'regional' | 'city' | 'local' | 'building'

export const TERRA_SCALE_THRESHOLDS_M: Record<Exclude<TerraScaleLevel, 'building'>, number> = {
  global: 3_000_000,
  regional: 200_000,
  city: 20_000,
  local: 2_000,
}

export function terraScaleLevelForHeight(heightMeters: number): TerraScaleLevel {
  if (heightMeters >= TERRA_SCALE_THRESHOLDS_M.global) return 'global'
  if (heightMeters >= TERRA_SCALE_THRESHOLDS_M.regional) return 'regional'
  if (heightMeters >= TERRA_SCALE_THRESHOLDS_M.city) return 'city'
  if (heightMeters >= TERRA_SCALE_THRESHOLDS_M.local) return 'local'
  return 'building'
}

export type TerraCameraScale = {
  level: TerraScaleLevel
  /** Increments once per real Cesium `camera.moveEnd` — the native Cesium "camera has settled"
   * signal. Consumers that need to re-run a bounded query only when the Commander stops moving
   * the camera (never mid-drag, never per-frame) watch this, not `level` alone. */
  settledAt: number
}

/** Plain top-level helpers, not inline in the hook/effect body — this repo's react-hooks/
 * immutability lint rule flags any call on a value reachable from a hook argument once ANY
 * mutation (here, `camera.percentageChanged = ...` and the addEventListener calls) happens
 * inline in that same closure, even a plain read-only `.isDestroyed()` check elsewhere in it. A
 * differently-named local parameter on a function outside the hook's scope is the established
 * escape hatch (see useTerraClock.ts's applyTerraTimeToViewerClock for the same pattern) — every
 * viewer-touching operation below lives in one of these, so nothing mutates `viewer` inline. */
function isTerraCesiumViewerAlive(targetViewer: CesiumViewer): boolean {
  return !targetViewer.isDestroyed()
}

function terraCameraHeightMeters(targetViewer: CesiumViewer): number {
  return targetViewer.camera.positionCartographic.height
}

function configureTerraCameraChangeSensitivity(targetViewer: CesiumViewer): void {
  // Finer-grained than Cesium's own 0.5 (50%) default so a scale-level transition is noticed
  // promptly — still event-driven, still bounded, never a per-frame sample.
  targetViewer.camera.percentageChanged = 0.05
}

function attachTerraCameraListeners(targetViewer: CesiumViewer, onChanged: () => void, onMoveEnd: () => void): () => void {
  targetViewer.camera.changed.addEventListener(onChanged)
  targetViewer.camera.moveEnd.addEventListener(onMoveEnd)
  return () => {
    // Real behavior observed in authenticated browser testing: a sibling TerraGlobe remount
    // (fast-refresh reload, or React StrictMode's dev double-invoke) can destroy this viewer
    // before this cleanup runs — removeEventListener on an already-destroyed viewer's camera
    // throws the same way every other Cesium getter does post-destroy.
    if (!isTerraCesiumViewerAlive(targetViewer)) return
    targetViewer.camera.changed.removeEventListener(onChanged)
    targetViewer.camera.moveEnd.removeEventListener(onMoveEnd)
  }
}

export function useTerraCameraScale(viewer: CesiumViewer | null): TerraCameraScale {
  const [level, setLevel] = useState<TerraScaleLevel>('global')
  const [settledAt, setSettledAt] = useState(0)
  const levelRef = useRef(level)

  useEffect(() => {
    if (!viewer) return
    const targetViewer = viewer
    let cancelled = false
    let detach: (() => void) | null = null

    async function attach() {
      await import('cesium')
      if (cancelled || !isTerraCesiumViewerAlive(targetViewer)) return

      configureTerraCameraChangeSensitivity(targetViewer)

      const recomputeLevel = () => {
        if (!isTerraCesiumViewerAlive(targetViewer)) return
        const next = terraScaleLevelForHeight(terraCameraHeightMeters(targetViewer))
        if (levelRef.current !== next) {
          levelRef.current = next
          setLevel(next)
        }
      }
      recomputeLevel()

      const onChanged = () => recomputeLevel()
      const onMoveEnd = () => {
        recomputeLevel()
        setSettledAt(Date.now())
      }
      detach = attachTerraCameraListeners(targetViewer, onChanged, onMoveEnd)
    }
    void attach()

    return () => {
      cancelled = true
      detach?.()
    }
  }, [viewer])

  return { level, settledAt }
}
