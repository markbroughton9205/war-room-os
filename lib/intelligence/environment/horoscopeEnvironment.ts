export type AstrologyInterpretationMode = 'spiritual' | 'ancestral' | 'symbolic' | 'neutral' | 'entertainment'
export type HoroscopePeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'

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
  period: HoroscopePeriod
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

const SYMBOLIC_GUIDANCE: Record<AstrologyInterpretationMode, Record<HoroscopePeriod, string>> = {
  spiritual: {
    daily: 'Ground the day in one concrete act of care, then let the next decision come from steadiness rather than pressure.',
    weekly: 'Protect your attention this week. A slower rhythm makes the strongest signal easier to hear.',
    monthly: 'Build around what has proven nourishing, not what merely looks urgent. Let devotion become structure.',
    yearly: 'The long arc favors patience, embodied judgment, and commitments that can survive ordinary days.',
  },
  ancestral: {
    daily: 'Notice the inherited pattern that asks for a different response today. Choose the repairable path.',
    weekly: 'Return to the practices that kept people alive before everything was optimized. Simplicity is intelligence.',
    monthly: 'An old family rhythm may be asking to be honored without being repeated. Keep the wisdom, release the burden.',
    yearly: 'This cycle favors legacy work: tending roots, naming patterns, and building something kinder for the next generation.',
  },
  symbolic: {
    daily: 'Read the day through material signals: pace, appetite, friction, and ease. The body is part of the dashboard.',
    weekly: 'A fixed-earth pattern is useful now: fewer abstractions, more durable moves, and proof through practice.',
    monthly: 'Let symbols become decisions. Beauty, money, shelter, and loyalty all point toward what needs tending.',
    yearly: 'The larger motif is consolidation: make the life around the mission strong enough to carry it.',
  },
  neutral: {
    daily: 'Use this as reflective journaling, not prediction: identify one priority, one boundary, and one thing to leave alone.',
    weekly: 'Review patterns in energy and attention. Treat repeated friction as planning data.',
    monthly: 'Look for what consistently supports clear judgment. Keep the routines that make evidence easier to act on.',
    yearly: 'Frame the year around observable commitments, relationships, and resources rather than unverifiable forecasts.',
  },
  entertainment: {
    daily: 'A good day for practical magic: clean one surface, answer one message, and take the win.',
    weekly: 'Main character energy is allowed, but the plot improves when the calendar is honest.',
    monthly: 'Romance the routine a little. The mundane parts of the mission still deserve atmosphere.',
    yearly: 'Big Taurus-coded arc: protect the peace, upgrade the snacks, and make the empire comfortable enough to last.',
  },
}

export function buildHoroscopeSnapshot(
  profile: AstrologyProfile = COMMANDER_ASTROLOGY_PROFILE,
  mode: AstrologyInterpretationMode = 'spiritual',
  configured = false,
  period: HoroscopePeriod = 'daily',
): HoroscopeSnapshot {
  return {
    enabled: false,
    mode,
    period,
    sign: profile.sign,
    date: profile.birthDate,
    birthTime: profile.birthTime,
    birthPlace: profile.birthPlace,
    interpretation: SYMBOLIC_GUIDANCE[mode][period],
    provider: configured ? 'Configured astrology source; live adapter not connected' : 'Symbolic fallback',
    providerState: configured ? 'configured_adapter_pending' : 'not_configured',
    moonPhase: undefined,
    planetaryFacts: [],
    framingNote: `${MODE_FRAMING[mode]} This is interpretive fallback guidance, not live provider-calculated astrology.`,
  }
}
