import type { OperatorGap } from '../gapFinder'

export function dedupeGaps(gaps: OperatorGap[]): OperatorGap[] {
  const byId = new Map<string, OperatorGap>()
  for (const g of gaps) {
    const existing = byId.get(g.id)
    if (!existing || g.severity === 'high') byId.set(g.id, g)
  }
  return [...byId.values()]
}

export function mergeSelfAuditWithLegacyGaps(
  legacy: OperatorGap[],
  selfAudit: OperatorGap[],
): OperatorGap[] {
  const legacyIds = new Set(legacy.map(g => g.id))
  const supplemental = selfAudit.filter(g => !legacyIds.has(g.id))
  return dedupeGaps([...legacy, ...supplemental])
}

export function applyCommanderDismissals(
  gaps: OperatorGap[],
  dismissed: Partial<Record<string, string>> | undefined,
): OperatorGap[] {
  if (!dismissed || !Object.keys(dismissed).length) return gaps
  return gaps.map(g => {
    const dismissedAt = dismissed[g.id]
    if (!dismissedAt) return g
    return {
      ...g,
      status: 'needs_review' as const,
      fixedAt: dismissedAt,
      verificationEvidence: ['Commander marked not important — excluded from open count.'],
    }
  })
}

export function countActionableOpenGaps(gaps: OperatorGap[]): number {
  return gaps.filter(
    g =>
      g.status === 'open' &&
      !g.verificationEvidence?.some(e => e.includes('not important')),
  ).length
}
