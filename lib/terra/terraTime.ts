/**
 * Terra's 4D time engine (Phase 6) — pure, framework-agnostic state transitions and the generic
 * temporal visibility function, deliberately separated from components/war-room/terra/
 * useTerraClock.ts (which wires this to an actual Cesium viewer.clock and React state) so the
 * logic that matters — playback math, visibility filtering, event-bus semantics — is testable via
 * a plain node script, matching this repo's deterministic-test convention (no React Testing
 * Library, no DOM).
 *
 * No persistence anywhere in this file — every function is a pure `(state) => state` transform.
 * "Do not persist frame-by-frame clock ticks" is satisfied by construction: there is nothing here
 * that writes anywhere.
 */
import type { TerraGeoFeature, TerraPlaybackRate, TerraTimeContextEvent, TerraTimeState, TerraTimeWindow } from '@/lib/terra/types'

export function createLiveTerraTimeState(nowIso: string): TerraTimeState {
  return { mode: 'live', currentTime: nowIso, playbackRate: 1, playing: true, liveOffsetMs: 0, lastLiveSyncAt: nowIso }
}

/** Live mode's own progression — called from useTerraClock.ts's bounded-rate Cesium clock
 * read-back, never from a setInterval independent of Cesium's actual clock. A no-op outside live
 * mode: historical mode's `currentTime` only ever changes via scrubTerraTime/
 * advanceHistoricalTerraTime, proving "historical mode freezes the selected timestamp" against
 * anything else touching it. */
export function advanceLiveTerraTime(state: TerraTimeState, nowIso: string): TerraTimeState {
  if (state.mode !== 'live') return state
  return { ...state, currentTime: nowIso, lastLiveSyncAt: nowIso }
}

/** Historical playback's own progression — advances `currentTime` by real elapsed time scaled by
 * playbackRate. A no-op when not playing or not in historical mode (never silently advances time
 * a Commander didn't ask to move). */
export function advanceHistoricalTerraTime(state: TerraTimeState, elapsedRealMs: number): TerraTimeState {
  if (state.mode !== 'historical' || !state.playing || elapsedRealMs <= 0) return state
  const advancedMs = elapsedRealMs * state.playbackRate
  const next = new Date(new Date(state.currentTime).getTime() + advancedMs).toISOString()
  return { ...state, currentTime: next }
}

/** Scrubbing (dragging the timeline, clicking a specific time) always enters/stays in historical
 * mode — even scrubbing to the current instant does not resume live tracking. Only
 * returnToLiveTerraTime does that, matching the mission's explicit LIVE/RETURN-TO-NOW distinction
 * from ordinary historical navigation. */
export function scrubTerraTime(state: TerraTimeState, isoTime: string): TerraTimeState {
  return { ...state, mode: 'historical', currentTime: isoTime }
}

export function returnToLiveTerraTime(nowIso: string): TerraTimeState {
  return createLiveTerraTimeState(nowIso)
}

export function playTerraTime(state: TerraTimeState): TerraTimeState {
  if (state.mode !== 'historical') return state
  return { ...state, playing: true }
}

export function pauseTerraTime(state: TerraTimeState): TerraTimeState {
  if (state.mode !== 'historical') return state
  return { ...state, playing: false }
}

export function setTerraPlaybackRate(state: TerraTimeState, rate: TerraPlaybackRate): TerraTimeState {
  return { ...state, playbackRate: rate }
}

/** Section 13's "data retrieval time vs display time" distinction, made structural: this reads
 * only `feature.timestamp` (observedAt-derived — see lib/terra/projectTerraIntelligenceEvent.ts)
 * and `feature.properties.expires` — never `feature.provenance.retrievedAt`. A feature fetched a
 * moment ago describing an old observation is filtered by how old the OBSERVATION is, not by how
 * fresh the HTTP response was.
 *
 * `window: null` (the default) preserves Phase 1-5's exact prior behavior: visible once it has
 * genuinely occurred (relative to `selectedTimeIso`), never visible if it's still in the future
 * relative to the selected viewpoint (the core "scheduled event does not masquerade as current
 * truth" guarantee) — this alone is not a new restriction on any existing layer, since every
 * Phase 1-5 event's real timestamp is always <= the moment it was actually fetched and shown.
 */
export function isTerraGeoFeatureVisibleAtTime(feature: TerraGeoFeature, selectedTimeIso: string, window: TerraTimeWindow): boolean {
  const referenceTime = feature.timestamp
  if (!referenceTime) return true // nothing to filter on — never hidden for lacking a timestamp

  const referenceMs = new Date(referenceTime).getTime()
  const selectedMs = new Date(selectedTimeIso).getTime()
  if (Number.isNaN(referenceMs) || Number.isNaN(selectedMs)) return true // malformed timestamp — never silently hidden

  const deltaMs = referenceMs - selectedMs

  if (deltaMs > 0) {
    // The event's own real timestamp is still in the future relative to the selected viewpoint.
    if (!window || window.lookaheadMs <= 0) return false
    return deltaMs <= window.lookaheadMs
  }

  if (window && window.lookbackMs > 0 && -deltaMs > window.lookbackMs) return false

  const expiresAt = typeof feature.properties.expires === 'string' ? feature.properties.expires : null
  if (expiresAt) {
    const expiresMs = new Date(expiresAt).getTime()
    // Expiration is evaluated against the SELECTED time, not real now — scrubbing back to before
    // a since-expired alert expired correctly shows it as active again for that viewpoint.
    if (!Number.isNaN(expiresMs) && expiresMs < selectedMs) return false
  }

  return true
}

export function filterTerraFeaturesByTime(features: TerraGeoFeature[], selectedTimeIso: string, window: TerraTimeWindow): TerraGeoFeature[] {
  return features.filter(feature => isTerraGeoFeatureVisibleAtTime(feature, selectedTimeIso, window))
}

export type TerraTimeWindowPreset = { id: string; label: string; window: TerraTimeWindow }

/** 'ALL' (null window) is the default/first entry — every existing layer keeps showing everything
 * it loads unless a Commander deliberately opts into a narrower window. */
export const TERRA_TIME_WINDOW_PRESETS: TerraTimeWindowPreset[] = [
  { id: 'all', label: 'ALL', window: null },
  { id: '1h', label: '1H', window: { lookbackMs: 3_600_000, lookaheadMs: 0 } },
  { id: '6h', label: '6H', window: { lookbackMs: 6 * 3_600_000, lookaheadMs: 0 } },
  { id: '24h', label: '24H', window: { lookbackMs: 24 * 3_600_000, lookaheadMs: 0 } },
  { id: '7d', label: '7D', window: { lookbackMs: 7 * 24 * 3_600_000, lookaheadMs: 0 } },
  { id: '30d', label: '30D', window: { lookbackMs: 30 * 24 * 3_600_000, lookaheadMs: 0 } },
]

/** Section 13: whether a layer's auto-refresh timer should run — false whenever Terra is not in
 * live mode, regardless of whether the layer's own on/off toggle is enabled. The initial load and
 * the manual "Refresh now" button are never gated by this — only the recurring timer is. */
export function shouldAutoRefreshTerraLayer(mode: TerraTimeState['mode']): boolean {
  return mode === 'live'
}

// --- Bounded semantic time-context event bus (section 15) ---

export type TerraTimeEventListener = (event: TerraTimeContextEvent) => void

export type TerraTimeEventBus = {
  subscribe: (listener: TerraTimeEventListener) => () => void
  emit: (event: TerraTimeContextEvent) => void
}

/** A plain in-memory pub-sub, local to one Terra session — not a persisted queue, not a
 * WebSocket, not wired to war_room_audit_logs (time navigation is transient Commander UI state,
 * the same "never persisted" treatment Phase 1's TerraClickPoint selection already established).
 * A future Council context bridge subscribes here; none does yet. */
export function createTerraTimeEventBus(): TerraTimeEventBus {
  const listeners = new Set<TerraTimeEventListener>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(event) {
      for (const listener of listeners) listener(event)
    },
  }
}
