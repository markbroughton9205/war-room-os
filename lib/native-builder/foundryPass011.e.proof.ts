/**
 * PASS 011 production cycle — state-confirmed Computer Use on the installed desktop.
 * Remote Cursor parity is deferred (usage-limited). Local 14b remains the engineering brain.
 */
import { pathToFileURL } from 'node:url'
import { readdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { startMission, runModelMission, runDeterministicMission, cancelMission } from './foundryMissionController'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { releaseMissionResources } from './foundryResourceLocks'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { listAllMissions, loadMission } from './foundryMissionStore'
import { executeEngineerTool } from './engineerTools'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { rememberFeatureOwnership, rememberEngineeringFact } from './foundryEngineeringMemory'

const REQUEST = 'PASS 011 installed computer use reliability. Add computer.click_and_wait so ACTION_SUCCESS is not STATE_SUCCESS. After New Session, Rename must appear. Complete Foundry → New Session → Rename → Session title → Save → Archive → Confirm Archive → Advanced → Restore on the installed War Room desktop. Title the proof session PASS 011 Computer Use Proof then archive it. Do not retry Cursor. Do not touch Terra. Validate, build, package, install and activate the exact build so MISSION_INSTALL_ID equals ACTIVE_INSTALL_ID equals RUNNING_INSTALL_ID.'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function cleanupProofSessions() {
  const dir = path.join(resolveRepoRoot(), '.war-room', 'native-builder', 'foundry-sessions')
  let names: string[] = []
  try {
    names = (await readdir(dir)).filter(name => name.endsWith('.json'))
  } catch {
    return
  }
  for (const name of names) {
    try {
      const raw = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as { title?: string; archived?: boolean }
      if ((raw.title === 'PASS 011 Computer Use Proof' || raw.title === 'PASS 010 Semantic Lifecycle Proof') && !raw.archived) {
        await unlink(path.join(dir, name))
      }
    } catch {
      /* skip */
    }
  }
}

async function run() {
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'LOCAL',
  })
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  const live = await listAllMissions()
  for (const mission of live) {
    if (['WAITING_RESOURCE', 'EXECUTING', 'REPLANNING', 'INSPECTING', 'BUILDING', 'PACKAGING', 'INSTALLING', 'VERIFYING', 'BLOCKED'].includes(mission.status) && /PASS 011|click_and_wait|installed computer use reliability/i.test(`${mission.title}\n${mission.userRequest}`)) {
      await cancelMission(mission.missionId).catch(() => undefined)
      await releaseMissionResources(mission.missionId).catch(() => undefined)
    }
  }
  await cleanupProofSessions()
  const mission = await startMission(REQUEST)
  let runE = await runModelMission(mission.missionId)
  const computer = await readFile('lib/native-builder/foundryComputerUse.ts', 'utf8')
  const geometry = await readFile('lib/native-builder/foundryComputerUseGeometry.ts', 'utf8')
  const backend = await readFile('scripts/foundry/computer-use-backend.py', 'utf8')
  const sourceDone = computer.includes('click_and_wait') && computer.includes('clickAndWait') && geometry.includes('SESSION_LIFECYCLE_CONTRACTS') && backend.includes('invalidate_cache')
  if (runE.status !== 'COMPLETE' && sourceDone) {
    runE = await runDeterministicMission(runE.missionId)
  }
  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, { repairId: runE.missionId })
  const identity = verify.result as {
    activeInstallId?: string | null
    runningInstallId?: string | null
    identityMatch?: boolean | null
  }
  const results: CaseResult[] = [
    check('acceptance_e_source', sourceDone, 'click_and_wait + contracts + invalidate_cache'),
    check('acceptance_e_complete', runE.status === 'COMPLETE', JSON.stringify({ status: runE.status, missing: runE.completionGate.missing, blocker: runE.blocker })),
    check('identity_match', identity.identityMatch === true && identity.activeInstallId === runE.installState.installId && identity.runningInstallId === runE.installState.installId, JSON.stringify({ ...identity, missionInstall: runE.installState.installId })),
    check('browser_acceptance', runE.browserState.ok === true, JSON.stringify(runE.browserState)),
    check('computer_acceptance', runE.computerUseState.ok === true, JSON.stringify(runE.computerUseState)),
  ]
  const loaded = await loadMission(runE.missionId) ?? runE
  await rememberFeatureOwnership({
    feature: 'state-confirmed Computer Use',
    owners: ['lib/native-builder/foundryComputerUse.ts', 'lib/native-builder/foundryComputerUseGeometry.ts', 'lib/native-builder/foundryComputerUseCdp.ts', 'scripts/foundry/computer-use-backend.py'],
    tests: ['lib/native-builder/foundryPass011.computerUse.validation.ts'],
    sourceMission: runE.missionId,
    sourceMissionId: runE.missionId,
    confidence: runE.status === 'COMPLETE' ? 'CONFIRMED' : 'SUPPORTED',
    uiControl: 'computer.click_and_wait',
    verifiedInteraction: 'AT-SPI action then expected-state proof, else semantic DOM click by accessible name, else one semantic bounds retry',
    contracts: ['computer.click_and_wait', 'ACTION_SUCCESS != STATE_SUCCESS'],
    roles: 'PRIMARY=foundryComputerUse.ts GEOMETRY=foundryComputerUseGeometry.ts CDP=foundryComputerUseCdp.ts BACKEND=computer-use-backend.py',
  })
  await rememberEngineeringFact({
    topic: 'atspi-noop-state-confirmation',
    summary: 'Chromium AT-SPI do_action can return true without React state change. PASS only after expected next control appears.',
    files: ['lib/native-builder/foundryComputerUse.ts', 'scripts/foundry/computer-use-backend.py'],
    sourceMission: runE.missionId,
    sourceMissionId: runE.missionId,
    confidence: runE.computerUseState.ok === true ? 'CONFIRMED' : 'SUPPORTED',
  })
  loaded.testArtifact = false
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`PASS 011 production: ${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryPass011ProductionProof }
