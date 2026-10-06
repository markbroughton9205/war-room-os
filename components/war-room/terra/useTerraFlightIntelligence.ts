'use client'

import { useEffect, useMemo, useState } from 'react'
import { observationFromOpenSkyFeature } from '@/lib/terra/flightIntelligence/adapters'
import { federateAircraftObservations } from '@/lib/terra/flightIntelligence/federation'
import { flightTruthToFeature } from '@/lib/terra/flightIntelligence/project'
import type { AircraftProviderObservation, ProviderHealthState, TerraAircraftTruth } from '@/lib/terra/flightIntelligence/types'
import { aircraftMatchesWatch, type WatchRule } from '@/lib/terra/flightIntelligence/monitor'
import type { TerraGeoFeature } from '@/lib/terra/types'

type Supplemental = {
  observations: AircraftProviderObservation[]
  providers: ProviderHealthState[]
}

export function useTerraFlightIntelligence(openskyFeatures: readonly TerraGeoFeature[], bboxQuery: string | null, rules: readonly WatchRule[], nowIso: string) {
  const [supplemental, setSupplemental] = useState<Supplemental>({ observations: [], providers: [] })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!bboxQuery) return
    const parts = bboxQuery.split(',').map(Number)
    if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) return
    const [lamin, lomin, lamax, lomax] = parts
    let cancelled = false
    const controller = new AbortController()
    const load = () => {
      const params = new URLSearchParams({
        lamin: String(lamin),
        lomin: String(lomin),
        lamax: String(lamax),
        lomax: String(lomax),
      })
      fetch(`/api/terra/flight-intelligence?${params}`, { signal: controller.signal, cache: 'no-store' })
        .then(async response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.json() as Promise<Supplemental>
        })
        .then(body => {
          if (!cancelled) {
            setSupplemental({ observations: body.observations ?? [], providers: body.providers ?? [] })
            setError(null)
          }
        })
        .catch(reason => {
          if (cancelled || (reason instanceof DOMException && reason.name === 'AbortError')) return
          setError(reason instanceof Error ? reason.message : 'Flight intelligence request failed.')
        })
    }
    load()
    const timer = setInterval(load, 60_000)
    return () => {
      cancelled = true
      controller.abort()
      clearInterval(timer)
    }
  }, [bboxQuery])

  const truth = useMemo(() => {
    const nowMs = Date.parse(nowIso)
    const opensky = openskyFeatures.flatMap(feature => {
      const observation = observationFromOpenSkyFeature(feature, nowIso)
      return observation ? [observation] : []
    })
    const watched = new Set<string>()
    const merged = federateAircraftObservations([...opensky, ...supplemental.observations], Number.isFinite(nowMs) ? nowMs : 0, watched)
    return merged.map(item => ({ ...item, watched: aircraftMatchesWatch(item, rules) }))
  }, [nowIso, openskyFeatures, rules, supplemental.observations])

  const features = useMemo(
    () => truth.flatMap(item => {
      const feature = flightTruthToFeature(item)
      return feature ? [feature] : []
    }),
    [truth],
  )

  const providers = useMemo<ProviderHealthState[]>(() => {
    const openskyState: ProviderHealthState = openskyFeatures.length > 0
      ? { provider: 'opensky', state: 'LIVE', detail: `${openskyFeatures.length} OpenSky features`, observationCount: openskyFeatures.length }
      : bboxQuery
        ? { provider: 'opensky', state: 'NO_COVERAGE', detail: 'OpenSky returned no aircraft for this view.', observationCount: 0 }
        : { provider: 'opensky', state: 'NO_COVERAGE', detail: 'View is outside the aircraft query limit.', observationCount: 0 }
    return [openskyState, ...supplemental.providers]
  }, [bboxQuery, openskyFeatures.length, supplemental.providers])

  return { truth: truth as TerraAircraftTruth[], features, providers, error, coverage: bboxQuery ? 'VIEW_BOUND' : 'NO_COVERAGE' as const }
}
