'use client'

import { useCallback, useState } from 'react'
import {
  CLOUDS_ENABLED_STORAGE_KEY,
  CLOUDS_OPACITY_STORAGE_KEY,
  DEFAULT_COMMANDER_CLOUD_OPACITY,
  WEATHER_DEPTH_AUTO_STORAGE_KEY,
} from '@/lib/terra/weather/atmosphere'

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return raw !== '0'
  } catch {
    return fallback
  }
}

function readUnit(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
  } catch {
    return fallback
  }
}

export function useTerraWeatherPrefs(): {
  cloudsEnabled: boolean
  cloudOpacity: number
  weatherDepthAuto: boolean
  setCloudsEnabled: (value: boolean) => void
  setCloudOpacity: (value: number) => void
  setWeatherDepthAuto: (value: boolean) => void
} {
  const [cloudsEnabled, setCloudsEnabledState] = useState(() => readBool(CLOUDS_ENABLED_STORAGE_KEY, true))
  const [cloudOpacity, setCloudOpacityState] = useState(() => readUnit(CLOUDS_OPACITY_STORAGE_KEY, DEFAULT_COMMANDER_CLOUD_OPACITY))
  const [weatherDepthAuto, setWeatherDepthAutoState] = useState(() => readBool(WEATHER_DEPTH_AUTO_STORAGE_KEY, true))

  const setCloudsEnabled = useCallback((value: boolean) => {
    setCloudsEnabledState(value)
    try { localStorage.setItem(CLOUDS_ENABLED_STORAGE_KEY, value ? '1' : '0') } catch { /* ignore */ }
  }, [])

  const setCloudOpacity = useCallback((value: number) => {
    const next = Math.min(1, Math.max(0, value))
    setCloudOpacityState(next)
    try { localStorage.setItem(CLOUDS_OPACITY_STORAGE_KEY, String(next)) } catch { /* ignore */ }
  }, [])

  const setWeatherDepthAuto = useCallback((value: boolean) => {
    setWeatherDepthAutoState(value)
    try { localStorage.setItem(WEATHER_DEPTH_AUTO_STORAGE_KEY, value ? '1' : '0') } catch { /* ignore */ }
  }, [])

  return {
    cloudsEnabled,
    cloudOpacity,
    weatherDepthAuto,
    setCloudsEnabled,
    setCloudOpacity,
    setWeatherDepthAuto,
  }
}
