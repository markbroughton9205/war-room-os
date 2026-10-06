import type { AdminCompactFeature, AdminIdentityPresentation, AdminViewport } from './types'

function intersects(bbox: [number, number, number, number], view: AdminViewport): boolean {
  const [west, south, east, north] = bbox
  return east >= view.west && west <= view.east && north >= view.south && south <= view.north
}

function containsPoint(feature: AdminCompactFeature, lon: number, lat: number): boolean {
  const [west, south, east, north] = feature.bbox
  if (lon < west || lon > east || lat < south || lat > north) return false
  return pointInRings(feature.rings, lon, lat)
}

function pointInRings(rings: number[][][], lon: number, lat: number): boolean {
  for (const ring of rings) {
    if (ring.length < 3) continue
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0]
      const yi = ring[i][1]
      const xj = ring[j][0]
      const yj = ring[j][1]
      const intersect = ((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi)
      if (intersect) inside = !inside
    }
    if (inside) return true
  }
  return false
}

export function selectCountryFeatures(
  features: AdminCompactFeature[],
  presentation: AdminIdentityPresentation,
  view: AdminViewport | null,
  activeIso2: string | null,
): AdminCompactFeature[] {
  if (presentation.countryLod === 'none') return []
  let selected = features.filter(f => f.kind === 'country')
  if (presentation.countryLod === 'major') {
    selected = selected.filter(f => (f.labelRank ?? 6) <= 3)
  } else if (presentation.countryLod === 'active') {
    const iso = activeIso2?.toUpperCase() ?? null
    selected = selected.filter(f => {
      if (iso && f.iso2 === iso) return true
      if (!view) return false
      return intersects(f.bbox, view)
    }).slice(0, 8)
  }
  if (view && presentation.countryLod === 'all') {
    selected = selected.filter(f => intersects(f.bbox, expand(view, 12)))
  }
  return selected
}

export function selectStateFeatures(
  features: AdminCompactFeature[],
  presentation: AdminIdentityPresentation,
  view: AdminViewport | null,
  activeAdm0: string | null,
  activeStateCode: string | null,
): AdminCompactFeature[] {
  if (presentation.stateLod === 'none') return []
  let selected = features.filter(f => f.kind === 'state')
  if (presentation.stateLod === 'active') {
    selected = selected.filter(f => {
      if (activeStateCode && f.iso3166_2 === activeStateCode) return true
      if (activeAdm0 && f.adm0 === activeAdm0) return true
      return false
    })
  } else if (presentation.stateLod === 'begin') {
    selected = selected.filter(f => (f.labelRank ?? 6) <= 4)
    if (view) selected = selected.filter(f => intersects(f.bbox, view))
  } else if (view) {
    selected = selected.filter(f => intersects(f.bbox, expand(view, 4)))
    if (activeAdm0) {
      const home = selected.filter(f => f.adm0 === activeAdm0 || f.iso3166_2 === activeStateCode)
      const nearby = selected.filter(f => f.adm0 !== activeAdm0).slice(0, 12)
      selected = [...home, ...nearby]
    }
  }
  return selected
}

export function findActiveFeature(
  features: AdminCompactFeature[],
  iso: string | null,
  lon: number | null,
  lat: number | null,
): AdminCompactFeature | null {
  if (iso) {
    const byIso = features.find(f => f.iso2 === iso || f.iso3166_2 === iso || f.iso3 === iso)
    if (byIso) return byIso
  }
  if (lon === null || lat === null) return null
  const hits = features.filter(f => containsPoint(f, lon, lat))
  hits.sort((a, b) => area(a.bbox) - area(b.bbox))
  return hits[0] ?? null
}

function area(bbox: [number, number, number, number]): number {
  return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1])
}

function expand(view: AdminViewport, deg: number): AdminViewport {
  return {
    west: view.west - deg,
    south: Math.max(-90, view.south - deg),
    east: view.east + deg,
    north: Math.min(90, view.north + deg),
  }
}

export function ringsToLonLatPairs(rings: number[][][]): Array<{ lon: number; lat: number }[]> {
  return rings.map(ring => ring.map(([lon, lat]) => ({ lon, lat })))
}
