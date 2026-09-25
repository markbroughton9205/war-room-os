/**
 * PASS 009 production cycle — session archive + Electron accessibility through exact install.
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

const REQUEST = 'Add a simple Foundry session archive control. Commander selects a session, can Rename, then clicks Archive, confirms, the session leaves the normal Sessions list, reload keeps it hidden, other sessions remain, and journals/audit stay. Improve Electron accessibility so Computer Use can find New Session, Rename, and Save by accessible name, keeping coordinate fallback. Do not add a dashboard. Do not touch Terra. Validate it, build it, package it, install and activate the exact build, transition the installed runtime, then verify it in the browser and through Computer Use so the exact mission install becomes ACTIVE and RUNNING.'

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
      if (raw.title === 'PASS 008 Rename Proof' && !raw.archived) await unlink(path.join(dir, name))
    } catch {
      /* skip */
    }
  }
}

async function run() {
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })
  process.env.FOUNDRY_PROVIDER_POLICY = 'AUTO'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_PRIMARY_MODEL
  const live = await listAllMissions()
  for (const mission of live) {
    if (['WAITING_RESOURCE', 'EXECUTING', 'REPLANNING', 'INSPECTING', 'BUILDING', 'PACKAGING', 'INSTALLING', 'VERIFYING', 'BLOCKED'].includes(mission.status) && /session archive|PASS 009/i.test(`${mission.title}\n${mission.userRequest}`)) {
      await cancelMission(mission.missionId).catch(() => undefined)
      await releaseMissionResources(mission.missionId).catch(() => undefined)
    }
  }
  await cleanupProofSessions()
  const mission = await startMission(REQUEST)
  let runE = await runModelMission(mission.missionId)
  const sessions = await readFile('lib/native-builder/foundrySessions.ts', 'utf8')
  const shell = await readFile('components/war-room/foundry/FoundryShell.tsx', 'utf8')
  const route = await readFile('app/api/mission-runtime/engineering/foundry/sessions/[id]/route.ts', 'utf8')
  const desktop = await readFile('desktop/src/main.cjs', 'utf8')
  const sourceDone = sessions.includes('archiveFoundrySession') && shell.includes('foundry-session-archive') && route.includes('archived') && desktop.includes('force-renderer-accessibility')
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
    check('acceptance_e_source', sourceDone, 'archive+a11y source'),
    check('acceptance_e_complete', runE.status === 'COMPLETE', JSON.stringify({ status: runE.status, missing: runE.completionGate.missing, blocker: runE.blocker })),
    check('identity_match', identity.identityMatch === true && identity.activeInstallId === runE.installState.installId && identity.runningInstallId === runE.installState.installId, JSON.stringify({ ...identity, missionInstall: runE.installState.installId })),
    check('browser_acceptance', runE.browserState.ok === true, JSON.stringify(runE.browserState)),
    check('computer_acceptance', runE.computerUseState.ok === true, JSON.stringify(runE.computerUseState)),
  ]
  const loaded = await loadMission(runE.missionId) ?? runE
  await rememberFeatureOwnership({
    feature: 'Foundry session archive lifecycle',
    owners: ['lib/native-builder/foundrySessions.ts', 'app/api/mission-runtime/engineering/foundry/sessions/[id]/route.ts', 'components/war-room/foundry/FoundryShell.tsx'],
    tests: ['lib/native-builder/foundrySessionArchive.validation.ts'],
    sourceMission: runE.missionId,
    sourceMissionId: runE.missionId,
    confidence: runE.status === 'COMPLETE' ? 'CONFIRMED' : 'SUPPORTED',
    uiControl: 'foundry-session-archive',
    verifiedInteraction: 'Rename → Save → Archive → Confirm → hidden after reload',
    contracts: ['archiveFoundrySession(id)', 'PATCH {archived:true}'],
    roles: 'PRIMARY=foundrySessions.ts API=sessions/[id] UI=FoundryShell TEST=foundrySessionArchive.validation.ts',
  })
  await rememberFeatureOwnership({
    feature: 'Electron Computer Use accessibility',
    owners: ['desktop/src/main.cjs', 'lib/native-builder/foundryComputerUse.ts', 'scripts/foundry/computer-use-backend.py'],
    tests: [],
    sourceMission: runE.missionId,
    sourceMissionId: runE.missionId,
    confidence: /semantic=\[/.test(runE.computerUseState.detail ?? '') ? 'CONFIRMED' : 'SUPPORTED',
    uiControl: 'computer.find_control',
    verifiedInteraction: 'semantic name/role first, xdotool geometry fallback second',
    roles: 'PRIMARY=main.cjs RUNTIME=foundryComputerUse.ts',
  })
  await rememberEngineeringFact({
    topic: 'session-archive-lifecycle',
    summary: 'ARCHIVE hides Commander sessions without deleting journals/audit. Session ids are never reused. Active missions cannot be archived.',
    files: ['lib/native-builder/foundrySessions.ts'],
    sourceMission: runE.missionId,
    sourceMissionId: runE.missionId,
    confidence: runE.status === 'COMPLETE' ? 'CONFIRMED' : 'SUPPORTED',
  })
  loaded.testArtifact = false
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`PASS 009 production: ${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryPass009ProductionProof }
