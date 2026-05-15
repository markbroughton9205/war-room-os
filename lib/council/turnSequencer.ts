import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

const DEFAULT_ORDER: CouncilOrchestrationFamily[] = [
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'red_team',
  'baby',
  'kimi',
  'bridge_architect',
]

/** Canonical speaker order for runtime diagnostics (filtered to families in play). */
export function buildDefaultDiagnosticOrder(families: CouncilOrchestrationFamily[]): CouncilOrchestrationFamily[] {
  const set = new Set(families)
  return DEFAULT_ORDER.filter(f => set.has(f))
}

export function nextSpeaker(
  order: CouncilOrchestrationFamily[],
  turnIndex: number,
): CouncilOrchestrationFamily | null {
  if (turnIndex < 0 || turnIndex >= order.length) return null
  return order[turnIndex] ?? null
}

/** After last speaker, `turnIndex === order.length` (no next speaker). */
export function advanceTurn(turnIndex: number, orderLength: number): number {
  if (orderLength <= 0) return 0
  return Math.min(turnIndex + 1, orderLength)
}
