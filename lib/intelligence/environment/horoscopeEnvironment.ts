export type HoroscopeSnapshot = {
  enabled: boolean
  sign: string
  date: string
  interpretation: string
  provider: string
  moonPhase?: string
  planetaryFacts: string[]
  disclaimer: string
}

export function buildHoroscopeSnapshot(sign = 'Aries', date = new Date()): HoroscopeSnapshot {
  return {
    enabled: false,
    sign,
    date: date.toISOString().slice(0, 10),
    interpretation: 'Horoscope provider not configured.',
    provider: 'None',
    planetaryFacts: [],
    disclaimer:
      'Astrology is symbolic/interpretive guidance, not verified factual prediction. Astronomy facts require source-backed ephemeris data.',
  }
}
