/**
 * Mission 16 real-project ENABLED routing proof.
 * Small Foundry copy change. Classification is routine, so Qwen should remain.
 */
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { enableCapabilityAwareRouting, getCapabilityAwareRoutingMode } from './foundryWorkerRouting'
import { runUnifiedWorkerMission } from './foundryFrkStandaloneUnification.real'
import { ACCEPTED_WORKER_CAPABILITY_EVIDENCE } from './foundryWorkerRoutingEvidence'

const REAL_TARGET = 'components/war-room/foundry/FoundryMissionControllerPanel.tsx'
const OLD = '{selected?.workerRouting ? ` · routing ${selected.workerRouting.mode}` : \'\'}'
const NEW = '{selected?.workerRouting ? ` · routing ${selected.workerRouting.mode} · stored policy LOCAL` : \'\'}'

export function independentlyVerifyEnabledReal(workspaceRoot = resolveRepoRoot()): { passed: boolean; detail: string } {
  const text = readFileSync(path.join(workspaceRoot, REAL_TARGET), 'utf8')
  const caption = /routing \$\{selected\.workerRouting\.mode\} · stored policy LOCAL/.test(text)
  const kept = /Mission details/.test(text) && /Selected worker:/.test(text)
  return { passed: caption && kept, detail: `caption=${caption} kept=${kept}` }
}

export async function runEnabledRealProject(): Promise<void> {
  const repo = resolveRepoRoot()
  const isolated = mkdtempSync(path.join(tmpdir(), 'wr-route16-real-'))
  const prevC = process.env.FOUNDRY_CONTRACTS_ROOT
  const prevR = process.env.FRK_REASONING_ROOT
  const prevM = process.env.FOUNDRY_CAPABILITY_AWARE_ROUTING_MODE
  process.env.FOUNDRY_CONTRACTS_ROOT = path.join(isolated, 'contracts')
  process.env.FRK_REASONING_ROOT = path.join(isolated, 'frk')
  delete process.env.FOUNDRY_CAPABILITY_AWARE_ROUTING_MODE
  mkdirSync(process.env.FOUNDRY_CONTRACTS_ROOT, { recursive: true })
  mkdirSync(process.env.FRK_REASONING_ROOT, { recursive: true })
  enableCapabilityAwareRouting({ mission: 'MISSION_16_REAL' })
  const local = ACCEPTED_WORKER_CAPABILITY_EVIDENCE.find(item => item.historicalReliability === 'RELIABLE')!
  const brief = [
    'MISSION 16 REAL PROJECT: Foundry mission details routing line.',
    'This is a routine R0/R1 copy change. Do not manufacture complexity.',
    `path=${REAL_TARGET}`,
    'Use file.replace_unique.',
    `matchText exactly: ${OLD}`,
    `replacementText exactly: ${NEW}`,
    'Do not touch Terra, HVS, WRIM, Harbor, Lane & Box, Inventory.',
  ].join('\n')
  try {
    const result = await runUnifiedWorkerMission({
      missionId: `m16-real-${Date.now()}`,
      workspaceRoot: repo,
      writeSet: [REAL_TARGET],
      goal: 'Show stored LOCAL policy next to the routing mode on mission details.',
      acceptance: ['stored policy LOCAL appears beside routing mode'],
      brief,
      verify: () => independentlyVerifyEnabledReal(repo),
      expectedEffect: 'stored policy LOCAL',
      routing: { remotePermitted: true, forceDepth: 'R0', forceAmbiguity: 'low', taskFamily: 'FEATURE_EXTENSION' },
    })
    const payload = {
      ...result,
      classification: 'FEATURE_EXTENSION',
      depth: result.depth,
      expectedWorker: `${local.provider}/${local.model}`,
      routingMode: getCapabilityAwareRoutingMode(),
      qwenRemained: result.actualWorker.provider === local.provider,
    }
    const out = path.join(repo, 'tmp/foundry-capability-aware-routing-enabled/real-project.json')
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(payload, null, 2))
    console.log(JSON.stringify(payload, null, 2))
    if (!payload.ok || !payload.qwenRemained) process.exit(1)
  } finally {
    if (prevC === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = prevC
    if (prevR === undefined) delete process.env.FRK_REASONING_ROOT
    else process.env.FRK_REASONING_ROOT = prevR
    if (prevM === undefined) delete process.env.FOUNDRY_CAPABILITY_AWARE_ROUTING_MODE
    else process.env.FOUNDRY_CAPABILITY_AWARE_ROUTING_MODE = prevM
    rmSync(isolated, { recursive: true, force: true })
  }
}

const isDirect = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isDirect) {
  runEnabledRealProject().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
