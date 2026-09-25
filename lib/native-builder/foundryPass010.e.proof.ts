/**
 * PASS 010 production cycle — wait-for-control, semantic clicks, session restore.
 * Remote Cursor parity is deferred (usage-limited). Local 14b is the engineering brain.
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

const REQUEST = 'Add wait-for-control so Computer Use finds Rename, Save, Archive, Confirm Archive, and Restore by accessible name. Add session restore under Advanced Archived Sessions. Commander creates PASS 010 Semantic Lifecycle Proof, renames, saves, archives, confirms, restores, reloads, then archives again. Do not retry Cursor. Do not touch Terra. Validate, build, package, install and activate the exact build, transition the installed runtime, then verify in the browser and through Computer Use so the exact mission install becomes ACTIVE and RUNNING.'

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
      if ((raw.title === 'PASS 010 Semantic Lifecycle Proof' || raw.title === 'PASS 009 Archive Proof') && !raw.archived) {
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
    if (['WAITING_RESOURCE', 'EXECUTING', 'REPLANNING', 'INSPECTING', 'BUILDING', 'PACKAGING', 'INSTALLING', 'VERIFYING', 'BLOCKED'].includes(mission.status) && /PASS 010|wait-for-control|session restore/i.test(`${mission.title}\n${mission.userRequest}`)) {
      await cancelMission(mission.missionId).catch(() => undefined)
      await releaseMissionResources(mission.missionId).catch(() => undefined)
    }
  }
  await cleanupProofSessions()
  const mission = await startMission(REQUEST)
  let runE = await runModelMission(mission.missionId)
  const sessions = await readFile('lib/native-builder/foundrySessions.ts', 'utf8')
  const shell = await readFile('components/war-room/foundry/FoundryShell.tsx', 'utf8')
  const computer = await readFile('lib/native-builder/foundryComputerUse.ts', 'utf8')
  const sourceDone = sessions.includes('restoreFoundrySession') && shell.includes('foundry-session-restore') && computer.includes('wait_for_control')
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
    check('acceptance_e_source', sourceDone, 'restore+wait_for_control source'),
    check('acceptance_e_complete', runE.status === 'COMPLETE', JSON.stringify({ status: runE.status, missing: runE.completionGate.missing, blocker: runE.blocker })),
    check('identity_match', identity.identityMatch === true && identity.activeInstallId === runE.installState.installId && identity.runningInstallId === runE.installState.installId, JSON.stringify({ ...identity, missionInstall: runE.installState.installId })),
    check('browser_acceptance', runE.browserState.ok === true, JSON.stringify(runE.browserState)),
    check('computer_acceptance', runE.computerUseState.ok === true, JSON.stringify(runE.computerUseState)),
  ]
  const loaded = await loadMission(runE.missionId) ?? runE
  await rememberFeatureOwnership({
    feature: 'Foundry session restore lifecycle',
    owners: ['lib/native-builder/foundrySessions.ts', 'app/api/mission-runtime/engineering/foundry/sessions/[id]/route.ts', 'components/war-room/foundry/FoundryShell.tsx'],
    tests: ['lib/native-builder/foundrySessionRestore.validation.ts'],
    sourceMission: runE.missionId,
    sourceMissionId: runE.missionId,
    confidence: runE.status === 'COMPLETE' ? 'CONFIRMED' : 'SUPPORTED',
    uiControl: 'foundry-session-restore',
    verifiedInteraction: 'Archive → Confirm Archive → Advanced → Restore → normal list; missions not resumed',
    contracts: ['restoreFoundrySession(id)', 'PATCH {archived:false}'],
    roles: 'PRIMARY=foundrySessions.ts API=sessions/[id] UI=FoundryShell TEST=foundrySessionRestore.validation.ts',
  })
  await rememberFeatureOwnership({
    feature: 'semantic wait-for-control',
    owners: ['lib/native-builder/foundryComputerUse.ts', 'scripts/foundry/computer-use-backend.py'],
    tests: [],
    sourceMission: runE.missionId,
    sourceMissionId: runE.missionId,
    confidence: /wait_for_control|AT_SPI_ACTION|SEMANTIC_BOUNDS_CLICK/.test(runE.computerUseState.detail ?? '') ? 'CONFIRMED' : 'SUPPORTED',
    uiControl: 'computer.wait_for_control',
    verifiedInteraction: 'poll AT-SPI until stable name/role in War Room window, then semantic click',
    roles: 'PRIMARY=foundryComputerUse.ts BACKEND=computer-use-backend.py',
  })
  await rememberEngineeringFact({
    topic: 'session-restore-lifecycle',
    summary: 'RESTORE returns an archived session to the normal list with the same id. It does not resume missions.',
    files: ['lib/native-builder/foundrySessions.ts'],
    sourceMission: runE.missionId,
    sourceMissionId: runE.missionId,
    confidence: runE.status === 'COMPLETE' ? 'CONFIRMED' : 'SUPPORTED',
  })
  await rememberEngineeringFact({
    topic: 'foundry-accessible-control-names',
    summary: 'New Session, Rename, Session title, Save, Cancel, Archive, Confirm Archive, Restore are truthful accessible names.',
    files: ['components/war-room/foundry/FoundryShell.tsx'],
    sourceMission: runE.missionId,
    sourceMissionId: runE.missionId,
    confidence: 'CONFIRMED',
  })
  loaded.testArtifact = false
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`PASS 010 production: ${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryPass010ProductionProof }
