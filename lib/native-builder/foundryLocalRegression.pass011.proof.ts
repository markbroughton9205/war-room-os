/**
 * PASS 011 — five locate-only 14B missions. Search+read then COMPLETE. No writes.
 */
import { pathToFileURL } from 'node:url'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { startMission, runModelMission } from './foundryMissionController'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { loadMission } from './foundryMissionStore'
import { resolveLocalModelHealth } from './localModelHealth'

const QUERIES = [
  'Where is restoreFoundrySession defined? Search and read the owner file. Do not change files.',
  'Where is archiveFoundrySession defined? Search and read the owner file. Do not change files.',
  'Where is evaluateMissionGate defined? Search and read the owner file. Do not change files.',
  'Where is correlateWarRoomWindow defined? Search and read the owner file. Do not change files.',
  'Where is isReadOnlyLocateRequest defined? Search and read the owner file. Do not change files.',
]

async function runOne(request: string) {
  const mission = await startMission(request)
  const runLocal = await runModelMission(mission.missionId)
  const loaded = await loadMission(runLocal.missionId) ?? runLocal
  loaded.testArtifact = true
  loaded.visibility = 'system'
  loaded.resumeEligible = false
  loaded.archived = true
  await archiveConfirmedSystemTestMission(loaded)
  const writes = loaded.sourceState.changedFiles.length
  const fallback = /deterministic/i.test(JSON.stringify(loaded.journal ?? []))
  const schemaFails = loaded.modelState?.invalidResponses ?? 0
  const pass = loaded.status === 'COMPLETE'
    && writes === 0
    && loaded.modelState?.activeProvider === 'ollama'
    && /qwen2.5-coder:14b/.test(loaded.modelState?.activeModel ?? '')
    && loaded.toolCalls.some(call => call.ok && call.tool === 'workspace.search')
    && loaded.toolCalls.some(call => call.ok && call.tool === 'file.read')
    && schemaFails === 0
  return {
    pass,
    status: loaded.status,
    provider: loaded.modelState?.activeProvider,
    model: loaded.modelState?.activeModel,
    files: loaded.sourceState.changedFiles,
    missing: loaded.completionGate.missing,
    tools: [...new Set(loaded.toolCalls.map(call => call.tool))],
    writes,
    fallback,
    schemaFails,
    missionId: loaded.missionId,
    request: request.slice(0, 72),
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
  const health = await resolveLocalModelHealth({ tryStart: true })
  if (health.state !== 'READY' || !/qwen2.5-coder:14b/.test(health.model ?? '')) {
    console.log(`FAIL local_health ${JSON.stringify(health)}`)
    process.exit(1)
  }
  const results = []
  for (const query of QUERIES) {
    const item = await runOne(query)
    results.push(item)
    console.log(`${item.pass ? 'PASS' : 'FAIL'} locate ${JSON.stringify(item)}`)
  }
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })
  const ok = results.filter(item => item.pass).length
  console.log(JSON.stringify({ LOCAL_READ_ONLY_5_OF_5: `${ok}/5`, results }, null, 2))
  if (ok !== 5 || results.some(item => item.writes !== 0 || item.fallback || item.schemaFails !== 0)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
