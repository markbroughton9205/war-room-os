import { resolveTargetAgentProfile } from './agentProfiles'
import type { ComposePromptInput, ComposedPrompt } from './types'

const REPO_PATH = '/Users/markbroughton/Developer/war-room-os'

function projectAndLoopBlock(input: ComposePromptInput): string {
  const lines: string[] = []
  if (input.project) {
    lines.push(`ACTIVE PROJECT: ${input.project.name}`)
    if (input.project.current_objective) lines.push(`OBJECTIVE: ${input.project.current_objective}`)
    if (input.project.current_phase) lines.push(`PHASE: ${input.project.current_phase}`)
  } else {
    lines.push('ACTIVE PROJECT: none set for this conversation.')
  }
  if (input.topOpenLoop) {
    lines.push(`TOP OPEN LOOP: ${input.topOpenLoop.title}`)
    if (input.topOpenLoop.description) lines.push(`  ${input.topOpenLoop.description}`)
    if (input.topOpenLoop.next_action) lines.push(`  Recorded next action: ${input.topOpenLoop.next_action}`)
  } else {
    lines.push('TOP OPEN LOOP: none recorded.')
  }
  return lines.join('\n')
}

export function composePrompt(input: ComposePromptInput): ComposedPrompt {
  const targetAgent = resolveTargetAgentProfile(input.intent, input.genericTargetLabel)
  const stateBlock = projectAndLoopBlock(input)

  if (input.intent === 'GIVE_CLAUDE_NEXT_PROMPT') {
    const promptText = [
      `AUTHORITATIVE REPO: ${REPO_PATH}`,
      '',
      stateBlock,
      '',
      'Read CLAUDE.md at the repo root before starting — this repo has no Jest/Vitest; validation',
      'uses self-executing *.validation.ts files run via the existing pnpm "validate:*" scripts.',
      'Do not duplicate work already completed on the open loop above. Inspect current repo state',
      '(git status/log, relevant files) before writing code. Report completion per CLAUDE.md\'s',
      'required "## NEXT STEPS FOR OPERATOR" section.',
      '',
      'CONTEXT SNAPSHOT (assembled from current War Room state):',
      input.contextPromptText,
    ].join('\n')
    return { targetAgent, promptText }
  }

  if (input.intent === 'GIVE_CODEX_BUILD_PROMPT') {
    const promptText = [
      `AUTHORITATIVE REPO: ${REPO_PATH}`,
      '',
      stateBlock,
      '',
      'Build against the open loop above. This is a manual handoff — Codex has no War Room-side',
      'execution bridge in this repo yet, so the Commander pastes this prompt in manually.',
      '',
      'CONTEXT SNAPSHOT:',
      input.contextPromptText,
    ].join('\n')
    return { targetAgent, promptText }
  }

  if (input.intent === 'GIVE_KIMI_RESEARCH_PROMPT') {
    const gaps = input.openKnowledgeGaps ?? []
    const contradictions = input.unresolvedContradictions ?? []
    const targetingBlock = gaps.length || contradictions.length
      ? [
          'TARGET EXACTLY THESE UNRESOLVED ITEMS — do not repeat research already completed:',
          ...gaps.map(g => `- [gap: ${g.gapType}] ${g.question}`),
          ...contradictions.map(c => `- [unresolved contradiction] "${c.claimAText}" vs "${c.claimBText}"`),
        ].join('\n')
      : 'No open knowledge gaps or unresolved contradictions are recorded for this project yet — investigate the open loop above.'
    const promptText = [
      'RESEARCH MISSION',
      '',
      stateBlock,
      '',
      targetingBlock,
      '',
      'Cite sources; flag knowledge gaps rather than guessing.',
      '',
      'CONTEXT SNAPSHOT:',
      input.contextPromptText,
    ].join('\n')
    return { targetAgent, promptText }
  }

  const promptText = [
    `MISSION FOR: ${targetAgent.displayName}`,
    '',
    stateBlock,
    '',
    'CONTEXT SNAPSHOT:',
    input.contextPromptText,
  ].join('\n')
  return { targetAgent, promptText }
}
