import { pathToFileURL } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { requestLocalCoderJson } from './localCoder'
import { parseAndValidateModelDecision } from './foundryModelDecision'
import { resolveLocalModelHealth } from './localModelHealth'
import { startMission, runModelMission } from './foundryMissionController'
import { persistFoundryRuntimeConfig, readFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { releaseMissionResources } from './foundryResourceLocks'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { PASS_004_PERMISSIONS } from './foundryMissionTypes'
import type { FoundryModelRuntimeState } from './foundryModelTypes'
import {
  FOUNDRY_LOCAL_DECISION_SCHEMA,
  FOUNDRY_LOCAL_GENERATE_OPTIONS,
  FOUNDRY_LOCAL_MODEL_SYSTEM_PROMPT,
  lastLocalModelCallMetrics,
} from './foundryLocalModelRuntime'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })
const LABEL = 'scripts/foundry/local-coder-label/label.txt'
const permissions = PASS_004_PERMISSIONS

function modelStateOf(mission: { modelState?: FoundryModelRuntimeState }): FoundryModelRuntimeState {
  return mission.modelState ?? {
    primaryProvider: null,
    activeProvider: null,
    activeModel: null,
    fallbackProvider: null,
    calls: 0,
    invalidResponses: 0,
    providerFailures: 0,
    consecutiveFailures: 0,
    repeatedActionCount: 0,
    lastDecision: null,
    lastReasoningSummary: null,
    lastExpectedObservation: null,
  }
}

function malformedCount(mission: { errors?: Array<{ message: string }>; modelState?: { invalidResponses?: number } }) {
  return mission.modelState?.invalidResponses
    ?? (mission.errors ?? []).filter(error => /MALFORMED|JSON object|decision must/i.test(error.message)).length
}

async function resetLabel(value = 'LOCAL_CODER_ALPHA') {
  await writeFile(LABEL, `${value}\n`, 'utf8')
}

async function structured(prompt: string) {
  const started = Date.now()
  const result = await requestLocalCoderJson({
    role: 'FOUNDRY_MASTER',
    system: FOUNDRY_LOCAL_MODEL_SYSTEM_PROMPT,
    prompt,
    timeoutMs: 180_000,
    format: FOUNDRY_LOCAL_DECISION_SCHEMA,
    options: FOUNDRY_LOCAL_GENERATE_OPTIONS,
    keepAlive: '30m',
  })
  const parsed = result.ok ? parseAndValidateModelDecision(result.text, permissions) : { ok: false as const, error: result.detail }
  return { result, parsed, latencyMs: Date.now() - started }
}

async function runFixtureOnce(name: string, results: CaseResult[]) {
  await resetLabel('LOCAL_CODER_ALPHA')
  const fixture = await startMission('Change the Foundry local-coder-label test fixture label from LOCAL_CODER_ALPHA to LOCAL_CODER_BETA, run its real test, and visually verify it. This is a test application fixture, not a production install.')
  const fixtureRun = await runModelMission(fixture.missionId)
  const fixtureSource = await readFile(LABEL, 'utf8')
  const fixtureTools = fixtureRun.toolCalls.map(call => call.tool)
  const journal = fixtureRun.journal.map(item => item.text).join('\n')
  const metrics = lastLocalModelCallMetrics
  const state = modelStateOf(fixtureRun)
  const pass = fixtureRun.status === 'COMPLETE'
    && fixtureSource.includes('LOCAL_CODER_BETA')
    && state.activeProvider === 'ollama'
    && (fixtureTools.includes('file.write') || fixtureTools.includes('file.patch'))
    && (fixtureTools.includes('terminal.execute') || fixtureTools.includes('test.run') || fixtureTools.includes('validation.run'))
    && !/deterministic fallback|PASS 004 mission/i.test(journal)
  results.push(check(name, pass, JSON.stringify({
    status: fixtureRun.status,
    provider: state.activeProvider,
    model: state.activeModel,
    tools: [...new Set(fixtureTools)],
    label: fixtureSource.trim(),
    calls: state.calls,
    invalid: malformedCount(fixtureRun),
    promptTokensEst: metrics?.promptTokensEst,
    repairs: metrics?.repairs,
  })))
  await releaseMissionResources(fixtureRun.missionId)
  return { fixtureRun, fixtureSource, fixtureTools }
}

async function run() {
  const previousConfig = {
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO' as const,
  }
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'LOCAL',
  })
  const previousEnv = {
    FOUNDRY_PROVIDER_POLICY: process.env.FOUNDRY_PROVIDER_POLICY,
    FOUNDRY_PRIMARY_MODEL: process.env.FOUNDRY_PRIMARY_MODEL,
  }
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  try {
  const health = await resolveLocalModelHealth({ tryStart: true })
  const results: CaseResult[] = [
    check('health_ready', health.state === 'READY' && Boolean(health.model), JSON.stringify({ state: health.state, model: health.model, detail: health.detail })),
  ]
  if (health.state !== 'READY') {
    for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    console.log('BLOCKED local model is not READY; refusing fake green.')
    process.exit(1)
  }

  const latencies: Record<string, number> = {}
  const smoke = [
    ['smoke_identify_fixture_file', 'Return a TOOL decision using workspace.search with query LOCAL_CODER_ALPHA and pathPrefix scripts/foundry/local-coder-label.'],
    ['smoke_choose_search', 'Return a TOOL decision for workspace.search with query THE FOUNDRY and pathPrefix components/war-room/foundry.'],
    ['smoke_choose_read', 'Return a TOOL decision for file.read with path components/war-room/foundry/FoundryShell.tsx.'],
    ['smoke_explain_bug', 'Return a TOOL decision for file.read of scripts/foundry/local-coder-label/label.txt.'],
    ['smoke_replan', 'Evidence showed theme-clue.mjs is not imported. Return a REPLAN decision.'],
    ['smoke_complete', 'The fixture label is now LOCAL_CODER_BETA and tests passed. Return a COMPLETE decision with no tool.'],
  ] as const

  if (!process.argv.includes('--missions-only')) {
    for (const [name, prompt] of smoke) {
      const outcome = await structured(prompt)
      latencies[name] = outcome.latencyMs
      const decision = outcome.parsed.ok ? outcome.parsed.decision.decision : null
      const expected = name === 'smoke_replan' ? 'REPLAN' : name === 'smoke_complete' ? 'COMPLETE' : 'TOOL'
      const toolOk = expected !== 'TOOL' || (
        name === 'smoke_choose_read' || name === 'smoke_explain_bug'
          ? outcome.parsed.ok && outcome.parsed.decision.tool?.name === 'file.read'
          : outcome.parsed.ok && outcome.parsed.decision.tool?.name === 'workspace.search'
      )
      results.push(check(
        name,
        outcome.result.ok && outcome.parsed.ok && decision === expected && toolOk,
        JSON.stringify({ latencyMs: outcome.latencyMs, decision, error: outcome.parsed.ok ? undefined : outcome.parsed.error, text: outcome.result.ok ? outcome.result.text.slice(0, 400) : outcome.result.detail }),
      ))
    }
  }

  const fixtureRuns = []
  for (let index = 1; index <= 5; index += 1) {
    fixtureRuns.push(await runFixtureOnce(`fixture_${index}_of_5`, results))
  }
  const firstFixture = fixtureRuns[0]

  const readOnly = await startMission('Find where THE FOUNDRY heading is rendered and explain the component path. Do not change any files.')
  const readOnlyRun = await runModelMission(readOnly.missionId)
  const readOnlyTools = readOnlyRun.toolCalls.map(call => call.tool)
  const readOnlyText = JSON.stringify(readOnlyRun.observations) + readOnlyRun.journal.map(item => item.text).join('\n')
  const readOnlyState = modelStateOf(readOnlyRun)
  results.push(check('readonly1_local', readOnlyState.activeProvider === 'ollama', `${readOnlyState.activeProvider}/${readOnlyState.activeModel}`))
  results.push(check('readonly1_search_read', readOnlyTools.includes('workspace.search') && readOnlyTools.includes('file.read'), [...new Set(readOnlyTools)].join(',')))
  results.push(check('readonly1_no_mutation', !readOnlyTools.some(name => name === 'file.write' || name === 'file.patch'), [...new Set(readOnlyTools)].join(',')))
  results.push(check('readonly1_complete', readOnlyRun.status === 'COMPLETE' && /FoundryShell/i.test(readOnlyText), `${readOnlyRun.status} ${readOnlyState.calls} invalid=${malformedCount(readOnlyRun)}`))

  const healthPath = await startMission('Find where Foundry decides whether the local model is READY and explain the health path. Do not change any files.')
  const healthRun = await runModelMission(healthPath.missionId)
  const healthTools = healthRun.toolCalls.map(call => call.tool)
  const healthText = JSON.stringify(healthRun.observations) + healthRun.journal.map(item => item.text).join('\n')
  const healthState = modelStateOf(healthRun)
  results.push(check('readonly2_local', healthState.activeProvider === 'ollama', `${healthState.activeProvider}/${healthState.activeModel}`))
  results.push(check('readonly2_search_read', healthTools.includes('workspace.search') && healthTools.includes('file.read'), [...new Set(healthTools)].join(',')))
  results.push(check('readonly2_no_mutation', !healthTools.some(name => name === 'file.write' || name === 'file.patch'), [...new Set(healthTools)].join(',')))
  results.push(check('readonly2_complete', healthRun.status === 'COMPLETE' && /localModelHealth|resolveLocalModelHealth/i.test(healthText), `${healthRun.status} ${healthState.calls} invalid=${malformedCount(healthRun)}`))

  await resetLabel('LOCAL_CODER_ALPHA')
  const controlled = await startMission('Change the Foundry local-coder-label test fixture label from LOCAL_CODER_ALPHA to LOCAL_CODER_BETA, run its real test, and visually verify it. This is a test application fixture, not a production install.')
  const controlledRun = await runModelMission(controlled.missionId)
  await releaseMissionResources(controlledRun.missionId)
  const controlledSource = await readFile(LABEL, 'utf8')
  results.push(check(
    'controlled_code_change',
    controlledRun.status === 'COMPLETE' && controlledSource.includes('LOCAL_CODER_BETA') && modelStateOf(controlledRun).activeProvider === 'ollama',
    `${controlledRun.status} ${controlledSource.trim()} invalid=${malformedCount(controlledRun)}`,
  ))

  const tenTurn = await startMission('Inspect these files in order using file.read, one file per turn, then COMPLETE: lib/native-builder/localModelHealth.ts, lib/native-builder/localCoder.ts, lib/native-builder/foundryModelRouter.ts, lib/native-builder/foundryModelContext.ts, lib/native-builder/foundryModelProviders.ts, lib/native-builder/ollamaClient.ts, lib/native-builder/engineerStatus.ts, lib/native-builder/foundryRuntimeConfig.ts, lib/native-builder/foundryModelDecision.ts, lib/native-builder/foundryLocalModelRuntime.ts. Do not change files.')
  const tenTurnRun = await runModelMission(tenTurn.missionId)
  const tenTurnTools = tenTurnRun.toolCalls.map(call => call.tool)
  const tenState = modelStateOf(tenTurnRun)
  results.push(check('ten_turn_local', tenState.activeProvider === 'ollama', `${tenState.activeProvider}/${tenState.activeModel}`))
  results.push(check('ten_turn_decisions', tenState.calls >= 10 && tenTurnRun.toolCalls.filter(call => call.tool === 'file.read' && call.ok).length >= 10, `calls=${tenState.calls} reads=${tenTurnRun.toolCalls.filter(call => call.tool === 'file.read').length}`))
  results.push(check('ten_turn_no_collapse', malformedCount(tenTurnRun) === 0 && tenTurnRun.status !== 'BLOCKED', `status=${tenTurnRun.status} invalid=${malformedCount(tenTurnRun)}`))
  results.push(check('ten_turn_complete', tenTurnRun.status === 'COMPLETE' && !tenTurnTools.some(name => name === 'file.write' || name === 'file.patch'), `${tenTurnRun.status} tools=${[...new Set(tenTurnTools)].join(',')}`))

  const allMissions = [...fixtureRuns.map(item => item.fixtureRun), readOnlyRun, healthRun, controlledRun, tenTurnRun]
  const directWrites = allMissions.filter(mission => /ollama generate wrote|direct filesystem/i.test(mission.journal.map(item => item.text).join('\n'))).length
  const deterministic = allMissions.filter(mission => /Chose file.write for small file|PASS 004 mission|runDeterministicMission/i.test(mission.journal.map(item => item.text).join('\n'))).length
  results.push(check('direct_model_fs_zero', directWrites === 0, String(directWrites)))
  results.push(check('deterministic_fallback_zero', deterministic === 0, String(deterministic)))

  const fixturePass = results.filter(result => result.name.startsWith('fixture_') && result.pass).length
  const quality = results.filter(result => [
    'health_ready',
    'fixture_1_of_5', 'fixture_2_of_5', 'fixture_3_of_5', 'fixture_4_of_5', 'fixture_5_of_5',
    'readonly1_complete', 'readonly2_complete', 'controlled_code_change', 'ten_turn_complete',
    'direct_model_fs_zero', 'deterministic_fallback_zero',
  ].includes(result.name))
  if (quality.every(result => result.pass) && !process.argv.includes('--no-persist-reliability')) {
    persistFoundryRuntimeConfig({ localMissionReliability: 'VALIDATED' })
  }

  const malformedTotal = allMissions.reduce((sum, mission) => sum + malformedCount(mission), 0)
  console.log(JSON.stringify({
    health,
    latencies,
    lastPrompt: lastLocalModelCallMetrics,
    fixture: firstFixture ? {
      status: firstFixture.fixtureRun.status,
      provider: modelStateOf(firstFixture.fixtureRun).activeProvider,
      model: modelStateOf(firstFixture.fixtureRun).activeModel,
      tools: [...new Set(firstFixture.fixtureTools)],
      label: firstFixture.fixtureSource.trim(),
    } : null,
    fixturePass,
    malformedTotal,
    readOnly: { status: readOnlyRun.status, calls: modelStateOf(readOnlyRun).calls, invalid: malformedCount(readOnlyRun), tools: [...new Set(readOnlyTools)] },
    healthPath: { status: healthRun.status, calls: modelStateOf(healthRun).calls, invalid: malformedCount(healthRun), tools: [...new Set(healthTools)] },
    controlled: { status: controlledRun.status, label: controlledSource.trim(), invalid: malformedCount(controlledRun) },
    tenTurn: { status: tenTurnRun.status, calls: modelStateOf(tenTurnRun).calls, invalid: malformedCount(tenTurnRun), tools: [...new Set(tenTurnTools)] },
    checks: results.map(result => ({ name: result.name, pass: result.pass, detail: result.detail.slice(0, 500) })),
  }, null, 2))
  if (results.some(result => !result.pass)) process.exit(1)
  } finally {
    if (previousEnv.FOUNDRY_PROVIDER_POLICY === undefined) delete process.env.FOUNDRY_PROVIDER_POLICY
    else process.env.FOUNDRY_PROVIDER_POLICY = previousEnv.FOUNDRY_PROVIDER_POLICY
    if (previousEnv.FOUNDRY_PRIMARY_MODEL === undefined) delete process.env.FOUNDRY_PRIMARY_MODEL
    else process.env.FOUNDRY_PRIMARY_MODEL = previousEnv.FOUNDRY_PRIMARY_MODEL
    persistFoundryRuntimeConfig({
      ...previousConfig,
      localMissionReliability: readFoundryRuntimeConfig().localMissionReliability,
    })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryLocalModelProof }
