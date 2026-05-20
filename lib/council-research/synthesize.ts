import type { GatheredSourceBundle } from './federationGather'
import type { FamilyRoleOutput, ResearchReport, SourceEvidenceLabel } from './types'

export function deriveConfidence(sources: GatheredSourceBundle): {
  level: ResearchReport['confidenceLevel']
  score: number
} {
  if (sources.sourcesUnavailable) {
    return { level: 'unknown', score: 0 }
  }
  const live = sources.sources.filter(s => s.evidenceLabel === 'LIVE_SIGNAL_BACKED').length
  const historical = sources.sources.filter(s => s.evidenceLabel === 'HISTORICAL_PATTERN_BASED').length
  const avg =
    sources.sources.length > 0
      ? sources.sources.reduce((n, s) => n + s.confidence, 0) / sources.sources.length
      : 0
  if (live >= 2 && avg >= 60) return { level: 'high', score: Math.min(0.95, avg / 100) }
  if (live >= 1 || avg >= 45) return { level: 'medium', score: Math.min(0.75, avg / 100) }
  if (historical > 0 && live === 0) return { level: 'low', score: 0.35 }
  return { level: 'low', score: Math.min(0.5, avg / 100) }
}

export function extractUnknownsFromMarkdown(markdown: string): string[] {
  const section = markdown.split(/##\s*what is unknown/i)[1]
  if (!section) return []
  return section
    .split('\n')
    .map(l => l.replace(/^[-*]\s*/, '').trim())
    .filter(l => l.length > 3 && !l.startsWith('#'))
    .slice(0, 8)
}

export function buildUnavailableReport(bundle: GatheredSourceBundle, decree: string): ResearchReport {
  const guidance = bundle.operatorGuidance ?? 'No live sources returned. Try a narrower question, paste a URL, or refresh News Intel.'
  const markdown = [
    '## What\'s happening',
    'No source-backed live picture is available right now. War Room did not fabricate current headlines or market moves.',
    '',
    '## Why it matters to Mark',
    'Acting without verified signals risks wasted attention or bad timing on cashflow and operations.',
    '',
    '## Money / business impact',
    'Unknown until sources respond — review Higher Vision, Broughton, and personal runway manually if urgent.',
    '',
    '## Family / life impact',
    'Not assessed — insufficient verified sources.',
    '',
    '## Risks',
    '- Deciding from memory or social rumor instead of cited evidence',
    '- Missing contradictory reporting',
    '',
    '## Best next move',
    `- ${guidance}`,
    '- Retry with a specific URL, ticker, or city name; or open News Intel and pick a story with a link.',
    '',
    '## Sources used',
    '- None returned (federation and live router exhausted or unconfigured)',
    '',
    '## Confidence level',
    'Unknown — no usable sources in this run.',
    '',
    '## What is unknown',
    `- Full answer to: ${decree.slice(0, 200)}`,
    '- Which providers failed (check Signal Federation / API keys)',
  ].join('\n')

  return {
    markdown,
    status: 'final_answer_ready',
    phases: ['gathering_sources', 'comparing_sources', 'red_team_check', 'final_answer_ready'],
    sources: bundle.sources,
    confidenceLevel: 'unknown',
    confidenceScore: 0,
    unknowns: extractUnknownsFromMarkdown(markdown),
    sourcesUnavailable: true,
    operatorGuidance: bundle.operatorGuidance,
    proposedOpportunity: null,
    babyLessonCandidate: null,
    generatedAt: bundle.generatedAt,
    familyOutputs: [],
  }
}

export function buildProposedOpportunity(args: {
  decree: string
  sources: GatheredSourceBundle['sources']
}): ResearchReport['proposedOpportunity'] {
  const backed = args.sources.find(s => s.evidenceLabel === 'LIVE_SIGNAL_BACKED' && s.url)
  const historical = args.sources.some(s => s.evidenceLabel === 'HISTORICAL_PATTERN_BASED')
  if (!backed && !historical) return null
  const evidenceLabel: SourceEvidenceLabel = backed ? 'LIVE_SIGNAL_BACKED' : 'HISTORICAL_PATTERN_BASED'
  const title = backed?.title ?? 'Pattern-based opportunity follow-up'
  return {
    title: title.slice(0, 160),
    whyNow: `Council research surfaced a ${evidenceLabel === 'LIVE_SIGNAL_BACKED' ? 'source-backed' : 'historical-pattern'} signal worth Commander review.`,
    evidenceLabel,
  }
}

export function appendRedTeamSection(markdown: string, redTeam: FamilyRoleOutput): string {
  if (!redTeam.ok || !redTeam.content.trim()) return markdown
  if (/no material red-team issues/i.test(redTeam.content)) return markdown
  return `${markdown}\n\n## Red Team notes\n${redTeam.content.trim()}`
}

export function formatSourcesSection(sources: GatheredSourceBundle['sources']): string {
  if (!sources.length) return '- None'
  return sources
    .slice(0, 12)
    .map(s => {
      const tag =
        s.evidenceLabel === 'HISTORICAL_PATTERN_BASED'
          ? ' (historical pattern)'
          : s.evidenceLabel === 'CACHED'
            ? ' (cached)'
            : ''
      return s.url ? `- [${s.title}](${s.url}) — ${s.provider}${tag}` : `- ${s.title} — ${s.provider}${tag}`
    })
    .join('\n')
}
