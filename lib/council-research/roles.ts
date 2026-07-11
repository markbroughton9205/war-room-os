import { buildPersonalizationBlock } from './personalize'
import type { FamilyRoleOutput } from './types'

export type CouncilResearchRole = FamilyRoleOutput['family']

export function buildRoleUserPrompt(args: {
  role: CouncilResearchRole
  decree: string
  sourceBlock: string
  priorNotes?: string
}): string {
  const personalization = buildPersonalizationBlock()
  const prior = args.priorNotes?.trim()
    ? `\n\n### Prior family notes (compare, do not repeat verbatim)\n${args.priorNotes.slice(0, 6000)}`
    : ''

  const roleBrief: Record<CouncilResearchRole, string> = {
    grok: 'Role: realtime signal scout — narrative shifts, social angle, what to verify next. Keep it sharp and short.',
    claude: 'Role: structure, risks, and business implications — invariants, evidence boundaries, what is solid vs assumed.',
    gemini: 'Role: cross-check and contradiction finder — compare sources, flag mismatches and stale items.',
    chatgpt: 'Role: final synthesis in plain language for Ra\'el — actionable, organized, no filler.',
    red_team: 'Role: challenge bad assumptions, scams, weak evidence, and overconfidence. Be specific.',
    baby: 'Role: observational witness ONLY — one short lesson candidate sentence if a durable pattern appears; do not answer the decree.',
  }

  return [
    roleBrief[args.role],
    '',
    personalization,
    '',
    `### Decree\n${args.decree.slice(0, 2800)}`,
    '',
    '### Source bundle (authoritative for facts)',
    args.sourceBlock,
    prior,
  ].join('\n')
}

export function buildSynthesisPrompt(args: {
  decree: string
  sourceBlock: string
  familyNotes: string
}): string {
  return [
    'Synthesize the council research team notes into ONE operator-facing report.',
    'Required sections (markdown headings, plain language):',
    "## What's happening",
    '## Why it matters to Mark',
    '## Money / business impact',
    '## Family / life impact (only if relevant; otherwise say "Not materially relevant from current sources.")',
    '## Risks',
    '## Best next move',
    '## Sources used (bulleted, with URLs when present)',
    '## Confidence level (High / Medium / Low / Unknown — one line with reason)',
    '## What is unknown',
    '',
    buildPersonalizationBlock(),
    '',
    `### Decree\n${args.decree.slice(0, 2000)}`,
    '',
    '### Sources',
    args.sourceBlock,
    '',
    '### Family notes',
    args.familyNotes.slice(0, 10_000),
  ].join('\n')
}

export function buildRedTeamChallengePrompt(args: {
  draftReport: string
  sourceBlock: string
}): string {
  return [
    'Review this draft council research report. List only material issues: unsupported claims, scam patterns, weak evidence, missing caveats.',
    'If the draft is well-calibrated, reply "No material red-team issues."',
    '',
    '### Draft report',
    args.draftReport.slice(0, 8000),
    '',
    '### Sources',
    args.sourceBlock.slice(0, 6000),
  ].join('\n')
}

export const RESEARCH_TEAM_ROLES: CouncilResearchRole[] = ['grok', 'claude', 'gemini']
