/**
 * Commander vs system/test mission visibility.
 * Archives confirmed harness artifacts without deleting audit history.
 */
import { appendJournal, listAllMissions, loadMission, saveMission } from './foundryMissionStore'
import { rebuildRegistry } from './foundryMissionRegistry'
import { listResourceClaims, releaseMissionResources, releaseMissionResourcesIfStale } from './foundryResourceLocks'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import {
  FOUNDRY_MISSION_CLASSIFICATIONS,
  type FoundryMissionClassification,
  type FoundryMissionRecord,
  type FoundryMissionVisibility,
} from './foundryMissionTypes'
import type { FoundryRegistryEntry, FoundryResourceClaim } from './foundryOperationsTypes'

export { FOUNDRY_MISSION_CLASSIFICATIONS }
export type { FoundryMissionClassification, FoundryMissionVisibility }

export const TEST_MISSION_CLASSES: readonly FoundryMissionClassification[] = [
  'SYSTEM_TEST',
  'ACCEPTANCE_FIXTURE',
  'CONTRACT_TEST',
  'RECOVERY_TEST',
]

export type FoundryMissionHistoryView = 'commander' | 'active' | 'completed' | 'system' | 'archived' | 'all'

type ClassRule = {
  classification: FoundryMissionClassification
  evidence: string
  test: (haystack: string) => boolean
}

const RULES: ClassRule[] = [
  {
    classification: 'ACCEPTANCE_FIXTURE',
    evidence: 'PASS 009 archive protection fixture',
    test: t => /pass 009 archive protection fixture/.test(t),
  },
  {
    classification: 'ACCEPTANCE_FIXTURE',
    evidence: 'foundry-p004/p005/p006 harmless acceptance marker',
    test: t => /\bfoundry[- ]p00[456]\b/.test(t) || /harmless (foundry-only visible )?acceptance marker/.test(t)
      || /header acceptance marker from foundry-p00/.test(t),
  },
  {
    classification: 'ACCEPTANCE_FIXTURE',
    evidence: 'model-tool-choice / model-replan / visual acceptance fixture',
    test: t => /model-tool-choice fixture/.test(t) || /model-replan fixture/.test(t)
      || /visual acceptance fixture/.test(t) || /system nominal but it is invisi/.test(t),
  },
  {
    classification: 'ACCEPTANCE_FIXTURE',
    evidence: 'fixture status-label acceptance',
    test: t => /test application's status label from ready to foundry ready/.test(t)
      || /controlled model-tool-choice fixture page is showing alpha/.test(t),
  },
  {
    classification: 'CONTRACT_TEST',
    evidence: 'contract / bounded repeated-action fixture',
    test: t => /contract fixture/.test(t) || /bounded repeated-action/.test(t)
      || /controlled model fixture shows alpha/.test(t),
  },
  {
    classification: 'RECOVERY_TEST',
    evidence: 'resource-lock interrupt / authorization recovery harness',
    test: t => /find where foundry resource locks are stored/.test(t)
      || /find where the authorization request is persisted/.test(t)
      || /controlled authorization/.test(t),
  },
  {
    classification: 'SYSTEM_TEST',
    evidence: 'ops-write-conflict fixture',
    test: t => /ops-write-conflict/.test(t),
  },
  {
    classification: 'SYSTEM_TEST',
    evidence: 'PASS 004/005/006 investigation harness',
    test: t => /find where (the war room login title is rendered|foundry mission persistence is stored|foundry provider health is stored|compact model context is built)/.test(t),
  },
  {
    classification: 'SYSTEM_TEST',
    evidence: 'known fixture path',
    test: t => /scripts\/foundry\/(ops-write-conflict|model-tool-choice|model-replan|model-visual|engineering-depth|multi-file)/.test(t),
  },
  {
    classification: 'SYSTEM_TEST',
    evidence: 'PASS 008 ownership mapping harness',
    test: t => /ownership path for foundry session creation/.test(t) || /complete ownership path for foundry session creation/.test(t),
  },
  {
    classification: 'ACCEPTANCE_FIXTURE',
    evidence: 'PASS 008 multi-file fixture',
    test: t => /multi-file\/(duplication|gap|contract)/.test(t) || /behavior-preserving refactor fixture|generated test fixture|contract migration fixture/.test(t),
  },
  {
    classification: 'SYSTEM_TEST',
    evidence: 'PASS 007 ownership mapping harness',
    test: t => /ownership path for the foundry project list/.test(t) || /full ownership path for the foundry project list/.test(t),
  },
  {
    classification: 'ACCEPTANCE_FIXTURE',
    evidence: 'PASS 007 engineering-depth fixture',
    test: t => /engineering-depth\/(greeting|stale-expect|impl-bug)/.test(t) || /stale-expect fixture|impl-bug fixture|engineering-depth greeting/.test(t),
  },
  {
    classification: 'SYSTEM_TEST',
    evidence: 'PASS 014 write-set fixture',
    test: t => /pass 014 write-set/.test(t) || /allowed_write_set fixture/.test(t),
  },
  {
    classification: 'ACCEPTANCE_FIXTURE',
    evidence: 'PASS 011 semantic stability / computer-use fixture',
    test: t => /pass 011/.test(t) || /semantic stability/.test(t) || /click_and_wait/.test(t)
      || /installed computer use reliability/.test(t) || /computer use proof/.test(t),
  },
  {
    classification: 'ACCEPTANCE_FIXTURE',
    evidence: 'PASS 012–015 historical production/acceptance fixture',
    test: t => /pass 012/.test(t) || /pass 013/.test(t) || /pass 014/.test(t) || /pass 015/.test(t)
      || /semantic lifecycle/.test(t),
  },
  {
    classification: 'SYSTEM_TEST',
    evidence: 'historical PASS / validator / proof / harness mission',
    test: t => /\bpass 0\d{2}\b/.test(t) || /validator mission/.test(t) || /proof mission/.test(t)
      || /test harness/.test(t) || /production acceptance fixture/.test(t)
      || /system validation mission/.test(t),
  },
]

export function missionHaystack(mission: Pick<FoundryMissionRecord, 'title' | 'userRequest' | 'goal'>): string {
  return `${mission.title}\n${mission.userRequest}\n${mission.goal}`.toLowerCase()
}

export function classifyFoundryMission(mission: FoundryMissionRecord): {
  classification: FoundryMissionClassification
  evidence: string[]
} {
  if (mission.classification && TEST_MISSION_CLASSES.includes(mission.classification) && mission.testArtifact) {
    return { classification: mission.classification, evidence: mission.classificationEvidence ?? ['stored testArtifact classification'] }
  }
  const haystack = missionHaystack(mission)
  const evidence: string[] = []
  let classification: FoundryMissionClassification | null = null
  for (const rule of RULES) {
    if (!rule.test(haystack)) continue
    evidence.push(rule.evidence)
    if (!classification) classification = rule.classification
  }
  if (mission.kind === 'fixture' && evidence.length) evidence.push('kind=fixture')
  if (/127\.0\.0\.1:18776/.test(mission.launchOrigin ?? '') && evidence.length) evidence.push('fixture launch origin')
  if (classification) return { classification, evidence }
  if (!mission.userRequest?.trim() && !mission.title?.trim()) {
    return { classification: 'UNKNOWN', evidence: ['empty title and request'] }
  }
  return { classification: 'COMMANDER_REAL', evidence: ['no known harness/fixture/acceptance markers'] }
}

export function isTestMissionClass(classification: FoundryMissionClassification | undefined): boolean {
  return Boolean(classification && TEST_MISSION_CLASSES.includes(classification))
}

export function isArchivedSystemMission(mission: Pick<FoundryMissionRecord, 'archived' | 'visibility' | 'testArtifact' | 'classification' | 'superseded'>): boolean {
  return mission.archived === true
    || mission.superseded === true
    || mission.testArtifact === true
    || mission.visibility === 'system'
    || isTestMissionClass(mission.classification)
}

export function isResumeEligible(mission: Pick<FoundryMissionRecord, 'archived' | 'superseded' | 'resumeEligible' | 'testArtifact' | 'visibility' | 'classification'>): boolean {
  if (mission.resumeEligible === false) return false
  if (mission.superseded === true) return false
  if (mission.archived === true) return false
  if (mission.testArtifact === true && mission.visibility === 'system') return false
  return true
}

export function isCommanderVisibleMission(mission: Pick<FoundryMissionRecord, 'archived' | 'visibility' | 'testArtifact' | 'classification' | 'superseded'> & Partial<Pick<FoundryMissionRecord, 'title' | 'userRequest' | 'goal' | 'kind'>>): boolean {
  if (mission.superseded === true) return false
  if (isArchivedSystemMission(mission)) return false
  if (mission.title || mission.userRequest || mission.goal) {
    const classified = classifyFoundryMission({
      title: mission.title ?? '',
      userRequest: mission.userRequest ?? '',
      goal: mission.goal ?? '',
      kind: mission.kind ?? 'application',
      classification: mission.classification,
      testArtifact: mission.testArtifact,
    } as FoundryMissionRecord)
    if (isTestMissionClass(classified.classification)) return false
  }
  return true
}

export function parseFoundryMissionHistoryView(value: string | null | undefined): FoundryMissionHistoryView {
  if (value === 'active' || value === 'completed' || value === 'system' || value === 'archived' || value === 'all') return value
  return 'commander'
}

export function missionMatchesHistoryView(mission: FoundryMissionRecord, view: FoundryMissionHistoryView): boolean {
  const testClass = isTestMissionClass(mission.classification) || mission.testArtifact === true
  if (view === 'all') return true
  if (view === 'archived') return isArchivedSystemMission(mission)
  if (view === 'system') return testClass || mission.visibility === 'system'
  if (view === 'completed') {
    return isCommanderVisibleMission(mission) && ['COMPLETE', 'FAILED', 'CANCELLED'].includes(mission.status)
  }
  if (view === 'active') {
    return isCommanderVisibleMission(mission) && !['COMPLETE', 'FAILED', 'CANCELLED'].includes(mission.status)
  }
  return isCommanderVisibleMission(mission)
}

export function filterMissionsForView(missions: FoundryMissionRecord[], view: FoundryMissionHistoryView = 'commander'): FoundryMissionRecord[] {
  return missions.filter(mission => missionMatchesHistoryView(mission, view))
}

export function filterRegistryForView(entries: FoundryRegistryEntry[], view: FoundryMissionHistoryView = 'commander'): FoundryRegistryEntry[] {
  return entries.filter(entry => {
    if (view === 'all') return true
    if (view === 'archived') return entry.archived === true || entry.superseded === true
    if (view === 'system') return entry.testArtifact === true || entry.visibility === 'system' || isTestMissionClass(entry.classification) || entry.superseded === true
    if (view === 'completed') return isCommanderVisibleMission(entry) && ['COMPLETE', 'FAILED', 'CANCELLED'].includes(entry.status)
    if (view === 'active') return isCommanderVisibleMission(entry) && !['COMPLETE', 'FAILED', 'CANCELLED'].includes(entry.status)
    return isCommanderVisibleMission(entry)
  })
}

export async function archiveConfirmedSystemTestMission(
  mission: FoundryMissionRecord,
  options?: { releaseStaleClaims?: boolean },
): Promise<{
  mission: FoundryMissionRecord
  classification: FoundryMissionClassification
  evidence: string[]
  releasedClaims: FoundryResourceClaim[]
}> {
  const classified = classifyFoundryMission(mission)
  if (!isTestMissionClass(classified.classification)) {
    return { mission, classification: classified.classification, evidence: classified.evidence, releasedClaims: [] }
  }
  mission.classification = classified.classification
  mission.classificationEvidence = classified.evidence
  mission.testArtifact = true
  mission.visibility = 'system'
  mission.archived = true
  mission.superseded = true
  mission.resumeEligible = false
  mission.archivedAt = mission.archivedAt ?? new Date().toISOString()
  const releasedClaims = options?.releaseStaleClaims === false
    ? []
    : await releaseMissionResourcesIfStale(mission.missionId)
  if (releasedClaims.length) {
    mission.lockClaims = (mission.lockClaims ?? []).filter(claim =>
      !releasedClaims.some(released => released.resource === claim.resource && released.callId === claim.callId),
    )
  }
  await appendJournal(mission, {
    kind: 'observation',
    text: `Archived system/test mission classification=${classified.classification} evidence=${classified.evidence.join('; ')}. superseded=true resumeEligible=false. Audit history preserved.`,
  })
  await saveMission(mission)
  return { mission, classification: classified.classification, evidence: classified.evidence, releasedClaims }
}

export async function archiveConfirmedSystemTestMissions(): Promise<{
  counts: Record<FoundryMissionClassification, number>
  archived: Array<{ missionId: string; title: string; classification: FoundryMissionClassification; evidence: string[] }>
  preserved: Array<{ missionId: string; title: string; classification: FoundryMissionClassification; evidence: string[] }>
  releasedClaims: FoundryResourceClaim[]
  leftoverLiveClaims: FoundryResourceClaim[]
}> {
  const missions = await listAllMissions()
  const counts: Record<FoundryMissionClassification, number> = {
    COMMANDER_REAL: 0,
    SYSTEM_TEST: 0,
    ACCEPTANCE_FIXTURE: 0,
    CONTRACT_TEST: 0,
    RECOVERY_TEST: 0,
    UNKNOWN: 0,
  }
  const archived: Array<{ missionId: string; title: string; classification: FoundryMissionClassification; evidence: string[] }> = []
  const preserved: Array<{ missionId: string; title: string; classification: FoundryMissionClassification; evidence: string[] }> = []
  const releasedClaims: FoundryResourceClaim[] = []
  for (const mission of missions) {
    const classified = classifyFoundryMission(mission)
    counts[classified.classification] += 1
    if (!isTestMissionClass(classified.classification)) {
      preserved.push({
        missionId: mission.missionId,
        title: mission.title,
        classification: classified.classification,
        evidence: classified.evidence,
      })
      continue
    }
    const result = await archiveConfirmedSystemTestMission(mission)
    archived.push({
      missionId: result.mission.missionId,
      title: result.mission.title,
      classification: result.classification,
      evidence: result.evidence,
    })
    releasedClaims.push(...result.releasedClaims)
  }
  await rebuildRegistry()
  const leftoverLiveClaims = (await listResourceClaims()).filter(claim => {
    const owner = missions.find(item => item.missionId === claim.missionId)
    return Boolean(owner && (owner.archived || owner.testArtifact || owner.superseded === true))
  })
  await logWarRoomRepoAudit('foundry-ops: archive-system-test-missions', {
    archived: archived.length,
    preserved: preserved.length,
    releasedClaims: releasedClaims.length,
    leftoverLiveClaims: leftoverLiveClaims.length,
    counts,
  })
  return { counts, archived, preserved, releasedClaims, leftoverLiveClaims }
}

export async function supersedeHistoricalProofMissions(
  missionIds: readonly string[],
  reason: string,
): Promise<Array<{
  missionId: string
  title: string
  status: string
  classification: FoundryMissionClassification
  resumeEligible: boolean
  superseded: boolean
  releasedClaims: FoundryResourceClaim[]
}>> {
  const results: Array<{
    missionId: string
    title: string
    status: string
    classification: FoundryMissionClassification
    resumeEligible: boolean
    superseded: boolean
    releasedClaims: FoundryResourceClaim[]
  }> = []
  for (const missionId of missionIds) {
    const mission = (await listAllMissions()).find(item => item.missionId === missionId)
      ?? null
    if (!mission) {
      results.push({
        missionId,
        title: '(missing)',
        status: 'MISSING',
        classification: 'UNKNOWN',
        resumeEligible: false,
        superseded: true,
        releasedClaims: [],
      })
      continue
    }
    const classified = classifyFoundryMission(mission)
    mission.classification = isTestMissionClass(classified.classification) ? classified.classification : 'ACCEPTANCE_FIXTURE'
    mission.classificationEvidence = [...(classified.evidence.length ? classified.evidence : ['PASS 006 live proof harness']), reason]
    mission.testArtifact = true
    mission.visibility = 'system'
    mission.archived = true
    mission.superseded = true
    mission.resumeEligible = false
    mission.archivedAt = mission.archivedAt ?? new Date().toISOString()
    const releasedClaims = await releaseMissionResourcesIfStale(mission.missionId)
    await releaseMissionResources(mission.missionId)
    mission.lockClaims = []
    mission.runtimeClaims = []
    mission.activeToolCallId = null
    if (mission.recovery) {
      mission.recovery = {
        ...mission.recovery,
        disposition: 'COMPLETE',
        notes: [...(mission.recovery.notes ?? []), `SUPERSEDED: ${reason}`],
      }
    }
    await appendJournal(mission, {
      kind: 'observation',
      text: `SUPERSEDED historical PASS 006 proof job. visibility=system testArtifact=true archived=true superseded=true resumeEligible=false. ${reason}. Audit history preserved. Do not resume. Do not acquire ACTIVE_RUNTIME.`,
    })
    await saveMission(mission)
    results.push({
      missionId: mission.missionId,
      title: mission.title,
      status: mission.status,
      classification: mission.classification,
      resumeEligible: false,
      superseded: true,
      releasedClaims,
    })
  }
  await rebuildRegistry()
  await logWarRoomRepoAudit('foundry-ops: supersede-historical-proof', {
    missionIds: [...missionIds],
    reason,
    count: results.length,
  })
  return results
}

export function commanderSessionLooksLikeSystemTest(title: string, chat: Array<{ text: string }>): boolean {
  const haystack = `${title}\n${chat.map(item => item.text).join('\n')}`.toLowerCase()
  return RULES.some(rule => rule.test(haystack))
}

/** Remaining PASS 009 archive-protection queued fixtures identified in PASS 012. */
export const STALE_PASS009_QUEUED_FIXTURE_IDS = [
  'df51ac62-768f-497e-8673-31f111de87c0',
  '9eb76d1e-66fe-44f8-8393-ea19c2638f3b',
  'ef2d6951-d37d-4533-96ac-4572d6190553',
] as const

export async function archiveStalePass009QueuedFixtures(): Promise<Array<{
  missionId: string
  title: string
  status: string
  archived: boolean
  resumeEligible: boolean
}>> {
  const results: Array<{ missionId: string; title: string; status: string; archived: boolean; resumeEligible: boolean }> = []
  for (const missionId of STALE_PASS009_QUEUED_FIXTURE_IDS) {
    const mission = await loadMission(missionId)
    if (!mission) continue
    const haystack = missionHaystack(mission)
    if (!/pass 009 archive protection fixture/.test(haystack) || mission.testArtifact !== true) continue
    if (mission.status !== 'COMPLETE' && mission.status !== 'CANCELLED') {
      mission.status = 'CANCELLED'
      mission.phase = 'CANCELLED'
    }
    mission.classification = 'ACCEPTANCE_FIXTURE'
    mission.classificationEvidence = [...(mission.classificationEvidence ?? []), 'PASS 009 stale queued fixture']
    mission.testArtifact = true
    mission.visibility = 'system'
    mission.archived = true
    mission.superseded = true
    mission.resumeEligible = false
    mission.archivedAt = mission.archivedAt ?? new Date().toISOString()
    await releaseMissionResources(mission.missionId)
    mission.lockClaims = []
    mission.runtimeClaims = []
    await appendJournal(mission, {
      kind: 'observation',
      text: 'PASS 012 archived stale PASS 009 queued fixture. visibility=system testArtifact=true archived=true resumeEligible=false. Journal/audit preserved. Records not deleted.',
    })
    await saveMission(mission)
    results.push({
      missionId: mission.missionId,
      title: mission.title,
      status: mission.status,
      archived: true,
      resumeEligible: false,
    })
  }
  await rebuildRegistry()
  await logWarRoomRepoAudit('foundry-ops: archive-stale-pass009-fixtures', {
    missionIds: results.map(item => item.missionId),
    count: results.length,
  })
  return results
}
