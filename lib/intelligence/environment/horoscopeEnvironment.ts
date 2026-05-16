export type AstrologyInterpretationMode = 'spiritual' | 'ancestral' | 'symbolic' | 'neutral' | 'entertainment'

export type HoroscopeSnapshot = {
  enabled: boolean
  mode: AstrologyInterpretationMode
  sign: string
  date: string
  interpretation: string
  provider: string
  moonPhase?: string
  planetaryFacts: string[]
  framingNote: string
}

const MODE_FRAMING: Record<AstrologyInterpretationMode, string> = {
  spiritual: 'Spiritual guidance mode for private Commander reflection.',
  ancestral: 'Ancestral pattern mode for lineage, memory, and inherited rhythm reflection.',
  symbolic: 'Symbolic archetype mode for pattern language and meaning-making.',
  neutral: 'Neutral mode: astrology interpretation is not verified factual prediction.',
  entertainment: 'Entertainment mode for light daily reflection.',
}

export function buildHoroscopeSnapshot(
  sign = 'Aries',
  date = new Date(),
  mode: AstrologyInterpretationMode = 'spiritual',
): HoroscopeSnapshot {
  return {
    enabled: false,
    mode,
    sign,
    date: date.toISOString().slice(0, 10),
    interpretation: 'Horoscope provider not configured.',
    provider: 'None',
    moonPhase: undefined,
    planetaryFacts: [],
    framingNote: MODE_FRAMING[mode],
  }
}
