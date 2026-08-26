'use client'

/**
 * Terra's 4D clock hook (Phase 6) — wires the pure state transitions in lib/terra/terraTime.ts to
 * an actual Cesium `viewer.clock` and bounded-rate React state. This is the ONLY place Terra
 * pushes a timestamp into Cesium or reads one back.
 *
 * Two one-directional data paths, never a loop:
 *   1. State -> Cesium: whenever Terra's own time-state changes (mode/rate/playing/currentTime —
 *      the last covers an explicit scrub), this hook pushes it onto viewer.clock.
 *   2. Cesium -> state: a single viewer.clock.onTick listener reads viewer.clock.currentTime back
 *      into React state, throttled to REACT_UPDATE_INTERVAL_MS (~1/sec) — "keep Cesium clock
 *      movement inside Cesium; React updates the visible timestamp at a bounded rate," not 60
 *      setState calls/sec. In live mode this IS the time source (Cesium's own render loop
 *      advances the clock in real time); in historical+playing mode, this same tick handler calls
 *      advanceHistoricalTerraTime with the real elapsed time since the last update, so playback
 *      rides Cesium's existing render loop rather than a second independent timer.
 *
 * Real Earth orientation/lighting (mission section 4/5) is a consequence of this, not a separate
 * system: TerraGlobe.tsx enables `scene.globe.enableLighting`, and Cesium computes the real sun
 * position purely from `viewer.clock.currentTime` internally — nothing here reimplements
 * astronomy Cesium already provides.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import type { TerraPlaybackRate, TerraTimeState } from '@/lib/terra/types'
import {
  advanceHistoricalTerraTime,
  advanceLiveTerraTime,
  createLiveTerraTimeState,
  createTerraTimeEventBus,
  pauseTerraTime,
  playTerraTime,
  returnToLiveTerraTime,
  scrubTerraTime,
  setTerraPlaybackRate,
  type TerraTimeEventBus,
} from '@/lib/terra/terraTime'

const REACT_UPDATE_INTERVAL_MS = 1000

/** A plain helper, not a hook — `targetViewer` is an ordinary function parameter, so imperatively
 * configuring an external Cesium object through it (the whole point of this function) is normal,
 * not a React-props mutation. Kept outside useTerraClock so the "push Terra time onto Cesium's
 * clock" logic has one clear, narrow home. */
function applyTerraTimeToViewerClock(targetViewer: CesiumViewer, Cesium: typeof import('cesium'), time: TerraTimeState): void {
  targetViewer.clock.currentTime = Cesium.JulianDate.fromIso8601(time.currentTime)
  targetViewer.clock.multiplier = time.mode === 'live' ? 1 : time.playbackRate
  targetViewer.clock.shouldAnimate = time.mode === 'live' || time.playing
  targetViewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED
}

export type UseTerraClockResult = {
  time: TerraTimeState
  bus: TerraTimeEventBus
  goLive: () => void
  scrub: (isoTime: string) => void
  play: () => void
  pause: () => void
  setPlaybackRate: (rate: TerraPlaybackRate) => void
}

export function useTerraClock(viewer: CesiumViewer | null): UseTerraClockResult {
  const [time, setTime] = useState<TerraTimeState>(() => createLiveTerraTimeState(new Date().toISOString()))
  // A stable value (never reassigned via its setter) rather than a ref, specifically so it can be
  // read directly in this hook's own return statement — reading a ref's `.current` during render
  // is against this repo's stricter react-hooks/refs rule; useState's initial-value snapshot is
  // exactly as stable across renders without tripping it.
  const [bus] = useState<TerraTimeEventBus>(() => createTerraTimeEventBus())

  // Mirrors `time` for read access inside the onTick handler (an event handler, not render —
  // exactly where the same lint rule says a ref read belongs) without making that handler's
  // effect dependency array include `time` itself, which would tear down/rebuild the Cesium
  // listener on every tick-driven update. Synced in an effect, never written during render.
  const timeRef = useRef(time)
  useEffect(() => {
    timeRef.current = time
  })

  const lastAdvanceAtRef = useRef(0)
  useEffect(() => {
    lastAdvanceAtRef.current = Date.now()
  }, [])

  // React -> Cesium is reserved for control changes. Tick-derived currentTime is deliberately
  // excluded: writing every sampled Cesium time straight back into the same clock creates a
  // feedback path and repeatedly restarts its epoch. Explicit scrubs/go-live update the clock in
  // their action callbacks below.
  useEffect(() => {
    if (!viewer) return
    const targetViewer = viewer
    let cancelled = false
    async function sync() {
      const Cesium = await import('cesium')
      // The dynamic import is an async gap where a sibling TerraGlobe remount (observed under
      // React StrictMode's dev-only double-invoke, and possible on any fast-refresh reload) can
      // destroy this exact viewer before this closure resumes — `cancelled` alone only tracks
      // this effect's own unmount, not a viewer torn down out from under it.
      if (cancelled || targetViewer.isDestroyed()) return
      applyTerraTimeToViewerClock(targetViewer, Cesium, timeRef.current)
    }
    void sync()
    return () => {
      cancelled = true
    }
  }, [viewer, time.mode, time.playbackRate, time.playing])

  // Cesium -> state, bounded rate, one listener for the hook's whole lifetime.
  useEffect(() => {
    if (!viewer) return
    let cancelled = false
    let removeListener: (() => void) | null = null

    async function attach() {
      const Cesium = await import('cesium')
      // Same async-gap race as the sync effect above.
      if (cancelled || viewer!.isDestroyed()) return

      const onTick = () => {
        const now = Date.now()
        if (now - lastAdvanceAtRef.current < REACT_UPDATE_INTERVAL_MS) return
        const elapsedMs = now - lastAdvanceAtRef.current
        const current = timeRef.current

        if (current.mode === 'live') {
          lastAdvanceAtRef.current = now
          const nowIso = Cesium.JulianDate.toIso8601(viewer!.clock.currentTime)
          setTime(prev => advanceLiveTerraTime(prev, nowIso))
          return
        }

        if (current.playing) {
          lastAdvanceAtRef.current = now
          setTime(prev => advanceHistoricalTerraTime(prev, elapsedMs))
        } else {
          lastAdvanceAtRef.current = now // avoid a large catch-up jump if playback resumes later
        }
      }

      // Captured once here, not re-read from `viewer` at cleanup time: viewer.clock is a getter
      // that throws once the viewer is destroyed (real behavior observed in authenticated browser
      // testing, under React StrictMode's dev-only double-invoke of this cleanup). The Clock object
      // itself stays a valid, inert target for removeEventListener regardless.
      const clock = viewer!.clock
      clock.onTick.addEventListener(onTick)
      removeListener = () => clock.onTick.removeEventListener(onTick)
    }
    void attach()

    return () => {
      cancelled = true
      removeListener?.()
    }
  }, [viewer])

  const goLive = useCallback(() => {
    const nowIso = new Date().toISOString()
    const next = returnToLiveTerraTime(nowIso)
    setTime(next)
    if (viewer) {
      void import('cesium').then(Cesium => {
        if (!viewer.isDestroyed()) applyTerraTimeToViewerClock(viewer, Cesium, next)
      })
    }
    bus.emit({ type: 'terra.time.returned_live', at: nowIso })
    bus.emit({ type: 'terra.time.mode.changed', mode: 'live', at: nowIso })
  }, [bus, viewer])

  const scrub = useCallback((isoTime: string) => {
    const wasLive = timeRef.current.mode === 'live'
    const next = scrubTerraTime(timeRef.current, isoTime)
    setTime(next)
    if (viewer) {
      void import('cesium').then(Cesium => {
        if (!viewer.isDestroyed()) applyTerraTimeToViewerClock(viewer, Cesium, next)
      })
    }
    const at = new Date().toISOString()
    if (wasLive) bus.emit({ type: 'terra.time.mode.changed', mode: 'historical', at })
    bus.emit({ type: 'terra.time.selected.changed', currentTime: isoTime, at })
  }, [bus, viewer])

  const play = useCallback(() => {
    setTime(prev => playTerraTime(prev))
    bus.emit({ type: 'terra.playback.started', rate: timeRef.current.playbackRate, at: new Date().toISOString() })
  }, [bus])

  const pause = useCallback(() => {
    setTime(prev => pauseTerraTime(prev))
    bus.emit({ type: 'terra.playback.paused', at: new Date().toISOString() })
  }, [bus])

  const setPlaybackRate = useCallback((rate: TerraPlaybackRate) => {
    setTime(prev => setTerraPlaybackRate(prev, rate))
  }, [])

  return { time, bus, goLive, scrub, play, pause, setPlaybackRate }
}
