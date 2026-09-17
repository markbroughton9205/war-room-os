'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TerraLiveIntelSnapshot } from '@/lib/terra/liveGeoIntelligence'

export function useTerraLiveIntel(opts: {
  bbox: string | null
  enabled: boolean
  refreshMs?: number
  latitude?: number | null
  longitude?: number | null
  place?: string | null
  nativePlaceName?: string | null
  englishPlaceName?: string | null
  city?: string | null
  county?: string | null
  state?: string | null
  country?: string | null
  countryCode?: string | null
  reversePlace?: string | null
  zoom?: string | null
}): {
  snapshot: TerraLiveIntelSnapshot | null
  error: string | null
  authRequired: boolean
  pending: boolean
  refresh: () => void
} {
  const [snapshot, setSnapshot] = useState<TerraLiveIntelSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState(false)
  const [pending, setPending] = useState(Boolean(opts.enabled))
  const requestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const refreshMs = opts.refreshMs ?? 120_000
  const bbox = opts.bbox
  const latitude = opts.latitude
  const longitude = opts.longitude
  const place = opts.place
  const nativePlaceName = opts.nativePlaceName
  const englishPlaceName = opts.englishPlaceName
  const city = opts.city
  const county = opts.county
  const state = opts.state
  const country = opts.country
  const countryCode = opts.countryCode
  const reversePlace = opts.reversePlace
  const zoom = opts.zoom
  const enabled = opts.enabled

  const load = useCallback(() => {
    if (!enabled) {
      setPending(false)
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const id = requestIdRef.current + 1
    requestIdRef.current = id
    setPending(true)
    const params = new URLSearchParams({ layers: 'vessels,intelligence_events,other' })
    if (bbox) params.set('bbox', bbox)
    if (typeof latitude === 'number' && Number.isFinite(latitude)) params.set('lat', String(latitude))
    if (typeof longitude === 'number' && Number.isFinite(longitude)) params.set('lon', String(longitude))
    if (place?.trim()) params.set('place', place.trim())
    if (nativePlaceName?.trim()) params.set('nativePlace', nativePlaceName.trim())
    if (englishPlaceName?.trim()) params.set('englishPlace', englishPlaceName.trim())
    if (city?.trim()) params.set('city', city.trim())
    if (county?.trim()) params.set('county', county.trim())
    if (state?.trim()) params.set('state', state.trim())
    if (country?.trim()) params.set('country', country.trim())
    if (countryCode?.trim()) params.set('countryCode', countryCode.trim())
    if (reversePlace?.trim()) params.set('reversePlace', reversePlace.trim())
    if (zoom?.trim()) params.set('zoom', zoom.trim())
    const fetchImpl = typeof window !== 'undefined' ? window.fetch.bind(window) : fetch
    void fetchImpl(`/api/terra/live-intel?${params.toString()}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async response => {
        if (id !== requestIdRef.current) return
        if (response.status === 401 || response.status === 503) {
          setAuthRequired(true)
          setError(null)
          setPending(false)
          return
        }
        if (!response.ok) {
          setError(`live-intel HTTP ${response.status}`)
          setPending(false)
          return
        }
        const payload = await response.json() as TerraLiveIntelSnapshot & { error?: string; authState?: string }
        if (id !== requestIdRef.current) return
        if (!payload?.providers) {
          setError('live-intel response missing providers')
          setPending(false)
          return
        }
        setAuthRequired(payload.authState === 'AUTH_REQUIRED')
        setError(null)
        setSnapshot(payload)
        setPending(false)
      })
      .catch(err => {
        if (controller.signal.aborted) return
        if (id !== requestIdRef.current) return
        setError(err instanceof Error ? err.message : String(err))
        setPending(false)
      })
  }, [enabled, bbox, latitude, longitude, place, nativePlaceName, englishPlaceName, city, county, state, country, countryCode, reversePlace, zoom])

  useLayoutEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!enabled) return undefined
    const timer = window.setInterval(load, refreshMs)
    return () => {
      window.clearInterval(timer)
    }
  }, [load, enabled, refreshMs])

  return { snapshot, error, authRequired, pending, refresh: load }
}
