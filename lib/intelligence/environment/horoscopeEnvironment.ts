export type AstrologyInterpretationMode = 'spiritual' | 'ancestral' | 'symbolic' | 'neutral' | 'entertainment'

export type AstrologyProfile = {
  sign: string
  birthDate: string
  birthTime: string
  birthPlace: string
}

export type HoroscopeProviderState = 'configured_adapter_pending' | 'not_configured'

export type HoroscopeSnapshot = {
  enabled: boolean
  mode: AstrologyInterpretationMode
  sign: string
  date: string
  birthTime: string
  birthPlace: string
  interpretation: string
  provider: string
  providerState: HoroscopeProviderState
  moonPhase?: string
  planetaryFacts: string[]
  framingNote: string
}

export const COMMANDER_ASTROLOGY_PROFILE: AstrologyProfile = {
  sign: 'Taurus',
  birthDate: 'May 10',
  birthTime: '3:14 PM',
  birthPlace: 'Minneapolis, MN',
}

const MODE_FRAMING: Record<AstrologyInterpretationMode, string> = {
  spiritual: 'Spiritual guidance mode for private Commander reflection.',
  ancestral: 'Ancestral pattern mode for lineage, memory, and inherited rhythm reflection.',
  symbolic: 'Symbolic archetype mode for pattern language and meaning-making.',
  neutral: 'Neutral mode: astrology interpretation is not verified factual prediction.',
  entertainment: 'Entertainment mode for light daily reflection.',
}

export function buildHoroscopeSnapshot(
  profile: AstrologyProfile = COMMANDER_ASTROLOGY_PROFILE,
  mode: AstrologyInterpretationMode = 'spiritual',
  configured = false,
): HoroscopeSnapshot {
  return {
    enabled: false,
    mode,
    sign: profile.sign,
    date: profile.birthDate,
    birthTime: profile.birthTime,
    birthPlace: profile.birthPlace,
    interpretation: configured
      ? `${profile.sign} Commander profile loaded; astrology adapter pending, so no live horoscope or planetary facts are displayed.`
      : `${profile.sign} Commander profile loaded; add an astrology provider adapter for source-backed horoscope data.`,
    provider: configured ? 'Configured, adapter pending' : 'Adapter pending',
    providerState: configured ? 'configured_adapter_pending' : 'not_configured',
    moonPhase: undefined,
    planetaryFacts: [],
    framingNote: MODE_FRAMING[mode],
  }
}
