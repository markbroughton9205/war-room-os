import type { AircraftClass, AircraftClassification, AircraftProviderObservation } from './types'

export type AircraftTypeEntry = {
  id: string
  icaoType: string
  label: string
  classes: AircraftClass[]
  description: string
}

/** Known ICAO type codes. Membership is type identity, never a current mission. */
export const AIRCRAFT_TYPE_REGISTRY: readonly AircraftTypeEntry[] = [
  {
    id: 'e6b_mercury',
    icaoType: 'E6',
    label: 'E-6B Mercury',
    classes: ['MILITARY', 'SPECIAL_MISSION', 'STRATEGIC'],
    description: 'Boeing E-6 Mercury',
  },
]

const BY_TYPE = new Map(AIRCRAFT_TYPE_REGISTRY.map(entry => [entry.icaoType, entry]))

export function classifyAircraftType(icaoType: string | null | undefined): AircraftClassification {
  const code = icaoType?.trim().toUpperCase() || null
  const entry = code ? BY_TYPE.get(code) : undefined
  if (!entry) {
    return { id: null, label: null, icaoType: code, classes: code ? [] : ['UNKNOWN'], missionInferred: false }
  }
  return {
    id: entry.id,
    label: entry.label,
    icaoType: entry.icaoType,
    classes: [...entry.classes],
    missionInferred: false,
  }
}

export function classificationFromObservation(observation: AircraftProviderObservation | null): AircraftClassification {
  const typed = classifyAircraftType(observation?.icaoType ?? null)
  const classes = new Set<AircraftClass>(typed.classes)
  if (observation?.providerFlags.includes('military')) classes.add('MILITARY')
  if (observation?.category === 'rotorcraft' || observation?.category === '8') classes.add('HELICOPTER')
  if (classes.size === 0) classes.add('UNKNOWN')
  return { ...typed, classes: [...classes], missionInferred: false }
}

export function aircraftMatchesClass(classification: AircraftClassification, aircraftClass: AircraftClass): boolean {
  return classification.classes.includes(aircraftClass)
}
