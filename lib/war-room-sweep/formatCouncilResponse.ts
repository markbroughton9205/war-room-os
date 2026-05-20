import type { SweepReport } from './types'

export function formatCouncilOsSweepMarkdown(report: SweepReport): string {
  const { summary } = report
  const lines: string[] = [
    '**Running War Room OS sweep…** (source-backed, diagnostic only — no auto fixes applied)',
    '',
    `**Readiness:** ${summary.readinessScore}% · **Config gaps:** ${summary.missingConfigCount} · **Repairs:** ${summary.repairCount} · **Duplicates:** ${summary.duplicateCount} · **Stale/degraded:** ${summary.staleDegradedCount}`,
    '',
    '### Top 5 fixes',
    ...formatFindingList(summary.topFixes, 5),
    '',
    '### Top 3 additions',
    ...formatFindingList(summary.topAdditions, 3),
    '',
    '### Top 3 removals',
    ...formatFindingList(summary.topRemovals, 3),
    '',
    '### Duplicates',
    ...(summary.duplicates.length
      ? summary.duplicates.map(f => `- **${f.title}**${f.duplicateOf ? ` (dup of ${f.duplicateOf})` : ''} — ${f.suggestedAction}`)
      : ['- None flagged in this sweep.']),
    '',
    '### Missing configuration',
    ...(summary.missingConfig.length
      ? summary.missingConfig.slice(0, 8).map(f => `- **${f.severity}** ${f.title}: ${f.suggestedAction}`)
      : ['- No missing configuration items in current snapshot.']),
    '',
    summary.recommendedNextRepairPacketId
      ? `**Recommended next repair packet:** \`${summary.recommendedNextRepairPacketId}\` — use War Room Evolution → Generate Next Repair Packet or per-finding repair in Engineering drawer.`
      : '**Recommended next repair packet:** none required — readiness looks clear for BLOCKER/HIGH items.',
    '',
    '_Open Engineering drawer → OS Sweep for filters, repair packets, and Cursor commands. Operator view shows summary only._',
  ]
  return lines.join('\n')
}

function formatFindingList(findings: SweepReport['summary']['topFixes'], max: number): string[] {
  if (!findings.length) return ['- None in this category.']
  return findings.slice(0, max).map(
    (f, i) => `${i + 1}. **${f.severity}** · ${f.title} — ${f.suggestedAction}${f.repairPacketAvailable ? ' _(repair packet available)_' : ''}`,
  )
}
