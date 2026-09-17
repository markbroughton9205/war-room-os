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
 * creating a self-stopping feedback loop). Idle auto-resume is allowed only while navigation
 * ownership is IDLE or AUTO_ORBIT. Commander inspect, camera fly, search fly, and manual globe
 * lock auto-resume. Orbit returns through Resume Cinematic View or an explicit toggle.
 * Canvas interaction does not permanently kill orbit unless auto-resume is locked or pause()
 * was called. Respects `prefers-reduced-motion`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import type { TerraScaleLevel } from './useTerraCameraScale'

// Subtle cinematic at close range; zoomed-out Earth should still read as live and spinning.
const ORBIT_RADIANS_PER_MS = 0.008 / 1000
const GLOBAL_ORBIT_RADIANS_PER_MS = 0.055 / 1000
const IDLE_RESUME_DELAY_MS = 20_000
const GLOBAL_IDLE_RESUME_DELAY_MS = 1_800

export type TerraCinematicOrbitResult = {
  orbiting: boolean
  /** True once the OS/browser prefers-reduced-motion setting has suppressed the feature
   * entirely — surfaced so the UI can explain why the control has no visible effect rather than
   * silently doing nothing. */
  suppressedByReducedMotion: boolean
  pause: () => void
  resume: () => void
  toggle: () => void
  lockAutoResume: (locked: boolean) => void
}

export function useTerraCinematicOrbit(
  viewer: CesiumViewer | null,
  enabled: boolean,
  scaleLevel: TerraScaleLevel = 'global',
  options?: { autoResumeLocked?: boolean },
): TerraCinematicOrbitResult {
  const [orbiting, setOrbiting] = useState(false)
  const [suppressedByReducedMotion, setSuppressedByReducedMotion] = useState(false)
  const lastInteractionAtRef = useRef(0)
  const pausedByUserRef = useRef(false)
  const orbitingRef = useRef(false)
  const scaleLevelRef = useRef(scaleLevel)
  const autoResumeLockedRef = useRef(Boolean(options?.autoResumeLocked))
  useEffect(() => {
    scaleLevelRef.current = scaleLevel
  }, [scaleLevel])
  useEffect(() => {
    autoResumeLockedRef.current = Boolean(options?.autoResumeLocked)
  }, [options?.autoResumeLocked])

  useEffect(() => {
    lastInteractionAtRef.current = Date.now()
  }, [])

  const noteInteraction = useCallback(() => {
    lastInteractionAtRef.current = Date.now()
    if (autoResumeLockedRef.current) {
      pausedByUserRef.current = true
    }
    if (orbitingRef.current) {
      orbitingRef.current = false
      setOrbiting(false)
    }
  }, [])

  const pause = useCallback(() => {
    lastInteractionAtRef.current = Date.now()
    pausedByUserRef.current = true
    if (orbitingRef.current) {
      orbitingRef.current = false
      setOrbiting(false)
    }
  }, [])

  const lockAutoResume = useCallback((locked: boolean) => {
    autoResumeLockedRef.current = locked
    if (locked && orbitingRef.current) {
      orbitingRef.current = false
      setOrbiting(false)
    }
  }, [])

  const resume = useCallback(() => {
    autoResumeLockedRef.current = false
    pausedByUserRef.current = false
    // Sets the "last interaction" far enough in the past that the idle-check below allows
    // orbiting to start on the very next frame, rather than waiting out the full idle delay
    // again — an explicit "Resume" click is exactly the deliberate override the idle timer
    // exists to eventually reach on its own.
    lastInteractionAtRef.current = Date.now() - IDLE_RESUME_DELAY_MS
    if (!orbitingRef.current) {
      orbitingRef.current = true
      setOrbiting(true)
    }
  }, [])

  const toggle = useCallback(() => {
    if (pausedByUserRef.current) {
      resume()
      return
    }
    pause()
  }, [pause, resume])

  // Real user input only — never Cesium's own camera-changed event, which this hook's own
  // rotation would otherwise immediately re-trigger.
  useEffect(() => {
    if (!viewer || !enabled) return
    const canvas = viewer.scene.canvas
    const onInteract = () => noteInteraction()
    canvas.addEventListener('pointerdown', onInteract)
    canvas.addEventListener('wheel', onInteract, { passive: true })
    canvas.addEventListener('touchstart', onInteract, { passive: true })
    return () => {
      canvas.removeEventListener('pointerdown', onInteract)
      canvas.removeEventListener('wheel', onInteract)
      canvas.removeEventListener('touchstart', onInteract)
    }
  }, [viewer, enabled, noteInteraction])

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
      const timeout = setTimeout(() => {
        if (!orbitingRef.current) return
        orbitingRef.current = false
        setOrbiting(false)
      }, 0)
      return () => clearTimeout(timeout)
    }

    let cancelled = false
    let frameHandle: number | null = null
    let lastFrameAt: number | null = null
    let CesiumModule: typeof import('cesium') | null = null

    async function loop() {
      const Cesium = await loadCesium()
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
        const zoomedOut = scaleLevelRef.current === 'global' || scaleLevelRef.current === 'regional'
        const idleDelay = zoomedOut ? GLOBAL_IDLE_RESUME_DELAY_MS : IDLE_RESUME_DELAY_MS
        const idleFor = now - lastInteractionAtRef.current
        const shouldOrbit = !pausedByUserRef.current
          && !autoResumeLockedRef.current
          && (orbitingRef.current || idleFor >= idleDelay)
        // rAF owns camera motion only. React is notified solely on the two semantic state edges,
        // never once per animation frame.
        if (orbitingRef.current !== shouldOrbit) {
          orbitingRef.current = shouldOrbit
          setOrbiting(shouldOrbit)
        }

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
        const rate = zoomedOut ? GLOBAL_ORBIT_RADIANS_PER_MS : ORBIT_RADIANS_PER_MS
        viewer.camera.rotate(CesiumModule!.Cartesian3.UNIT_Z, -rate * elapsedMs)
      }
      frameHandle = requestAnimationFrame(frame)
    }
    void loop()

    return () => {
      cancelled = true
      if (frameHandle !== null) cancelAnimationFrame(frameHandle)
    }
  }, [viewer, enabled, suppressedByReducedMotion])

  return { orbiting, suppressedByReducedMotion, pause, resume, toggle, lockAutoResume }
}
