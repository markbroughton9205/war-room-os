import type { AircraftProviderObservation, TerraAircraftIdentity } from './types'

const ICAO_HEX = /^[0-9a-f]{6}$/

export function normalizeIcaoHex(value: string | null | undefined): string | null {
  if (!value) return null
  const hex = value.trim().toLowerCase()
  return ICAO_HEX.test(hex) ? hex : null
}

export function resolveAircraftIdentity(observation: AircraftProviderObservation): TerraAircraftIdentity {
  const icaoHex = normalizeIcaoHex(observation.icaoHex)
  if (icaoHex) {
    return { key: icaoHex, icaoHex, registration: observation.registration, basis: 'icao_hex' }
  }
  const providerId = observation.providerAircraftId?.trim()
  if (providerId) {
    return {
      key: `provider:${observation.provider}:${providerId}`,
      icaoHex: null,
      registration: observation.registration,
      basis: 'provider_aircraft_id',
    }
  }
  const registration = observation.registration?.trim().toUpperCase()
  if (registration) {
    return { key: `reg:${registration}`, icaoHex: null, registration, basis: 'registration' }
  }
  return {
    key: `temp:${observation.provider}:${observation.receivedAt}:${observation.callsign ?? 'unknown'}`,
    icaoHex: null,
    registration: null,
    basis: 'temporary',
  }
}
