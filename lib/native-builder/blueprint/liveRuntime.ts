/**
 * Live blueprint runtime: assembles the reviewed isolated broker with the REAL War Room host adapters, as a per-process singleton.
 *
 *   host.sessions     -> authbridge over the Commander gate facts (credential-free actor; revocation probe = isLocalCommanderSessionLive)
 *   host.missions     -> live mission record + Agent Ops assignment readers (read-only, synchronous)
 *   host.workspaces   -> validated workspace snapshots (installed runtime tree refused)
 *   host.baseIdentity -> live read-only base identity accessor (repo / worktree / commit / branch / physical root)
 *   leaseBacking      -> the REPO_WRITE registry shared with Foundry missions (same file + guard protocol), per-execution holder, no adoption
 *   host.dependencies -> dependency evidence + sandboxed usability verification + Commander approval store (never installs)
 *   host.pipeline     -> host-owned recipes (no package-supplied commands), host stage checks, build-environment identity
 *   host.phase9Sink   -> live recursive-learning log
 * Nothing here can complete a mission or assignment, install anything, or reach the network.
 */
import fs from 'node:fs'
import { isLocalCommanderSessionLive } from '@/lib/security/commanderSession'
import { commanderOnlyPolicy, createWarRoomAuthBridge } from './authbridge.mjs'
import { createBroker } from './broker.mjs'
import { createControlPlane } from './control.mjs'
import { createLiveShapedBacking } from './reslock.mjs'
import { createRegistryLockModel } from './lockregistry.mjs'
import { createDependencyApprovalStore, createLiveDependencyVerifier } from './liveDependencies'
import { blueprintNode, createLiveBuildKit, materializeTools } from './liveBuild'
import { createLiveOwnershipBridge } from './liveMissions'
import { createLivePhase9Sink } from './livePhase9'
import { blueprintRoots } from './liveRoots'
import { liveBaseIdentity, resolveBlueprintWorkspaceSync } from './liveWorkspaces'

export const BLUEPRINT_BROKER_ID = 'wr-blueprint-broker'

export type BackgroundRun = { execId: string; startedAt: number; finishedAt: number | null; error: { code: string; message: string } | null }

export function buildBlueprintRuntime(overrides: { leaseTtlMs?: number; now?: () => number } = {}) {
  const roots = blueprintRoots()
  for (const d of [roots.root, roots.control, roots.evidence, roots.tools]) fs.mkdirSync(d, { recursive: true, mode: 0o700 })
  const control = createControlPlane({ root: roots.control, now: overrides.now, leaseTtlMs: overrides.leaseTtlMs ?? 120_000 })
  const store = createDependencyApprovalStore({ root: roots.dependencyApprovals, signer: control.signer })
  const tools = materializeTools(roots.tools)
  const probe = tools['depprobe.mjs']
  const node = blueprintNode()
  const verifier = createLiveDependencyVerifier({ store, probePath: probe.path, probeDigest: probe.sha256, nodeCmd: node.cmd, nodeEnv: node.env })
  const kit = createLiveBuildKit({ toolsDir: roots.tools, verifier })
  const bridge = createWarRoomAuthBridge({ isSessionLive: isLocalCommanderSessionLive, now: overrides.now })
  const missions = createLiveOwnershipBridge()
  const model = createRegistryLockModel({ file: roots.repoWriteRegistry, epochFile: roots.leaseEpochs })
  const leaseBacking = createLiveShapedBacking({ model, rootOf: (workspaceId: string) => ({ root: resolveBlueprintWorkspaceSync(workspaceId)?.root, fileIds: [] as string[] }), pid: process.pid })
  const phase9Sink = createLivePhase9Sink()
  const host = {
    sessions: bridge.sessions,
    missions,
    workspaces: { resolve: resolveBlueprintWorkspaceSync },
    baseIdentity: liveBaseIdentity,
    checks: kit.checks,
    policy: { ...commanderOnlyPolicy, allowRetain: () => false },
    phase9Sink,
    pipeline: kit.pipeline,
    dependencies: verifier,
  }
  const broker = createBroker({ brokerId: BLUEPRINT_BROKER_ID, control, evidenceRoot: roots.evidence, host, leaseBacking, now: overrides.now, leaseTtlMs: overrides.leaseTtlMs ?? 120_000, approvalTtlMs: 15 * 60_000, checkTimeoutMs: 60_000 })
  const background = new Map<string, BackgroundRun>()
  return { roots, control, store, verifier, kit, bridge, missions, host, broker, background, leaseBacking }
}
export type BlueprintRuntime = ReturnType<typeof buildBlueprintRuntime>

type Holder = typeof globalThis & { __wrBlueprintRuntime?: { key: string; runtime: BlueprintRuntime } }
/** Per-process singleton, keyed by the blueprint data root (so a relocated WAR_ROOM_LOCAL_DATA_DIR gets its own instance). */
export function getBlueprintRuntime(): BlueprintRuntime {
  const key = blueprintRoots().root
  const g = globalThis as Holder
  if (!g.__wrBlueprintRuntime || g.__wrBlueprintRuntime.key !== key) g.__wrBlueprintRuntime = { key, runtime: buildBlueprintRuntime() }
  return g.__wrBlueprintRuntime.runtime
}
export function resetBlueprintRuntimeForTests(): void { (globalThis as Holder).__wrBlueprintRuntime = undefined }
