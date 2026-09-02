import type { CouncilTurnIntent } from './types'

const WORLD_SUBQUESTIONS = [
  'current geopolitics and major conflicts',
  'global economics and markets',
  'technology and AI developments',
  'climate and major disasters',
  'public health headlines',
  'notable law and policy changes',
]

/**
 * Broad research asks get non-overlapping subquestions for the existing live research router.
 * Does not fan out a separate provider per subquestion.
 */
export function expandResearchQuery(commanderText: string, intent: CouncilTurnIntent): string {
  const t = commanderText.trim()
  const worldish =
    intent === 'FRESHNESS_SENSITIVE'
    || intent === 'TIME_SENSITIVE'
    || /\bwhat(?:'s|s|\s+is)\s+going\s+on\s+with\s+the\s+world\b/i.test(t)
    || /\bworld\b/.test(t) && /\b(going on|happening|brief|news)\b/i.test(t)
  if (!worldish) return t
  return [
    t,
    '',
    'Cover distinct current-event areas without repeating the same search:',
    ...WORLD_SUBQUESTIONS.map((q, i) => `${i + 1}. ${q}`),
  ].join('\n')
}

export function listWorldBriefSubquestions(): string[] {
  return [...WORLD_SUBQUESTIONS]
}
