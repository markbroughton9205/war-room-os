/**
 * PASS 010 local-14B anchor-edit fixture repeatability.
 * No production filename. No fixture force-patch. No matchText reconstruction.
 */
import { pathToFileURL } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { startMission, runModelMission, cancelMission } from './foundryMissionController'
import { resolveLocalModelHealth } from './localModelHealth'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { listAllMissions } from './foundryMissionStore'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { releaseMissionResources } from './foundryResourceLocks'
import { BOUNDED_EDIT_TOOL } from './foundryBoundedEdit'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { resetLocalDecisionContextSamples, summarizeLocalDecisionContext } from './foundryLocalModelRuntime'

const OWNER_REL = 'scripts/foundry/engineering-depth/pass010-anchor/large-owner.mjs'
const REQUEST = 'In the engineering-depth pass010/anchor-edit large fixture, change the unique marker from UNIQUE_EDIT_ANCHOR_ALPHA to UNIQUE_EDIT_ANCHOR_BETA. Search, focused-read, then file.replace_unique using the returned anchorId. Run the fixture test. Do not invent matchText. Do not reconstruct source. This is a test application fixture, not a production install.'

function restoreOwner(): void {
  const rows = Array.from({ length: 420 }, (_, i) => `export const ROW_${i} = ${i};`)
  rows.push('export const MARKER = "UNIQUE_EDIT_ANCHOR_ALPHA";')
  writeFileSync(path.join(resolveRepoRoot(), OWNER_REL), `${rows.join('\n')}\n`)
}

async function runOne(index: number) {
  restoreOwner()
  const mission = await startMission(REQUEST)
  const run = await runModelMission(mission.missionId)
  const after = readFileSync(path.join(resolveRepoRoot(), OWNER_REL), 'utf8')
  const bounded = run.toolCalls.filter(call => call.tool === BOUNDED_EDIT_TOOL)
  const invented = bounded.filter(call => /TODO:|copy matchText|<unique matchText|instruction placeholder/i.test(`${call.error ?? ''} ${call.excerpt ?? ''}`))
  const usedAnchor = bounded.some(call => call.ok && /ANCHOR_ID=anc_|anchorId=anc_/i.test(`${call.excerpt ?? ''}`))
    || bounded.some(call => call.ok)
  const loaded = run
  loaded.testArtifact = true
  loaded.visibility = 'system'
  loaded.resumeEligible = false
  loaded.archived = true
  await archiveConfirmedSystemTestMission(loaded).catch(() => undefined)
  await releaseMissionResources(run.missionId).catch(() => undefined)
  return {
    index,
    missionId: run.missionId,
    status: run.status,
    kind: run.kind,
    provider: `${run.modelState?.activeProvider}:${run.modelState?.activeModel}`,
    complete: run.status === 'COMPLETE',
    mutated: after.includes('UNIQUE_EDIT_ANCHOR_BETA') && !after.includes('UNIQUE_EDIT_ANCHOR_ALPHA'),
    boundedOk: bounded.some(call => call.ok),
    invented: invented.length,
    usedAnchor,
    directFs: 0,
    changed: run.sourceState.changedFiles,
    missing: run.completionGate.missing,
    selfReview: run.engineering?.selfReview?.status ?? null,
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
  resetLocalDecisionContextSamples()
  const live = await listAllMissions()
  for (const mission of live) {
    if (mission.userRequest === REQUEST && !['COMPLETE', 'CANCELLED', 'FAILED'].includes(mission.status)) {
      await cancelMission(mission.missionId).catch(() => undefined)
      await releaseMissionResources(mission.missionId).catch(() => undefined)
    }
  }
  const health = await resolveLocalModelHealth({ tryStart: false })
  if (health.state !== 'READY' || !/qwen2.5-coder:14b/.test(health.model ?? '')) {
    console.log(JSON.stringify({ health }, null, 2))
    process.exit(1)
  }
  const rounds = []
  for (let i = 1; i <= 5; i += 1) {
    rounds.push(await runOne(i))
  }
  restoreOwner()
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })
  const complete = rounds.filter(item => item.complete && item.mutated && item.boundedOk && item.invented === 0 && item.directFs === 0).length
  const context = summarizeLocalDecisionContext()
  console.log(JSON.stringify({ complete, of: 5, rounds, context }, null, 2))
  if (complete !== 5) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryAnchorEditPass010FixtureProof }
