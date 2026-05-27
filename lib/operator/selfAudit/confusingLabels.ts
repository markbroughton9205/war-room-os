import type { OperatorGap } from '../gapFinder'
import { JARGON_REPLACEMENTS, selfAuditGap } from './gapFactory'
import type { SelfAuditContext } from './types'

export function auditConfusingLabels(ctx: SelfAuditContext): OperatorGap[] {
  const gaps: OperatorGap[] = []
  const corpus = [
    ...(ctx.operatorLabels ?? []),
    ctx.chatHealthLabel ?? '',
    ctx.persistenceHealthLabel ?? '',
    ctx.memory?.runtimeLabel ?? '',
  ]
    .join('\n')
    .trim()

  if (!corpus) return gaps

  const seen = new Set<string>()
  JARGON_REPLACEMENTS.forEach((rule, index) => {
    if (!rule.pattern.test(corpus)) return
    const key = String(index)
    if (seen.has(key)) return
    seen.add(key)
    gaps.push(
      selfAuditGap({
        id: `self-audit-jargon-${index}`,
        title: `Jargon detected: ${rule.pattern.source.replace(/\\b|\\/gi, '')}`,
        plainLanguage: `Operators may not know “${corpus.match(rule.pattern)?.[0] ?? 'term'}” — try “${rule.plain}”.`,
        meaning: 'Operator-facing labels still use engineering vocabulary.',
        area: 'Labels & copy',
        category: 'Confusing Labels',
        kind: 'suggestion',
        severity: 'low',
        recommendedFix: rule.suggestion,
        cursorCommand: `Replace jargon in operator ribbons and panels: ${rule.suggestion}`,
      }),
    )
  })

  if (/\b0\.42\b/.test(corpus) || /\b42%\b/.test(corpus)) {
    gaps.push(
      selfAuditGap({
        id: 'self-audit-static-confidence-label',
        title: 'Static confidence percentage in UI',
        plainLanguage: 'A fixed confidence number (like 42%) may look real but be a placeholder.',
        meaning: 'Hard-coded confidence values confuse trust in council answers.',
        area: 'Council quality',
        category: 'Confusing Labels',
        kind: 'suggestion',
        severity: 'medium',
        recommendedFix: 'Hide confidence until computed from lib/council/confidenceScore.ts.',
        cursorCommand: 'Remove static 0.42 confidence placeholders from operator-visible components.',
      }),
    )
  }

  return gaps
}
