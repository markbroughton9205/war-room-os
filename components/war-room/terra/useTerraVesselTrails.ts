'use client'

/**
 * Session-only vessel trails — mirrors components/war-room/terra/useTerraAircraftTrails.ts exactly,
 * keyed by MMSI instead of icao24. Deliberately reuses lib/terra/aircraftTrail.ts's
 * updateTerraAircraftTrail/TerraAircraftTrailPoint directly rather than duplicating an identical
 * bounded-trail implementation under a new name — that logic (point-count cap, age cap, dedup on
 * an unchanged observation) is domain-agnostic despite living in an aircraft-named file. Never
 * fetches or fabricates a historical track — every point came from an actual observation received
 * during this browser session.
 */
import { useEffect, useRef, useState } from 'react'
import type { TerraGeoFeature } from '@/lib/terra/types'
import { updateTerraAircraftTrail, type TerraAircraftTrailPoint } from '@/lib/terra/aircraftTrail'

const EMPTY_TRAILS: Record<string, TerraAircraftTrailPoint[]> = {}

export function useTerraVesselTrails(features: TerraGeoFeature[], enabled: boolean): Record<string, TerraAircraftTrailPoint[]> {
  const trailsRef = useRef<Record<string, TerraAircraftTrailPoint[]>>({})
  const [trails, setTrails] = useState<Record<string, TerraAircraftTrailPoint[]>>(EMPTY_TRAILS)

  useEffect(() => {
    if (!enabled) {
      const hadTrails = Object.keys(trailsRef.current).length > 0
      trailsRef.current = {}
      if (!hadTrails) return
      const timeout = setTimeout(() => setTrails(EMPTY_TRAILS), 0)
      return () => clearTimeout(timeout)
    }

    const now = Date.now()
    const next: Record<string, TerraAircraftTrailPoint[]> = {}
    for (const feature of features) {
      if (feature.kind !== 'vessel_position') continue
      const mmsi = typeof feature.properties.mmsi === 'string' ? feature.properties.mmsi : null
      if (!mmsi) continue
      const existing = trailsRef.current[mmsi] ?? []
      next[mmsi] = updateTerraAircraftTrail(existing, { longitude: feature.longitude, latitude: feature.latitude, observedAtMs: now })
    }
    trailsRef.current = next
    const timeout = setTimeout(() => setTrails(next), 0)
    return () => clearTimeout(timeout)
  }, [features, enabled])

  return trails
}
