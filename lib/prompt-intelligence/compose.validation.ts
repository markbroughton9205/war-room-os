import { pathToFileURL } from 'node:url'
import { composePrompt } from './compose'
import type { ComposePromptInput, PromptIntent } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function baseInput(intent: PromptIntent, genericTargetLabel?: string): ComposePromptInput {
  return {
    intent,
    conversationId: 'conv-1',
    projectId: 'proj-1',
    genericTargetLabel,
    contextPromptText: '## Active project\nRa\'el Spine',
    project: { name: 'Ra\'el Spine', current_objective: 'Ship Wave 1', current_phase: 'implementation' },
    topOpenLoop: { title: 'Wire prompt intelligence', description: null, next_action: 'write compose.ts' },
  }
}

function testAllFourIntentsProduceNonEmptyOutput(): CaseResult[] {
  const intents: PromptIntent[] = ['GIVE_CLAUDE_NEXT_PROMPT', 'GIVE_KIMI_RESEARCH_PROMPT', 'GIVE_CODEX_BUILD_PROMPT', 'GENERIC_AGENT_MISSION_PROMPT']
  return intents.map(intent => {
    const result = composePrompt(baseInput(intent, intent === 'GENERIC_AGENT_MISSION_PROMPT' ? 'Gemini' : undefined))
    return check(`${intent}_produces_nonempty_prompt`, result.promptText.trim().length > 0, `len=${result.promptText.length}`)
  })
}

function testClaudeRoutesThroughEngineeringRegistry(): CaseResult[] {
  const result = composePrompt(baseInput('GIVE_CLAUDE_NEXT_PROMPT'))
  return [
    check('claude_target_agent_id_is_claude_code', result.targetAgent.agentId === 'claude_code', result.targetAgent.agentId),
    check('claude_source_is_engineering_registry', result.targetAgent.source === 'engineering_agent_registry', result.targetAgent.source),
  ]
}

function testCodexRoutesThroughEngineeringRegistry(): CaseResult[] {
  const result = composePrompt(baseInput('GIVE_CODEX_BUILD_PROMPT'))
  return [
    check('codex_target_agent_id_is_codex', result.targetAgent.agentId === 'codex', result.targetAgent.agentId),
    check('codex_source_is_engineering_registry', result.targetAgent.source === 'engineering_agent_registry', result.targetAgent.source),
  ]
}

function testKimiRoutesThroughCouncilRegistryNeverEngineering(): CaseResult[] {
  const result = composePrompt(baseInput('GIVE_KIMI_RESEARCH_PROMPT'))
  return [
    check('kimi_target_agent_id_is_kimi', result.targetAgent.agentId === 'kimi', result.targetAgent.agentId),
    check('kimi_source_is_council_registry_not_engineering', result.targetAgent.source === 'council_capability_registry', result.targetAgent.source),
  ]
}

function testGenericUsesFreeFormLabelWithNoRegistryLookup(): CaseResult[] {
  const result = composePrompt(baseInput('GENERIC_AGENT_MISSION_PROMPT', 'Gemini'))
  return [
    check('generic_uses_supplied_label', result.targetAgent.displayName === 'Gemini', result.targetAgent.displayName),
    check('generic_source_is_generic', result.targetAgent.source === 'generic', result.targetAgent.source),
  ]
}

function testPromptIncludesRepoPathAndOpenLoopForClaude(): CaseResult[] {
  const result = composePrompt(baseInput('GIVE_CLAUDE_NEXT_PROMPT'))
  return [
    check('claude_prompt_includes_repo_path', result.promptText.includes('/Users/markbroughton/Developer/war-room-os'), 'checked'),
    check('claude_prompt_includes_top_open_loop_title', result.promptText.includes('Wire prompt intelligence'), 'checked'),
    check('claude_prompt_includes_context_snapshot_text', result.promptText.includes("Ra'el Spine"), 'checked'),
  ]
}

// AGI Wave 2 (Phase 35/58) — a research prompt must target unresolved gaps/contradictions rather
// than repeating known work when they exist for the active project.
function testKimiPromptTargetsOpenGapsAndContradictionsWhenPresent(): CaseResult[] {
  const input: ComposePromptInput = {
    ...baseInput('GIVE_KIMI_RESEARCH_PROMPT'),
    openKnowledgeGaps: [{ question: 'Does architecture B scale past 10k conversations?', gapType: 'insufficient_evidence' }],
    unresolvedContradictions: [{ claimAText: 'Postgres FTS is sufficient for Wave 2.', claimBText: 'Vector search is required for Wave 2.' }],
  }
  const result = composePrompt(input)
  return [
    check('kimi_prompt_includes_open_gap_question', result.promptText.includes('Does architecture B scale past 10k conversations?'), 'checked'),
    check('kimi_prompt_includes_unresolved_contradiction', result.promptText.includes('Postgres FTS is sufficient') && result.promptText.includes('Vector search is required'), 'checked'),
    check('kimi_prompt_instructs_not_to_repeat_completed_work', result.promptText.toLowerCase().includes('do not repeat research already completed'), 'checked'),
  ]
}

function testKimiPromptFallsBackWhenNoGapsOrContradictions(): CaseResult[] {
  const result = composePrompt(baseInput('GIVE_KIMI_RESEARCH_PROMPT'))
  return [check('kimi_prompt_falls_back_to_open_loop_when_nothing_unresolved', result.promptText.includes('No open knowledge gaps or unresolved contradictions'), 'checked')]
}

export function runPromptIntelligenceComposeValidation(): CaseResult[] {
  return [
    ...testAllFourIntentsProduceNonEmptyOutput(),
    ...testClaudeRoutesThroughEngineeringRegistry(),
    ...testCodexRoutesThroughEngineeringRegistry(),
    ...testKimiRoutesThroughCouncilRegistryNeverEngineering(),
    ...testGenericUsesFreeFormLabelWithNoRegistryLookup(),
    ...testPromptIncludesRepoPathAndOpenLoopForClaude(),
    ...testKimiPromptTargetsOpenGapsAndContradictionsWhenPresent(),
    ...testKimiPromptFallsBackWhenNoGapsOrContradictions(),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runPromptIntelligenceComposeValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Prompt Intelligence compose validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
