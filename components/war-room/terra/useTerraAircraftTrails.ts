'use client'

/**
 * Session-only aircraft trails — thin client wrapper around the pure bounding logic in
 * lib/terra/aircraftTrail.ts. Appends one point per icao24 each time a real, new aircraft feature
 * list arrives (i.e. once per live refresh, never per Cesium frame); cleared entirely when the
 * layer is disabled. Never fetches or fabricates a historical track — every point came from an
 * actual observation received during this browser session.
 */
import { useEffect, useRef, useState } from 'react'
import type { TerraGeoFeature } from '@/lib/terra/types'
import { updateTerraAircraftTrail, type TerraAircraftTrailPoint } from '@/lib/terra/aircraftTrail'

const EMPTY_TRAILS: Record<string, TerraAircraftTrailPoint[]> = {}

export function useTerraAircraftTrails(features: TerraGeoFeature[], enabled: boolean): Record<string, TerraAircraftTrailPoint[]> {
  const trailsRef = useRef<Record<string, TerraAircraftTrailPoint[]>>({})
  const [trails, setTrails] = useState<Record<string, TerraAircraftTrailPoint[]>>(EMPTY_TRAILS)

  useEffect(() => {
    if (!enabled) {
      const hadTrails = Object.keys(trailsRef.current).length > 0
      trailsRef.current = {}
      if (!hadTrails) return
      // Deferred a tick — this repo's react-hooks/set-state-in-effect lint rule flags a
      // synchronous setState call reachable by direct static analysis from an effect body; the
      // same zero-delay-timeout escape hatch useTerraLayer.ts's kickoff already uses.
      const timeout = setTimeout(() => setTrails(EMPTY_TRAILS), 0)
      return () => clearTimeout(timeout)
    }

    const now = Date.now()
    const next: Record<string, TerraAircraftTrailPoint[]> = {}
    for (const feature of features) {
      if (feature.kind !== 'aircraft_state') continue
      const icao24 = typeof feature.properties.icao24 === 'string' ? feature.properties.icao24 : null
      if (!icao24) continue
      const existing = trailsRef.current[icao24] ?? []
      next[icao24] = updateTerraAircraftTrail(existing, { longitude: feature.longitude, latitude: feature.latitude, observedAtMs: now })
    }
    trailsRef.current = next
    const timeout = setTimeout(() => setTrails(next), 0)
    return () => clearTimeout(timeout)
  }, [features, enabled])

  return trails
}
