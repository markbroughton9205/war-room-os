/**
 * Production activation handoff: a mission that already installed may wait for
 * production ownership without going FAILED, then activate ITS OWN install.
 * Does not weaken live-owner protection. Does not rebuild/repackage/reinstall.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { installedAppTreeDir } from './installLayout'
import { appendJournal, saveMission, transitionMission } from './foundryMissionStore'
import { realInstallOptRoot, type InstallStamp } from './installerTool'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { isResumeEligible } from './foundryMissionVisibility'
import {
  isAuthorizedProductionActivator,
  isLiveProductionMission,
  readProductionOwner,
  REFUSED_FOREIGN_INSTALL,
  REFUSED_STALE_PRODUCTION_OWNER,
  type FoundryProductionOwner,
} from './foundryProductionOwnership'
import type { FoundryMissionRecord, FoundryMissionState } from './foundryMissionTypes'

export const ACTIVATION_PENDING_STATE = 'ACTIVATION_PENDING' as const
export const REFUSED_TRANSITION_BEFORE_ACTIVATE = 'REFUSED_TRANSITION_BEFORE_ACTIVATE'
export const REFUSED_ARTIFACT_INTEGRITY = 'REFUSED_ARTIFACT_INTEGRITY'

export const ACTIVATION_RETRY_INTENTS = ['ACTIVATE', 'TRANSITION', 'IDENTITY', 'BROWSER_VERIFY', 'COMPUTER_VERIFY', 'COMPLETE'] as const
export const PRESERVED_TOOLCHAIN_INTENTS = ['BUILD', 'PACKAGE', 'INSTALL', 'PATCH_SOURCE', 'SELF_REVIEW', 'LINT', 'TYPECHECK', 'REGRESSION'] as const

export type ActivationPendingRecord = {
  missionInstallId: string
  blockingOwnerMission: string | null
  blockingGeneration: number | null
  blockingOwnerState: FoundryMissionState | 'MISSING' | null
  enteredAt: string
  integrityOk?: boolean
  integrityDetail?: string
}

export type ForeignInstallRefusal = {
  ok: false
  code: typeof REFUSED_FOREIGN_INSTALL
  error: string
  MISSION_ID: string
  MISSION_INSTALL_ID: string | null
  REQUESTED_INSTALL_ID: string
  CURRENT_ACTIVE_INSTALL_ID: string | null
}

export type ArtifactIntegrityResult = {
  ok: boolean
  installId: string
  exists: boolean
  stampValid: boolean
  executableExists: boolean
  hashesMatch: boolean
  gitIdentityOk: boolean
  detail: string
}

export function missionBoundInstallId(mission: FoundryMissionRecord): string | null {
  return mission.installState.installId && mission.installState.ok === true
    ? mission.installState.installId
    : null
}

export function missionIdentityAccepted(mission: FoundryMissionRecord): boolean {
  const installId = missionBoundInstallId(mission)
  if (!installId) return false
  return mission.runtimeState.identityMatch === true
    && mission.runtimeState.activeInstallId === installId
    && mission.runtimeState.runningInstallId === installId
}

export function isActivationOwnershipConflict(error: string | null | undefined): boolean {
  return /REFUSED_STALE_PRODUCTION_OWNER|REFUSED_FOREIGN_INSTALL|ACTIVE_RUNTIME busy|does not own ACTIVE_RUNTIME/i.test(error ?? '')
}

export function formatForeignInstallRefusal(input: {
  missionId: string
  missionInstallId: string | null
  requestedInstallId: string
  currentActiveInstallId?: string | null
}): ForeignInstallRefusal {
  return {
    ok: false,
    code: REFUSED_FOREIGN_INSTALL,
    error: [
      REFUSED_FOREIGN_INSTALL,
      `MISSION_ID=${input.missionId}`,
      `MISSION_INSTALL_ID=${input.missionInstallId ?? 'null'}`,
      `REQUESTED_INSTALL_ID=${input.requestedInstallId}`,
      `CURRENT_ACTIVE_INSTALL_ID=${input.currentActiveInstallId ?? 'null'}`,
    ].join('\n'),
    MISSION_ID: input.missionId,
    MISSION_INSTALL_ID: input.missionInstallId,
    REQUESTED_INSTALL_ID: input.requestedInstallId,
    CURRENT_ACTIVE_INSTALL_ID: input.currentActiveInstallId ?? null,
  }
}

export function bindMissionInstallId(mission: FoundryMissionRecord, requested: string | null | undefined, currentActive?: string | null): {
  ok: true
  installId: string
} | ForeignInstallRefusal {
  const bound = missionBoundInstallId(mission)
  if (!bound) {
    return formatForeignInstallRefusal({
      missionId: mission.missionId,
      missionInstallId: null,
      requestedInstallId: requested ?? '',
      currentActiveInstallId: currentActive,
    })
  }
  if (requested && requested !== bound) {
    return formatForeignInstallRefusal({
      missionId: mission.missionId,
      missionInstallId: bound,
      requestedInstallId: requested,
      currentActiveInstallId: currentActive,
    })
  }
  return { ok: true, installId: bound }
}

export function isActivationPendingEligible(mission: FoundryMissionRecord): boolean {
  if (!missionBoundInstallId(mission)) return false
  if (mission.buildState.ok !== true || mission.packageState.ok !== true || mission.installState.ok !== true) return false
  if (missionIdentityAccepted(mission)) return false
  if (mission.status === 'COMPLETE' || mission.status === 'CANCELLED') return false
  if (mission.superseded === true) return false
  return true
}

export function activationNextRequiredAction(mission: FoundryMissionRecord): string {
  const installId = missionBoundInstallId(mission)
  if (!installId) return 'installer.install_production'
  if (mission.plan.some(step => step.intent === 'ACTIVATE' && step.status === 'done') && mission.runtimeState.activeInstallId === installId) {
    return 'runtime.transition_to_active'
  }
  return `installer.activate(${installId})`
}

function fileSha256(filePath: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex')
  } catch {
    return null
  }
}

export function verifyInstallArtifactIntegrity(
  installId: string,
  mission?: FoundryMissionRecord | null,
  optRoot = realInstallOptRoot(),
): ArtifactIntegrityResult {
  const installDir = path.join(optRoot, installId)
  const exists = existsSync(installDir)
  let stamp: InstallStamp | null = null
  try {
    stamp = JSON.parse(readFileSync(path.join(installDir, 'INSTALL_STAMP.json'), 'utf8')) as InstallStamp
  } catch {
    stamp = null
  }
  const stampValid = Boolean(stamp?.install_id && stamp.install_id === installId)
  const executable = stamp?.executable || path.join(installedAppTreeDir(installDir), 'war-room-os')
  const executableExists = existsSync(executable)
  const appimageOk = !stamp?.appimage || !existsSync(stamp.appimage) || Boolean(fileSha256(stamp.appimage))
  const debOk = !stamp?.deb || !existsSync(stamp.deb) || Boolean(fileSha256(stamp.deb))
  const hashesMatch = appimageOk && debOk
  const gitLooksLikeSha = /^[a-f0-9]{7,40}$/i.test((mission?.repoIdentity ?? '').trim())
  const gitIdentityOk = !stamp?.gitSha || !gitLooksLikeSha
    ? true
    : stamp.gitSha.startsWith(mission!.repoIdentity!.slice(0, 7))
      || mission!.repoIdentity!.startsWith(stamp.gitShort ?? '')
      || stamp.gitShort === mission!.repoIdentity
  const ok = exists && stampValid && executableExists && hashesMatch && gitIdentityOk
  const missing = [
    ...(!exists ? ['install directory missing'] : []),
    ...(!stampValid ? ['INSTALL_STAMP.json missing or install_id mismatch'] : []),
    ...(!executableExists ? ['executable missing'] : []),
    ...(!hashesMatch ? ['package artifact hash unreadable'] : []),
    ...(!gitIdentityOk ? ['git identity does not correspond to mission evidence'] : []),
  ]
  return {
    ok,
    installId,
    exists,
    stampValid,
    executableExists,
    hashesMatch,
    gitIdentityOk,
    detail: ok ? `INSTALL_ID=${installId} integrity PASS` : `INSTALL_ID=${installId} integrity FAIL: ${missing.join('; ')}`,
  }
}

export function resetActivationRetrySteps(mission: FoundryMissionRecord): void {
  for (const step of mission.plan) {
    if (!(ACTIVATION_RETRY_INTENTS as readonly string[]).includes(step.intent)) continue
    if (step.intent === 'COMPUTER_VERIFY' && step.status === 'done' && !missionIdentityAccepted(mission)) {
      step.status = 'pending'
      step.note = 'Computer Use against a foreign occupant does not count. Retry after this mission install is active.'
      continue
    }
    if (step.status === 'failed' || step.status === 'done' && !missionIdentityAccepted(mission) && step.intent !== 'INSTALL') {
      if (step.intent === 'ACTIVATE' || step.intent === 'TRANSITION' || step.intent === 'IDENTITY' || step.intent === 'BROWSER_VERIFY' || step.intent === 'COMPLETE') {
        step.status = 'pending'
        step.note = step.note ? `${step.note} (activation retry pending)` : 'activation retry pending'
      }
    }
  }
}

export function applyActivationPendingState(
  mission: FoundryMissionRecord,
  meta: Omit<ActivationPendingRecord, 'enteredAt' | 'missionInstallId'> & { missionInstallId?: string },
): ActivationPendingRecord {
  const record: ActivationPendingRecord = {
    missionInstallId: meta.missionInstallId ?? missionBoundInstallId(mission) ?? '',
    blockingOwnerMission: meta.blockingOwnerMission,
    blockingGeneration: meta.blockingGeneration,
    blockingOwnerState: meta.blockingOwnerState,
    enteredAt: new Date().toISOString(),
    integrityOk: meta.integrityOk,
    integrityDetail: meta.integrityDetail,
  }
  mission.engineering ??= {}
  mission.engineering.activationPending = record
  resetActivationRetrySteps(mission)
  mission.blocker = {
    blocker: 'ACTIVATION_PENDING',
    evidence: [
      `BLOCKING_OWNER_MISSION=${record.blockingOwnerMission ?? 'none'}`,
      `BLOCKING_GENERATION=${record.blockingGeneration ?? 'none'}`,
      `BLOCKING_OWNER_STATE=${record.blockingOwnerState ?? 'none'}`,
      `MISSION_INSTALL_ID=${record.missionInstallId}`,
    ].join('\n'),
    attempted: 'installer.activate',
    why: 'Production ownership is held by another mission. This install is intact and must not be rebuilt.',
    unblock: 'When the blocking owner is no longer in a live production state, resume ACTIVATE for this mission installId only.',
  }
  return record
}

export async function enterActivationPending(
  mission: FoundryMissionRecord,
  meta: Omit<ActivationPendingRecord, 'enteredAt' | 'missionInstallId'> & { missionInstallId?: string },
): Promise<FoundryMissionRecord> {
  const record = applyActivationPendingState(mission, meta)
  if (mission.status !== ACTIVATION_PENDING_STATE) {
    await transitionMission(mission, ACTIVATION_PENDING_STATE, `INSTALL succeeded; activation ownership wait. ${mission.blocker?.evidence ?? ''}`)
  } else {
    await appendJournal(mission, { kind: 'observation', text: `ACTIVATION_PENDING still blocked: ${mission.blocker?.evidence ?? ''}` })
    await saveMission(mission)
  }
  await logWarRoomRepoAudit('foundry-ops: activation-pending', {
    missionId: mission.missionId,
    ...record,
  })
  return mission
}

export async function recoverFailedMissionToActivationPending(
  mission: FoundryMissionRecord,
  owner?: FoundryProductionOwner | null,
  ownerMission?: FoundryMissionRecord | null,
): Promise<{ ok: boolean; mission: FoundryMissionRecord; error?: string }> {
  if (!isActivationPendingEligible(mission)) {
    return { ok: false, mission, error: 'Mission is not eligible for activation-pending recovery.' }
  }
  const installId = missionBoundInstallId(mission)!
  const integrity = verifyInstallArtifactIntegrity(installId, mission)
  if (!integrity.ok) {
    return { ok: false, mission, error: `${REFUSED_ARTIFACT_INTEGRITY}: ${integrity.detail}` }
  }
  if (mission.archived === true || mission.testArtifact === true || mission.visibility === 'system') {
    mission.archived = false
    mission.archivedAt = undefined
    mission.testArtifact = false
    mission.visibility = 'commander'
    mission.resumeEligible = true
    await appendJournal(mission, {
      kind: 'decision',
      text: 'Restored commander visibility for an intact installed mission that was archived while activation was still retryable.',
    })
  }
  applyActivationPendingState(mission, {
    missionInstallId: installId,
    blockingOwnerMission: owner?.productionOwnerMissionId ?? owner?.ownerMissionId ?? null,
    blockingGeneration: owner?.productionGeneration ?? null,
    blockingOwnerState: ownerMission?.status ?? (owner ? 'MISSING' : null),
    integrityOk: true,
    integrityDetail: integrity.detail,
  })
  if (mission.status === 'FAILED' || mission.status === 'BLOCKED') {
    await transitionMission(mission, ACTIVATION_PENDING_STATE, 'Recover retryable activation conflict without FAILED→EXECUTING')
  } else if (mission.status !== ACTIVATION_PENDING_STATE) {
    await transitionMission(mission, ACTIVATION_PENDING_STATE, 'Enter activation-pending for intact install')
  }
  await saveMission(mission)
  return { ok: true, mission }
}

export async function describeBlockingProductionOwner(ownerPathOverride?: string): Promise<{
  owner: FoundryProductionOwner | null
  ownerMission: FoundryMissionRecord | null
  stillLive: boolean
}> {
  const owner = await readProductionOwner(ownerPathOverride)
  if (!owner?.productionOwnerMissionId) return { owner, ownerMission: null, stillLive: false }
  const { loadMission } = await import('./foundryMissionStore')
  const ownerMission = await loadMission(owner.productionOwnerMissionId)
  return {
    owner,
    ownerMission,
    stillLive: isLiveProductionMission(ownerMission),
  }
}

export async function auditOwnershipHandoff(input: {
  fromMissionId: string | null
  toMissionId: string
  fromGeneration: number | null
  toInstallId: string
  fromState: string | null
}): Promise<void> {
  await logWarRoomRepoAudit('foundry-ops: production-ownership-handoff', {
    FROM_MISSION_ID: input.fromMissionId,
    TO_MISSION_ID: input.toMissionId,
    FROM_GENERATION: input.fromGeneration,
    TO_INSTALL_ID: input.toInstallId,
    FROM_STATE: input.fromState,
    NOTE: 'New generation recorded only after authorized installer.activate. Old generation record was not mutated deceptively.',
  })
}

export function sourceEditsAllowed(mission: FoundryMissionRecord): boolean {
  if (mission.status === ACTIVATION_PENDING_STATE) return false
  if (missionBoundInstallId(mission) && mission.buildState.ok === true && mission.packageState.ok === true) return false
  return true
}

export function toolchainRebuildRequired(mission: FoundryMissionRecord, integrity: ArtifactIntegrityResult): {
  rebuild: boolean
  repackage: boolean
  reinstall: boolean
} {
  if (integrity.ok && missionBoundInstallId(mission) === integrity.installId) {
    return { rebuild: false, repackage: false, reinstall: false }
  }
  return { rebuild: true, repackage: true, reinstall: true }
}

export { isLiveProductionMission, isAuthorizedProductionActivator, isResumeEligible }
