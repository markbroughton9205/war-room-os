/**
 * Click→Info race + enrich binding.
 * Rapid click A then B: A's reverse-geocode must never overwrite B.
 * Reverse geocode must never fabricate a house number or OSM id.
 */
export function inspectEnrichAppliesTo(selection: {
  latitude: number | null
  longitude: number | null
}, enrich: {
  latitude: number | null
  longitude: number | null
}): boolean {
  if (selection.latitude === null || selection.longitude === null) return false
  if (enrich.latitude === null || enrich.longitude === null) return false
  const dLat = Math.abs(selection.latitude - enrich.latitude)
  const dLon = Math.abs(selection.longitude - enrich.longitude)
  return dLat < 0.00015 && dLon < 0.00015
}

export function inspectIdentityIsFabricated(identity: string | null | undefined): boolean {
  if (!identity) return true
  const value = identity.trim().toLowerCase()
  return value === '' || value === 'unknown' || value === 'n/a' || value.includes('inferred-id')
}

export function inspectMustNotCopyNeighborAddress(selectedHouse: string | null, enrichAddress: string | null): string | null {
  if (!selectedHouse) return null
  if (!enrichAddress) return selectedHouse
  return selectedHouse
}
