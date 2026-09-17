'use client'

import { useEffect } from 'react'

import {
  consumeMediaIntelHandoff,
  MEDIA_INTEL_EVENT,
  type MediaIntelContext,
} from '@/lib/media/intelContext'
import type { TerraLocationCommandHandler } from './TerraLocationCommandInput'
import type { TerraLocationResolution } from '@/lib/terra/locationCommand'

/**
 * Applies Media GO TO INTEL regional handoff to existing Terra search navigation.
 * Resolves a publisher/station region query. Does not invent event coordinates.
 */
export function TerraMediaIntelHandoff({
  onResolvedLocation,
}: {
  onResolvedLocation: TerraLocationCommandHandler
}) {
  useEffect(() => {
    let cancelled = false

    async function apply(context: MediaIntelContext | null) {
      if (!context?.query || cancelled) return
      try {
        const response = await fetch(`/api/terra/resolve-location?q=${encodeURIComponent(context.query)}`, {
          cache: 'no-store',
          credentials: 'include',
        })
        const result = await response.json() as TerraLocationResolution
        if (cancelled || result.status !== 'resolved') return
        onResolvedLocation({
          ...result.target,
          instantRequested: false,
          query: context.query,
        })
      } catch {
        return
      }
    }

    void apply(consumeMediaIntelHandoff())

    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<MediaIntelContext>).detail
      void apply(detail ?? consumeMediaIntelHandoff())
    }
    window.addEventListener(MEDIA_INTEL_EVENT, onEvent)
    return () => {
      cancelled = true
      window.removeEventListener(MEDIA_INTEL_EVENT, onEvent)
    }
  }, [onResolvedLocation])

  return null
}
