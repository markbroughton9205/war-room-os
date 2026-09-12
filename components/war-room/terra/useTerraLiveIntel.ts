'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TerraLiveIntelSnapshot } from '@/lib/terra/liveGeoIntelligence'

export function useTerraLiveIntel(opts: {
  bbox: string | null
  enabled: boolean
  refreshMs?: number
}): {
  snapshot: TerraLiveIntelSnapshot | null
  error: string | null
  refresh: () => void
} {
  const [snapshot, setSnapshot] = useState<TerraLiveIntelSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const refreshMs = opts.refreshMs ?? 60_000

  const load = useCallback(() => {
    if (!opts.enabled) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const id = requestIdRef.current + 1
    requestIdRef.current = id
    const params = new URLSearchParams({ layers: 'vessels' })
    if (opts.bbox) params.set('bbox', opts.bbox)
    void fetch(`/api/terra/live-intel?${params.toString()}`, {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async response => {
        if (id !== requestIdRef.current) return
        if (!response.ok) {
          setError(`live-intel HTTP ${response.status}`)
          return
        }
        const payload = await response.json() as TerraLiveIntelSnapshot & { error?: string }
        if (id !== requestIdRef.current) return
        if (!payload?.providers) {
          setError('live-intel response missing providers')
          return
        }
        setError(null)
        setSnapshot(payload)
      })
      .catch(err => {
        if (controller.signal.aborted) return
        if (id !== requestIdRef.current) return
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [opts.enabled, opts.bbox])

  useEffect(() => {
    load()
    if (!opts.enabled) return undefined
    const timer = window.setInterval(load, refreshMs)
    return () => {
      window.clearInterval(timer)
      abortRef.current?.abort()
    }
  }, [load, opts.enabled, refreshMs])

  return { snapshot, error, refresh: load }
}
