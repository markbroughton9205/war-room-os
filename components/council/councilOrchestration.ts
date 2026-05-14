import { COUNCIL_FAMILY_COOLDOWN_TURNS, COUNCIL_RED_TEAM_EVERY_N_TURNS } from './councilConstants'
import type { CouncilOrchestrationFamily } from './councilSessionTypes'

const CORE_CLOUD: CouncilOrchestrationFamily[] = ['chatgpt', 'claude', 'grok']

const GEMINI_HINT_NEEDLES = [
  'plan',
  'synthesize',
  'synthesis',
  'document',
  'pdf',
  'image',
  'architecture',
  'long context',
  'research summary',
]

function normalizeText(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function heuristicPrefersGemini(context: string): boolean {
  const t = context.toLowerCase()
  return GEMINI_HINT_NEEDLES.some(n => t.includes(n))
}

/** Small stable hash for duplicate assistant debouncing. */
export function councilContentHash(text: string) {
  const t = normalizeText(text)
  let h = 0
  for (let i = 0; i < t.length; i++) h = (Math.imul(31, h) + t.charCodeAt(i)) | 0
  return `${h}:${t.length}`
}

export function pickNextOrchestrationFamily(params: {
  autonomousRoundIndex: number
  recentSpeakers: CouncilOrchestrationFamily[]
  deepDiscussionMode: boolean
  /** From GET /api/engine-control/status `gemini` row — Gemini is excluded from rotation when false. */
  geminiFunctional: boolean
  /** Last Ra'el decree plus recent thread text (keyword heuristic for Gemini slot). */
  orchestrationContext: string
  /** When true, Red Team speaks next (one-shot; caller clears after scheduling). */
  forceRedTeamEarly?: boolean
}): CouncilOrchestrationFamily {
  const {
    autonomousRoundIndex,
    recentSpeakers,
    deepDiscussionMode,
    geminiFunctional,
    orchestrationContext,
    forceRedTeamEarly,
  } = params

  if (forceRedTeamEarly) return 'red_team'

  const insertRed = autonomousRoundIndex > 0 && autonomousRoundIndex % COUNCIL_RED_TEAM_EVERY_N_TURNS === 0
  if (insertRed) return 'red_team'

  const pool: CouncilOrchestrationFamily[] = geminiFunctional ? [...CORE_CLOUD, 'gemini'] : [...CORE_CLOUD]
  const lastK = recentSpeakers.slice(-COUNCIL_FAMILY_COOLDOWN_TURNS)
  const geminiHint = geminiFunctional && heuristicPrefersGemini(orchestrationContext)

  const baseOrder = geminiFunctional ? [...CORE_CLOUD, 'gemini'] : CORE_CLOUD

  const score = (f: CouncilOrchestrationFamily) => {
    let s = baseOrder.indexOf(f)
    if (s < 0) s = 0
    if (lastK.includes(f)) s -= 10
    if (f === 'gemini' && geminiHint) s += 8
    return s
  }

  let best = pool[autonomousRoundIndex % pool.length]!
  let bestScore = score(best)
  for (const f of pool) {
    const sc = score(f)
    if (sc > bestScore) {
      best = f
      bestScore = sc
    }
  }

  if (deepDiscussionMode && autonomousRoundIndex % 11 === 10) return 'baby'

  return best
}

export function orchestrationFamilyToTypingFamily(
  f: CouncilOrchestrationFamily,
): 'CHATGPT FAMILY' | 'CLAUDE FAMILY' | 'GROK FAMILY' | 'GEMINI FAMILY' | 'KIMI FAMILY' | 'BRIDGE ARCHITECT' {
  if (f === 'gemini') return 'GEMINI FAMILY'
  if (f === 'claude' || f === 'red_team') return 'CLAUDE FAMILY'
  if (f === 'grok') return 'GROK FAMILY'
  if (f === 'kimi') return 'KIMI FAMILY'
  if (f === 'bridge_architect') return 'BRIDGE ARCHITECT'
  return 'CHATGPT FAMILY'
}

export function orchestrationFamilyToLocalAgentId(f: CouncilOrchestrationFamily): string | null {
  switch (f) {
    case 'chatgpt':
    case 'baby':
      return 'chatgpt-family-baby'
    case 'claude':
    case 'red_team':
      return f === 'red_team' ? 'red-team-baby' : 'claude-family-baby'
    case 'grok':
      return 'grok-family-baby'
    case 'kimi':
      return 'kimi-family-baby'
    case 'bridge_architect':
      return 'bridge-architect-baby'
    default:
      return null
  }
}
