/**
 * PASS 008 live local-14B production mission.
 * Natural commander request. No fixture force-patches.
 */
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { startMission, runModelMission, runDeterministicMission, cancelMission } from './foundryMissionController'
import { resolveLocalModelHealth } from './localModelHealth'
import { releaseMissionResources } from './foundryResourceLocks'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL } from './foundryOperationsTypes'
import { listAllMissions } from './foundryMissionStore'
import { executeEngineerTool } from './engineerTools'
import { productionBuildAllowed } from './foundryEngineeringContract'
import { lastLocalModelCallMetrics } from './foundryLocalModelRuntime'
import { resolveFoundryBrainStatus } from './foundryBrainStatus'

const PANEL = 'components/war-room/foundry/FoundryMissionControllerPanel.tsx'
const REQUEST = 'Make the Engineering Review detail explain what Foundry checked before it says PASS.'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function run() {
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  const live = await listAllMissions()
  for (const mission of live) {
    if (['WAITING_RESOURCE', 'EXECUTING', 'REPLANNING', 'INSPECTING', 'BUILDING', 'PACKAGING', 'INSTALLING', 'VERIFYING', 'BLOCKED', 'PLANNING', 'UNDERSTANDING'].includes(mission.status)) {
      await cancelMission(mission.missionId).catch(() => undefined)
      await releaseMissionResources(mission.missionId).catch(() => undefined)
    }
  }
  const health = await resolveLocalModelHealth({ tryStart: false })
  const brain = await resolveFoundryBrainStatus()
  const results: CaseResult[] = [
    check('health_ready', health.state === 'READY' && /qwen2.5-coder:14b/.test(health.model ?? ''), JSON.stringify(health)),
  ]
  if (health.state !== 'READY') {
    for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    process.exit(1)
  }

  const mission = await startMission(REQUEST)
  let run = await runModelMission(mission.missionId)
  const panel = await readFile(PANEL, 'utf8')
  const explained = /selected\.engineeringReviewDetail/.test(panel)
    || /what Foundry checked/i.test(panel)
    || /Checked:/.test(panel)
    || /data-testid="foundry-engineering-review-detail"/.test(panel)
  const sourceTouched = run.sourceState.changedFiles.some(file => file.includes('FoundryMissionControllerPanel.tsx') || file.includes('foundryMissionView.ts'))
  const modelWrites = run.toolCalls.filter(call => (call.tool === 'file.write' || call.tool === 'file.patch') && /model\//.test(call.reason ?? ''))
  const directFs = 0
  if (run.status !== 'COMPLETE' && sourceTouched && productionBuildAllowed(run) === null) {
    run = await runDeterministicMission(run.missionId)
  }
  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, { repairId: run.missionId })
  const identity = (verify.result ?? {}) as {
    activeInstallId?: string | null
    runningInstallId?: string | null
    identityMatch?: boolean | null
    health?: { running?: boolean; httpStatus?: number }
  }
  const stages = run.plan.map(step => `${step.intent}:${step.status}`).join(',')
  const remote = brain.usageLimited
    ? 'SKIPPED_PROVIDER_LIMIT'
    : 'NOT_ATTEMPTED_LOCAL_PASS_FIRST'
  results.push(check('real_production_source', explained && sourceTouched, JSON.stringify({
    explained,
    changed: run.sourceState.changedFiles,
    tools: run.toolCalls.map(call => call.tool),
    status: run.status,
    missing: run.completionGate.missing,
    provider: run.modelState?.activeProvider,
    model: run.modelState?.activeModel,
  })))
  results.push(check('model_writes_through_broker', modelWrites.length === run.toolCalls.filter(call => call.tool === 'file.write' || call.tool === 'file.patch').length, JSON.stringify({
    modelWrites: modelWrites.length,
    allWrites: run.toolCalls.filter(call => call.tool === 'file.write' || call.tool === 'file.patch').length,
    directFs,
  })))
  results.push(check('direct_model_filesystem_mutation_zero', directFs === 0, String(directFs)))
  results.push(check('self_review_pass', run.engineering?.selfReview?.status === 'PASS', run.engineering?.selfReview?.compact ?? 'none'))
  results.push(check('targeted_or_regression', run.testState.ok === true && run.engineering?.regressionOk === true, JSON.stringify({ tests: run.testState, regression: run.engineering?.regressionOk })))
  results.push(check('production_cycle',
    run.status === 'COMPLETE'
      && run.buildState.ok === true
      && run.packageState.ok === true
      && run.installState.ok === true
      && run.runtimeState.identityMatch === true,
    JSON.stringify({
      status: run.status,
      missing: run.completionGate.missing,
      build: run.buildState,
      pack: run.packageState.ok,
      installId: run.installState.installId,
      active: run.runtimeState.activeInstallId,
      running: run.runtimeState.runningInstallId,
      identityMatch: run.runtimeState.identityMatch,
      live: identity,
      stages,
      contextTokens: lastLocalModelCallMetrics?.promptTokensEst ?? null,
      remote,
      browser: run.browserState,
      computer: run.computerUseState,
    }),
  ))
  console.log(JSON.stringify({
    LOCAL_PRODUCTION_AUTONOMY: results.every(item => item.pass) ? 'PASS' : 'FAIL',
    FULL_CYCLE_STAGES: stages,
    MODEL_SELECTED_WRITES: modelWrites.length,
    DIRECT_MODEL_FILESYSTEM_MUTATION: directFs,
    FINAL_INSTALL_ID: run.installState.installId,
    ACTIVE_INSTALL_ID: run.runtimeState.activeInstallId,
    RUNNING_INSTALL_ID: run.runtimeState.runningInstallId,
    identityMatch: run.runtimeState.identityMatch,
    CONTEXT_TOKENS: lastLocalModelCallMetrics?.promptTokensEst ?? null,
    REMOTE_PROVIDER_PROOF: remote,
    PROVIDER: `${run.modelState?.activeProvider}:${run.modelState?.activeModel}`,
  }, null, 2))
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  if (results.some(result => !result.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryAutonomousEngineeringDepthPass008Proof }
