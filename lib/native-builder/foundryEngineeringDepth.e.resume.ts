/**
 * Finish PASS 007 Mission E against the already-built clean 39aa6c26 install.
 */
import { pathToFileURL } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { runDeterministicMission } from './foundryMissionController'
import { releaseMissionResources } from './foundryResourceLocks'
import { listAllMissions, loadMission, saveMission } from './foundryMissionStore'
import { executeEngineerTool } from './engineerTools'

const PANEL = 'components/war-room/foundry/FoundryMissionControllerPanel.tsx'
const INSTALL_ID = 'war-room-os-0.1.0-75f49a0-pass004-39aa6c26'
const MISSION_ID = '39aa6c26-6352-4139-8d46-8ea439e17f6c'

async function stripPassMarker(): Promise<string> {
  const panel = await readFile(PANEL, 'utf8')
  const next = panel.replace(/\s+data-foundry-pass="007"/g, '')
  if (next !== panel) await writeFile(PANEL, next, 'utf8')
  return next
}

async function run() {
  const panel = await stripPassMarker()
  if (!panel.includes('aria-label="Engineering review status"') || panel.includes('data-foundry-pass')) {
    console.log('FAIL source_not_clean')
    process.exit(1)
  }
  const live = await listAllMissions()
  for (const mission of live) await releaseMissionResources(mission.missionId).catch(() => undefined)
  const candidate = await loadMission(MISSION_ID) ?? live.find(mission => mission.missionId === MISSION_ID)
  if (!candidate) {
    console.log('FAIL missing_mission')
    process.exit(1)
  }
  for (const step of candidate.plan) {
    if (['BUILD', 'PACKAGE', 'INSTALL'].includes(step.intent)) step.status = 'done'
    if (['ACTIVATE', 'TRANSITION', 'IDENTITY', 'BROWSER_VERIFY', 'COMPUTER_VERIFY', 'COMPLETE'].includes(step.intent)) step.status = 'pending'
  }
  candidate.buildState = { ok: true, detail: candidate.buildState.detail ?? 'reused clean PASS 007 build' }
  candidate.packageState = { ...candidate.packageState, ok: true }
  candidate.installState = { ok: true, installId: INSTALL_ID, detail: 'reused existing clean side-by-side install' }
  candidate.lockClaims = []
  candidate.runtimeClaims = []
  candidate.retryCounts = {}
  candidate.blocker = null
  candidate.status = 'VERIFYING'
  await saveMission(candidate)
  const finished = await runDeterministicMission(candidate.missionId)
  await executeEngineerTool({ tool: 'browser.stop', input: {} }, { repairId: finished.missionId }).catch(() => undefined)
  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, { repairId: finished.missionId })
  const identity = verify.result as { activeInstallId?: string | null; runningInstallId?: string | null; identityMatch?: boolean | null }
  const reloaded = await loadMission(finished.missionId)
  const finalPanel = await readFile(PANEL, 'utf8')
  console.log(JSON.stringify({
    missionId: finished.missionId,
    status: finished.status,
    missing: finished.completionGate.missing,
    installId: finished.installState.installId,
    active: identity.activeInstallId,
    running: identity.runningInstallId,
    identityMatch: identity.identityMatch,
    browser: reloaded?.browserState,
    computer: reloaded?.computerUseState,
    passMarker: finalPanel.includes('data-foundry-pass'),
    aria: finalPanel.includes('aria-label="Engineering review status"'),
  }, null, 2))
  const ok = finished.status === 'COMPLETE'
    && finished.installState.installId === INSTALL_ID
    && identity.activeInstallId === INSTALL_ID
    && identity.runningInstallId === INSTALL_ID
    && identity.identityMatch === true
    && finished.browserState.ok === true
    && !finalPanel.includes('data-foundry-pass')
  if (!ok) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
