import { pathToFileURL } from 'node:url'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { startMission, runModelMission } from './foundryMissionController'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { loadMission } from './foundryMissionStore'

async function run() {
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'LOCAL',
  })
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  const mission = await startMission('Where is restoreFoundrySession defined? Search and read the owner file. Do not change files.')
  const runLocal = await runModelMission(mission.missionId)
  const loaded = await loadMission(runLocal.missionId) ?? runLocal
  loaded.testArtifact = true
  loaded.visibility = 'system'
  loaded.resumeEligible = false
  loaded.archived = true
  await archiveConfirmedSystemTestMission(loaded)
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })
  console.log(JSON.stringify({
    status: runLocal.status,
    provider: runLocal.modelState?.activeProvider,
    model: runLocal.modelState?.activeModel,
    files: runLocal.sourceState.changedFiles,
    missing: runLocal.completionGate.missing,
  }))
  if (runLocal.status !== 'COMPLETE' || runLocal.sourceState.changedFiles.length !== 0 || runLocal.modelState?.activeProvider !== 'ollama') process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
