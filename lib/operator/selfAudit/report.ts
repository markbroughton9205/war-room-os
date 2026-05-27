import type { OperatorGap } from '../gapFinder'
import type { SelfAuditFindingKind } from './types'

function sectionForGap(g: OperatorGap): string {
  if (g.status === 'fixed') return 'Fixed Recently'
  if (g.category === 'Duplicate Features' || g.kind === 'duplicate') return 'Duplicates'
  if (g.category === 'Placeholder Values' || g.kind === 'placeholder') return 'Placeholders'
  if (g.category === 'Mobile Layout Risk' || g.kind === 'mobile') return 'Mobile Risks'
  if (g.category === 'Revenue Readiness' || g.kind === 'revenue') return 'Revenue Gaps'
  if (g.kind === 'suggestion' || g.category === 'Confusing Labels') return 'Suggestions'
  if (g.status === 'open') return 'Open Issues'
  return 'Other'
}

export function formatSelfAuditReport(gaps: OperatorGap[]): string {
  const buckets = new Map<string, OperatorGap[]>()
  for (const g of gaps) {
    const key = sectionForGap(g)
    const list = buckets.get(key) ?? []
    list.push(g)
    buckets.set(key, list)
  }

  const order = [
    'Open Issues',
    'Suggestions',
    'Duplicates',
    'Placeholders',
    'Mobile Risks',
    'Revenue Gaps',
    'Fixed Recently',
    'Other',
  ]

  const lines = [
    '# War Room Self-Audit Report',
    `Generated: ${new Date().toISOString()}`,
    `Total findings: ${gaps.length}`,
    '',
  ]

  for (const title of order) {
    const items = buckets.get(title)
    if (!items?.length) continue
    lines.push(`## ${title} (${items.length})`)
    items.forEach((g, i) => {
      lines.push(`### ${i + 1}. ${g.title} [${g.severity}] · ${g.status}`)
      lines.push(`Category: ${g.category}`)
      lines.push(`Plain language: ${g.plainLanguage}`)
      if (g.mergedSources && g.mergedSources.length > 1) {
        lines.push(`Merged sources: ${g.mergedSources.join(' · ')}`)
      }
      lines.push(`Meaning: ${g.meaning}`)
      lines.push(`Recommended: ${g.recommendedFix}`)
      lines.push(`Cursor: ${g.cursorCommand}`)
      if (g.verificationEvidence?.length) {
        lines.push(`Evidence: ${g.verificationEvidence.join('; ')}`)
      }
      lines.push('')
    })
  }

  if (!gaps.length) lines.push('No self-audit findings with current heuristics.')
  return lines.join('\n').trim()
}

export function topSelfAuditCursorCommand(gaps: OperatorGap[]): string | null {
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const open = gaps
    .filter(g => g.status === 'open')
    .sort((a, b) => rank[a.severity] - rank[b.severity])
  return open[0]?.cursorCommand ?? null
}

export function gapsBySelfAuditSection(gaps: OperatorGap[]): Record<string, OperatorGap[]> {
  const out: Record<string, OperatorGap[]> = {}
  for (const g of gaps) {
    const key = sectionForGap(g)
    out[key] = [...(out[key] ?? []), g]
  }
  return out
}

export type { SelfAuditFindingKind }
