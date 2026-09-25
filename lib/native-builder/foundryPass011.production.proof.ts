/**
 * PASS 011 live production cycle. Local 14B policy. No deterministic fallback.
 * The mission itself install/activates after evidenced source.
 */
import { pathToFileURL } from 'node:url'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { startMission, runModelMission, cancelMission } from './foundryMissionController'
import { releaseMissionResources } from './foundryResourceLocks'
import { listAllMissions, loadMission } from './foundryMissionStore'
import { executeEngineerTool } from './engineerTools'

const REQUEST = 'PASS 011 click_and_wait installed Computer Use reliability for The Foundry session lifecycle. Cache the War Room AT-SPI app, wait for Rename/Save/Archive/Confirm Archive/Restore, refuse off-window clicks, package computer-use-backend.py, then install and activate this mission production build. Do not retry Cursor. Do not touch Terra. Do not commit.'

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
    if (['WAITING_RESOURCE', 'EXECUTING', 'REPLANNING', 'INSPECTING', 'BUILDING', 'PACKAGING', 'INSTALLING', 'VERIFYING', 'BLOCKED'].includes(mission.status) && /PASS 011|click_and_wait/i.test(`${mission.title}\n${mission.userRequest}`)) {
      await cancelMission(mission.missionId).catch(() => undefined)
      await releaseMissionResources(mission.missionId).catch(() => undefined)
    }
  }
  const mission = await startMission(REQUEST, 'PASS 011 Semantic Stability')
  const runLocal = await runModelMission(mission.missionId)
  const loaded = await loadMission(runLocal.missionId) ?? runLocal
  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, { repairId: loaded.missionId })
  const identity = (verify.result ?? {}) as {
    activeInstallId?: string | null
    runningInstallId?: string | null
    identityMatch?: boolean | null
  }
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })
  console.log(JSON.stringify({
    missionId: loaded.missionId,
    status: loaded.status,
    provider: loaded.modelState?.activeProvider,
    model: loaded.modelState?.activeModel,
    files: loaded.sourceState.changedFiles,
    build: loaded.buildState,
    pack: { ok: loaded.packageState.ok, detail: String(loaded.packageState.detail ?? '').slice(0, 240) },
    installId: loaded.installState.installId,
    installOk: loaded.installState.ok,
    runtime: loaded.runtimeState,
    verify: identity,
    browser: loaded.browserState,
    computer: loaded.computerUseState,
    blocker: loaded.blocker,
    missing: loaded.completionGate.missing,
  }, null, 2))
  if (loaded.status !== 'COMPLETE' || identity.identityMatch !== true || identity.activeInstallId !== loaded.installState.installId) {
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
