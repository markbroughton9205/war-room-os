'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TerraGeoFeature } from '@/lib/terra/types'
import type { TerraLiveIntelItem } from '@/lib/terra/liveIntelPanelModel'
import { decideAlertDuck } from '@/lib/media/alerts/duckPolicy'
import {
  ingestWeatherAlerts,
  mergeWeatherAlerts,
  pickWeatherToast,
  WEATHER_DEDUPE_STORAGE_KEY,
  WEATHER_MUTE_STORAGE_KEY,
  type WeatherAlert,
  type WeatherDedupeRecord,
  type WeatherToastCandidate,
} from '@/lib/terra/weather'

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function readMuted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(WEATHER_MUTE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function useTerraWeatherAlerts(input: {
  features: TerraGeoFeature[]
  intelItems?: TerraLiveIntelItem[]
  nowIso?: string
}): {
  alerts: WeatherAlert[]
  toast: WeatherToastCandidate | null
  muted: boolean
  dismissToast: () => void
  muteAlerts: () => void
} {
  const [muted, setMuted] = useState(readMuted)
  const [toast, setToast] = useState<WeatherToastCandidate | null>(null)
  const recordsRef = useRef<Record<string, WeatherDedupeRecord>>(readJson(WEATHER_DEDUPE_STORAGE_KEY, {}))
  const knownIdsRef = useRef<Set<string>>(new Set())
  const nowIso = input.nowIso ?? new Date().toISOString()

  const alerts = useMemo(() => mergeWeatherAlerts({
    features: input.features,
    intelItems: input.intelItems,
    nowIso,
  }), [input.features, input.intelItems, nowIso])

  useEffect(() => {
    const { records, toasts } = ingestWeatherAlerts({
      alerts,
      records: recordsRef.current,
      nowIso,
      muted,
    })
    recordsRef.current = records
    try {
      sessionStorage.setItem(WEATHER_DEDUPE_STORAGE_KEY, JSON.stringify(records))
    } catch {
      /* ignore quota */
    }
    const next = pickWeatherToast(toasts.filter(item => !knownIdsRef.current.has(`${item.alert.id}:${item.kind}:${item.alert.updated ?? item.alert.sent ?? ''}`)))
    if (next) {
      knownIdsRef.current.add(`${next.alert.id}:${next.kind}:${next.alert.updated ?? next.alert.sent ?? ''}`)
      setToast(next)
      decideAlertDuck({
        severity: next.alert.severity,
        duckingEnabled: false,
        alreadyDuckedForAlertId: false,
        audioAlreadyPlaying: false,
      })
    }
  }, [alerts, muted])

  const dismissToast = useCallback(() => setToast(null), [])
  const muteAlerts = useCallback(() => {
    setMuted(true)
    setToast(null)
    try {
      localStorage.setItem(WEATHER_MUTE_STORAGE_KEY, '1')
    } catch {
      /* ignore */
    }
  }, [])

  return { alerts, toast, muted, dismissToast, muteAlerts }
}
