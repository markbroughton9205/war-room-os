import type { CouncilOrchestrationFamily, PersistedCouncilMessage } from '@/components/council/councilSessionTypes'
import type { CommanderOperationEvent, CommanderOperationEventType } from '../unified-experience/types'
import { createMessageId } from '../messageIds'

export const CORE_FAMILIES: readonly CouncilOrchestrationFamily[] = [
  'chatgpt',
  'claude',
  'gemini',
  'grok',
  'red_team',
]

const FAMILY_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT Family',
  claude: 'Claude Family',
  gemini: 'Gemini Family',
  grok: 'Grok Family',
  red_team: 'RED TEAM',
}

/** Deterministic seeded PRNG (mulberry32) — same seed always produces the same simulated round. */
export function makeDeterministicRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type SimulatedRound = {
  roundIndex: number
  events: CommanderOperationEvent[]
  expectedResponded: CouncilOrchestrationFamily[]
  expectedFailed: CouncilOrchestrationFamily[]
  decree: PersistedCouncilMessage
  responses: PersistedCouncilMessage[]
}

/**
 * Generates one deterministic simulated Full Council round: a decree plus, per family, one of
 * {clean success, retry-then-success, clean failure, retry-then-still-fails, timeout}, plus an
 * occasional defensive event with unresolved family identity (must never count as a contribution).
 * Every event and message carries a round-scoped id/sequence so cross-round contamination is
 * detectable (Phase 3 reuses this to prove late/older-round events can't leak into a newer round).
 */
export function simulateRound(roundIndex: number, seed: number): SimulatedRound {
  const rng = makeDeterministicRng(seed)
  let sequence = 0
  const events: CommanderOperationEvent[] = []
  const expectedResponded: CouncilOrchestrationFamily[] = []
  const expectedFailed: CouncilOrchestrationFamily[] = []
  const responses: PersistedCouncilMessage[] = []
  const baseTime = Date.UTC(2026, 0, 1) + roundIndex * 60_000

  const mk = (
    overrides: Partial<CommanderOperationEvent> & { type: CommanderOperationEventType },
  ): CommanderOperationEvent => {
    sequence += 1
    return {
      id: `round-${roundIndex}-event-${sequence}`,
      sequence,
      timestamp: new Date(baseTime + sequence).toISOString(),
      familyId: null,
      familyLabel: null,
      roleLabel: null,
      statusLabel: 'Status',
      messageId: null,
      outputText: null,
      replyToEventId: null,
      replyToFamilyId: null,
      replyToLabel: null,
      provenance: 'provider_response',
      isActualProviderOutput: false,
      isFinal: false,
      ...overrides,
    }
  }

  const decreeContent = `Round ${roundIndex}: report status in one sentence.`
  const decree: PersistedCouncilMessage = {
    id: createMessageId(`sim-decree-${roundIndex}`),
    familyName: "RA'EL",
    content: decreeContent,
    timestamp: new Date(baseTime).toLocaleTimeString(),
    color: '#FFD700',
    icon: '⚔',
    provider: '',
    messageType: 'decree',
  }
  events.push(mk({ type: 'request_received' }))

  for (const family of CORE_FAMILIES) {
    const roll = rng()
    const respond = () => {
      const msgId = createMessageId(`sim-response-${roundIndex}-${family}`)
      events.push(mk({ type: 'family_responded', familyId: family, messageId: msgId, isActualProviderOutput: true, isFinal: true }))
      responses.push({
        id: msgId,
        familyName: FAMILY_LABELS[family] ?? family,
        content: `Round ${roundIndex} status from ${family}: council stabilization holding, no drift.`,
        timestamp: new Date(baseTime + sequence).toLocaleTimeString(),
        color: '#9CA3AF',
        icon: '•',
        provider: '',
        messageType: 'response',
      })
      expectedResponded.push(family)
    }
    const fail = (type: 'family_failed' | 'family_timed_out') => {
      events.push(mk({ type, familyId: family, isFinal: true }))
      expectedFailed.push(family)
    }

    if (roll < 0.6) {
      respond()
    } else if (roll < 0.78) {
      // Retry that ultimately succeeds — two terminal "responded" events for the same family.
      events.push(mk({ type: 'family_started', familyId: family }))
      respond()
      respond()
      // The second respond() above pushed a duplicate messageId+content combo onto responses;
      // only the family's LAST terminal event should be canonical, so drop the premature one.
      responses.splice(responses.length - 2, 1)
      expectedResponded.pop()
    } else if (roll < 0.9) {
      fail('family_failed')
    } else if (roll < 0.96) {
      // Retry that still ends in failure — premature "responded" later corrected to "failed".
      // No entry is added to responses/expectedResponded for the premature attempt.
      events.push(mk({ type: 'family_responded', familyId: family }))
      fail('family_failed')
    } else {
      fail('family_timed_out')
    }
  }

  // Defensive case: an event with no resolvable family identity must never count as a contribution.
  if (rng() < 0.15) {
    events.push(mk({ type: 'family_responded', familyId: 'unknown' }))
  }

  events.push(mk({ type: 'synthesis_completed', familyId: null, isFinal: true }))

  return { roundIndex, events, expectedResponded, expectedFailed, decree, responses }
}

export function simulateRounds(count: number, seedBase = 1): SimulatedRound[] {
  const rounds: SimulatedRound[] = []
  for (let i = 1; i <= count; i += 1) {
    rounds.push(simulateRound(i, seedBase + i * 7919))
  }
  return rounds
}
