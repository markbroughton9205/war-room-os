'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TerraDegreeRectangle } from '@/lib/terra/aircraftBoundingBox'
import {
  DEFAULT_RADAR_OPACITY,
  RADAR_ENABLED_STORAGE_KEY,
  RADAR_METADATA_CACHE_MS,
  radarFrameAgeLabel,
  resolveRadarViewState,
  type RadarCatalog,
  type RadarFrame,
} from '@/lib/terra/weather'
import type { TerraScaleLevel } from './useTerraCameraScale'

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
  }
}

export function useTerraRadar(input: {
  view: TerraDegreeRectangle | null
  nowIso: string
  scaleLevel: TerraScaleLevel
}): {
  catalog: RadarCatalog
  enabled: boolean
  selected: RadarFrame | null
  viewState: ReturnType<typeof resolveRadarViewState>
  frameAge: string
  opacity: number
  playing: boolean
  canAnimate: boolean
  setEnabled: (value: boolean) => void
  selectFrame: (stamp: string) => void
  selectLatest: () => void
  setPlaying: (value: boolean) => void
} {
  const [catalog, setCatalog] = useState<RadarCatalog>(() => emptyCatalog(input.nowIso))
  const [enabled, setEnabledState] = useState(readEnabled)
  const [selectedStamp, setSelectedStamp] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const followLatestRef = useRef(true)
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
  const canAnimate = !reducedMotion && input.scaleLevel !== 'global'

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch('/api/terra/weather/radar', { cache: 'no-store' })
        if (!response.ok) throw new Error(`radar metadata HTTP ${response.status}`)
        const payload = await response.json() as { catalog?: RadarCatalog }
        if (cancelled || !payload.catalog) return
        setCatalog(payload.catalog)
        if (followLatestRef.current && payload.catalog.latest) {
          setSelectedStamp(payload.catalog.latest.iemStamp)
        }
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'radar metadata failed'
        setCatalog(current => current.latest
          ? { ...current, catalogState: 'STALE', error: message }
          : { ...emptyCatalog(new Date().toISOString()), catalogState: 'ERROR_UPSTREAM', error: message })
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, RADAR_METADATA_CACHE_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const selected = useMemo(() => {
    if (!selectedStamp) return catalog.latest
    return catalog.frames.find(frame => frame.iemStamp === selectedStamp) ?? catalog.latest
  }, [catalog, selectedStamp])

  const viewState = useMemo(() => resolveRadarViewState({
    catalog: {
      catalogState: catalog.catalogState,
      frames: catalog.frames,
      latest: selected ?? catalog.latest,
    },
    view: input.view,
    nowIso: input.nowIso,
    enabled,
  }), [catalog, selected, input.view, input.nowIso, enabled])

  const frameAge = radarFrameAgeLabel(viewState.frame?.timestampIso ?? null, input.nowIso)

  useEffect(() => {
    if (!playing || !canAnimate || catalog.frames.length < 2) return
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
    opacity: DEFAULT_RADAR_OPACITY,
    playing: playing && canAnimate,
    canAnimate,
    setEnabled,
    selectFrame,
    selectLatest,
    setPlaying,
  }
}
