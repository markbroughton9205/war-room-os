'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  TERRA_CLOUD_DISPLAY_INTERVAL_MS,
  type EarthPulseAuroraCell,
  type EarthPulseCloudCatalog,
  type EarthPulseEngineState,
  type EarthPulseLightningFlash,
  type NightLightsCatalog,
} from '@/lib/terra/earthPulse'
import { nearestMeasuredFrame } from '@/lib/terra/weather/atmosphere'

function emptyClouds(): EarthPulseCloudCatalog {
  return {
    frames: [],
    latestBySatellite: {},
    intervalMinutes: 10,
    cacheBound: 12,
    truthState: 'UNAVAILABLE',
    coverage: { kind: 'none', label: 'none', west: null, south: null, east: null, north: null, basis: 'loading' },
    error: null,
    fromCache: false,
  }
}

export function useTerraEarthPulse(input: {
  terraTime: string
  timeMode: 'live' | 'historical'
  enabled?: boolean
  advanceAllowedRef?: { current: boolean }
  cloudFetchAllowedRef?: { current: boolean }
  lightningFetchAllowedRef?: { current: boolean }
  auroraFetchAllowedRef?: { current: boolean }
}): {
  engine: EarthPulseEngineState | null
  clouds: EarthPulseCloudCatalog
  cloudFrameIndex: number
  cloudPlaying: boolean
  lightning: EarthPulseLightningFlash[]
  lightningState: string
  aurora: EarthPulseAuroraCell[]
  auroraMax: number
  auroraState: string
  night: NightLightsCatalog | null
  cloudConsecutiveFailures: number
  cloudLastAttemptMs: number | null
  setCloudPlaying: (value: boolean) => void
  selectCloudFrame: (index: number) => void
} {
  const enabled = input.enabled !== false
  const [engine, setEngine] = useState<EarthPulseEngineState | null>(null)
  const [clouds, setClouds] = useState<EarthPulseCloudCatalog>(emptyClouds)
  const [cloudFrameIndex, setCloudFrameIndex] = useState(0)
  const [cloudPlaying, setCloudPlaying] = useState(true)
  const [lightning, setLightning] = useState<EarthPulseLightningFlash[]>([])
  const [lightningState, setLightningState] = useState('UNAVAILABLE')
  const [aurora, setAurora] = useState<EarthPulseAuroraCell[]>([])
  const [auroraMax, setAuroraMax] = useState(0)
  const [auroraState, setAuroraState] = useState('UNAVAILABLE')
  const [night, setNight] = useState<NightLightsCatalog | null>(null)
  const [cloudConsecutiveFailures, setCloudConsecutiveFailures] = useState(0)
  const [cloudLastAttemptMs, setCloudLastAttemptMs] = useState<number | null>(null)
  const followLatestRef = useRef(true)
  const cloudFailuresRef = useRef(0)
  const cloudLastAttemptRef = useRef<number | null>(null)
  const query = useMemo(() => {
    const params = new URLSearchParams({ time: input.terraTime, mode: input.timeMode })
    return params.toString()
  }, [input.terraTime, input.timeMode])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = async () => {
      try {
        const now = Date.now()
        const skipClouds = (input.cloudFetchAllowedRef && input.cloudFetchAllowedRef.current === false)
          || (cloudFailuresRef.current >= 3 && cloudLastAttemptRef.current != null && now - cloudLastAttemptRef.current < 30_000)
        const skipLightning = input.lightningFetchAllowedRef?.current === false
        const skipAurora = input.auroraFetchAllowedRef?.current === false
        const cloudQuery = skipClouds
          ? Promise.resolve(null)
          : fetch(`/api/terra/earth-pulse/clouds?${query}`, { cache: 'no-store' }).then(res => {
            cloudLastAttemptRef.current = Date.now()
            setCloudLastAttemptMs(cloudLastAttemptRef.current)
            return res
          })
        const [engineRes, cloudRes, lightningRes, auroraRes, nightRes] = await Promise.all([
          fetch(`/api/terra/earth-pulse?${query}`, { cache: 'no-store' }),
          cloudQuery,
          skipLightning ? Promise.resolve(null) : fetch(`/api/terra/earth-pulse/lightning?${query}`, { cache: 'no-store' }),
          skipAurora ? Promise.resolve(null) : fetch(`/api/terra/earth-pulse/aurora?${query}`, { cache: 'no-store' }),
          fetch(`/api/terra/earth-pulse/night-lights?${query}`, { cache: 'no-store' }),
        ])
        if (cancelled) return
        if (engineRes.ok) {
          const payload = await engineRes.json() as { engine?: EarthPulseEngineState }
          if (payload.engine) setEngine(payload.engine)
        }
        if (cloudRes && cloudRes.ok) {
          cloudFailuresRef.current = 0
          setCloudConsecutiveFailures(0)
          const payload = await cloudRes.json() as { catalog?: EarthPulseCloudCatalog }
          if (payload.catalog) {
            setClouds(payload.catalog)
            const east = payload.catalog.frames.filter(frame => frame.satellite === (payload.catalog?.playbackSatellite ?? 'GOES-East'))
            if (input.timeMode === 'historical') {
              const nearest = nearestMeasuredFrame(east, input.terraTime)
              const index = nearest ? east.findIndex(frame => frame.id === nearest.frame.id) : -1
              setCloudFrameIndex(index >= 0 ? index : Math.max(0, east.length - 1))
              setCloudPlaying(false)
              followLatestRef.current = false
            } else if (followLatestRef.current) {
              setCloudFrameIndex(Math.max(0, east.length - 1))
            }
          }
        } else if (cloudRes && !cloudRes.ok) {
          cloudFailuresRef.current += 1
          setCloudConsecutiveFailures(cloudFailuresRef.current)
        }
        if (lightningRes && lightningRes.ok) {
          const payload = await lightningRes.json() as { lightning?: { flashes?: EarthPulseLightningFlash[]; truthState?: string } }
          setLightning(payload.lightning?.flashes ?? [])
          setLightningState(payload.lightning?.truthState ?? 'UNAVAILABLE')
        }
        if (auroraRes && auroraRes.ok) {
          const payload = await auroraRes.json() as { aurora?: { cells?: EarthPulseAuroraCell[]; maxAurora?: number; truthState?: string } }
          setAurora(payload.aurora?.cells ?? [])
          setAuroraMax(payload.aurora?.maxAurora ?? 0)
          setAuroraState(payload.aurora?.truthState ?? 'UNAVAILABLE')
        }
        if (nightRes.ok) {
          const payload = await nightRes.json() as { night?: NightLightsCatalog }
          if (payload.night) setNight(payload.night)
        }
      } catch {
        if (!cancelled) {
          cloudFailuresRef.current += 1
          setCloudConsecutiveFailures(cloudFailuresRef.current)
          setLightningState(current => current === 'LIVE' ? 'STALE' : current)
        }
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, input.timeMode === 'live' ? 45_000 : 120_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [enabled, query, input.timeMode])

  const eastFrames = useMemo(
    () => clouds.frames.filter(frame => frame.satellite === (clouds.playbackSatellite ?? 'GOES-East')),
    [clouds.frames, clouds.playbackSatellite],
  )

  useEffect(() => {
    if (input.timeMode === 'historical' || !cloudPlaying || eastFrames.length < 2) return
    const timer = window.setInterval(() => {
      if (input.advanceAllowedRef && !input.advanceAllowedRef.current) return
      setCloudFrameIndex(current => {
        const next = (current + 1) % eastFrames.length
        followLatestRef.current = next === eastFrames.length - 1
        return next
      })
    }, TERRA_CLOUD_DISPLAY_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [cloudPlaying, eastFrames.length, input.timeMode, input.advanceAllowedRef])

  const selectCloudFrame = useCallback((index: number) => {
    followLatestRef.current = index >= eastFrames.length - 1
    setCloudFrameIndex(index)
    setCloudPlaying(false)
  }, [eastFrames.length])

  return {
    engine,
    clouds,
    cloudFrameIndex,
    cloudPlaying,
    lightning,
    lightningState,
    aurora,
    auroraMax,
    auroraState,
    night,
    cloudConsecutiveFailures,
    cloudLastAttemptMs,
    setCloudPlaying,
    selectCloudFrame,
  }
}
