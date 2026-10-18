/**
 * Critic findings. The critic reads the problem, constraints, plan, source, and evidence.
 */
import type { FoundryCriticFinding, FrkCriticCategory } from './types'
import { clipText } from './text'

export function critiqueIndependent(input: {
  findingId: string
  category: FrkCriticCategory
  summary: string
  blocksAcceptance: boolean
  problem: string
  constraints: string[]
  plan: string
  source: string
  evidence: string
}): { ok: true; finding: FoundryCriticFinding } | { ok: false; reason: string } {
  if (!input.problem || !input.plan || !input.source || !input.evidence) {
    return { ok: false, reason: 'Critic requires the problem, plan, source, and evidence, not an implementer summary.' }
  }
  if (!input.constraints) {
    return { ok: false, reason: 'Critic requires the constraint list.' }
  }
  return {
    ok: true,
    finding: {
      findingId: input.findingId,
      category: input.category,
      summary: clipText(input.summary),
      blocksAcceptance: input.blocksAcceptance,
      resolved: false,
      sawSource: true,
    },
  }
}

export function unresolvedCriticBlock(findings: FoundryCriticFinding[]): string | null {
  const open = findings.filter(item => item.blocksAcceptance && !item.resolved)
  if (!open.length) return null
  return `Critic finding blocks project ready: ${open.map(item => item.category).join(', ')}`
}
