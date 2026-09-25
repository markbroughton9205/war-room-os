import { pathToFileURL } from 'node:url'
import { parseAndValidateModelDecision } from './foundryModelDecision'
import { FoundryModelRouter } from './foundryModelRouter'
import type { FoundryMissionModel, FoundryModelResponse } from './foundryModelTypes'
import { startMissionInput } from './foundryMissionController'
import { buildLocalFoundryModelContext, buildLocalFoundryModelPrompt, estimateTokens, localToolsForMission, LOCAL_MODEL_CONTEXT_BUDGET_TOKENS } from './foundryLocalModelRuntime'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

class TestModel implements FoundryMissionModel {
  readonly provider: 'cursor-agent' | 'ollama'
  readonly model: string
  calls = 0
  constructor(provider: 'cursor-agent' | 'ollama', private readonly response: FoundryModelResponse) {
    this.provider = provider
    this.model = `test-${provider}`
  }
  reasonMission() { this.calls += 1; return Promise.resolve(this.response) }
  chooseNextAction() { this.calls += 1; return Promise.resolve(this.response) }
  diagnoseFailure() { this.calls += 1; return Promise.resolve(this.response) }
  replan() { this.calls += 1; return Promise.resolve(this.response) }
  summarizeProgress() { this.calls += 1; return Promise.resolve(this.response) }
}

async function run() {
  const mission = startMissionInput('Find the Foundry heading.')
  const search = parseAndValidateModelDecision(JSON.stringify({
    decision: 'TOOL',
    reasoningSummary: 'Search for the heading.',
    tool: { name: 'workspace.search', args: { query: 'THE FOUNDRY' } },
  }), mission.permissions)
  const read = parseAndValidateModelDecision(JSON.stringify({
    decision: 'TOOL',
    reasoningSummary: 'Read the component.',
    tool: { name: 'file.read', args: { path: 'components/war-room/foundry/FoundryShell.tsx' } },
  }), mission.permissions)
  const replan = parseAndValidateModelDecision(JSON.stringify({
    decision: 'REPLAN',
    reasoningSummary: 'Switch to reading the shell after search.',
    planChanges: { add: [{ id: 'read-shell', intent: 'READ', title: 'Read FoundryShell' }] },
  }), mission.permissions)
  const complete = parseAndValidateModelDecision(JSON.stringify({
    decision: 'COMPLETE',
    reasoningSummary: 'Heading is rendered in FoundryShell.',
  }), mission.permissions)
  const prose = parseAndValidateModelDecision('I will just edit the files myself.', mission.permissions)

  const limited: FoundryModelResponse = {
    ok: false,
    provider: 'cursor-agent',
    model: 'gpt-5.6-sol-medium',
    error: 'usage limit',
    failureClass: 'PROVIDER',
    latencyMs: 1,
  }
  const localOk: FoundryModelResponse = {
    ok: true,
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    decision: {
      decision: 'TOOL',
      reasoningSummary: 'Local model chose workspace.search.',
      tool: { name: 'workspace.search', args: { query: 'THE FOUNDRY' } },
    },
    rawText: '{}',
    latencyMs: 1,
  }
  const cursor = new TestModel('cursor-agent', limited)
  const local = new TestModel('ollama', localOk)
  const skipped = await new FoundryModelRouter([cursor, local]).route(
    'chooseNextAction',
    { kind: 'chooseNextAction', context: { missionId: 'x' } as never },
    { primaryUsageLimited: true, requestedProvider: 'cursor-agent' },
  )
  const pinned = await new FoundryModelRouter([cursor, local]).route(
    'chooseNextAction',
    { kind: 'chooseNextAction', context: { missionId: 'x' } as never },
    { pinProvider: 'cursor-agent', requestedProvider: 'cursor-agent' },
  )

  const blankSummary = parseAndValidateModelDecision(JSON.stringify({
    decision: 'TOOL',
    tool: { name: 'workspace.search', args: { query: 'THE FOUNDRY' } },
  }), mission.permissions)
  const lowerDecision = parseAndValidateModelDecision(JSON.stringify({
    decision: 'tool',
    reasoningSummary: 'search',
    tool: { name: 'workspace.search', args: { query: 'THE FOUNDRY' } },
  }), mission.permissions)
  const stringBlocker = parseAndValidateModelDecision(JSON.stringify({
    decision: 'BLOCKED',
    reasoningSummary: 'cannot continue',
    blocker: 'Need a readable file path.',
  }), mission.permissions)
  const fixtureKind = startMissionInput('Change the Foundry local-coder-label test fixture label from LOCAL_CODER_ALPHA to LOCAL_CODER_BETA. This is a test application fixture, not a production install.')
  const locateKind = startMissionInput('Find where THE FOUNDRY heading is rendered and explain the component path. Do not change any files.')
  const compactPrompt = buildLocalFoundryModelPrompt({
    kind: 'chooseNextAction',
    context: buildLocalFoundryModelContext(fixtureKind),
  })
  const stringOp = parseAndValidateModelDecision(JSON.stringify({
    decision: 'TOOL',
    reasoningSummary: 'run fixture test',
    tool: { name: 'terminal.execute', args: { operation: 'node_test' } },
  }), fixtureKind.permissions)
  const jsonStringOp = parseAndValidateModelDecision(JSON.stringify({
    decision: 'TOOL',
    reasoningSummary: 'run fixture test',
    tool: { name: 'terminal.execute', args: { operation: '{"id":"node_test","targets":["scripts/foundry/local-coder-label/app.test.mjs"]}' } },
  }), fixtureKind.permissions)
  const unsafeOp = parseAndValidateModelDecision(JSON.stringify({
    decision: 'TOOL',
    reasoningSummary: 'run something',
    tool: { name: 'terminal.execute', args: { operation: 'rm -rf /' } },
  }), fixtureKind.permissions)
  const afterWrite = startMissionInput('Change the Foundry local-coder-label test fixture label from LOCAL_CODER_ALPHA to LOCAL_CODER_BETA. This is a test application fixture, not a production install.')
  afterWrite.sourceState.changedFiles = ['scripts/foundry/local-coder-label/label.txt']
  afterWrite.completionGate = { complete: false, missing: ['SELF_REVIEW_DONE', 'VALIDATION_DONE'], detail: 'need review' }
  const afterWriteTools = localToolsForMission(afterWrite)
  afterWrite.engineering = {
    selfReview: { status: 'PASS', findings: [], severity: [], requiredAction: 'none', at: new Date().toISOString(), diffHash: 'abc', compact: 'FINDINGS: none' },
  }
  afterWrite.completionGate = { complete: false, missing: ['VALIDATION_DONE'], detail: 'need test' }
  const afterReviewTools = localToolsForMission(afterWrite)
  afterWrite.testState = { ok: true, detail: 'green' }
  afterWrite.engineering.regressionOk = true
  afterWrite.completionGate = { complete: true, missing: [], detail: 'done' }
  const afterTestTools = localToolsForMission(afterWrite)
  const locateTools = localToolsForMission(locateKind)

  const results = [
    check('contract_search_tool', search.ok && search.decision.tool?.name === 'workspace.search', JSON.stringify(search)),
    check('contract_read_tool', read.ok && read.decision.tool?.name === 'file.read', JSON.stringify(read)),
    check('contract_replan', replan.ok && replan.decision.decision === 'REPLAN', JSON.stringify(replan)),
    check('contract_complete', complete.ok && complete.decision.decision === 'COMPLETE', JSON.stringify(complete)),
    check('contract_reject_prose', !prose.ok, JSON.stringify(prose)),
    check('parser_blank_reasoning_defaults', blankSummary.ok && blankSummary.decision.tool?.name === 'workspace.search', JSON.stringify(blankSummary)),
    check('parser_lowercase_decision', lowerDecision.ok && lowerDecision.decision.decision === 'TOOL', JSON.stringify(lowerDecision)),
    check('parser_string_blocker', stringBlocker.ok && stringBlocker.decision.decision === 'BLOCKED', JSON.stringify(stringBlocker)),
    check('parser_coerce_operation_id_string', stringOp.ok && (stringOp.ok ? (stringOp.decision.tool?.args.operation as { id?: string })?.id === 'node_test' : false), JSON.stringify(stringOp)),
    check('parser_coerce_operation_json_string', jsonStringOp.ok && Array.isArray(jsonStringOp.ok ? (jsonStringOp.decision.tool?.args.operation as { targets?: string[] })?.targets : null), JSON.stringify(jsonStringOp)),
    check('parser_reject_unsafe_operation_string', !unsafeOp.ok, JSON.stringify(unsafeOp)),
    check('phase_tools_after_write_requires_review', afterWriteTools.some(tool => tool.name === 'engineering.review') && !afterWriteTools.some(tool => tool.name === 'terminal.execute'), afterWriteTools.map(tool => tool.name).join(',')),
    check('phase_tools_after_review_keeps_test', afterReviewTools.some(tool => tool.name === 'terminal.execute') && !afterReviewTools.some(tool => tool.name === 'file.write'), afterReviewTools.map(tool => tool.name).join(',')),
    check('phase_tools_after_test_empty', afterTestTools.length === 0, afterTestTools.map(tool => tool.name).join(',')),
    check('locate_tools_are_search_and_read', locateTools.some(tool => tool.name === 'workspace.search') && locateTools.some(tool => tool.name === 'file.read') && !locateTools.some(tool => tool.name === 'code.impact' || tool.name === 'file.write'), locateTools.map(tool => tool.name).join(',')),
    check('kind_fixture_not_production', fixtureKind.kind === 'fixture', fixtureKind.kind),
    check('locate_only_ignores_do_not_change', locateKind.kind === 'fixture', locateKind.kind),
    check('local_prompt_under_budget', estimateTokens(compactPrompt) <= LOCAL_MODEL_CONTEXT_BUDGET_TOKENS, `${estimateTokens(compactPrompt)} tokens / ${compactPrompt.length} chars`),
    check('route_skips_limited_primary', skipped.response.ok && skipped.response.provider === 'ollama' && skipped.attempts.length === 1 && skipped.attempts[0]?.provider === 'ollama', JSON.stringify({ reason: skipped.reason, attempts: skipped.attempts, cursorCalls: cursor.calls, localCalls: local.calls })),
    check('route_pin_does_not_silent_switch', pinned.reason === 'PINNED' && !pinned.response.ok && cursor.calls === 1 && local.calls === 1, JSON.stringify(pinned)),
  ]
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry local model contract: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryLocalModelValidation }
