import type { AdminCompactFeature, AdminIdentityPresentation, AdminViewport } from './types'

export type AdminLabel = {
  id: string
  text: string
  kind: 'country' | 'state' | 'city'
  lon: number
  lat: number
  rank: number
}

const MIN_LABEL_SEP_DEG: Record<AdminLabel['kind'], number> = {
  country: 18,
  state: 4.5,
  city: 1.4,
}

function dist2(a: AdminLabel, lon: number, lat: number): number {
  const dLon = (a.lon - lon) * Math.cos((a.lat * Math.PI) / 180)
  const dLat = a.lat - lat
  return dLon * dLon + dLat * dLat
}

export function declutterLabels(
  candidates: AdminLabel[],
  cap: number,
  kind: AdminLabel['kind'],
): AdminLabel[] {
  if (cap <= 0) return []
  const sorted = [...candidates].sort((a, b) => a.rank - b.rank || a.text.localeCompare(b.text))
  const kept: AdminLabel[] = []
  const sep = MIN_LABEL_SEP_DEG[kind]
  const sep2 = sep * sep
  for (const label of sorted) {
    if (kept.length >= cap) break
    if (kept.some(existing => dist2(existing, label.lon, label.lat) < sep2)) continue
    kept.push(label)
  }
  return kept
}

export function countryLabels(
  features: AdminCompactFeature[],
  presentation: AdminIdentityPresentation,
): AdminLabel[] {
  if (presentation.countryLabelOpacity <= 0) return []
  const candidates: AdminLabel[] = features.map(f => ({
    id: `country:${f.id}`,
    text: f.name.toUpperCase(),
    kind: 'country',
    lon: f.lon,
    lat: f.lat,
    rank: f.labelRank ?? 6,
  }))
  return declutterLabels(candidates, presentation.countryLabelCap, 'country')
}

export function stateLabels(
  features: AdminCompactFeature[],
  presentation: AdminIdentityPresentation,
): AdminLabel[] {
  if (presentation.stateLabelOpacity <= 0) return []
  const candidates: AdminLabel[] = features.map(f => ({
    id: `state:${f.id}`,
    text: f.name.toUpperCase(),
    kind: 'state',
    lon: f.lon,
    lat: f.lat,
    rank: f.labelRank ?? 5,
  }))
  return declutterLabels(candidates, presentation.stateLabelCap, 'state')
}

export function cityLabels(
  features: AdminCompactFeature[],
  presentation: AdminIdentityPresentation,
  view: AdminViewport | null,
): AdminLabel[] {
  if (presentation.cityLabelOpacity <= 0) return []
  let pool = features.filter(f => f.kind === 'place')
  if (view) {
    pool = pool.filter(f => f.lon >= view.west && f.lon <= view.east && f.lat >= view.south && f.lat <= view.north)
  }
  const candidates: AdminLabel[] = pool.map(f => ({
    id: `place:${f.id}`,
    text: f.name,
    kind: 'city',
    lon: f.lon,
    lat: f.lat,
    rank: f.labelRank ?? 8,
  }))
  return declutterLabels(candidates, presentation.cityLabelCap, 'city')
}
