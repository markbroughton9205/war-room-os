import type { WeatherAlert, WeatherFlyPlan, WeatherGeometryBasis } from './types'

const MIN_RECTANGLE_SPAN_DEG = 0.05

export function bboxFromRings(rings: number[][][] | null | undefined): WeatherAlert['bbox'] {
  if (!rings?.length) return null
  let west = Infinity
  let east = -Infinity
  let south = Infinity
  let north = -Infinity
  for (const ring of rings) {
    for (const vertex of ring) {
      const [lon, lat] = vertex
      if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) continue
      west = Math.min(west, lon)
      east = Math.max(east, lon)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
  }
  if (!Number.isFinite(west) || !Number.isFinite(east) || !Number.isFinite(south) || !Number.isFinite(north)) return null
  const padLon = Math.max(0, (MIN_RECTANGLE_SPAN_DEG - (east - west)) / 2)
  const padLat = Math.max(0, (MIN_RECTANGLE_SPAN_DEG - (north - south)) / 2)
  return {
    west: west - padLon,
    east: east + padLon,
    south: south - padLat,
    north: north + padLat,
  }
}

export function resolveGeometryBasis(input: {
  rings: number[][][] | null
  bbox: WeatherAlert['bbox']
  areaDesc: string | null
  affectedZones: string[]
  representativePoint: WeatherAlert['representativePoint']
  pointIsVertexAverage: boolean
}): WeatherGeometryBasis {
  if (input.rings && input.rings.length > 0) return 'POLYGON'
  if (input.bbox) return 'BBOX'
  if (input.affectedZones.length > 0 || input.areaDesc) return 'ZONE'
  if (input.representativePoint && !input.pointIsVertexAverage) return 'REPRESENTATIVE_POINT'
  return 'UNKNOWN'
}

export function resolveWeatherFlyPlan(alert: WeatherAlert): WeatherFlyPlan {
  if (alert.geometryBasis === 'POLYGON' && alert.bbox) {
    return {
      action: 'fit-polygon',
      basis: 'POLYGON',
      ...alert.bbox,
      longitude: (alert.bbox.west + alert.bbox.east) / 2,
      latitude: (alert.bbox.south + alert.bbox.north) / 2,
    }
  }
  if (alert.geometryBasis === 'BBOX' && alert.bbox) {
    return {
      action: 'fit-bbox',
      basis: 'BBOX',
      ...alert.bbox,
      longitude: (alert.bbox.west + alert.bbox.east) / 2,
      latitude: (alert.bbox.south + alert.bbox.north) / 2,
    }
  }
  if (alert.geometryBasis === 'ZONE') {
    return {
      action: 'no-fly',
      basis: 'ZONE',
      reason: 'NWS supplied zone text only. No polygon/bbox to fit. Terra will not pretend a centroid is the event location.',
    }
  }
  if (alert.geometryBasis === 'REPRESENTATIVE_POINT' && alert.representativePoint) {
    return {
      action: 'no-fly',
      basis: 'REPRESENTATIVE_POINT',
      reason: 'A representative point is not the exact event location. Terra will not camera-frame it as a point event.',
    }
  }
  return {
    action: 'no-fly',
    basis: 'UNKNOWN',
    reason: 'No lawful alert geometry is available to fly to.',
  }
}
