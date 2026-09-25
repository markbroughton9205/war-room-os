/**
 * PASS 012 — one harmless locate-only 14B mission. Search+read then COMPLETE. No writes.
 */
import { pathToFileURL } from 'node:url'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { startMission, runModelMission } from './foundryMissionController'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { loadMission } from './foundryMissionStore'
import { resolveLocalModelHealth } from './localModelHealth'

const REQUEST = 'Where is acquireProductionLease defined? Search and read the owner file. Do not change files.'

async function run() {
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'LOCAL',
  })
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  const health = await resolveLocalModelHealth({ tryStart: true })
  if (health.state !== 'READY' || !/qwen2.5-coder:14b/.test(health.model ?? '')) {
    console.log(`FAIL local_health ${JSON.stringify(health)}`)
    process.exit(1)
  }
  const mission = await startMission(REQUEST, 'PASS 012 locate-only')
  const runLocal = await runModelMission(mission.missionId)
  const loaded = await loadMission(runLocal.missionId) ?? runLocal
  loaded.testArtifact = true
  loaded.visibility = 'system'
  loaded.resumeEligible = false
  loaded.archived = true
  await archiveConfirmedSystemTestMission(loaded)
  const writes = loaded.sourceState.changedFiles.length
  const fallback = loaded.modelState?.fallbackProvider != null
    && loaded.journal.some(entry => /deterministic fallback/i.test(entry.text))
  const pass = loaded.status === 'COMPLETE'
    && writes === 0
    && loaded.modelState?.activeProvider === 'ollama'
    && /qwen2.5-coder:14b/.test(loaded.modelState?.activeModel ?? '')
    && loaded.toolCalls.some(call => call.ok && call.tool === 'workspace.search')
    && loaded.toolCalls.some(call => call.ok && call.tool === 'file.read')
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })
  console.log(JSON.stringify({
    pass,
    status: loaded.status,
    provider: loaded.modelState?.activeProvider,
    model: loaded.modelState?.activeModel,
    writes,
    fallback,
    DIRECT_MODEL_FILESYSTEM_MUTATION: writes,
    DETERMINISTIC_FALLBACK: fallback ? 1 : 0,
    missionId: loaded.missionId,
    tools: [...new Set(loaded.toolCalls.map(call => call.tool))],
    missing: loaded.completionGate.missing,
  }, null, 2))
  if (!pass) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
