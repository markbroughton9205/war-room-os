'use client'

/**
 * Terra's optional cinematic idle-camera orbit (Phase 6, mission section 6) — a slow, subtle
 * rotation of the CAMERA around the globe while idle in live mode. Deliberately isolated from
 * Terra's clock/time state (lib/terra/terraTime.ts, useTerraClock.ts): this hook only ever calls
 * `viewer.camera.rotate(...)`, never touches `viewer.clock` or any TerraTimeState — Earth/time
 * state keeps progressing regardless of whether the camera is orbiting, and orbiting never
 * advances or freezes Terra time.
 *
 * Stops immediately on any real user input (pointerdown/wheel on the Cesium canvas — not
 * Cesium's own `camera.changed` event, which this hook's own rotation would otherwise trigger,
 * creating a self-stopping feedback loop). Resumes automatically after an idle period, or
 * immediately via the exposed `resume()` action (TerraShell's "Resume Cinematic View" control).
 * Respects `prefers-reduced-motion` — does not orbit at all when the OS/browser requests it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'

// Roughly one full revolution every ~13 real minutes — "subtle and cinematic," never a fast
// screensaver spin.
const ORBIT_RADIANS_PER_MS = 0.008 / 1000
const IDLE_RESUME_DELAY_MS = 20_000

export type TerraCinematicOrbitResult = {
  orbiting: boolean
  /** True once the OS/browser prefers-reduced-motion setting has suppressed the feature
   * entirely — surfaced so the UI can explain why the control has no visible effect rather than
   * silently doing nothing. */
  suppressedByReducedMotion: boolean
  pause: () => void
  resume: () => void
}

export function useTerraCinematicOrbit(viewer: CesiumViewer | null, enabled: boolean): TerraCinematicOrbitResult {
  const [orbiting, setOrbiting] = useState(false)
  const [suppressedByReducedMotion, setSuppressedByReducedMotion] = useState(false)
  const lastInteractionAtRef = useRef(0)
  const pausedByUserRef = useRef(false)

  useEffect(() => {
    lastInteractionAtRef.current = Date.now()
  }, [])

  const pause = useCallback(() => {
    lastInteractionAtRef.current = Date.now()
    pausedByUserRef.current = true
    setOrbiting(false)
  }, [])

  const resume = useCallback(() => {
    pausedByUserRef.current = false
    // Sets the "last interaction" far enough in the past that the idle-check below allows
    // orbiting to start on the very next frame, rather than waiting out the full idle delay
    // again — an explicit "Resume" click is exactly the deliberate override the idle timer
    // exists to eventually reach on its own.
    lastInteractionAtRef.current = Date.now() - IDLE_RESUME_DELAY_MS
  }, [])

  // Real user input only — never Cesium's own camera-changed event, which this hook's own
  // rotation would otherwise immediately re-trigger.
  useEffect(() => {
    if (!viewer || !enabled) return
    const canvas = viewer.scene.canvas
    const onInteract = () => pause()
    canvas.addEventListener('pointerdown', onInteract)
    canvas.addEventListener('wheel', onInteract, { passive: true })
    canvas.addEventListener('touchstart', onInteract, { passive: true })
    return () => {
      canvas.removeEventListener('pointerdown', onInteract)
      canvas.removeEventListener('wheel', onInteract)
      canvas.removeEventListener('touchstart', onInteract)
    }
  }, [viewer, enabled, pause])

  // Deriving suppressedByReducedMotion as its own small effect (rather than inline in the main
  // orbit-loop effect below) keeps that state update the ONLY thing this effect does — still
  // deferred a tick for the same "no synchronous setState in an effect body" reason the rest of
  // this codebase already established a standard fix for (see useTerraLayer.ts's own kickoff
  // pattern).
  useEffect(() => {
    const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null
    const matches = Boolean(media?.matches)
    const timeout = setTimeout(() => setSuppressedByReducedMotion(matches), 0)
    return () => clearTimeout(timeout)
  }, [])

  useEffect(() => {
    if (!viewer || !enabled || suppressedByReducedMotion) {
      const timeout = setTimeout(() => setOrbiting(false), 0)
      return () => clearTimeout(timeout)
    }

    let cancelled = false
    let frameHandle: number | null = null
    let lastFrameAt: number | null = null
    let CesiumModule: typeof import('cesium') | null = null

    async function loop() {
      const Cesium = await import('cesium')
      if (cancelled) return
      CesiumModule = Cesium

      function frame() {
        if (cancelled) return
        frameHandle = requestAnimationFrame(frame)
        if (document.visibilityState === 'hidden') {
          lastFrameAt = null // don't accumulate a huge catch-up jump once the tab becomes visible again
          return
        }
        const now = Date.now()
        const idleFor = now - lastInteractionAtRef.current
        const shouldOrbit = !pausedByUserRef.current && idleFor >= IDLE_RESUME_DELAY_MS
        setOrbiting(previous => (previous === shouldOrbit ? previous : shouldOrbit))

        if (!shouldOrbit || !viewer || viewer.isDestroyed()) {
          lastFrameAt = null
          return
        }
        if (lastFrameAt === null) {
          lastFrameAt = now
          return
        }
        const elapsedMs = now - lastFrameAt
        lastFrameAt = now
        viewer.camera.rotate(CesiumModule!.Cartesian3.UNIT_Z, -ORBIT_RADIANS_PER_MS * elapsedMs)
      }
      frameHandle = requestAnimationFrame(frame)
    }
    void loop()

    return () => {
      cancelled = true
      if (frameHandle !== null) cancelAnimationFrame(frameHandle)
    }
  }, [viewer, enabled, suppressedByReducedMotion])

  return { orbiting, suppressedByReducedMotion, pause, resume }
}
