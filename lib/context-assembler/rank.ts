import { DEFAULT_CONTEXT_BUDGET, SECTION_DROP_PRIORITY, estimateTokens, truncateToTokenCap } from './budget'
import type { ContextBudget, ContextSection, ContextSourceRef } from './types'

export type RankResult = {
  included: ContextSection[]
  includedSourceIds: ContextSourceRef[]
  excludedSourceIds: ContextSourceRef[]
  totalTokens: number
  breakdown: Record<string, number>
}

/**
 * Deterministic two-pass budgeting:
 *  1. Per-section truncation to that section's own cap (never reorders sections).
 *  2. If the sum still exceeds the global budget, drop whole sections in ascending
 *     SECTION_DROP_PRIORITY order (lowest-value first) until it fits. 'identity' is never dropped.
 * Presentation order (the order `sections` was passed in) is preserved for whatever survives.
 */
export function rankAndBudget(
  sections: ContextSection[],
  budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
): RankResult {
  const excludedSourceIds: ContextSourceRef[] = []

  const truncated = sections.map(section => {
    const cap = budget.sectionCaps[section.kind] ?? section.tokenEstimate
    const { text, truncated: wasTruncated } = truncateToTokenCap(section.text, cap)
    if (!wasTruncated) return section
    // Truncation invalidates any source ref whose content lived past the cut point. We don't know
    // exactly which refs survived textually, so conservatively keep the first ref (usually the
    // section's primary subject) and mark the rest excluded.
    const [kept, ...rest] = section.sourceRefs
    excludedSourceIds.push(...rest)
    return {
      ...section,
      text,
      tokenEstimate: estimateTokens(text),
      sourceRefs: kept ? [kept] : [],
    }
  })

  let totalTokens = truncated.reduce((sum, s) => sum + s.tokenEstimate, 0)

  const survivorKinds = new Set(truncated.map(s => s.kind))
  const dropOrder = [...survivorKinds].sort(
    (a, b) => (SECTION_DROP_PRIORITY[a] ?? 0) - (SECTION_DROP_PRIORITY[b] ?? 0),
  )

  const dropped = new Set<string>()
  for (const kind of dropOrder) {
    if (totalTokens <= budget.totalTokens) break
    if (kind === 'identity') continue
    const section = truncated.find(s => s.kind === kind && !dropped.has(s.kind))
    if (!section) continue
    dropped.add(kind)
    totalTokens -= section.tokenEstimate
    excludedSourceIds.push(...section.sourceRefs)
  }

  const included = truncated.filter(s => !dropped.has(s.kind))
  const includedSourceIds = included.flatMap(s => s.sourceRefs)
  const breakdown: Record<string, number> = {}
  for (const section of included) breakdown[section.kind] = section.tokenEstimate

  return { included, includedSourceIds, excludedSourceIds, totalTokens, breakdown }
}
