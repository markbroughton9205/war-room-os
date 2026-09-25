import { pathToFileURL } from 'node:url'
import { buildFoundryModelContext } from './foundryModelContext'
import { parseAndValidateModelDecision } from './foundryModelDecision'
import { FoundryModelRouter } from './foundryModelRouter'
import { runModelMission, startMission, startMissionInput } from './foundryMissionController'
import { FOUNDRY_MODEL_TOOL_CATALOG, validateModelToolRequest } from './foundryToolCatalog'
import { futureFoundryModelAdapter } from './foundryModelProviders'
import type { FoundryMissionModel, FoundryModelResponse } from './foundryModelTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

class TestModel implements FoundryMissionModel {
  readonly provider: 'wrim' | 'openai'
  readonly model: string
  constructor(provider: 'wrim' | 'openai', private readonly response: FoundryModelResponse) {
    this.provider = provider
    this.model = `test-${provider}`
  }
  reasonMission() { return Promise.resolve(this.response) }
  chooseNextAction() { return Promise.resolve(this.response) }
  diagnoseFailure() { return Promise.resolve(this.response) }
  replan() { return Promise.resolve(this.response) }
  summarizeProgress() { return Promise.resolve(this.response) }
}

async function run() {
  const mission = startMissionInput('The fixture page is showing ALPHA. Change it to OMEGA and verify it.')
  const valid = parseAndValidateModelDecision(JSON.stringify({
    decision: 'TOOL',
    reasoningSummary: 'Find the observed label before editing.',
    tool: { name: 'workspace.search', args: { query: 'ALPHA', pathPrefix: 'scripts/foundry' } },
    expectedObservation: 'The source path that renders ALPHA.',
  }), mission.permissions)
  const unknown = parseAndValidateModelDecision(JSON.stringify({
    decision: 'TOOL',
    reasoningSummary: 'Attempt invented tool.',
    tool: { name: 'shell.exec', args: { command: 'echo nope' } },
  }), mission.permissions)
  const forbidden = validateModelToolRequest('deploy.inspect', { target: {} }, mission.permissions)
  const malformed = parseAndValidateModelDecision('I think you should grep the repo.', mission.permissions)
  const blocked = parseAndValidateModelDecision(JSON.stringify({
    decision: 'BLOCKED',
    reasoningSummary: 'Provider login is required.',
    blocker: { blocker: 'Login required', evidence: 'HTTP 401', attempted: 'provider call', why: 'No valid session', unblock: 'Commander signs in' },
  }), mission.permissions)
  mission.observations.push(...Array.from({ length: 50 }, (_, index) => ({
    at: new Date().toISOString(),
    source: index % 2 ? 'file.read' : 'browser.inspect',
    text: 'x'.repeat(1_500),
  })))
  const context = buildFoundryModelContext(mission)
  const unavailable: FoundryModelResponse = {
    ok: false,
    provider: 'wrim',
    model: null,
    error: 'WRIM unavailable',
    failureClass: 'UNAVAILABLE',
    latencyMs: 1,
  }
  const success: FoundryModelResponse = {
    ok: true,
    provider: 'openai',
    model: 'test-openai',
    decision: {
      decision: 'TOOL',
      reasoningSummary: 'Fallback chose repository search.',
      tool: { name: 'workspace.search', args: { query: 'ALPHA' } },
    },
    rawText: '{}',
    latencyMs: 1,
  }
  const routed = await new FoundryModelRouter([
    new TestModel('wrim', unavailable),
    new TestModel('openai', success),
  ]).route('chooseNextAction', { kind: 'chooseNextAction', context })
  const loopMission = await startMission('Contract fixture: search for ALPHA and demonstrate bounded repeated-action handling.')
  const loopRouter = new FoundryModelRouter([
    new TestModel('openai', success),
  ])
  const firstRun = runModelMission(loopMission.missionId, loopRouter)
  const duplicateRun = runModelMission(loopMission.missionId, loopRouter)
  const coalesced = firstRun === duplicateRun
  const loopResult = await firstRun

  const results = [
    check('p005_contract_01_catalog', FOUNDRY_MODEL_TOOL_CATALOG.length >= 30, `${FOUNDRY_MODEL_TOOL_CATALOG.length} model tools`),
    check('p005_contract_02_valid_tool', valid.ok && valid.decision.tool?.name === 'workspace.search', JSON.stringify(valid)),
    check('p005_contract_03_unknown_rejected', !unknown.ok, JSON.stringify(unknown)),
    check('p005_contract_04_forbidden_rejected', !forbidden.ok, JSON.stringify(forbidden)),
    check('p005_contract_05_prose_rejected', !malformed.ok, JSON.stringify(malformed)),
    check('p005_contract_06_blocker_schema', blocked.ok && blocked.decision.decision === 'BLOCKED', JSON.stringify(blocked)),
    check('p005_contract_07_context_bounded', JSON.stringify(context.relevantExcerpts).length <= 12_000, `${JSON.stringify(context.relevantExcerpts).length} chars`),
    check('p005_contract_08_context_has_gate', 'completionGate' in context && Array.isArray(context.tools), context.completionGate.detail),
    check('p005_contract_09_provider_fallback', routed.response.ok && routed.attempts.length === 2, JSON.stringify(routed.attempts)),
    check('p005_contract_10_wrim_interface', futureFoundryModelAdapter('wrim').provider === 'wrim', 'normalized future adapter'),
    check('p005_contract_11_model_tool_executed', loopResult.toolCalls.some(call => call.tool === 'workspace.search'), loopResult.toolCalls.map(call => call.tool).join(',')),
    check('p005_contract_12_loop_detected', loopResult.status === 'BLOCKED' && /Repeated tool loop/.test(loopResult.blocker?.evidence ?? ''), JSON.stringify(loopResult.blocker)),
    check('p005_contract_13_duplicate_run_coalesced', coalesced, `samePromise=${coalesced}`),
  ]
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry PASS 005 model contract: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
