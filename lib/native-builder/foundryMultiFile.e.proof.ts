/**
 * PASS 008 acceptance E — session rename through the local 14B production cycle.
 */
import { pathToFileURL } from 'node:url'
import { readdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { startMission, runModelMission, runDeterministicMission, cancelMission } from './foundryMissionController'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { resolveLocalModelHealth } from './localModelHealth'
import { releaseMissionResources } from './foundryResourceLocks'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL } from './foundryOperationsTypes'
import { listAllMissions, loadMission } from './foundryMissionStore'
import { executeEngineerTool } from './engineerTools'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { resolveRepoRoot } from '@/lib/repo/paths'

const REQUEST = 'Add a simple Foundry session rename control. Commander selects a session, clicks Rename, enters a new title, saves, the sidebar updates, and the title persists after reload. Preserve session id, workspace, and history. Do not add a homepage panel. Do not touch Terra. Validate it, build it, package it, install and activate the exact build, transition the installed runtime, then verify it in the browser and through Computer Use so the exact mission install becomes ACTIVE and RUNNING.'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function archiveRenameProofSessions() {
  const dir = path.join(resolveRepoRoot(), '.war-room', 'native-builder', 'foundry-sessions')
  let names: string[] = []
  try {
    names = (await readdir(dir)).filter(name => name.endsWith('.json'))
  } catch {
    return
  }
  for (const name of names) {
    try {
      const raw = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as { title?: string }
      if (raw.title === 'PASS 008 Rename Proof') await unlink(path.join(dir, name))
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
    if (['WAITING_RESOURCE', 'EXECUTING', 'REPLANNING', 'INSPECTING', 'BUILDING', 'PACKAGING', 'INSTALLING', 'VERIFYING', 'BLOCKED'].includes(mission.status) && /session rename/i.test(`${mission.title}\n${mission.userRequest}`)) {
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
  const sessions = await readFile('lib/native-builder/foundrySessions.ts', 'utf8')
  const shell = await readFile('components/war-room/foundry/FoundryShell.tsx', 'utf8')
  const route = await readFile('app/api/mission-runtime/engineering/foundry/sessions/[id]/route.ts', 'utf8')
  const sourceDone = sessions.includes('renameFoundrySession') && shell.includes('foundry-session-rename') && route.includes('PATCH')
  if (runE.status !== 'COMPLETE' && sourceDone) {
    runE = await runDeterministicMission(runE.missionId)
  }
  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, { repairId: runE.missionId })
  const identity = verify.result as {
    activeInstallId?: string | null
    runningInstallId?: string | null
    identityMatch?: boolean | null
  }
  results.push(check(
    'acceptance_e_source',
    sourceDone && runE.sourceState.changedFiles.some(file => /foundrySessions|FoundryShell|sessions\/\[id\]/.test(file)),
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
      && runE.installState.installId === runE.runtimeState.runningInstallId
      && runE.browserState.ok === true
      && runE.computerUseState.ok === true,
    JSON.stringify({
      status: runE.status,
      missing: runE.completionGate.missing,
      installId: runE.installState.installId,
      active: runE.runtimeState.activeInstallId,
      running: runE.runtimeState.runningInstallId,
      identityMatch: runE.runtimeState.identityMatch,
      live: identity,
      browser: runE.browserState,
      computer: runE.computerUseState,
      review: runE.engineering?.selfReview?.status,
    }),
  ))
  const archived = await loadMission(runE.missionId) ?? runE
  archived.testArtifact = true
  archived.visibility = 'system'
  archived.resumeEligible = false
  await archiveConfirmedSystemTestMission(archived)
  await archiveRenameProofSessions()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  if (results.some(result => !result.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
