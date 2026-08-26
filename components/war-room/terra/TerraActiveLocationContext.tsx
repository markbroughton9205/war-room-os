'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { TerraActiveLocation } from '@/lib/terra/activeLocation'

type TerraActiveLocationContextValue = {
  activeLocation: TerraActiveLocation | null
  setActiveLocation: (location: TerraActiveLocation | null) => void
}

const TerraActiveLocationContext = createContext<TerraActiveLocationContextValue | null>(null)

export function TerraActiveLocationProvider({ children }: { children: ReactNode }) {
  const [activeLocation, setActiveLocation] = useState<TerraActiveLocation | null>(null)
  const value = useMemo(() => ({ activeLocation, setActiveLocation }), [activeLocation])
  return <TerraActiveLocationContext.Provider value={value}>{children}</TerraActiveLocationContext.Provider>
}

/** Semantic handoff for the existing/future Council. It intentionally contains location only;
 * it does not create a Council session, provider, or conversation runtime. */
export function useTerraActiveLocation() {
  const value = useContext(TerraActiveLocationContext)
  if (!value) throw new Error('useTerraActiveLocation must be used inside TerraActiveLocationProvider')
  return value
}
