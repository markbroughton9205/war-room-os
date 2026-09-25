import { pathToFileURL } from 'node:url'
import { loadMission, saveMission } from './foundryMissionStore'
import { runDeterministicMission } from './foundryMissionController'
import { executeEngineerTool } from './engineerTools'

const ID = '35aa0ae0-7f24-4f68-bdbb-0aa1d5ec55bd'

async function run() {
  const mission = await loadMission(ID)
  if (!mission) throw new Error('mission missing')
  mission.status = 'VERIFYING'
  mission.blocker = null
  mission.cancelRequested = false
  mission.retryCounts = {}
  mission.lockClaims = []
  mission.runtimeClaims = []
  mission.maxLoops = Math.max(mission.maxLoops, mission.loopCount + 20)
  mission.computerUseState = { ok: null, detail: null }
  if (!mission.sourceState.changedFiles.includes('lib/native-builder/foundryProductionOwnership.ts')) {
    mission.sourceState.changedFiles.push('lib/native-builder/foundryProductionOwnership.ts')
  }
  for (const step of mission.plan) {
    if (['COMPUTER_VERIFY', 'COMPLETE'].includes(step.intent)) {
      step.status = 'pending'
      step.note = undefined
    }
    if (step.intent === 'BROWSER_VERIFY' && mission.browserState.ok === true) {
      step.status = 'done'
    }
  }
  await saveMission(mission)
  const runE = await runDeterministicMission(ID)
  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, { repairId: ID })
  console.log(JSON.stringify({
    status: runE.status,
    missing: runE.completionGate.missing,
    computer: runE.computerUseState,
    browser: runE.browserState,
    identity: {
      active: (verify.result as { activeInstallId?: string })?.activeInstallId,
      running: (verify.result as { runningInstallId?: string })?.runningInstallId,
      match: (verify.result as { identityMatch?: boolean })?.identityMatch,
      missionInstall: runE.installState.installId,
    },
    activate: runE.plan.find(step => step.intent === 'ACTIVATE'),
    transition: runE.plan.find(step => step.intent === 'TRANSITION'),
  }, null, 2))
  if (runE.status !== 'COMPLETE' || runE.computerUseState.ok !== true) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
