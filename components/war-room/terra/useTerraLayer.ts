'use client'

/**
 * Terra's generic client-side layer data hook (Phase 3) — replaces the Phase 1/2
 * useTerraEarthquakeFeed.ts, which was hardwired to one layer. Talks only to
 * /api/terra/layers/{layerId} (this app's own Next.js API route) — never to any upstream provider
 * host directly — parameterized by layerId so every catalog entry in lib/terra/layerCatalog.ts
 * shares this one hook instead of each layer getting its own copy-pasted fetch hook.
 *
 * State machine and stale-vs-error semantics are unchanged from Phase 1/2: a failed refresh never
 * clears previously-displayed data (no flicker to empty) but is reported as 'stale', never
 * silently re-labeled 'live'; a failed first load with nothing to fall back on is 'error', never
 * fabricated demo markers.
 */
import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import type { TerraGeoFeature } from '@/lib/terra/types'
import { bridgeTerraFeedState } from '@/lib/ui/runtimeEventBridge'

export type TerraLayerFeedState = 'loading' | 'live' | 'empty' | 'error' | 'stale'

export type TerraLayerFeedResult = {
  state: TerraLayerFeedState
  features: TerraGeoFeature[]
  skippedCount: number
  lastFetchedAt: string | null
  lastErrorMessage: string | null
  refresh: () => void
}

// The Phase 1-4 default, still used by every layer that doesn't declare its own
// refreshIntervalMs — well above the Research Engine's own live-feed cache TTL
// (lib/research-engine/cache/ttlCache.ts CACHE_TTL.liveFeed=60s), so an automatic refresh is very
// unlikely to ever force a real upstream call; it mostly re-reads the existing server cache. A
// plain interval timer, cleared on unmount — no background job/worker/queue introduced. Phase 5
// lets a layer override this (lib/terra/layerCatalogSummary.ts's refreshIntervalMs) for a
// source-appropriate cadence rather than one fixed rate for every hazard feed.
const DEFAULT_AUTO_REFRESH_MS = 120_000

type ApiResponse = {
  status: 'success' | 'empty' | 'error'
  features: TerraGeoFeature[]
  skippedCount: number
  fetchedAt: string
  fromCache: boolean
  error: { message: string } | null
}

export function useTerraLayer(
  layerId: string,
  enabled: boolean,
  refreshIntervalMs: number = DEFAULT_AUTO_REFRESH_MS,
  // Phase 6, mission section 13: the recurring auto-refresh timer only — never the initial load
  // (a layer still shows data once toggled on in historical mode) and never the manual
  // `refresh()` action below. True (the default) preserves every pre-Phase-6 layer's exact prior
  // behavior for a caller that hasn't been updated to pass Terra's live/historical mode through.
  autoRefreshAllowed: boolean = true,
  // God's Eye multi-scale phase: `undefined` (every pre-existing call site) means "use the
  // catalog's own defaultQueryText," exactly as before. `null` means "enabled, but no real bounded
  // query exists yet" (e.g. no active location) — fetch is skipped, not sent with an empty q=.
  // A real string overrides defaultQueryText via the route's existing `?q=` support and refetches
  // whenever it changes, e.g. TerraShell recomputing "category:landmark near <lat>,<lon>,<r>" as
  // the Commander's active location or camera scale changes.
  queryOverride?: string | null,
): TerraLayerFeedResult {
  const [state, setState] = useState<TerraLayerFeedState>('loading')
  const [features, setFeatures] = useState<TerraGeoFeature[]>([])
  const [skippedCount, setSkippedCount] = useState(0)
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null)
  const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null)
  const hasLoadedOnceRef = useRef(false)
  const requestIdRef = useRef(0)
  // In-flight request cancellation: a superseded requery (queryOverride change, manual refresh)
  // or an unmount aborts the previous fetch outright instead of letting it run to completion and
  // only then discarding the result — real network/request savings on rapid camera pans, not just
  // stale-write protection (which requestIdRef below still provides).
  const abortRef = useRef<AbortController | null>(null)
  // Tracks the latest feature count outside React state so the failure branch below can decide
  // stale-vs-error without making `load` depend on `features` (which would recreate it — and the
  // auto-refresh interval that depends on it — every time the feed updates).
  const featureCountRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    // Matrix runtime bridge (lib/ui/runtimeEventBridge.ts): every feed-state transition is
    // surfaced to the Matrix palette channel bus, not just rendered in TerraShell's own chrome.
    // Every setState below is wrapped in startTransition: this hook is instantiated once per Terra
    // layer (a dozen-plus on the God's Eye command center), so a burst of feeds all resolving
    // around the same moment — the common case right after the globe mounts — must never compete,
    // as high-priority synchronous updates, with whatever the Commander is doing in the Council
    // composer at that exact moment.
    const transition = (next: TerraLayerFeedState) => {
      startTransition(() => setState(next))
      bridgeTerraFeedState(layerId, next)
    }
    if (!hasLoadedOnceRef.current) transition('loading')
    try {
      const qs = queryOverride ? `?q=${encodeURIComponent(queryOverride)}` : ''
      const res = await fetch(`/api/terra/layers/${encodeURIComponent(layerId)}${qs}`, { cache: 'no-store', signal: controller.signal })
      if (requestId !== requestIdRef.current) return // superseded by a later request
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body: ApiResponse = await res.json()
      hasLoadedOnceRef.current = true
      if (body.status === 'error') {
        setLastErrorMessage(body.error?.message ?? `Layer "${layerId}" request failed.`)
        transition(featureCountRef.current > 0 ? 'stale' : 'error')
        return
      }
      featureCountRef.current = body.features.length
      startTransition(() => {
        setFeatures(body.features)
        setSkippedCount(body.skippedCount)
        setLastFetchedAt(body.fetchedAt)
        setLastErrorMessage(null)
      })
      transition(body.features.length === 0 ? 'empty' : 'live')
    } catch (error) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return
      hasLoadedOnceRef.current = true
      startTransition(() => setLastErrorMessage(error instanceof Error ? error.message : String(error)))
      transition(featureCountRef.current > 0 ? 'stale' : 'error')
      console.error(`[terra] layer "${layerId}" request failed`, error)
    }
  }, [layerId, queryOverride])

  useEffect(() => {
    if (!enabled || queryOverride === null) return
    // Deferred a tick rather than called synchronously in the effect body — see useTerraLayer's
    // Phase 1 predecessor for the same fix: `load` sets state (the initial 'loading' status)
    // before its first await, and this repo's lint rules treat a synchronous setState-from-effect
    // as a cascading-render risk. A zero-delay timeout is the standard escape hatch.
    const kickoff = setTimeout(() => void load(), 0)
    const interval = autoRefreshAllowed ? setInterval(() => void load(), refreshIntervalMs) : null
    return () => {
      clearTimeout(kickoff)
      if (interval !== null) clearInterval(interval)
      abortRef.current?.abort()
    }
  }, [enabled, load, refreshIntervalMs, autoRefreshAllowed, queryOverride])

  return {
    state: enabled ? state : 'empty',
    features: enabled ? features : [],
    skippedCount,
    lastFetchedAt,
    lastErrorMessage,
    refresh: () => void load(),
  }
}
