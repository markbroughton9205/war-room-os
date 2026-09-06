import { isLightweightPingDecree } from '@/lib/council/contextRelevance'
import { isSocialCouncilCheckin } from '@/lib/council/live-orchestration/socialCheckin'
import { detectResearchIntent } from '@/lib/research/researchIntent'
import type { CouncilOrchestrationDepth, CouncilTurnIntent } from './types'

export type ClassifiedCouncilTurn = {
  intent: CouncilTurnIntent
  depth: CouncilOrchestrationDepth
  shouldResearch: boolean
  researchReasons: string[]
  notes: string[]
}

const STATUS_PING =
  /^(?:(?:hey|hi|hello)\s+)?(?:council[,!]?\s+)?(?:quick\s+)?(?:status\s+ping|status(?:\s+check)?|ping)[!?.\s]*$/i

const WAR_ROOM_RUNTIME_STATUS =
  /(?:status\s+summary\s+of\s+(?:the\s+)?war\s*room|(?:war\s*room|runtime)\s+status|system\s+health|(?:give\s+me\s+(?:a\s+)?)?(?:short\s+)?status\s+summary|fresh\s+council\s+round|(?:current\s+)?runtime\s+health)/i

const PRESENCE_GOING_ON =
  /^(?:(?:hey|hi|hello)\s+)?(?:council[,!]?\s+)?(?:what(?:'s|s|\s+is)\s+going\s+on|whats\s+going\s+on)[!?.\s]*$/i

const WORLD_FRESH =
  /\b(?:world|global|headlines?|current\s+events?|breaking|today|right\s+now|this\s+(?:week|month)|bitcoin|markets?)\b/i

const EXPLICIT_MEMORY =
  /\b(?:tell\s+me\s+about|what(?:'s|s|\s+is)\s+our|remind\s+me|the\s+\w+\s+plan\s+we\s+discussed)\b/i

const FOLLOW_UP =
  /^(?:tell\s+me\s+more|more\s+on\s+that|go\s+deeper|continue|keep\s+going|and\s+then\??)[!?.\s]*$/i

const TRIVIAL_FACT =
  /^(?:what(?:'s|s|\s+is)\s+)?\d+\s*[+\-*/x×]\s*\d+\s*\??$/i

const STRATEGIC =
  /\b(?:strategy|strategic|decision|trade[- ]?off|should\s+we|recommend|council\s+deliberat)/i

const DIRECTIVE =
  /\b(?:decree|do\s+this|execute|ship\s+it|implement|make\s+it\s+so)\b/i

/**
 * Turn-level intent for session isolation, memory gating, and orchestration depth.
 * Complements (does not replace) Native Router / detectResearchIntent.
 */
export function classifyCouncilTurn(text: string): ClassifiedCouncilTurn {
  const raw = typeof text === 'string' ? text.trim() : ''
  const notes: string[] = []
  if (!raw) {
    return {
      intent: 'GREETING',
      depth: 'FAST',
      shouldResearch: false,
      researchReasons: ['empty_text'],
      notes: ['empty_commander_turn'],
    }
  }

  const research = detectResearchIntent(raw, { intentKind: 'natural' })
  const lightweight = isLightweightPingDecree(raw)
  const socialCheckin = isSocialCouncilCheckin(raw)
  const statusPing = STATUS_PING.test(raw) || (WAR_ROOM_RUNTIME_STATUS.test(raw) && !/\b(panama|freight|broughton|relocation)\b/i.test(raw))
  const presenceGoingOn = PRESENCE_GOING_ON.test(raw) && !WORLD_FRESH.test(raw)

  if (socialCheckin || lightweight || statusPing || presenceGoingOn) {
    notes.push(socialCheckin ? 'social_checkin' : lightweight ? 'lightweight_ping' : statusPing ? 'status_ping' : 'presence_going_on')
    return {
      intent: socialCheckin ? 'SOCIAL_CHECKIN' : statusPing ? 'STATUS_CHECK' : 'GREETING',
      depth: 'FAST',
      shouldResearch: false,
      researchReasons: ['excluded_fast_turn'],
      notes,
    }
  }

  if (FOLLOW_UP.test(raw)) {
    return {
      intent: 'FOLLOW_UP',
      depth: 'FAST',
      shouldResearch: false,
      researchReasons: ['local_follow_up'],
      notes: ['same_session_follow_up'],
    }
  }

  if (TRIVIAL_FACT.test(raw)) {
    return {
      intent: 'KNOWLEDGE_QUESTION',
      depth: 'FAST',
      shouldResearch: false,
      researchReasons: ['trivial_closed_form'],
      notes: ['no_durable_memory'],
    }
  }

  if (EXPLICIT_MEMORY.test(raw)) {
    notes.push('explicit_memory_ask')
    return {
      intent: 'EXPLICIT_MEMORY',
      depth: 'FULL',
      shouldResearch: research.shouldResearch,
      researchReasons: research.reasons,
      notes,
    }
  }

  if (research.shouldResearch) {
    const freshness = /\b(?:latest|today|right\s+now|breaking|current|going\s+on\s+with\s+the\s+world)\b/i.test(raw)
    const intent: CouncilTurnIntent = freshness || WORLD_FRESH.test(raw)
      ? (/\btoday|this\s+week|right\s+now\b/i.test(raw) ? 'TIME_SENSITIVE' : 'FRESHNESS_SENSITIVE')
      : 'RESEARCH_REQUEST'
    return {
      intent,
      depth: 'FULL',
      shouldResearch: true,
      researchReasons: research.reasons,
      notes: ['research_intent_positive'],
    }
  }

  if (STRATEGIC.test(raw)) {
    return {
      intent: 'STRATEGIC_ANALYSIS',
      depth: 'FULL',
      shouldResearch: false,
      researchReasons: research.reasons,
      notes: ['strategic_language'],
    }
  }

  if (DIRECTIVE.test(raw)) {
    return {
      intent: 'DIRECTIVE',
      depth: 'FULL',
      shouldResearch: false,
      researchReasons: research.reasons,
      notes: ['directive_language'],
    }
  }

  return {
    intent: 'KNOWLEDGE_QUESTION',
    depth: 'FULL',
    shouldResearch: false,
    researchReasons: research.reasons,
    notes: ['default_knowledge'],
  }
}

export function shouldRunFamilyDeliberation(classified: ClassifiedCouncilTurn): boolean {
  // STATUS_CHECK stays FAST so it skips memory/research, but Group still needs a live
  // Nebula round (ORION / LUMEN / AURORA) instead of the frontier engine-gate path.
  if (classified.intent === 'STATUS_CHECK') return true
  return classified.depth === 'FULL'
}

export function shouldInjectCommanderProfile(classified: ClassifiedCouncilTurn): boolean {
  return classified.depth === 'FULL' && classified.intent !== 'GREETING' && classified.intent !== 'STATUS_CHECK' && classified.intent !== 'SOCIAL_CHECKIN'
}
