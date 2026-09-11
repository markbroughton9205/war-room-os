import {
  MAX_CONCLUSION_CHARS,
  MAX_OBJECTIVE_CHARS,
  type CouncilSessionIntelligenceV1,
  type DurableContinuationContext,
  type DurableDeliberationRound,
} from './types'
import { clampText } from './snapshot'

/**
 * Bounded continuation context for a follow-up Commander request in the SAME conversation.
 * Does not inject the full prior transcript.
 */
export function buildContinuationPromptBlock(
  intelligence: CouncilSessionIntelligenceV1 | null | undefined,
): string | null {
  if (!intelligence || intelligence.rounds.length === 0) return null
  const prior = intelligence.rounds[intelligence.rounds.length - 1]
  const ctx = prior.continuationContext
  const lines: string[] = [
    '[PRIOR SESSION INTELLIGENCE — Council history, not current live evidence]',
    `conversationId: ${intelligence.conversationId}`,
    `priorRoundId: ${prior.roundId}`,
    `priorOutcome: ${prior.outcome}`,
  ]

  const objective = clampText(ctx.previousObjective ?? prior.commanderRequest, MAX_OBJECTIVE_CHARS)
  if (objective) lines.push(`previousObjective: ${objective}`)

  const synthesis = clampText(ctx.previousSynthesisSummary, MAX_CONCLUSION_CHARS)
  if (synthesis) lines.push(`priorSynthesis: ${synthesis}`)

  if (ctx.failedSeats.length) {
    lines.push(`priorFailedSeats: ${ctx.failedSeats.join(', ')}`)
    lines.push('Do not fabricate missing seat contributions from the prior round.')
  }
  if (ctx.degradedReasons.length) {
    lines.push(`priorDegradedReasons: ${ctx.degradedReasons.slice(0, 6).join(' | ')}`)
  }
  if (ctx.unresolvedQuestions.length) {
    lines.push(`unresolvedQuestions: ${ctx.unresolvedQuestions.slice(0, 5).join(' | ')}`)
  }
  if (ctx.evidenceIds.length) {
    lines.push(`priorEvidenceIds: ${ctx.evidenceIds.slice(0, 20).join(', ')}`)
  }
  if (ctx.authoritativeContributionSummaries.length) {
    lines.push('authoritativePriorContributions:')
    for (const s of ctx.authoritativeContributionSummaries.slice(0, 5)) {
      lines.push(`- ${s}`)
    }
  }

  const digest = intelligence.sessionDigest
  if (digest.lastSynthesis && digest.lastSynthesis !== synthesis) {
    lines.push(`sessionDigest.lastSynthesis: ${clampText(digest.lastSynthesis, MAX_CONCLUSION_CHARS)}`)
  }
  if (digest.establishedConclusions.length) {
    lines.push(`establishedConclusions: ${digest.establishedConclusions.slice(-3).join(' | ')}`)
  }

  lines.push('[End PRIOR SESSION INTELLIGENCE]')
  lines.push('Treat the above as prior Council conclusions and provenance only. Do not treat prior synthesis or member opinions as new independent evidence sources.')
  return lines.join('\n')
}

export function continuationAllowsNewRound(
  prior: DurableDeliberationRound | null | undefined,
): { allowed: boolean; reason: string } {
  if (!prior) return { allowed: true, reason: 'no_prior_round' }
  // COMPLETE, DEGRADED, FAILED, INTERRUPTED all allow a new Commander round.
  // We never auto-retry; Commander must start the follow-up explicitly.
  return { allowed: true, reason: `prior_outcome_${prior.outcome}` }
}

export function assertSameConversationContinuation(input: {
  conversationId: string
  intelligence: CouncilSessionIntelligenceV1 | null | undefined
}): { ok: boolean; error?: string } {
  if (!input.intelligence) return { ok: true }
  if (input.intelligence.conversationId !== input.conversationId) {
    return {
      ok: false,
      error: 'session_intelligence_conversation_mismatch',
    }
  }
  return { ok: true }
}

export function summarizeContinuationContext(
  ctx: DurableContinuationContext,
): Record<string, unknown> {
  return {
    previousOutcome: ctx.previousOutcome,
    hasSynthesis: Boolean(ctx.previousSynthesisSummary),
    failedSeatCount: ctx.failedSeats.length,
    evidenceCount: ctx.evidenceIds.length,
    unresolvedCount: ctx.unresolvedQuestions.length,
    contributionCount: ctx.authoritativeContributionSummaries.length,
  }
}
