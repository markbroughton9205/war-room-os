'use client'

import { useEffect, useRef, useState } from 'react'
import { mapillaryHostedConfigured } from '@/lib/terra/godsEye/streetImagery'

type MapillaryViewportState = 'AUTH_REQUIRED' | 'LOADING' | 'LIVE' | 'NO_COVERAGE' | 'UNAVAILABLE'

export function TerraMapillaryViewport({
  latitude,
  longitude,
}: {
  latitude: number | null
  longitude: number | null
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<MapillaryViewportState>(() => (
    mapillaryHostedConfigured(process.env.NEXT_PUBLIC_MAPILLARY_ACCESS_TOKEN) ? 'LOADING' : 'AUTH_REQUIRED'
  ))

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPILLARY_ACCESS_TOKEN?.trim() || ''
    if (!mapillaryHostedConfigured(token)) {
      setState('AUTH_REQUIRED')
      return
    }
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    let viewer: { remove?: () => void } | null = null

    async function mount() {
      setState('LOADING')
      try {
        const mapillary = await import('mapillary-js')
        await import('mapillary-js/dist/mapillary.css')
        if (cancelled || !container) return
        viewer = new mapillary.Viewer({
          accessToken: token,
          container,
          component: { cover: false },
        })
        if (latitude === null || longitude === null) {
          if (!cancelled) setState('NO_COVERAGE')
          return
        }
        const nearby = await fetch(
          `https://graph.mapillary.com/images?fields=id&closeto=${longitude},${latitude}&limit=1`,
          { headers: { Authorization: `OAuth ${token}` } },
        )
        if (cancelled) return
        if (nearby.status === 401 || nearby.status === 403) {
          setState('AUTH_REQUIRED')
          return
        }
        if (!nearby.ok) {
          setState('UNAVAILABLE')
          return
        }
        const body = await nearby.json() as { data?: Array<{ id?: string }> }
        const imageId = body.data?.[0]?.id
        if (!imageId) {
          setState('NO_COVERAGE')
          return
        }
        await (viewer as { moveTo: (id: string) => Promise<unknown> }).moveTo(imageId)
        if (!cancelled) setState('LIVE')
      } catch {
        if (!cancelled) setState('UNAVAILABLE')
      }
    }
    void mount()
    return () => {
      cancelled = true
      try { viewer?.remove?.() } catch { /* viewer teardown */ }
    }
  }, [latitude, longitude])

  return (
    <div className="relative h-28 overflow-hidden rounded border border-dashed border-cyan-400/20 bg-slate-950/60" data-testid="mapillary-viewport" data-mapillary-state={state}>
      <div ref={containerRef} className="absolute inset-0" />
      {state !== 'LIVE' ? (
        <p className="absolute inset-0 grid place-items-center px-3 text-center text-[10px] leading-snug text-slate-500">
          {state === 'AUTH_REQUIRED'
            ? 'MAPILLARY HOSTED · AUTH_REQUIRED — set NEXT_PUBLIC_MAPILLARY_ACCESS_TOKEN. Token is never shown here. STREAM_ONLY.'
            : state === 'LOADING'
              ? 'MAPILLARYJS loading…'
              : state === 'NO_COVERAGE'
                ? 'MAPILLARY HOSTED · NO_COVERAGE at this coordinate. Cesium stays the globe.'
                : 'MAPILLARY HOSTED · UNAVAILABLE — provider error. Cesium stays the globe.'}
        </p>
      ) : null}
    </div>
  )
}
