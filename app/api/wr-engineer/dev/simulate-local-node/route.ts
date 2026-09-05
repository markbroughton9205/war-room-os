import os from 'node:os'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { getRepoStatus } from '@/lib/repo/status'
import { wrEngineerNodeStore } from '@/lib/wr-engineer/node/store'
import { authorizePairing, generatePairingCode, requestPairing } from '@/lib/wr-engineer/node/pairing'
import { recordHeartbeat } from '@/lib/wr-engineer/node/identity'
import { applyRepositoryStatusReport, listRepositoriesForNode, registerRepository } from '@/lib/wr-engineer/node/repository'
import { NODE_INSPECTION_CAPABILITIES, nodePlatformFromOsPlatform } from '@/lib/wr-engineer/node/types'
import { logWrEngineerAudit } from '@/lib/wr-engineer/audit'

export const dynamic = 'force-dynamic'

/**
 * Development-only convenience: runs the full pair -> authorize -> heartbeat -> register-repository
 * -> report-status handshake end to end AGAINST THE SERVER'S OWN MACHINE, so the WR-Engineer UI has
 * a real, live node + a real, currently-checked-out repository to demonstrate against without
 * requiring a second physical machine or the wr-engineer-node CLI to be running somewhere.
 *
 * This is explicitly a simulation of the pairing flow, not a shortcut around it: it calls the exact
 * same pairing.ts/identity.ts/repository.ts functions a real external node's requests would go
 * through (generatePairingCode -> requestPairing -> authorizePairing -> recordHeartbeat ->
 * registerRepository), just with this server process supplying the NODE_HELLO facts about itself
 * instead of a second machine doing so over the network. Every branch/HEAD value reported is real
 * (read from this actual git worktree via lib/repo/status.ts), never fabricated.
 */
export async function POST() {
  const session = await requireCommanderSession('WR-Engineer dev simulation')
  if (!session.ok) return session.response

  const platform = nodePlatformFromOsPlatform(os.platform())
  if (!platform) {
    return NextResponse.json({ error: `Unsupported host platform for simulation: ${os.platform()}` }, { status: 500 })
  }

  const { code } = await generatePairingCode(wrEngineerNodeStore)
  const pairingRequest = await requestPairing(wrEngineerNodeStore, code, {
    nodeName: `Local Dev Node (${os.hostname()})`,
    platform,
    architecture: os.arch(),
    hostname: os.hostname(),
    osVersion: os.release(),
    agentVersion: 'dev-simulated-0.1.0',
    capabilities: [...NODE_INSPECTION_CAPABILITIES],
  })
  const { node, credential } = await authorizePairing(wrEngineerNodeStore, pairingRequest.tokenId)
  const heartbeat = await recordHeartbeat(wrEngineerNodeStore, { nodeId: node.nodeId, credential })
  if (!heartbeat.ok) {
    return NextResponse.json({ error: `Simulated heartbeat failed: ${heartbeat.reason}` }, { status: 500 })
  }

  const repoRoot = resolveRepoRoot()
  const existingRepos = await listRepositoriesForNode(wrEngineerNodeStore, node.nodeId)
  let repository = existingRepos.find(r => r.path === repoRoot) ?? null
  if (!repository) {
    repository = await registerRepository(wrEngineerNodeStore, {
      nodeId: node.nodeId,
      name: path.basename(repoRoot),
      path: repoRoot,
    })
  }

  const status = await getRepoStatus()
  repository = await applyRepositoryStatusReport(wrEngineerNodeStore, repository.repositoryId, {
    currentBranch: status.currentBranch,
    headSha: status.lastCommitHash?.full ?? 'unknown',
  })

  await logWrEngineerAudit('dev: local node simulated and paired', { nodeId: node.nodeId, repositoryId: repository.repositoryId })

  return NextResponse.json({
    node: { ...heartbeat.node, credential: undefined },
    repository,
  })
}
