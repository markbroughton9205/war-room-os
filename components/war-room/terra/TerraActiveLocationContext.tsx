'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { TerraActiveLocation } from '@/lib/terra/activeLocation'
import type { TerraGeoFeature } from '@/lib/terra/types'

type TerraActiveLocationContextValue = {
  activeLocation: TerraActiveLocation | null
  setActiveLocation: (location: TerraActiveLocation | null) => void
  /** The exact observed TerraGeoFeature behind a deliberate event-marker click, if the active
   * location arose from one — null for a plain ground click/typed search. Smallest typed Council
   * extension point for this phase (see useTerraActiveLocation's doc comment below): carries the
   * selected event alongside the location it's already handing off, without building any Council
   * runtime here. */
  selectedEvent: TerraGeoFeature | null
  setSelectedEvent: (feature: TerraGeoFeature | null) => void
}

const TerraActiveLocationContext = createContext<TerraActiveLocationContextValue | null>(null)

export function TerraActiveLocationProvider({ children }: { children: ReactNode }) {
  const [activeLocation, setActiveLocation] = useState<TerraActiveLocation | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<TerraGeoFeature | null>(null)
  const value = useMemo(() => ({ activeLocation, setActiveLocation, selectedEvent, setSelectedEvent }), [activeLocation, selectedEvent])
  return <TerraActiveLocationContext.Provider value={value}>{children}</TerraActiveLocationContext.Provider>
}

/** Semantic handoff for the existing/future Council. It intentionally contains only location and
 * (as of the event-intelligence phase) the exact selected event behind it — never a Related
 * Intelligence result list, a Council session, a provider, or a conversation runtime. */
export function useTerraActiveLocation() {
  const value = useContext(TerraActiveLocationContext)
  if (!value) throw new Error('useTerraActiveLocation must be used inside TerraActiveLocationProvider')
  return value
}
