import { classifyCouncilTurn } from '@/lib/council/session-orchestration/turnIntent'
import { isSocialCouncilCheckin } from './socialCheckin'
import { isLightweightPingDecree } from '@/lib/council/contextRelevance'

const THANKS_OKAY =
  /^(?:thanks|thank you|thx|ty|okay|ok|got it|sounds good|cool|cheers)[!?.\s]*$/i

const DURABLE_SIGNALS =
  /\b(?:from now on|going forward|standing decree|always use|prefer|remember that|architecture decision|we decided|approved|project state)\b/i

export type MemoryCandidateDecision = {
  shouldPrompt: boolean
  reason: string
  durable: boolean
}

export function decideMemoryCandidatePrompt(input: {
  commanderText: string
  intentTier?: string
  attendanceWave?: boolean
  anySuccess?: boolean
}): MemoryCandidateDecision {
  const text = input.commanderText?.trim() ?? ''
  if (!input.anySuccess) {
    return { shouldPrompt: false, reason: 'no_successful_family_output', durable: false }
  }
  if (input.attendanceWave) {
    return { shouldPrompt: false, reason: 'attendance_wave', durable: false }
  }
  if (!text) {
    return { shouldPrompt: false, reason: 'empty_turn', durable: false }
  }
  if (isSocialCouncilCheckin(text) || isLightweightPingDecree(text) || THANKS_OKAY.test(text)) {
    return { shouldPrompt: false, reason: 'social_or_ack_turn', durable: false }
  }
  const classified = classifyCouncilTurn(text)
  if (
    classified.intent === 'GREETING'
    || classified.intent === 'STATUS_CHECK'
    || classified.intent === 'SOCIAL_CHECKIN'
    || classified.intent === 'FOLLOW_UP'
  ) {
    return { shouldPrompt: false, reason: `intent_${classified.intent}`, durable: false }
  }
  if (classified.depth === 'FAST' && classified.intent === 'KNOWLEDGE_QUESTION') {
    return { shouldPrompt: false, reason: 'trivial_fast_question', durable: false }
  }
  if (DURABLE_SIGNALS.test(text) || classified.intent === 'DIRECTIVE' || classified.intent === 'EXPLICIT_MEMORY') {
    return { shouldPrompt: true, reason: 'durable_commander_statement', durable: true }
  }
  if (input.intentTier === 'casual') {
    return { shouldPrompt: false, reason: 'casual_tier', durable: false }
  }
  if (text.length < 48 && !DURABLE_SIGNALS.test(text)) {
    return { shouldPrompt: false, reason: 'short_non_durable', durable: false }
  }
  return { shouldPrompt: true, reason: 'substantive_council_turn', durable: true }
}
