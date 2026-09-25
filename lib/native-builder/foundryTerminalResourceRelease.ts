/**
 * Terminal mission resource-claim hygiene.
 * Releases claims a COMPLETE/FAILED/CANCELLED/BLOCKED/archived mission can no longer
 * legitimately hold. Does not stop installed runtimes, rewrite production generations,
 * or delete installs.
 */
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import {
  FOUNDRY_LOCK_ORDER,
  type FoundryResourceClaim,
  type FoundryResourceId,
} from './foundryOperationsTypes'
import {
  listResourceClaims,
  releaseMissionResources,
  releaseResource,
} from './foundryResourceLocks'
import { FOUNDRY_TERMINAL_STATES, type FoundryMissionRecord, type FoundryMissionState } from './foundryMissionTypes'

export const TERMINAL_CLAIM_STATES: readonly FoundryMissionState[] = [...FOUNDRY_TERMINAL_STATES, 'BLOCKED']

const PERSISTENT_ON_BLOCKED: readonly FoundryResourceId[] = [
  'PRODUCTION_LEASE',
  'REPO_WRITE',
  'ACTIVE_RUNTIME',
  'PORT_3847',
  'PORT_3848',
]

export type TerminalClaimRelease = {
  missionId: string
  status: FoundryMissionState
  released: FoundryResourceClaim[]
  kept: FoundryResourceId[]
  alreadyClear: boolean
}

export function isTerminalClaimMission(mission: Pick<FoundryMissionRecord, 'status' | 'archived' | 'superseded' | 'resumeEligible'>): boolean {
  if (mission.archived === true || mission.superseded === true || mission.resumeEligible === false) return true
  return (TERMINAL_CLAIM_STATES as readonly string[]).includes(mission.status)
}

export function resourcesToKeepOnTerminal(mission: FoundryMissionRecord): FoundryResourceId[] {
  if (mission.status === 'BLOCKED' && mission.archived !== true && mission.superseded !== true && mission.resumeEligible !== false) {
    return [...PERSISTENT_ON_BLOCKED]
  }
  return []
}

export async function releaseTerminalMissionClaims(mission: FoundryMissionRecord): Promise<TerminalClaimRelease> {
  if (!isTerminalClaimMission(mission)) {
    return { missionId: mission.missionId, status: mission.status, released: [], kept: (mission.lockClaims ?? []).map(claim => claim.resource), alreadyClear: false }
  }
  const keep = new Set(resourcesToKeepOnTerminal(mission))
  const recorded = [...(mission.lockClaims ?? [])]
  const fileClaims = (await listResourceClaims()).filter(claim => claim.missionId === mission.missionId)
  const byResource = new Map<FoundryResourceId, FoundryResourceClaim>()
  for (const claim of [...fileClaims, ...recorded]) byResource.set(claim.resource, claim)

  const released: FoundryResourceClaim[] = []
  const drop: FoundryResourceId[] = []
  for (const resource of [...FOUNDRY_LOCK_ORDER].reverse()) {
    if (keep.has(resource)) continue
    const claim = byResource.get(resource)
    if (!claim && !(mission.lockClaims ?? []).some(item => item.resource === resource)) continue
    await releaseResource(resource, mission.missionId)
    drop.push(resource)
    if (claim) released.push(claim)
  }
  if (!keep.has('PRODUCTION_LEASE')) {
    const { shouldHoldProductionLease, releaseProductionLease } = await import('./foundryProductionLease')
    if (!shouldHoldProductionLease(mission)) {
      await releaseProductionLease(mission.missionId).catch(() => undefined)
    } else {
      keep.add('PRODUCTION_LEASE')
    }
  }

  const remaining = (mission.lockClaims ?? []).filter(claim => keep.has(claim.resource) && !drop.includes(claim.resource))
  const alreadyClear = released.length === 0 && remaining.length === (mission.lockClaims ?? []).length && drop.length === 0
  mission.lockClaims = remaining
  if (!keep.has('ACTIVE_RUNTIME')) {
    mission.runtimeClaims = (mission.runtimeClaims ?? []).filter(item => item !== 'ACTIVE_RUNTIME')
  }

  await logWarRoomRepoAudit('foundry-ops: terminal-claims-released', {
    missionId: mission.missionId,
    status: mission.status,
    archived: mission.archived === true,
    released: released.map(claim => ({
      resource: claim.resource,
      pid: claim.pid,
      heartbeatAt: claim.heartbeatAt,
      operation: claim.operation,
    })),
    kept: [...keep],
  })
  return { missionId: mission.missionId, status: mission.status, released, kept: [...keep], alreadyClear }
}

export async function reconcileTerminalMissionClaims(missions: FoundryMissionRecord[]): Promise<TerminalClaimRelease[]> {
  const results: TerminalClaimRelease[] = []
  const fileClaims = await listResourceClaims()
  const seen = new Set<string>()
  for (const mission of missions) {
    if (!isTerminalClaimMission(mission)) continue
    if (!(mission.lockClaims ?? []).length && !fileClaims.some(claim => claim.missionId === mission.missionId)) continue
    results.push(await releaseTerminalMissionClaims(mission))
    seen.add(mission.missionId)
  }
  const orphans = fileClaims.filter(claim => !seen.has(claim.missionId))
  for (const claim of orphans) {
    const owner = missions.find(item => item.missionId === claim.missionId)
    if (owner && isTerminalClaimMission(owner)) {
      results.push(await releaseTerminalMissionClaims(owner))
    }
  }
  return results
}
