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
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TerraGeoFeature } from '@/lib/terra/types'

export type TerraLayerFeedState = 'loading' | 'live' | 'empty' | 'error' | 'stale'

export type TerraLayerFeedResult = {
  state: TerraLayerFeedState
  features: TerraGeoFeature[]
  skippedCount: number
  lastFetchedAt: string | null
  lastErrorMessage: string | null
  refresh: () => void
}

// Conservative — well above the Research Engine's own live-feed cache TTL (lib/research-engine/
// cache/ttlCache.ts CACHE_TTL.liveFeed=60s), so an automatic refresh is very unlikely to ever
// force a real upstream call; it mostly re-reads the existing server cache. A plain interval
// timer, cleared on unmount — no background job/worker/queue introduced.
const AUTO_REFRESH_MS = 120_000

type ApiResponse = {
  status: 'success' | 'empty' | 'error'
  features: TerraGeoFeature[]
  skippedCount: number
  fetchedAt: string
  fromCache: boolean
  error: { message: string } | null
}

export function useTerraLayer(layerId: string, enabled: boolean): TerraLayerFeedResult {
  const [state, setState] = useState<TerraLayerFeedState>('loading')
  const [features, setFeatures] = useState<TerraGeoFeature[]>([])
  const [skippedCount, setSkippedCount] = useState(0)
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null)
  const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null)
  const hasLoadedOnceRef = useRef(false)
  const requestIdRef = useRef(0)
  // Tracks the latest feature count outside React state so the failure branch below can decide
  // stale-vs-error without making `load` depend on `features` (which would recreate it — and the
  // auto-refresh interval that depends on it — every time the feed updates).
  const featureCountRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    if (!hasLoadedOnceRef.current) setState('loading')
    try {
      const res = await fetch(`/api/terra/layers/${encodeURIComponent(layerId)}`, { cache: 'no-store' })
      if (requestId !== requestIdRef.current) return // superseded by a later request
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body: ApiResponse = await res.json()
      hasLoadedOnceRef.current = true
      if (body.status === 'error') {
        setLastErrorMessage(body.error?.message ?? `Layer "${layerId}" request failed.`)
        setState(featureCountRef.current > 0 ? 'stale' : 'error')
        return
      }
      featureCountRef.current = body.features.length
      setFeatures(body.features)
      setSkippedCount(body.skippedCount)
      setLastFetchedAt(body.fetchedAt)
      setLastErrorMessage(null)
      setState(body.features.length === 0 ? 'empty' : 'live')
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      hasLoadedOnceRef.current = true
      setLastErrorMessage(error instanceof Error ? error.message : String(error))
      setState(featureCountRef.current > 0 ? 'stale' : 'error')
      console.error(`[terra] layer "${layerId}" request failed`, error)
    }
  }, [layerId])

  useEffect(() => {
    if (!enabled) return
    // Deferred a tick rather than called synchronously in the effect body — see useTerraLayer's
    // Phase 1 predecessor for the same fix: `load` sets state (the initial 'loading' status)
    // before its first await, and this repo's lint rules treat a synchronous setState-from-effect
    // as a cascading-render risk. A zero-delay timeout is the standard escape hatch.
    const kickoff = setTimeout(() => void load(), 0)
    const interval = setInterval(() => void load(), AUTO_REFRESH_MS)
    return () => {
      clearTimeout(kickoff)
      clearInterval(interval)
    }
  }, [enabled, load])

  return {
    state: enabled ? state : 'empty',
    features: enabled ? features : [],
    skippedCount,
    lastFetchedAt,
    lastErrorMessage,
    refresh: () => void load(),
  }
}
