/**
 * Single production activation authority.
 *
 * Every live installer.activate / runtime.transition_to_active / launcher-shim
 * mutation must pass authorizeProductionActivation. commanderConfirmed:true is
 * never sufficient by itself.
 *
 * Call graph (live machine) — every production entry:
 *   mission controller callTool
 *     → claimToolResources (PRODUCTION_LEASE first)
 *       → acquireProductionLease (atomic wx)
* → BUILD_PIPELINE / PACKAGE_PIPELINE / INSTALL_PIPELINE / ACTIVE_RUNTIME
 *     → executeEngineerTool
 *   engineerTools installer.activate
* → installerActivate → authorizeProductionActivation → recordProductionOwner
 *   engineerTools runtime.transition_to_active
 *     → runtimeTransitionToActive → authorizeProductionActivation
 *   engineerTools runtime.launch_installed
 *     → refuse if another live lease holder exists; otherwise relaunch current
 *   engineerTools installer.rollback_activation
 *     → installerActivate (MAINTENANCE_ROLLBACK, COMMANDER_EXPLICIT_ROLLBACK)
 *   engineerTools mission.start (from a parent mission)
 *     → child recorded as HELPER; cannot acquire PRODUCTION_LEASE
 *   Engineering Review helper / peer Foundry missions
 *     → same claimToolResources path; REFUSED_PRODUCTION_LEASE_HELD or
 *       REFUSED_HELPER_NOT_PRODUCTION_OWNER — never steals ACTIVE_RUNTIME
 *   production / resume / relaunch / acceptance proof scripts
 *     → installerActivate / runtimeTransitionToActive via FOUNDRY_PRODUCTION_MISSION_ID
 *       or COMMANDER_EXPLICIT_ROLLBACK + FOUNDRY_ROLLBACK_INSTALL_ID
 *   deterministic production continuation
 *     → runDeterministicMission → same tool path / same lease
 *   manual maintenance
 *     → MAINTENANCE_ROLLBACK exclusive lease (Commander explicit)
 *
 * Previous bypasses closed here:
 *   - helper scripts calling installerActivate({ commanderConfirmed: true })
 *     with no mission
 *   - completed/archived/superseded missions re-activating
 *   - older generation overwriting a newer production epoch
 *   - allowHistoricalRollback without COMMANDER_EXPLICIT_ROLLBACK
 *   - recordProductionOwner rewriting ownership without an authorized activate
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { foundryDataHierarchy } from './foundryPaths'
import { loadMission } from './foundryMissionStore'
import { installerActiveStatus, realInstallOptRoot } from './installerTool'
import { listResourceClaims } from './foundryResourceLocks'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { classifyFoundryMission, isResumeEligible, isTestMissionClass } from './foundryMissionVisibility'
import type { FoundryMissionClassification, FoundryMissionRecord, FoundryMissionState } from './foundryMissionTypes'

export const STALE_PASS006_MISSION_IDS = [
  '29d1b794-b575-4c5d-9285-240eae2cf9f8',
  '85757e99-94f9-48f1-b2ed-afa1c00b8621',
  'e650f093-9ee8-430e-9620-259f1a084f9b',
] as const

export const HISTORICAL_PROOF_INSTALL_IDS = [
  'war-room-os-0.1.0-10a3d34-pass006-e650f093',
  'war-room-os-0.1.0-10a3d34-pass006-85757e99',
  'war-room-os-0.1.0-75f49a0-foundry-5d4b64e1',
  'war-room-os-0.1.0-75f49a0-foundry-2013affd',
  'war-room-os-0.1.0-75f49a0-pass011r-88356e33',
  'war-room-os-0.1.0-75f49a0-foundry-544de899',
  'war-room-os-0.1.0-75f49a0-foundry-9bf8ed1f',
  'war-room-os-0.1.0-75f49a0-foundry-pass014-write-set',
  'war-room-os-0.1.0-75f49a0-foundry-2a97aa3d',
] as const

export const PRODUCTION_ACTIVATION_AUTHORITY = 'authorizeProductionActivation' as const

export const REFUSED_PRODUCTION_LEASE_HELD = 'REFUSED_PRODUCTION_LEASE_HELD'
export const REFUSED_HELPER_NOT_PRODUCTION_OWNER = 'REFUSED_HELPER_NOT_PRODUCTION_OWNER'
export const REFUSED_STALE_PRODUCTION_OWNER = 'REFUSED_STALE_PRODUCTION_OWNER'
export const REFUSED_SCRIPT_BYPASS = 'REFUSED_SCRIPT_BYPASS'
export const REFUSED_HISTORICAL_INSTALL = 'REFUSED_HISTORICAL_INSTALL'
export const REFUSED_MISSING_MISSION = 'REFUSED_MISSING_MISSION'
export const REFUSED_MISSION_NOT_CURRENT = 'REFUSED_MISSION_NOT_CURRENT'
export const REFUSED_MAINTENANCE_REQUIRED = 'REFUSED_MAINTENANCE_REQUIRED'
export const REFUSED_OLDER_INSTALL = 'REFUSED_OLDER_INSTALL'
export const REFUSED_FOREIGN_INSTALL = 'REFUSED_FOREIGN_INSTALL'

export type ProductionActivationMode = 'MISSION' | 'MAINTENANCE_ROLLBACK' | 'RELAUNCH_CURRENT'

/** States in which a mission can still legitimately mutate or transition production.
 * ACTIVATION_PENDING is a waiter, not a blocking live owner. */
export const LIVE_PRODUCTION_STATES = new Set<FoundryMissionState>([
  'EXECUTING',
  'VALIDATING',
  'BUILDING',
  'PACKAGING',
  'INSTALLING',
  'VERIFYING',
  'REPLANNING',
  'WAITING_RESOURCE',
  'WAITING_AUTHORIZATION',
  'RECOVERING',
  'PAUSED',
])

/** Requester may attempt activate: live mutation states plus activation-pending wait. */
export const PRODUCTION_ACTIVATOR_STATES = new Set<FoundryMissionState>([
  ...LIVE_PRODUCTION_STATES,
  'ACTIVATION_PENDING',
])

export function isLiveProductionMission(mission: FoundryMissionRecord | null | undefined): boolean {
  if (!mission) return false
  if (mission.archived === true || mission.superseded === true || mission.resumeEligible === false) return false
  if (!isResumeEligible(mission)) return false
  if (['COMPLETE', 'FAILED', 'CANCELLED', 'ACTIVATION_PENDING'].includes(mission.status)) return false
  if (mission.status === 'BLOCKED') {
    return mission.plan.some(step => ['BUILD', 'PACKAGE', 'INSTALL', 'ACTIVATE', 'TRANSITION', 'IDENTITY', 'BROWSER_VERIFY', 'COMPUTER_VERIFY'].includes(step.intent) && (step.status === 'pending' || step.status === 'active'))
      || (mission.sourceState.changedFiles.length > 0 && mission.installState.ok !== true)
      || (mission.buildState.ok === true && mission.packageState.ok !== true)
      || (mission.packageState.ok === true && mission.installState.ok !== true)
  }
  return LIVE_PRODUCTION_STATES.has(mission.status)
}

export function isAuthorizedProductionActivator(mission: FoundryMissionRecord | null | undefined): boolean {
  if (!mission) return false
  if (mission.archived === true || mission.superseded === true || mission.resumeEligible === false) return false
  if (!isResumeEligible(mission)) return false
  if (['COMPLETE', 'FAILED', 'CANCELLED'].includes(mission.status)) return false
  return PRODUCTION_ACTIVATOR_STATES.has(mission.status)
}

export type FoundryProductionOwner = {
  installId: string
  ownerMissionId: string | null
  ownerClass: FoundryMissionClassification | 'COMMANDER_DIRECT' | 'MAINTENANCE_ROLLBACK' | null
  activatedAt: string
  productionGeneration: number
  productionOwnerMissionId: string | null
  activeInstallId: string
}

export type ProductionActivationRequest = {
  missionId?: string | null
  installId: string
  commanderConfirmed?: boolean
  commanderExplicitRollback?: boolean
  activationMode?: ProductionActivationMode
  allowHistoricalRollback?: boolean
  realOptRootOverride?: string
  ownerPathOverride?: string
  ownerOverride?: FoundryProductionOwner | null
  missionOverride?: FoundryMissionRecord | null
  ownerMissionOverride?: FoundryMissionRecord | null
  currentActiveInstallIdOverride?: string | null
  skipLiveMachine?: boolean
  leasePathOverride?: string
}

export type ProductionAuthorizationOk = {
  ok: true
  mode: ProductionActivationMode
  generation: number
  code?: undefined
  error?: undefined
  stage?: undefined
}

export type ProductionAuthorizationDenied = {
  ok: false
  error: string
  code: string
  stage: 'policy'
  mode?: ProductionActivationMode
}

export type ProductionAuthorizationResult = ProductionAuthorizationOk | ProductionAuthorizationDenied

function ownerPath(override?: string): string {
  return override || path.join(foundryDataHierarchy().operations, 'production-owner.json')
}

export function isHistoricalProofInstall(installId: string): boolean {
  return (HISTORICAL_PROOF_INSTALL_IDS as readonly string[]).includes(installId)
}

function asOwner(parsed: Partial<FoundryProductionOwner> | null | undefined): FoundryProductionOwner | null {
  if (!parsed || typeof parsed.installId !== 'string' || !parsed.installId) return null
  const generation = typeof parsed.productionGeneration === 'number' && Number.isFinite(parsed.productionGeneration)
    ? parsed.productionGeneration
    : 1
  return {
    installId: parsed.installId,
    ownerMissionId: typeof parsed.ownerMissionId === 'string' ? parsed.ownerMissionId : null,
    ownerClass: parsed.ownerClass ?? null,
    activatedAt: typeof parsed.activatedAt === 'string' ? parsed.activatedAt : '',
    productionGeneration: generation,
    productionOwnerMissionId: typeof parsed.productionOwnerMissionId === 'string'
      ? parsed.productionOwnerMissionId
      : (typeof parsed.ownerMissionId === 'string' ? parsed.ownerMissionId : null),
    activeInstallId: typeof parsed.activeInstallId === 'string' ? parsed.activeInstallId : parsed.installId,
  }
}

export async function readProductionOwner(ownerPathOverride?: string): Promise<FoundryProductionOwner | null> {
  const file = ownerPath(ownerPathOverride)
  if (!existsSync(file)) return null
  try {
    return asOwner(JSON.parse(await readFile(file, 'utf8')) as Partial<FoundryProductionOwner>)
  } catch {
    return null
  }
}

export async function recordProductionOwner(input: {
  installId: string
  mission?: FoundryMissionRecord | null
  missionId?: string | null
  mode?: ProductionActivationMode
  ownerPathOverride?: string
  authorized?: boolean
}): Promise<FoundryProductionOwner> {
  if (input.authorized !== true && !input.ownerPathOverride) {
    throw new Error('recordProductionOwner requires an authorized production activation. Direct ownership writes are refused.')
  }
  if (input.authorized === true && !input.ownerPathOverride && input.mode !== 'RELAUNCH_CURRENT') {
    const { readProductionLease, REFUSED_PRODUCTION_LEASE_HELD: leaseHeld } = await import('./foundryProductionLease')
    const lease = await readProductionLease()
    const requester = input.mission?.missionId ?? input.missionId ?? null
    if (lease && requester && lease.ownerMissionId !== requester) {
      throw new Error(`${leaseHeld}: peer ${requester} cannot bump productionGeneration while ${lease.ownerMissionId} holds PRODUCTION_LEASE.`)
    }
  }
  const previous = await readProductionOwner(input.ownerPathOverride)
  const mission = input.mission ?? (input.missionId ? await loadMission(input.missionId) : null)
  const generation = input.mode === 'RELAUNCH_CURRENT'
    ? (previous?.productionGeneration ?? 1)
    : (previous?.productionGeneration ?? 0) + 1
  const owner: FoundryProductionOwner = {
    installId: input.installId,
    ownerMissionId: mission?.missionId ?? input.missionId ?? null,
    ownerClass: input.mode === 'MAINTENANCE_ROLLBACK'
      ? 'MAINTENANCE_ROLLBACK'
      : (mission ? classifyFoundryMission(mission).classification : 'COMMANDER_DIRECT'),
    activatedAt: new Date().toISOString(),
    productionGeneration: generation,
    productionOwnerMissionId: mission?.missionId ?? input.missionId ?? null,
    activeInstallId: input.installId,
  }
  await mkdir(path.dirname(ownerPath(input.ownerPathOverride)), { recursive: true })
  await writeFile(ownerPath(input.ownerPathOverride), JSON.stringify(owner, null, 2), 'utf8')
  await logWarRoomRepoAudit('foundry-ops: production-owner', owner)
  return owner
}

function stampBuiltAt(installId: string, root: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(root, installId, 'INSTALL_STAMP.json'), 'utf8')) as { builtAt?: string }
    return typeof raw.builtAt === 'string' ? raw.builtAt : null
  } catch {
    return null
  }
}

function deny(code: string, error: string, mode?: ProductionActivationMode): ProductionAuthorizationDenied {
  return { ok: false, stage: 'policy', code, error: error.startsWith(code) ? error : `${code}: ${error}`, mode }
}

function resolveMode(input: ProductionActivationRequest, sameAsCurrent: boolean): ProductionActivationMode | ProductionAuthorizationDenied {
  if (input.commanderExplicitRollback === true) {
    if (input.activationMode && input.activationMode !== 'MAINTENANCE_ROLLBACK') {
      return deny(REFUSED_MAINTENANCE_REQUIRED, `commanderExplicitRollback requires activationMode=MAINTENANCE_ROLLBACK, got ${input.activationMode}.`)
    }
    return 'MAINTENANCE_ROLLBACK'
  }
  if (input.activationMode === 'MAINTENANCE_ROLLBACK') {
    return deny(REFUSED_MAINTENANCE_REQUIRED, 'MAINTENANCE_ROLLBACK requires COMMANDER_EXPLICIT_ROLLBACK=true and the exact target install id.')
  }
  if (input.allowHistoricalRollback === true) {
    return deny(REFUSED_MAINTENANCE_REQUIRED, 'allowHistoricalRollback is not sufficient. Set COMMANDER_EXPLICIT_ROLLBACK=true with the exact install id.')
  }
  if (input.activationMode === 'RELAUNCH_CURRENT') {
    if (!sameAsCurrent) {
      return deny(REFUSED_SCRIPT_BYPASS, 'RELAUNCH_CURRENT cannot switch production identity.')
    }
    return 'RELAUNCH_CURRENT'
  }
  if (input.missionId || input.missionOverride) return 'MISSION'
  if (sameAsCurrent && input.activationMode !== 'MISSION') return 'RELAUNCH_CURRENT'
  return deny(REFUSED_SCRIPT_BYPASS, 'commanderConfirmed is not sufficient. Production activation requires a live authorized mission or COMMANDER_EXPLICIT_ROLLBACK.')
}

export function productionActivationFromEnv(installId: string): ProductionActivationRequest {
  const rollback = process.env.FOUNDRY_COMMANDER_EXPLICIT_ROLLBACK === 'true'
  const rollbackTarget = process.env.FOUNDRY_ROLLBACK_INSTALL_ID?.trim()
  const missionId = process.env.FOUNDRY_PRODUCTION_MISSION_ID?.trim() || null
  if (rollback) {
    if (rollbackTarget && rollbackTarget !== installId) {
      throw new Error(`${REFUSED_MAINTENANCE_REQUIRED}: FOUNDRY_ROLLBACK_INSTALL_ID=${rollbackTarget} does not match ${installId}.`)
    }
    return {
      installId,
      commanderConfirmed: true,
      commanderExplicitRollback: true,
      activationMode: 'MAINTENANCE_ROLLBACK',
      missionId: missionId,
    }
  }
  if (!missionId) {
    throw new Error(`${REFUSED_SCRIPT_BYPASS}: helper scripts must set FOUNDRY_PRODUCTION_MISSION_ID or FOUNDRY_COMMANDER_EXPLICIT_ROLLBACK with FOUNDRY_ROLLBACK_INSTALL_ID.`)
  }
  return {
    installId,
    commanderConfirmed: true,
    missionId,
    activationMode: 'MISSION',
  }
}

export async function authorizeProductionActivation(
  input: ProductionActivationRequest,
): Promise<ProductionAuthorizationResult> {
  const installId = input.installId
  if (installId && isHistoricalProofInstall(installId) && input.commanderExplicitRollback !== true) {
    return deny(REFUSED_HISTORICAL_INSTALL, `Refusing historical proof rollback of ${installId}. COMMANDER_EXPLICIT_ROLLBACK is required.`)
  }

  const isolated = Boolean(input.realOptRootOverride && input.realOptRootOverride !== realInstallOptRoot())
    || input.skipLiveMachine === true
  const skipIsolatedFastPath = Boolean(
    input.ownerOverride
    || input.ownerPathOverride
    || input.missionOverride
    || input.activationMode === 'RELAUNCH_CURRENT'
    || input.activationMode === 'MAINTENANCE_ROLLBACK'
    || input.commanderExplicitRollback === true
    || (installId && isHistoricalProofInstall(installId)),
  )
  if (isolated && !skipIsolatedFastPath) {
    return { ok: true, mode: 'MISSION', generation: 1 }
  }
  if (input.commanderConfirmed !== true) {
    return deny('REFUSED_UNCONFIRMED', 'Production activation requires commanderConfirmed: true.')
  }
  if (!installId) return deny('REFUSED_INSTALL_ID', 'installId is required.')

  if (isHistoricalProofInstall(installId) && input.commanderExplicitRollback !== true) {
    return deny(REFUSED_HISTORICAL_INSTALL, `Refusing historical proof rollback of ${installId}. COMMANDER_EXPLICIT_ROLLBACK is required.`)
  }

  const currentStatus = isolated
    ? { activeInstallId: input.currentActiveInstallIdOverride ?? input.ownerOverride?.activeInstallId ?? null }
    : await installerActiveStatus()
  const currentActive = input.currentActiveInstallIdOverride
    ?? currentStatus.activeInstallId
    ?? null
  const sameAsCurrent = Boolean(currentActive && currentActive === installId)
  const modeOrDeny = resolveMode(input, sameAsCurrent)
  if (typeof modeOrDeny !== 'string') return modeOrDeny
  const mode = modeOrDeny

  const owner = input.ownerOverride !== undefined
    ? input.ownerOverride
    : await readProductionOwner(input.ownerPathOverride)
  const generation = owner?.productionGeneration ?? 1

  if (mode === 'RELAUNCH_CURRENT') {
    if (!sameAsCurrent) return deny(REFUSED_SCRIPT_BYPASS, 'RELAUNCH_CURRENT cannot switch production identity.')
    if (!isolated || input.leasePathOverride) {
      const { readProductionLease, inspectLeaseOwnerLiveness } = await import('./foundryProductionLease')
      const lease = await readProductionLease(input.leasePathOverride)
      const requester = input.missionId ?? input.missionOverride?.missionId ?? null
      if (lease && requester && lease.ownerMissionId !== requester) {
        const inspect = await inspectLeaseOwnerLiveness(lease)
        if (!inspect.reclaimable) {
          return deny(REFUSED_PRODUCTION_LEASE_HELD, `RELAUNCH_CURRENT refused; PRODUCTION_LEASE held by ${lease.ownerMissionId}.`)
        }
      }
    }
    return { ok: true, mode, generation }
  }

  if (mode === 'MAINTENANCE_ROLLBACK') {
    const rollbackMission = input.missionOverride ?? (input.missionId ? await loadMission(input.missionId) : null)
    if (rollbackMission) {
      const { isHelperNotProductionOwner } = await import('./foundryProductionLease')
      if (isHelperNotProductionOwner(rollbackMission)) {
        return deny(REFUSED_HELPER_NOT_PRODUCTION_OWNER, `Helper ${rollbackMission.missionId} cannot invoke maintenance rollback.`)
      }
    }
    if (input.commanderExplicitRollback !== true) {
      return deny(REFUSED_MAINTENANCE_REQUIRED, 'Maintenance activation requires COMMANDER_EXPLICIT_ROLLBACK=true.')
    }
    if (process.env.FOUNDRY_DISALLOW_MAINTENANCE_ACTIVATION === 'true') {
      return deny(REFUSED_MAINTENANCE_REQUIRED, 'Maintenance activation is disabled for this process (ordinary proof/test).')
    }
    if (process.env.FOUNDRY_VALIDATION === '1' && process.env.FOUNDRY_ALLOW_MAINTENANCE_FIXTURE !== 'true') {
      return deny(REFUSED_MAINTENANCE_REQUIRED, 'Ordinary validation/proof scripts cannot use MAINTENANCE_ROLLBACK.')
    }
    if (!isolated || input.leasePathOverride) {
      if (rollbackMission) {
        const { acquireProductionLease } = await import('./foundryProductionLease')
        const lease = await acquireProductionLease({
          mission: rollbackMission,
          waitMs: 0,
          mode: 'MAINTENANCE_ROLLBACK',
          commanderExplicitRollback: true,
          pathOverride: input.leasePathOverride,
          skipLiveMachine: isolated,
          installTarget: installId,
        })
        if (!lease.ok) {
          return deny(lease.code === REFUSED_PRODUCTION_LEASE_HELD ? REFUSED_PRODUCTION_LEASE_HELD : lease.code, lease.error)
        }
      }
    }
    return { ok: true, mode, generation: generation + 1 }
  }

  if (!input.missionId && !input.missionOverride) {
    return deny(REFUSED_MISSING_MISSION, 'Mission activation requires a live mission id.')
  }

  const mission = input.missionOverride ?? (input.missionId ? await loadMission(input.missionId) : null)
  if (!mission) {
    return deny(REFUSED_MISSING_MISSION, `Unknown mission ${input.missionId} cannot activate production.`)
  }
  const { isHelperNotProductionOwner } = await import('./foundryProductionLease')
  if (isHelperNotProductionOwner(mission)) {
    return deny(
      REFUSED_HELPER_NOT_PRODUCTION_OWNER,
      `Helper ${mission.missionId} (parent=${mission.parentMissionId ?? 'none'}) is not PRODUCTION_OWNER and cannot activate production.`,
    )
  }
  if (!isResumeEligible(mission) || mission.superseded === true || mission.archived === true || mission.resumeEligible === false) {
    return deny(REFUSED_MISSION_NOT_CURRENT, `Mission ${mission.missionId} is archived/superseded/not resume-eligible and cannot change ACTIVE_RUNTIME.`)
  }
  if (!isAuthorizedProductionActivator(mission) || ['COMPLETE', 'FAILED', 'CANCELLED'].includes(mission.status)) {
    return deny(
      REFUSED_STALE_PRODUCTION_OWNER,
      `Mission ${mission.missionId} is not in an authorized live production phase (status=${mission.status}). Completed/historical passes cannot steal ACTIVE_RUNTIME.`,
    )
  }
  if (mission.installState.installId && mission.installState.installId !== installId) {
    return deny(
      REFUSED_FOREIGN_INSTALL,
      [
        REFUSED_FOREIGN_INSTALL,
        `MISSION_ID=${mission.missionId}`,
        `MISSION_INSTALL_ID=${mission.installState.installId}`,
        `REQUESTED_INSTALL_ID=${installId}`,
        `CURRENT_ACTIVE_INSTALL_ID=${currentActive ?? 'null'}`,
      ].join('\n'),
    )
  }

  const classified = classifyFoundryMission(mission)
  if (isTestMissionClass(classified.classification) || mission.testArtifact) {
    if (!isAuthorizedProductionActivator(mission)) {
      return deny(REFUSED_MISSION_NOT_CURRENT, `Test/acceptance mission ${mission.missionId} is not in an authorized production acceptance phase (status=${mission.status}).`)
    }
  }

  if (owner && owner.productionOwnerMissionId && owner.productionOwnerMissionId !== mission.missionId && !sameAsCurrent) {
    const ownerMission = input.ownerMissionOverride !== undefined
      ? input.ownerMissionOverride
      : await loadMission(owner.productionOwnerMissionId)
    const ownerStillLive = isLiveProductionMission(ownerMission)
    if (ownerStillLive || !ownerMission) {
      return deny(
        REFUSED_STALE_PRODUCTION_OWNER,
        `Mission ${mission.missionId} cannot overwrite production generation ${owner.productionGeneration} owned by ${owner.productionOwnerMissionId}.`,
      )
    }
    await logWarRoomRepoAudit('foundry-ops: production-ownership-handoff', {
      FROM_MISSION_ID: owner.productionOwnerMissionId,
      TO_MISSION_ID: mission.missionId,
      FROM_GENERATION: owner.productionGeneration,
      TO_INSTALL_ID: installId,
      FROM_STATE: ownerMission.status,
      NOTE: 'Blocking owner is not live. Requester may acquire a new generation via authorized activate. Old generation record is not rewritten here.',
    })
  }

  const mustHoldLease = !sameAsCurrent && (!isolated || Boolean(input.leasePathOverride))
  if (mustHoldLease) {
    const { assertProductionLeaseHeld, REFUSED_PRODUCTION_LEASE_HELD: leaseHeld, REFUSED_HELPER_NOT_PRODUCTION_OWNER: helperCode } = await import('./foundryProductionLease')
    const lease = await assertProductionLeaseHeld(mission, input.leasePathOverride)
    if (!lease.ok) {
      const code = lease.code === leaseHeld
        ? REFUSED_PRODUCTION_LEASE_HELD
        : lease.code === helperCode
          ? REFUSED_HELPER_NOT_PRODUCTION_OWNER
          : REFUSED_MISSION_NOT_CURRENT
      return deny(code, lease.error)
    }
    const claims = isolated ? [] : await listResourceClaims()
    const ownsRuntime = isolated
      || claims.some(claim => claim.resource === 'ACTIVE_RUNTIME' && claim.missionId === mission.missionId)
      || (mission.runtimeClaims ?? []).includes('ACTIVE_RUNTIME')
      || claims.some(claim => claim.resource === 'PRODUCTION_LEASE' && claim.missionId === mission.missionId)
    if (!ownsRuntime && !isolated) {
      return deny(REFUSED_MISSION_NOT_CURRENT, `Mission ${mission.missionId} does not own ACTIVE_RUNTIME and cannot change production.`)
    }
  }

  if (!isolated && !sameAsCurrent) {
    const root = realInstallOptRoot()
    const currentBuilt = currentActive ? stampBuiltAt(currentActive, root) : null
    const requestedBuilt = stampBuiltAt(installId, root)
    const ownIntactInstall = Boolean(mission.installState.installId && mission.installState.installId === installId)
    if (currentBuilt && requestedBuilt && Date.parse(requestedBuilt) < Date.parse(currentBuilt) && !ownIntactInstall) {
      return deny(REFUSED_OLDER_INSTALL, `Refusing to activate older install ${installId} (${requestedBuilt}) over current ${currentActive} (${currentBuilt}). Use COMMANDER_EXPLICIT_ROLLBACK.`)
    }
  }

  return { ok: true, mode, generation: generation + (sameAsCurrent ? 0 : 1) }
}

/** @deprecated Use authorizeProductionActivation. Kept as the same authority. */
export async function assertProductionActivationAllowed(
  input: ProductionActivationRequest,
): Promise<ProductionAuthorizationResult> {
  return authorizeProductionActivation(input)
}
