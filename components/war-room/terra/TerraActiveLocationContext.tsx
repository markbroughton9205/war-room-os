'use client'

import { createContext, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { TerraActiveLocation } from '@/lib/terra/activeLocation'
import type { TerraGeoFeature } from '@/lib/terra/types'
import type { TerraAircraftRegionalSummary } from '@/lib/terra/aircraftRegionalSummary'
import type { TerraVesselRegionalSummary } from '@/lib/terra/vesselRegionalSummary'
import type { TerraMaritimeCoverageState } from '@/lib/terra/maritimeCoverage'
import type { TerraCoverageTruthState } from '@/lib/terra/coverageTruth'

type TerraActiveLocationContextValue = {
  activeLocation: TerraActiveLocation | null
  setActiveLocation: (location: TerraActiveLocation | null) => void
  /** The exact observed TerraGeoFeature behind a deliberate event-marker click, if the active
   * location arose from one — null for a plain ground click/typed search. Smallest typed Council
   * extension point for this phase (see useTerraActiveLocation's doc comment below): carries the
   * selected event alongside the location it's already handing off, without building any Council
   * runtime here. Also doubles as "selected aircraft" (kind === 'aircraft_state') — the live
   * aviation phase adds no separate selectedAircraft type since TerraGeoFeature already carries
   * everything a selected aircraft needs. */
  selectedEvent: TerraGeoFeature | null
  setSelectedEvent: (feature: TerraGeoFeature | null) => void
  /** Live-aviation phase: a bounded, current summary of the aircraft layer's own loaded feature
   * set (count/airborne/on-ground/stale/average altitude — see
   * lib/terra/aircraftRegionalSummary.ts) — never the raw feature array itself. `null` when the
   * aircraft layer is off or has never loaded. */
  aircraftSummary: TerraAircraftRegionalSummary | null
  setAircraftSummary: (summary: TerraAircraftRegionalSummary | null) => void
  /** Terra Phase 3 (Maritime Source Federation): the same bounded-summary pattern as
   * aircraftSummary, plus the coverage-truth state (lib/terra/maritimeCoverage.ts) — required
   * alongside the summary so a Council consumer can never mistake a NO_COVERAGE region for a
   * genuinely empty one. `null` when the Maritime layer is off or has never loaded. */
  maritimeSummary: { regional: TerraVesselRegionalSummary; coverageState: TerraMaritimeCoverageState } | null
  setMaritimeSummary: (summary: { regional: TerraVesselRegionalSummary; coverageState: TerraMaritimeCoverageState } | null) => void
  /** WAR ROOM TERRA LINKED per-layer coverage wiring (additive, optional): the current
   * coverage-truth state (lib/terra/coverageTruth.ts) of each visible Terra layer, keyed by
   * layer id. Optional so existing providers/consumers keep working unchanged; consumers must
   * treat `undefined` as "no per-layer coverage evidence available" (graceful absent). Each
   * state is an OBSERVED availability fact about the provider feed — never a condition verdict. */
  layerCoverage?: Partial<Record<string, TerraCoverageTruthState>>
  /** Functional-update-capable (Dispatch<SetStateAction>) so N layer components can each publish
   * their own layer id additively without stale-closure merges; passing a full replacement object
   * still type-checks, so existing callers are unaffected. */
  setLayerCoverage?: Dispatch<SetStateAction<Partial<Record<string, TerraCoverageTruthState>>>>
}

const TerraActiveLocationContext = createContext<TerraActiveLocationContextValue | null>(null)

export function TerraActiveLocationProvider({ children }: { children: ReactNode }) {
  const [activeLocation, setActiveLocation] = useState<TerraActiveLocation | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<TerraGeoFeature | null>(null)
  const [aircraftSummary, setAircraftSummary] = useState<TerraAircraftRegionalSummary | null>(null)
  const [maritimeSummary, setMaritimeSummary] = useState<TerraActiveLocationContextValue['maritimeSummary']>(null)
  const [layerCoverage, setLayerCoverage] = useState<Partial<Record<string, TerraCoverageTruthState>>>({})
  const value = useMemo(
    () => ({ activeLocation, setActiveLocation, selectedEvent, setSelectedEvent, aircraftSummary, setAircraftSummary, maritimeSummary, setMaritimeSummary, layerCoverage, setLayerCoverage }),
    [activeLocation, selectedEvent, aircraftSummary, maritimeSummary, layerCoverage],
  )
  return <TerraActiveLocationContext.Provider value={value}>{children}</TerraActiveLocationContext.Provider>
}

/** Semantic handoff for the existing/future Council. It intentionally contains only location, the
 * exact selected event/aircraft behind it, and a bounded aircraft regional summary — never a
 * Related Intelligence result list, the raw aircraft feed, a Council session, a provider, or a
 * conversation runtime. */
export function useTerraActiveLocation() {
  const value = useContext(TerraActiveLocationContext)
  if (!value) throw new Error('useTerraActiveLocation must be used inside TerraActiveLocationProvider')
  return value
}
