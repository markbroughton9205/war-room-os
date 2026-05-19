import type { CouncilCompressionMessage, CouncilCompressedSummary } from '@/lib/council/compression'
import { compressCouncilOutput } from '@/lib/council/compression'
import { toDisplayText } from '@/lib/council/toDisplayText'
import {
  MESSAGE_THRESHOLD_FOR_COMPRESSION,
  TOKEN_ESTIMATE_THRESHOLD,
} from '@/lib/conversation-runtime/config'

export type RollingCompressionResult = {
  applied: boolean
  summaryBlock: string
  compressed: CouncilCompressedSummary
  preserved: {
    decreeExcerpt: string | null
    decisions: string[]
    contradictions: string[]
    unresolvedQuestions: string[]
  }
  tokenEstimateBefore: number
  tokenEstimateAfter: number
}

function estimateTokens(messages: CouncilCompressionMessage[]): number {
  const chars = messages.reduce((sum, m) => sum + toDisplayText(m.content).length, 0)
  return Math.ceil(chars / 4)
}

function latestDecreeExcerpt(messages: CouncilCompressionMessage[]): string | null {
  const decree = messages.findLast(m => {
    const fam = m.familyName.toUpperCase()
    return m.messageType === 'decree' || fam.includes("RA'EL") || fam === 'RAEL'
  })
  if (!decree) return null
  const text = toDisplayText(decree.content).trim()
  return text ? text.slice(0, 320) : null
}

function extractUnresolvedQuestions(messages: CouncilCompressionMessage[]): string[] {
  const lines: string[] = []
  for (const message of messages) {
    for (const line of toDisplayText(message.content).split(/\n+/)) {
      const t = line.trim()
      if (t.endsWith('?') && t.length > 16) lines.push(t.slice(0, 200))
    }
  }
  return [...new Set(lines)].slice(0, 8)
}

export function shouldApplyRollingCompression(messages: CouncilCompressionMessage[]): boolean {
  if (messages.length >= MESSAGE_THRESHOLD_FOR_COMPRESSION) return true
  return estimateTokens(messages) >= TOKEN_ESTIMATE_THRESHOLD
}

/**
 * Rolling compression: summarize older discussion while preserving decree, decisions,
 * contradictions, and unresolved questions. Builds on Phase 20 `compressCouncilOutput`.
 */
export function applyRollingContextCompression(
  messages: CouncilCompressionMessage[],
  mode: import('@/lib/council/compression').CouncilOutputMode = 'standard',
): RollingCompressionResult {
  const tokenEstimateBefore = estimateTokens(messages)
  const compressed = compressCouncilOutput(messages, mode)
  const applied = shouldApplyRollingCompression(messages)

  const preserved = {
    decreeExcerpt: latestDecreeExcerpt(messages),
    decisions: compressed.decisionSummary.slice(0, 6),
    contradictions: compressed.disagreements.slice(0, 6),
    unresolvedQuestions: extractUnresolvedQuestions(messages),
  }

  const summaryParts = [
    preserved.decreeExcerpt ? `Decree: ${preserved.decreeExcerpt}` : null,
    preserved.decisions.length ? `Decisions: ${preserved.decisions.join(' | ')}` : null,
    preserved.contradictions.length ? `Contradictions: ${preserved.contradictions.join(' | ')}` : null,
    preserved.unresolvedQuestions.length ? `Open questions: ${preserved.unresolvedQuestions.join(' | ')}` : null,
    `Risk (${compressed.risk.level}): ${compressed.risk.summary}`,
    `Next: ${compressed.nextAction}`,
  ].filter(Boolean)

  const summaryBlock = summaryParts.join('\n')
  const tokenEstimateAfter = Math.ceil(summaryBlock.length / 4)

  return {
    applied,
    summaryBlock,
    compressed,
    preserved,
    tokenEstimateBefore,
    tokenEstimateAfter,
  }
}
