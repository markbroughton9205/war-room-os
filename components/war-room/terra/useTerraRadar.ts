'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TerraDegreeRectangle } from '@/lib/terra/aircraftBoundingBox'
import {
  RADAR_ENABLED_STORAGE_KEY,
  RADAR_METADATA_CACHE_MS,
  radarFrameAgeLabel,
  resolveRadarViewState,
  type RadarCatalog,
  type RadarFrame,
} from '@/lib/terra/weather'
import {
  DEFAULT_COMMANDER_RADAR_OPACITY,
  HISTORICAL_UNAVAILABLE_LABEL,
  historicalWeatherAvailability,
  nearestMeasuredFrame,
  RADAR_HISTORICAL_MAX_SKEW_MS,
  RADAR_OPACITY_STORAGE_KEY,
} from '@/lib/terra/weather/atmosphere'

function readEnabled(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const raw = localStorage.getItem(RADAR_ENABLED_STORAGE_KEY)
    if (raw == null) return true
    return raw !== '0'
  } catch {
    return true
  }
}

function readCommanderOpacity(): number {
  if (typeof window === 'undefined') return DEFAULT_COMMANDER_RADAR_OPACITY
  try {
    const raw = localStorage.getItem(RADAR_OPACITY_STORAGE_KEY)
    if (raw == null) return DEFAULT_COMMANDER_RADAR_OPACITY
    const value = Number(raw)
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_COMMANDER_RADAR_OPACITY
  } catch {
    return DEFAULT_COMMANDER_RADAR_OPACITY
  }
}

function emptyCatalog(retrievedAt: string): RadarCatalog {
  return {
    provider: 'iem_mesonet',
    providerName: 'Iowa Environmental Mesonet / Iowa State University',
    product: 'USCOMP-N0Q',
    productLabel: 'CONUS NEXRAD mosaic N0Q (8-bit base reflectivity; IEM uses N0B source since 2022-04-18)',
    truthKind: 'MEASURED',
    attribution: 'Iowa Environmental Mesonet / Iowa State University. NEXRAD from NOAA/NWS. IEM materials are public domain; attribution appreciated. This is MEASURED reflectivity, not a forecast and not alert confirmation.',
    docsUrl: 'https://mesonet.agron.iastate.edu/ogc/',
    disclaimerUrl: 'https://mesonet.agron.iastate.edu/disclaimer.php',
    coverage: { west: -126, south: 23, east: -65, north: 50, basis: 'IEM n0q_0.wld + N0Q mosaic dimensions after 2014-08-08' },
    frames: [],
    latest: null,
    retrievedAt,
    generatedAt: null,
    fromCache: false,
    catalogState: 'UNAVAILABLE',
    error: null,
    radarQuorum: null,
  }
}

/**
 * Probe identity is coarse on purpose: panning inside a degree must not re-issue tile requests.
 * The key carries everything the request needs, so the effect can depend on the key alone.
 */
function radarEchoProbeRequest(view: TerraDegreeRectangle | null, stamp: string | null): { key: string } | null {
  if (!view || !stamp) return null
  const round = (value: number) => Math.round(value)
  return { key: `${stamp}:${round(view.west)},${round(view.south)},${round(view.east)},${round(view.north)}` }
}

function parseRadarEchoProbeKey(key: string): { query: string } | null {
  const [stamp, bbox] = key.split(':')
  const parts = bbox?.split(',') ?? []
  if (!stamp || parts.length !== 4) return null
  const [west, south, east, north] = parts
  if (!west || !south || !east || !north) return null
  return { query: new URLSearchParams({ stamp, west, south, east, north }).toString() }
}

export function useTerraRadar(input: {
  view: TerraDegreeRectangle | null
  nowIso: string
  timeMode: 'live' | 'historical'
  fetchAllowedRef?: { current: boolean }
  animateAllowedRef?: { current: boolean }
}): {
  catalog: RadarCatalog
  enabled: boolean
  selected: RadarFrame | null
  viewState: ReturnType<typeof resolveRadarViewState>
  frameAge: string
  echoFraction: number | null
  commanderOpacity: number
  playing: boolean
  canAnimate: boolean
  historicalUnavailable: boolean
  consecutiveFailures: number
  lastAttemptMs: number | null
  setEnabled: (value: boolean) => void
  setCommanderOpacity: (value: number) => void
  selectFrame: (stamp: string) => void
  selectLatest: () => void
  setPlaying: (value: boolean) => void
} {
  const [catalog, setCatalog] = useState<RadarCatalog>(() => emptyCatalog(input.nowIso))
  const [enabled, setEnabledState] = useState(readEnabled)
  const [commanderOpacity, setCommanderOpacityState] = useState(readCommanderOpacity)
  const [selectedStamp, setSelectedStamp] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [consecutiveFailures, setConsecutiveFailures] = useState(0)
  const [lastAttemptMs, setLastAttemptMs] = useState<number | null>(null)
  const consecutiveFailuresRef = useRef(0)
  const lastAttemptMsRef = useRef<number | null>(null)
  const followLatestRef = useRef(true)
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
  const canAnimate = !reducedMotion && input.timeMode === 'live'
  const fetchKey = input.timeMode === 'live' ? 'live' : input.nowIso.slice(0, 16)
  const query = useMemo(() => {
    if (input.timeMode === 'live') return 'mode=live'
    const params = new URLSearchParams({ time: input.nowIso, mode: 'historical' })
    return params.toString()
  }, [fetchKey, input.timeMode, input.nowIso])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (input.fetchAllowedRef && input.fetchAllowedRef.current === false) return
      const now = Date.now()
      if (consecutiveFailuresRef.current >= 3 && lastAttemptMsRef.current != null && now - lastAttemptMsRef.current < 30_000) return
      lastAttemptMsRef.current = now
      setLastAttemptMs(now)
      try {
        const response = await fetch(`/api/terra/weather/radar?${query}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(`radar metadata HTTP ${response.status}`)
        const payload = await response.json() as { catalog?: RadarCatalog }
        if (cancelled || !payload.catalog) return
        setConsecutiveFailures(0)
        consecutiveFailuresRef.current = 0
        setCatalog(payload.catalog)
        if (input.timeMode === 'historical') {
          const nearest = nearestMeasuredFrame(payload.catalog.frames, input.nowIso)
          followLatestRef.current = false
          setSelectedStamp(nearest?.frame.iemStamp ?? null)
          setPlaying(false)
          return
        }
        if (followLatestRef.current && payload.catalog.latest) {
          setSelectedStamp(payload.catalog.latest.iemStamp)
        }
      } catch (error) {
        if (cancelled) return
        setConsecutiveFailures(current => {
          const next = current + 1
          consecutiveFailuresRef.current = next
          return next
        })
        const message = error instanceof Error ? error.message : 'radar metadata failed'
        setCatalog(current => current.latest && input.timeMode === 'live'
          ? { ...current, catalogState: 'STALE', error: message }
          : { ...emptyCatalog(new Date().toISOString()), catalogState: 'ERROR_UPSTREAM', error: message })
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, input.timeMode === 'live' ? RADAR_METADATA_CACHE_MS : 120_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [query, input.timeMode])

  const historicalUnavailable = input.timeMode === 'historical'
    && historicalWeatherAvailability({
      timeMode: 'historical',
      terraTime: input.nowIso,
      frames: catalog.frames,
      maxSkewMs: RADAR_HISTORICAL_MAX_SKEW_MS,
    }) === 'UNAVAILABLE_FOR_SELECTED_TIME'

  const selected = useMemo(() => {
    if (historicalUnavailable) return null
    if (!selectedStamp) return catalog.latest
    return catalog.frames.find(frame => frame.iemStamp === selectedStamp) ?? catalog.latest
  }, [catalog, selectedStamp, historicalUnavailable])

  const viewState = useMemo(() => {
    if (historicalUnavailable) {
      return {
        state: 'UNAVAILABLE' as const,
        frame: null,
        showLayer: false,
        label: HISTORICAL_UNAVAILABLE_LABEL,
      }
    }
    return resolveRadarViewState({
      catalog: {
        catalogState: catalog.catalogState,
        frames: catalog.frames,
        latest: selected ?? catalog.latest,
      },
      view: input.view,
      nowIso: input.nowIso,
      enabled,
    })
  }, [catalog, selected, input.view, input.nowIso, enabled, historicalUnavailable])

  const frameAge = historicalUnavailable
    ? HISTORICAL_UNAVAILABLE_LABEL
    : radarFrameAgeLabel(viewState.frame?.timestampIso ?? null, input.nowIso)

  /**
   * Measuring the mosaic is what lets Terra say NO_PRECIP instead of assuming it. The probe only
   * runs when radar is actually on screen, and only once per frame-and-coarse-view pair.
   */
  const probeRequest = useMemo(
    () => radarEchoProbeRequest(input.view, viewState.showLayer ? viewState.frame?.iemStamp ?? null : null),
    [input.view, viewState.showLayer, viewState.frame?.iemStamp],
  )
  const probeKey = probeRequest?.key ?? null
  const [echoProbe, setEchoProbe] = useState<{ key: string; fraction: number | null } | null>(null)
  useEffect(() => {
    if (!probeKey) return
    if (input.fetchAllowedRef?.current === false) return
    const request = parseRadarEchoProbeKey(probeKey)
    if (!request) return
    const controller = new AbortController()
    let cancelled = false
    const probe = async () => {
      try {
        const response = await fetch(`/api/terra/weather/radar/echo?${request.query}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`radar echo HTTP ${response.status}`)
        const payload = await response.json() as { probe?: { echoFraction?: number | null } }
        if (cancelled) return
        const value = payload.probe?.echoFraction
        setEchoProbe({ key: probeKey, fraction: typeof value === 'number' && Number.isFinite(value) ? value : null })
      } catch {
        if (!cancelled) setEchoProbe({ key: probeKey, fraction: null })
      }
    }
    void probe()
    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- probeKey encodes the frame and rounded view the probe is for; widening deps would re-issue tile requests on every pan.
  }, [probeKey])

  /** A result only counts for the frame and view it was measured against. */
  const echoFraction = echoProbe && probeKey && echoProbe.key === probeKey ? echoProbe.fraction : null

  useEffect(() => {
    if (!playing || !canAnimate || catalog.frames.length < 2) return
    if (input.animateAllowedRef && input.animateAllowedRef.current === false) return
    const timer = window.setInterval(() => {
      setSelectedStamp(current => {
        const stamps = catalog.frames.map(frame => frame.iemStamp)
        const index = current ? stamps.indexOf(current) : stamps.length - 1
        const next = stamps[(index + 1) % stamps.length]
        followLatestRef.current = next === stamps[stamps.length - 1]
        return next ?? current
      })
    }, 800)
    return () => window.clearInterval(timer)
  }, [playing, canAnimate, catalog.frames])

  useEffect(() => {
    if (!canAnimate && playing) setPlaying(false)
  }, [canAnimate, playing])

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value)
    try {
      localStorage.setItem(RADAR_ENABLED_STORAGE_KEY, value ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const setCommanderOpacity = useCallback((value: number) => {
    const next = Math.min(1, Math.max(0, value))
    setCommanderOpacityState(next)
    try {
      localStorage.setItem(RADAR_OPACITY_STORAGE_KEY, String(next))
    } catch {
      /* ignore */
    }
  }, [])

  const selectFrame = useCallback((stamp: string) => {
    followLatestRef.current = catalog.latest?.iemStamp === stamp
    setSelectedStamp(stamp)
    setPlaying(false)
  }, [catalog.latest])

  const selectLatest = useCallback(() => {
    followLatestRef.current = true
    setSelectedStamp(catalog.latest?.iemStamp ?? null)
    setPlaying(false)
  }, [catalog.latest])

  return {
    catalog,
    enabled,
    selected: viewState.frame,
    viewState,
    frameAge,
    echoFraction,
    commanderOpacity,
    playing: playing && canAnimate,
    canAnimate,
    historicalUnavailable,
    consecutiveFailures,
    lastAttemptMs,
    setEnabled,
    setCommanderOpacity,
    selectFrame,
    selectLatest,
    setPlaying,
  }
}
