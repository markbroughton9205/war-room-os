'use client'

/**
 * Client-side data hook for Terra's earthquake layer. Talks only to
 * /api/terra/earthquakes (this app's own Next.js API route) — never to earthquake.usgs.gov
 * directly, and never re-implements what lib/research-engine/providers/usgsEarthquakeFeed.ts
 * already does server-side.
 *
 * State is deliberately honest: a failed refresh never clears previously-displayed data (no
 * flicker to empty) but is reported as 'stale', never silently re-labeled 'live'. A failed first
 * load with nothing to fall back on is reported as 'error', never as fabricated demo markers.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TerraGeoFeature } from '@/lib/terra/types'

export type TerraEarthquakeFeedState = 'loading' | 'live' | 'empty' | 'error' | 'stale'

export type TerraEarthquakeFeedResult = {
  state: TerraEarthquakeFeedState
  features: TerraGeoFeature[]
  skippedCount: number
  lastFetchedAt: string | null
  lastErrorMessage: string | null
  refresh: () => void
}

// Conservative — well above the Research Engine's own 60s live-feed cache TTL for this provider
// (lib/research-engine/cache/ttlCache.ts CACHE_TTL.liveFeed), so an automatic refresh is very
// unlikely to ever force a real upstream USGS call; it mostly re-reads the existing server cache.
// A plain interval timer, cleared on unmount — no background job/worker/queue introduced.
const AUTO_REFRESH_MS = 120_000

type ApiResponse = {
  status: 'success' | 'empty' | 'error'
  features: TerraGeoFeature[]
  skippedCount: number
  fetchedAt: string
  fromCache: boolean
  error: { message: string } | null
}

export function useTerraEarthquakeFeed(enabled: boolean): TerraEarthquakeFeedResult {
  const [state, setState] = useState<TerraEarthquakeFeedState>('loading')
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
      const res = await fetch('/api/terra/earthquakes', { cache: 'no-store' })
      if (requestId !== requestIdRef.current) return // superseded by a later request
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body: ApiResponse = await res.json()
      hasLoadedOnceRef.current = true
      if (body.status === 'error') {
        setLastErrorMessage(body.error?.message ?? 'Earthquake feed request failed.')
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
      console.error('[terra] earthquake feed request failed', error)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    // Deferred a tick rather than called synchronously in the effect body — `load` sets state
    // (the initial 'loading' status) before its first await, and this repo's lint rules treat a
    // synchronous setState-from-effect as a cascading-render risk. A zero-delay timeout is the
    // standard escape hatch: identical behavior, no synchronous setState during the commit phase.
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
