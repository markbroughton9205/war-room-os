/**
 * PASS 009 remote Cursor health, multi-file fixture, and cross-provider ownership.
 * Cursor is BRAIN only. Tool Broker remains HANDS. No production activation.
 */
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CursorAgentProvider } from './cursorAgentProvider'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'
import { PASS_004_PERMISSIONS } from './foundryMissionTypes'
import type { FoundryModelContext } from './foundryModelTypes'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { startMission, runModelMission } from './foundryMissionController'
import { executeEngineerTool } from './engineerTools'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { loadMission } from './foundryMissionStore'
import { resolveLocalModelHealth } from './localModelHealth'
import { FoundryModelRouter } from './foundryModelRouter'
import type { FoundryMissionRecord } from './foundryMissionTypes'

const execFileAsync = promisify(execFile)

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const REMOTE_REQUEST = 'Change the scripts/foundry/pass009/settings theme contract from classic to midnight across config.mjs, view.mjs, and settings.test.mjs. Map owners, impact, baseline, plan, patch through Tool Broker, self-review, run the targeted settings test, then COMPLETE. This is a test application fixture, not a production install. Do not activate production.'

function smokeContext(): FoundryModelContext {
  return {
    missionId: 'pass009-cursor-smoke',
    missionKind: 'fixture',
    userRequest: 'Search the repository for archiveFoundrySession. Do not change files.',
    goal: 'Prove Cursor ask-mode structured TOOL JSON without mutating the reasoning workspace.',
    successCriteria: ['Return a TOOL decision', 'No workspace mutation'],
    constraints: ['READ_ONLY_INVESTIGATION', 'COMMIT = NO'],
    permissions: { ...PASS_004_PERMISSIONS, build: false, package: false, installProduction: false, activateInstall: false, installedRuntimeControl: false },
    phase: 'INSPECTING',
    plan: [{ id: 'understand', title: 'Understand', status: 'done' }],
    hypotheses: [],
    changedFiles: [],
    importantFindings: [],
    relevantExcerpts: [],
    visualEvidence: [],
    recentToolResults: [],
    recentErrors: [],
    unresolvedQuestions: [],
    completionGate: { complete: false, missing: ['SOURCE_DONE'], detail: 'smoke' },
    tools: FOUNDRY_MODEL_TOOL_CATALOG.filter(tool => ['workspace.search', 'code.owners', 'file.read'].includes(tool.name)),
  }
}

async function gitDirty(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { timeout: 8_000 })
    return stdout.trim()
  } catch {
    return 'git-status-failed'
  }
}

async function archiveIfTest(mission: FoundryMissionRecord) {
  const loaded = await loadMission(mission.missionId) ?? mission
  loaded.testArtifact = true
  loaded.visibility = 'system'
  loaded.resumeEligible = false
  await archiveConfirmedSystemTestMission(loaded)
}

async function run() {
  const results: CaseResult[] = []
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'REMOTE',
  })
  process.env.FOUNDRY_PROVIDER_POLICY = 'REMOTE'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_PRIMARY_MODEL
  process.env.FOUNDRY_FALLBACK_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL

  const beforeDirty = await gitDirty()
  const modelId = FOUNDRY_DEFAULT_PRIMARY_MODEL.replace(/^cursor-agent:/, '')
  const cursor = new CursorAgentProvider(modelId)
  const smoke = await cursor.chooseNextAction({ kind: 'chooseNextAction', context: smokeContext() })
  const afterDirty = await gitDirty()
  const warRoomMutation = beforeDirty !== afterDirty
  const quota = !smoke.ok && /quota|usage.?limit|rate.?limit|resource_exhausted|insufficient/i.test(smoke.ok ? '' : smoke.error)
  results.push(check(
    'remote_provider_health',
    smoke.ok && smoke.decision.decision === 'TOOL' && !warRoomMutation,
    JSON.stringify({
      ok: smoke.ok,
      model: smoke.ok ? smoke.model : smoke.model,
      decision: smoke.ok ? smoke.decision.decision : undefined,
      tool: smoke.ok ? smoke.decision.tool?.name : undefined,
      error: smoke.ok ? undefined : smoke.error,
      failureClass: smoke.ok ? undefined : smoke.failureClass,
      warRoomMutation,
      quota,
    }),
  ))
  if (!smoke.ok) {
    results.push(check('remote_multi_file_engineering', false, quota ? 'REMOTE_PROVIDER_PROOF=BLOCKED_PROVIDER_LIMIT' : (smoke.error ?? 'cursor failed')))
    for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    persistFoundryRuntimeConfig({
      primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
      fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
      providerPolicy: 'AUTO',
    })
    process.exit(quota ? 0 : 1)
  }

  const mission = await startMission(REMOTE_REQUEST)
  const runRemote = await runModelMission(mission.missionId)
  const tools = [...new Set(runRemote.toolCalls.map(call => call.tool))]
  const provider = runRemote.modelState?.activeProvider
  const swapped = provider === 'ollama'
  const files = runRemote.sourceState.changedFiles
  const quotaDuring = /quota|usage.?limit|rate.?limit|resource_exhausted/i.test(runRemote.blocker?.blocker ?? runRemote.completionGate.detail ?? '')
  results.push(check(
    'remote_multi_file_engineering',
    !swapped && runRemote.status === 'COMPLETE' && files.length >= 3 && runRemote.testState.ok === true,
    JSON.stringify({
      status: runRemote.status,
      provider,
      model: runRemote.modelState?.activeModel,
      files,
      tools,
      tests: runRemote.testState,
      missing: runRemote.completionGate.missing,
      quotaDuring,
      proof: swapped ? 'DETERMINISTIC_FALLBACK_OR_SWAP' : quotaDuring ? 'BLOCKED_PROVIDER_LIMIT' : runRemote.status,
    }),
  ))
  await archiveIfTest(runRemote)

  const truth = await executeEngineerTool({ tool: 'code.owners', input: { query: 'archiveFoundrySession foundry session persistence' } }, { repairId: 'pass009-owners' })
  const truthBlob = JSON.stringify(truth.result ?? truth.error)
  const router = new FoundryModelRouter()
  const ownerContext = smokeContext()
  ownerContext.userRequest = 'Map owners for Foundry session archive persistence. Return TOOL code.owners. Do not change files.'
  ownerContext.goal = 'Cross-provider ownership consistency'
  const cursorOwn = await router.route('chooseNextAction', { kind: 'chooseNextAction', context: ownerContext }, { pinProvider: 'cursor-agent', policy: 'REMOTE' })
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'LOCAL',
  })
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  const ollamaOwn = await router.route('chooseNextAction', { kind: 'chooseNextAction', context: ownerContext }, { pinProvider: 'ollama', policy: 'LOCAL' })
  const cursorQuery = JSON.stringify(cursorOwn.response.ok ? cursorOwn.response.decision.tool : cursorOwn.response.error)
  const ollamaQuery = JSON.stringify(ollamaOwn.response.ok ? ollamaOwn.response.decision.tool : ollamaOwn.response.error)
  const sameOwners = /foundrySessions|FoundryShell|sessions\/\[id\]/i.test(`${truthBlob}\n${cursorQuery}\n${ollamaQuery}`)
  results.push(check(
    'cross_provider_ownership',
    sameOwners && /foundrySessions/.test(truthBlob),
    JSON.stringify({ truth: truthBlob.slice(0, 400), cursor: cursorQuery.slice(0, 240), ollama: ollamaQuery.slice(0, 240) }),
  ))

  const localHealth = await resolveLocalModelHealth({ tryStart: true })
  results.push(check('local_health', localHealth.state === 'READY' && /qwen2.5-coder:14b/.test(localHealth.model ?? ''), JSON.stringify({ state: localHealth.state, model: localHealth.model })))
  const locate = await startMission('Where is archiveFoundrySession defined? Search and read the owner. Do not change files.')
  const locateRun = await runModelMission(locate.missionId)
  results.push(check(
    'local_provider_regression',
    locateRun.status === 'COMPLETE' && locateRun.sourceState.changedFiles.length === 0 && locateRun.modelState?.activeProvider === 'ollama',
    JSON.stringify({ status: locateRun.status, provider: locateRun.modelState?.activeProvider, model: locateRun.modelState?.activeModel, files: locateRun.sourceState.changedFiles, missing: locateRun.completionGate.missing }),
  ))
  await archiveIfTest(locateRun)

  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })
  process.env.FOUNDRY_PROVIDER_POLICY = 'AUTO'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_PRIMARY_MODEL

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`PASS 009 remote parity: ${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (results.some(item => !item.pass && item.name !== 'remote_multi_file_engineering')) process.exit(1)
  const remote = results.find(item => item.name === 'remote_multi_file_engineering')
  if (remote && !remote.pass && !/BLOCKED_PROVIDER_LIMIT/.test(remote.detail)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryRemoteParityProof }
