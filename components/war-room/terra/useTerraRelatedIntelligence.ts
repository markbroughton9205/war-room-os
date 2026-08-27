'use client'

/**
 * Terra event "Related Intelligence" fetch — talks only to this app's own
 * /api/terra/event-intelligence route (never a provider host directly), which is a thin wrapper
 * around the existing Research Engine's executeResearch(). Mirrors TerraShell's activateCoordinate
 * stale-response guard exactly (AbortController + monotonic sequence, via
 * lib/terra/requestSequence.ts's isTerraRequestStale) so selecting a second event before the
 * first's request completes can never let the first event's results overwrite the second's.
 *
 * `query: null` (no event selected, or a ground click) skips the fetch entirely — never sent with
 * an empty q= — matching useTerraLayer.ts's identical `queryOverride === null` convention.
 */
import { useEffect, useRef, useState } from 'react'
import type { TerraRelatedIntelligenceProviderStatus, TerraRelatedIntelligenceResult } from '@/lib/terra/relatedIntelligence'
import { isTerraRequestStale } from '@/lib/terra/requestSequence'

export type TerraRelatedIntelligenceState = 'idle' | 'loading' | 'live' | 'empty' | 'error'

export type TerraRelatedIntelligenceFeed = {
  state: TerraRelatedIntelligenceState
  results: TerraRelatedIntelligenceResult[]
  providerStatuses: TerraRelatedIntelligenceProviderStatus[]
  videoProviderMessage: string | null
  lastErrorMessage: string | null
}

type ApiResponse = {
  status: 'success' | 'empty' | 'error'
  results: TerraRelatedIntelligenceResult[]
  providerStatuses: TerraRelatedIntelligenceProviderStatus[]
  videoProviderMessage: string
  error: { message: string } | null
}

const IDLE_FEED: TerraRelatedIntelligenceFeed = { state: 'idle', results: [], providerStatuses: [], videoProviderMessage: null, lastErrorMessage: null }

export function useTerraRelatedIntelligence(query: string | null): TerraRelatedIntelligenceFeed {
  const [feed, setFeed] = useState<TerraRelatedIntelligenceFeed>(IDLE_FEED)
  const requestRef = useRef<{ sequence: number; controller: AbortController | null }>({ sequence: 0, controller: null })

  useEffect(() => () => requestRef.current.controller?.abort(), [])

  useEffect(() => {
    requestRef.current.controller?.abort()

    if (query === null) {
      requestRef.current = { sequence: requestRef.current.sequence + 1, controller: null }
      // Deferred a tick — this repo's react-hooks/set-state-in-effect lint rule flags a
      // synchronous setState call reachable by direct static analysis from an effect body; the
      // same zero-delay-timeout escape hatch useTerraLayer.ts's kickoff already uses.
      const timeout = setTimeout(() => setFeed(IDLE_FEED), 0)
      return () => clearTimeout(timeout)
    }

    const controller = new AbortController()
    const sequence = requestRef.current.sequence + 1
    requestRef.current = { sequence, controller }
    const kickoff = setTimeout(() => setFeed(prev => ({ ...prev, state: 'loading' })), 0)

    void fetch(`/api/terra/event-intelligence?q=${encodeURIComponent(query)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Related intelligence request failed with HTTP ${response.status}.`)
        return response.json() as Promise<ApiResponse>
      })
      .then(body => {
        if (isTerraRequestStale(sequence, requestRef.current.sequence)) return
        if (body.status === 'error') {
          setFeed({ state: 'error', results: [], providerStatuses: body.providerStatuses, videoProviderMessage: body.videoProviderMessage, lastErrorMessage: body.error?.message ?? 'Related intelligence request failed.' })
          return
        }
        setFeed({ state: body.results.length === 0 ? 'empty' : 'live', results: body.results, providerStatuses: body.providerStatuses, videoProviderMessage: body.videoProviderMessage, lastErrorMessage: null })
      })
      .catch(error => {
        if (controller.signal.aborted || isTerraRequestStale(sequence, requestRef.current.sequence)) return
        setFeed({ state: 'error', results: [], providerStatuses: [], videoProviderMessage: null, lastErrorMessage: error instanceof Error ? error.message : String(error) })
      })

    return () => clearTimeout(kickoff)
  }, [query])

  return feed
}
