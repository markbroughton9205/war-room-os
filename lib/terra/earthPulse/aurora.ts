import 'server-only'

import { cacheGet, cacheSet } from '@/lib/research-engine/cache/ttlCache'
import type { EarthPulseAuroraCell, EarthPulseTruthState } from './types'
import { OVATION_URL } from './sources'
import { fetchText } from './shared'
import { classifyAuroraFreshness } from './freshness'
import { aggregateOvationCells } from './client'

const CACHE_KEY = 'terra-earth-pulse-ovation'
const CACHE_MS = 10 * 60_000

type OvationPayload = {
  'Observation Time'?: string
  'Forecast Time'?: string
  coordinates?: unknown
}

export { aggregateOvationCells }

export async function loadOvationAurora(input: {
  terraTime: string
  timeMode: 'live' | 'historical'
}): Promise<{
  cells: EarthPulseAuroraCell[]
  observationTime: string | null
  forecastTime: string | null
  maxAurora: number
  truthState: EarthPulseTruthState
  error: string | null
  fromCache: boolean
}> {
  if (input.timeMode === 'historical') {
    return {
      cells: [],
      observationTime: null,
      forecastTime: null,
      maxAurora: 0,
      truthState: 'UNAVAILABLE',
      error: 'OVATION latest is a nowcast. Historical timeline playback is not supported.',
      fromCache: false,
    }
  }

  const cached = cacheGet<{ cells: EarthPulseAuroraCell[]; observationTime: string | null; forecastTime: string | null; maxAurora: number }>(CACHE_KEY)
  if (cached) {
    return {
      ...cached,
      truthState: classifyAuroraFreshness(cached.forecastTime ?? cached.observationTime, input.terraTime, true),
      error: null,
      fromCache: true,
    }
  }

  const result = await fetchText(OVATION_URL, 20_000)
  if (!result.ok) {
    return {
      cells: [],
      observationTime: null,
      forecastTime: null,
      maxAurora: 0,
      truthState: 'UNAVAILABLE',
      error: result.message,
      fromCache: false,
    }
  }

  let payload: OvationPayload
  try {
    payload = JSON.parse(result.text) as OvationPayload
  } catch {
    return {
      cells: [],
      observationTime: null,
      forecastTime: null,
      maxAurora: 0,
      truthState: 'UNAVAILABLE',
      error: 'OVATION JSON parse failed',
      fromCache: false,
    }
  }
  const observationTime = typeof payload['Observation Time'] === 'string' ? payload['Observation Time'] : null
  const forecastTime = typeof payload['Forecast Time'] === 'string' ? payload['Forecast Time'] : null
  const cells = aggregateOvationCells(payload.coordinates)
  const maxAurora = cells.reduce((max, cell) => Math.max(max, cell.aurora), 0)
  cacheSet(CACHE_KEY, { cells, observationTime, forecastTime, maxAurora }, CACHE_MS)
  return {
    cells,
    observationTime,
    forecastTime,
    maxAurora,
    truthState: classifyAuroraFreshness(forecastTime ?? observationTime, input.terraTime, true),
    error: null,
    fromCache: false,
  }
}
