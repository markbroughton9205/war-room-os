import 'server-only'

import { gatherCouncilResearchSources } from './federationGather'
import { detectCouncilResearchIntent } from './intent'
import {
  buildRedTeamChallengePrompt,
  buildRoleUserPrompt,
  buildSynthesisPrompt,
  RESEARCH_TEAM_ROLES,
} from './roles'
import { invokeCouncilResearchRole } from './providers'
import {
  appendRedTeamSection,
  buildProposedOpportunity,
  buildUnavailableReport,
  deriveConfidence,
  extractUnknownsFromMarkdown,
} from './synthesize'
import type { CouncilResearchRunInput, FamilyRoleOutput, ResearchReport, ResearchStatus } from './types'

function phase(onPhase: CouncilResearchRunInput['onPhase'], status: ResearchStatus) {
  onPhase?.(status)
}

export async function runCouncilResearchTeam(
  input: CouncilResearchRunInput,
): Promise<ResearchReport> {
  const phases: ResearchStatus[] = []
  const recordPhase = (p: ResearchStatus) => {
    phases.push(p)
    phase(input.onPhase, p)
  }

  recordPhase('gathering_sources')
  const bundle = await gatherCouncilResearchSources({
    decree: input.decree,
    storyContext: input.storyContext,
  })

  if (bundle.sourcesUnavailable) {
    const report = buildUnavailableReport(bundle, input.decree)
    report.phases = [...phases, 'comparing_sources', 'red_team_check', 'final_answer_ready']
    recordPhase('final_answer_ready')
    return report
  }

  recordPhase('comparing_sources')
  const familyOutputs: FamilyRoleOutput[] = []
  const roleResults = await Promise.all(
    RESEARCH_TEAM_ROLES.map(async role => {
      const userPrompt = buildRoleUserPrompt({
        role,
        decree: input.decree,
        sourceBlock: bundle.sourceBlock,
      })
      const result = await invokeCouncilResearchRole({ role, userPrompt })
      return { role, ...result }
    }),
  )

  for (const r of roleResults) {
    familyOutputs.push({
      family: r.role,
      content: r.content,
      ok: r.ok,
      error: r.error,
    })
  }

  const familyNotes = familyOutputs
    .filter(f => f.ok && f.content.trim())
    .map(f => `### ${f.family}\n${f.content}`)
    .join('\n\n')

  const synthPrompt = buildSynthesisPrompt({
    decree: input.decree,
    sourceBlock: bundle.sourceBlock,
    familyNotes: familyNotes || '(No family outputs — synthesize from sources only.)',
  })

  const synth = await invokeCouncilResearchRole({
    role: 'chatgpt',
    userPrompt: synthPrompt,
  })

  let markdown = synth.ok && synth.content.trim()
    ? synth.content.trim()
    : [
        '## What\'s happening',
        familyNotes.slice(0, 2000) || 'Families did not return synthesis; see source bundle only.',
        '',
        '## Confidence level',
        'Low — synthesis provider unavailable.',
      ].join('\n')

  recordPhase('red_team_check')
  const redPrompt = buildRedTeamChallengePrompt({
    draftReport: markdown,
    sourceBlock: bundle.sourceBlock,
  })
  const red = await invokeCouncilResearchRole({ role: 'red_team', userPrompt: redPrompt })
  const redOut: FamilyRoleOutput = {
    family: 'red_team',
    content: red.content,
    ok: red.ok,
    error: red.error,
  }
  familyOutputs.push(redOut)
  markdown = appendRedTeamSection(markdown, redOut)

  const baby = await invokeCouncilResearchRole({
    role: 'baby',
    userPrompt: buildRoleUserPrompt({
      role: 'baby',
      decree: input.decree,
      sourceBlock: bundle.sourceBlock,
      priorNotes: familyNotes,
    }),
  })
  const babyLessonCandidate =
    baby.ok && baby.content.trim() && !/no lesson/i.test(baby.content)
      ? { text: baby.content.trim().slice(0, 400) }
      : null
  if (baby.ok) {
    familyOutputs.push({ family: 'baby', content: baby.content, ok: true })
  }

  const { level, score } = deriveConfidence(bundle)
  const unknowns = extractUnknownsFromMarkdown(markdown)

  recordPhase('final_answer_ready')

  return {
    markdown,
    status: 'final_answer_ready',
    phases: [...phases],
    sources: bundle.sources,
    confidenceLevel: level,
    confidenceScore: score,
    unknowns,
    sourcesUnavailable: false,
    operatorGuidance: bundle.operatorGuidance,
    proposedOpportunity: buildProposedOpportunity({ decree: input.decree, sources: bundle.sources }),
    babyLessonCandidate,
    generatedAt: bundle.generatedAt,
    familyOutputs,
  }
}

export { detectCouncilResearchIntent }
