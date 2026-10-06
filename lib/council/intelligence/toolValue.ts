/**
 * Information-gain tool selection. Prefer one high-information probe over ten low-value calls.
 * Capability ≠ authority. Estimates do not grant execution.
 */

import { lookupCapability } from './capabilityRegistry'
import type { QuestionNode, ToolValueEstimate } from './orchestrationTypes'

export function estimateToolValue(input: {
  tool: string
  question: QuestionNode | { text: string }
}): ToolValueEstimate {
  const cap = lookupCapability(input.tool)
  const text = input.question.text.toLowerCase()
  const discriminating = /screenshot|crash|quota|pixel|sandbox|ollama|install|3847|3848/.test(text)
  const gain = discriminating && /health|ports|broker|council.backend/.test(input.tool)
    ? 'HIGH'
    : cap?.read_or_write === 'read'
      ? 'MED'
      : 'LOW'
  const authority = !cap
    ? 'DENY'
    : cap.approval_required || cap.financial || cap.production_mutation
      ? 'REQUIRE_APPROVAL'
      : 'ALLOW'
  return Object.freeze({
    tool: input.tool,
    question: input.question.text,
    expected_information_gain: gain,
    cost: cap?.local_or_external === 'external' ? 'MED' : 'LOW',
    latency: input.tool.startsWith('browser') || input.tool === 'research.web' ? 'MED' : 'LOW',
    risk: cap?.financial || cap?.production_mutation ? 'CRITICAL' : cap?.approval_required ? 'HIGH' : 'LOW',
    authority,
    reversibility: cap?.reversible !== false,
  })
}

export function pickHighInformationProbes(estimates: readonly ToolValueEstimate[], cap = 3): ToolValueEstimate[] {
  const allowed = estimates.filter(row => row.authority !== 'DENY')
  const ranked = [...allowed].sort((a, b) => score(b) - score(a))
  const chosen: ToolValueEstimate[] = []
  for (const row of ranked) {
    if (chosen.length >= cap) break
    if (row.expected_information_gain === 'LOW' && chosen.some(c => c.expected_information_gain === 'HIGH')) continue
    chosen.push(row)
  }
  return chosen
}

function score(row: ToolValueEstimate): number {
  const gain = { HIGH: 6, MED: 3, LOW: 1 }[row.expected_information_gain]
  const cost = { HIGH: 3, MED: 2, LOW: 1 }[row.cost]
  const risk = { CRITICAL: 5, HIGH: 3, MED: 2, LOW: 0 }[row.risk]
  return gain * 4 - cost - risk
}
