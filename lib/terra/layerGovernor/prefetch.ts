import type { PrefetchPlan } from './types'

export function planPrefetch(input: {
  flying: boolean
  flightKey: string | null
  coveringAtDestination: string[]
  radarLikely: boolean
  previousKey?: string | null
}): PrefetchPlan {
  if (!input.flying || !input.flightKey) {
    return {
      key: '',
      providers: [],
      radarLikely: false,
      roadsLikely: false,
      weatherMetadata: false,
      coverageMetadata: false,
      cancelled: Boolean(input.previousKey),
    }
  }
  const cancelled = Boolean(input.previousKey && input.previousKey !== input.flightKey)
  return {
    key: input.flightKey,
    providers: input.coveringAtDestination.slice(0, 6),
    radarLikely: input.radarLikely,
    roadsLikely: true,
    weatherMetadata: input.radarLikely,
    coverageMetadata: input.coveringAtDestination.length > 0,
    cancelled,
  }
}
