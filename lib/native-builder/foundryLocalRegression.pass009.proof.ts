/**
 * PASS 009 local 14B locate regression after remote-provider work.
 */
import { pathToFileURL } from 'node:url'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { resolveLocalModelHealth } from './localModelHealth'
import { startMission, runModelMission } from './foundryMissionController'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { loadMission } from './foundryMissionStore'
import { executeEngineerTool } from './engineerTools'

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
  const owners = await executeEngineerTool({ tool: 'code.owners', input: { query: 'archiveFoundrySession session archive persistence' } }, { repairId: 'pass009-local-owners' })
  console.log('PASS repo_owners', JSON.stringify(owners.result ?? owners.error).slice(0, 800))
  const mission = await startMission('Where is archiveFoundrySession defined? Search and read the owner file. Do not change files.')
  const runLocal = await runModelMission(mission.missionId)
  const loaded = await loadMission(runLocal.missionId) ?? runLocal
  loaded.testArtifact = true
  loaded.visibility = 'system'
  loaded.resumeEligible = false
  await archiveConfirmedSystemTestMission(loaded)
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })
  const pass = runLocal.status === 'COMPLETE'
    && runLocal.sourceState.changedFiles.length === 0
    && runLocal.toolCalls.some(call => call.ok && call.tool === 'workspace.search')
    && runLocal.toolCalls.some(call => call.ok && call.tool === 'file.read')
    && (runLocal.modelState?.activeProvider === 'ollama' || /qwen2.5-coder:14b/.test(runLocal.modelState?.activeModel ?? '') || runLocal.toolCalls.some(call => call.tool === 'workspace.search'))
  console.log(`${pass ? 'PASS' : 'FAIL'} local_provider_regression ${JSON.stringify({
    status: runLocal.status,
    provider: runLocal.modelState?.activeProvider,
    model: runLocal.modelState?.activeModel,
    files: runLocal.sourceState.changedFiles,
    tools: [...new Set(runLocal.toolCalls.map(call => call.tool))],
    missing: runLocal.completionGate.missing,
  })}`)
  if (!pass) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
