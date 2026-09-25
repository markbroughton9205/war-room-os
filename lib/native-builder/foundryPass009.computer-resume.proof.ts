import { pathToFileURL } from 'node:url'
import { loadMission, saveMission } from './foundryMissionStore'
import { runDeterministicMission } from './foundryMissionController'
import { executeEngineerTool } from './engineerTools'

const ID = 'c7a19588-f1c0-462b-a046-001604af871d'

async function run() {
  const mission = await loadMission(ID)
  if (!mission) throw new Error('mission missing')
  mission.status = 'VERIFYING'
  mission.blocker = null
  mission.cancelRequested = false
  mission.maxLoops = Math.max(mission.maxLoops, mission.loopCount + 16)
  mission.computerUseState = { ok: null, detail: null }
  for (const step of mission.plan) {
    if (step.intent === 'COMPUTER_VERIFY') {
      step.status = 'pending'
      step.note = undefined
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
  }, null, 2))
  if (runE.status !== 'COMPLETE' || runE.computerUseState.ok !== true) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
