import { pathToFileURL } from 'node:url'
import { loadMission, saveMission } from './foundryMissionStore'
import { runDeterministicMission } from './foundryMissionController'
import { executeEngineerTool } from './engineerTools'

const ID = '88356e33-1ec2-4b8e-b86a-bddd606cb881'

async function run() {
  const mission = await loadMission(ID)
  if (!mission) throw new Error('mission missing')
  mission.status = 'VERIFYING'
  mission.blocker = null
  mission.archived = false
  mission.archivedAt = undefined
  mission.superseded = false
  mission.resumeEligible = true
  mission.testArtifact = false
  mission.visibility = 'commander'
  mission.cancelRequested = false
  mission.retryCounts = {}
  mission.lockClaims = []
  mission.runtimeClaims = []
  mission.maxLoops = Math.max(mission.maxLoops, mission.loopCount + 40)
  mission.browserState = { ok: null, detail: null }
  mission.computerUseState = { ok: null, detail: null }
  for (const file of [
    'lib/native-builder/foundryComputerUse.ts',
    'lib/native-builder/foundryComputerUseGeometry.ts',
    'lib/native-builder/foundryComputerUseCdp.ts',
    'scripts/foundry/computer-use-backend.py',
    'desktop/src/main.cjs',
    'components/war-room/foundry/FoundryShell.tsx',
    'lib/native-builder/installerTool.ts',
    'lib/native-builder/runtimeControl.ts',
  ]) {
    if (!mission.sourceState.changedFiles.includes(file)) mission.sourceState.changedFiles.push(file)
  }
  for (const step of mission.plan) {
    const keepDone = (
      (mission.buildState.ok === true && step.intent === 'BUILD')
      || (mission.packageState.ok === true && step.intent === 'PACKAGE')
      || (mission.installState.ok === true && step.intent === 'INSTALL')
    )
    if (keepDone) continue
    if (['ACTIVATE', 'TRANSITION', 'IDENTITY', 'BROWSER_VERIFY', 'COMPUTER_VERIFY', 'COMPLETE'].includes(step.intent)) {
      step.status = 'pending'
      step.note = undefined
    }
  }
  if (mission.buildState.ok !== true) mission.buildState = { ok: null, detail: null }
  if (mission.packageState.ok !== true) mission.packageState = { ok: null, detail: null }
  if (mission.installState.ok !== true) mission.installState = { ok: null, detail: null, installId: null }
  mission.computerUseState = { ok: null, detail: null }
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
  if (runE.status !== 'COMPLETE' || runE.computerUseState.ok !== true || runE.browserState.ok !== true) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
