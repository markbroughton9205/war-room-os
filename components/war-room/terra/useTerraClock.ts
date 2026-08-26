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

  // State -> Cesium. Re-runs on every currentTime change too (covers an explicit scrub
  // immediately) — harmless in live/playing mode where currentTime changes are themselves sourced
  // from Cesium a moment earlier in the same tick, so re-pushing it is idempotent, not a fight.
  useEffect(() => {
    if (!viewer) return
    const targetViewer = viewer
    let cancelled = false
    async function sync() {
      const Cesium = await import('cesium')
      if (cancelled) return
      applyTerraTimeToViewerClock(targetViewer, Cesium, time)
    }
    void sync()
    return () => {
      cancelled = true
    }
  }, [viewer, time])

  // Cesium -> state, bounded rate, one listener for the hook's whole lifetime.
  useEffect(() => {
    if (!viewer) return
    let cancelled = false
    let removeListener: (() => void) | null = null

    async function attach() {
      const Cesium = await import('cesium')
      if (cancelled) return

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

      viewer!.clock.onTick.addEventListener(onTick)
      removeListener = () => viewer!.clock.onTick.removeEventListener(onTick)
    }
    void attach()

    return () => {
      cancelled = true
      removeListener?.()
    }
  }, [viewer])

  const goLive = useCallback(() => {
    const nowIso = new Date().toISOString()
    setTime(returnToLiveTerraTime(nowIso))
    bus.emit({ type: 'terra.time.returned_live', at: nowIso })
    bus.emit({ type: 'terra.time.mode.changed', mode: 'live', at: nowIso })
  }, [bus])

  const scrub = useCallback((isoTime: string) => {
    const wasLive = timeRef.current.mode === 'live'
    setTime(prev => scrubTerraTime(prev, isoTime))
    const at = new Date().toISOString()
    if (wasLive) bus.emit({ type: 'terra.time.mode.changed', mode: 'historical', at })
    bus.emit({ type: 'terra.time.selected.changed', currentTime: isoTime, at })
  }, [bus])

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
