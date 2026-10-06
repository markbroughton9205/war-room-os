/**
 * AURORA executive synthesis. Dynamic structure. No raw agent chat.
 * Does not invent facts or false consensus.
 */

import type { CognitiveStrategy, CompletionVerdict, ConflictRecord } from './orchestrationTypes'
import type { JanusAnalysis, MissionContractV1, SentinelReview } from './types'
import type { EbcMissionResult } from '@/lib/council/evidence-board/types'

export function auroraSynthesisShape(strategy: CognitiveStrategy): 'prose' | 'research' | 'decision' | 'incident' | 'engineering' {
  if (strategy.id === 'DIRECT') return 'prose'
  if (strategy.id === 'RESEARCH') return 'research'
  if (strategy.id === 'COMPARE' || strategy.id === 'DESIGN' || strategy.id === 'SIMULATE') return 'decision'
  if (strategy.id === 'DIAGNOSE' || strategy.id === 'INCIDENT_RESPONSE') return 'incident'
  if (strategy.id === 'PLAN' || strategy.id === 'REVIEW') return 'engineering'
  return 'prose'
}

export function composeAuroraBrief(input: {
  contract: MissionContractV1
  strategy: CognitiveStrategy
  ebc: EbcMissionResult | null
  janus: JanusAnalysis | null
  sentinel: SentinelReview | null
  conflicts: readonly ConflictRecord[]
  completion: CompletionVerdict
}): string {
  const unresolved = input.conflicts.filter(c => c.unresolved)
  const shape = auroraSynthesisShape(input.strategy)
  let brief: string
  if (input.ebc?.commander_brief && input.strategy.id !== 'COMPARE' && input.completion === 'COMPLETE') {
    brief = input.ebc.commander_brief
  } else {
    const facts = (input.ebc?.board.claims ?? []).filter(c => c.status === 'VERIFIED' || c.status === 'SUPPORTED')
    const lines: string[] = []
    if (shape === 'prose') brief = input.ebc?.commander_brief || input.contract.objective
    else {
      if (shape === 'research') {
        lines.push(input.ebc?.commander_brief || input.contract.objective)
        lines.push(`Findings: ${facts.length} evidence-backed claims. Sources remain on the Evidence Board.`)
        if (unresolved.length) lines.push(`Unresolved: ${unresolved.map(c => c.disputed_claim).join('; ')}`)
      }
      if (shape === 'decision') {
        lines.push(`Recommendation is bounded by authority (commit=${input.contract.authority.commit}, deploy=${input.contract.authority.production_deploy}).`)
        if (input.janus?.invoked) lines.push(`Alternatives: ${input.janus.scenarios.map(s => s.option).join(' | ')}`)
        if (input.sentinel?.invoked) lines.push(`Risks: ${input.sentinel.risks.map(r => r.category).join(', ') || 'none material'}`)
        if (unresolved.length) lines.push(`The evidence does not yet resolve: ${unresolved.map(c => c.disputed_claim).join('; ')}`)
      }
      if (shape === 'incident') {
        lines.push(input.ebc?.commander_brief || 'Current state from live probes.')
        lines.push('Likely cause remains a hypothesis until EBC verifies it.')
      }
      if (shape === 'engineering') {
        lines.push(`Plan constrained by: ${input.contract.explicit_exclusions.join(', ') || 'stated authority'}. No mutation in this pass.`)
      }
      brief = lines.filter(Boolean).join('\n') || input.contract.objective
    }
  }
  if (input.completion === 'NEEDS_MORE_EVIDENCE') {
    return `${brief}\nStill missing: required evidence for blocking questions. Completion: ${input.completion}.`
  }
  if (input.completion === 'BLOCKED') {
    return `${brief}\nBlocked: SENTINEL, TOOL_BLOCKED, or unresolved hard dependency. Completion: ${input.completion}.`
  }
  if (input.completion === 'NEEDS_COMMANDER') {
    return `${brief}\nCommander decision required: authority or scope amendment. Completion: ${input.completion}.`
  }
  if (input.completion === 'PARTIALLY_COMPLETE') {
    return `${brief}\nPartial: useful result above; remaining gap: verification or evidence. Completion: ${input.completion}.`
  }
  if (input.completion === 'FAILED') {
    return `${brief}\nFailed: task failure. Completion: ${input.completion}.`
  }
  if (input.strategy.id === 'DIRECT') return brief
  return `${brief}\nCompletion: ${input.completion}`
}
