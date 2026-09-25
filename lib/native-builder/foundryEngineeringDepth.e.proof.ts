/**
 * PASS 007 acceptance E — one Foundry-only production change through the local 14B.
 */
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { startMission, runModelMission, runDeterministicMission, cancelMission } from './foundryMissionController'
import { resolveLocalModelHealth } from './localModelHealth'
import { listResourceClaims, releaseMissionResources } from './foundryResourceLocks'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL } from './foundryOperationsTypes'
import { listAllMissions } from './foundryMissionStore'
import { executeEngineerTool } from './engineerTools'

const PANEL = 'components/war-room/foundry/FoundryMissionControllerPanel.tsx'
const REQUEST = 'In Advanced session details only, when engineeringReview is FAIL, display FAIL instead of PENDING on the ENGINEERING REVIEW chip in FoundryMissionControllerPanel. Do not add a homepage panel, operations dashboard, or PASS007 marker. Do not touch Terra. Perform the production install cycle so the exact mission install becomes ACTIVE and RUNNING.'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function run() {
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  const leftover = await listResourceClaims()
  for (const missionId of [...new Set(leftover.map(claim => claim.missionId))]) {
    await releaseMissionResources(missionId).catch(() => undefined)
  }
  const live = await listAllMissions()
  for (const mission of live) {
    if (['WAITING_RESOURCE', 'EXECUTING', 'REPLANNING', 'INSPECTING', 'BUILDING', 'PACKAGING', 'INSTALLING', 'VERIFYING', 'BLOCKED'].includes(mission.status) && /engineering-depth|data-foundry-pass|Engineering review status|display FAIL instead of PENDING/i.test(`${mission.title}\n${mission.userRequest}`)) {
      await cancelMission(mission.missionId).catch(() => undefined)
      await releaseMissionResources(mission.missionId).catch(() => undefined)
    }
  }
  const health = await resolveLocalModelHealth({ tryStart: false })
  const results: CaseResult[] = [
    check('health_ready', health.state === 'READY' && /qwen2.5-coder:14b/.test(health.model ?? ''), JSON.stringify(health)),
  ]
  if (health.state !== 'READY') {
    for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    process.exit(1)
  }

  const mission = await startMission(REQUEST)
  let runE = await runModelMission(mission.missionId)
  const panel = await readFile(PANEL, 'utf8')
  const sourceDone = panel.includes("selected.engineeringReview === 'FAIL'") && panel.includes('ENGINEERING REVIEW') && !panel.includes('data-foundry-pass')
  if (runE.status !== 'COMPLETE' && sourceDone) {
    runE = await runDeterministicMission(runE.missionId)
  }
  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, { repairId: runE.missionId })
  const identity = verify.result as {
    activeInstallId?: string | null
    runningInstallId?: string | null
    identityMatch?: boolean | null
    health?: { running?: boolean; httpStatus?: number }
    corePort?: { running?: boolean; httpStatus?: number }
  }
  results.push(check(
    'acceptance_e_source',
    sourceDone && runE.sourceState.changedFiles.some(file => file.includes('FoundryMissionControllerPanel.tsx')),
    JSON.stringify({ changed: runE.sourceState.changedFiles, tools: runE.toolCalls.map(call => call.tool), status: runE.status, missing: runE.completionGate.missing }),
  ))
  results.push(check(
    'acceptance_e_production',
    runE.status === 'COMPLETE'
      && runE.buildState.ok === true
      && runE.packageState.ok === true
      && runE.installState.ok === true
      && runE.runtimeState.identityMatch === true
      && runE.installState.installId === runE.runtimeState.activeInstallId
      && runE.installState.installId === runE.runtimeState.runningInstallId,
    JSON.stringify({
      status: runE.status,
      missing: runE.completionGate.missing,
      installId: runE.installState.installId,
      active: runE.runtimeState.activeInstallId,
      running: runE.runtimeState.runningInstallId,
      identityMatch: runE.runtimeState.identityMatch,
      live: identity,
      review: runE.engineering?.selfReview?.status,
    }),
  ))
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  if (results.some(result => !result.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
