/**
 * PASS 012 — production lease exclusivity, edit-contract context, canonical memory paths.
 * Does not embed production replacement text or weaken PASS 011 anchors.
 */
import { pathToFileURL } from 'node:url'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { cancelMission, startMissionInput } from './foundryMissionController'
import {
  compactFileRead,
  describeReplacementShape,
  formatEditContract,
  validateReplacementText,
} from './foundryBoundedEdit'
import {
  acquireProductionLease,
  inspectLeaseOwnerLiveness,
  readProductionLease,
  reclaimProductionLeaseIfSafe,
  REFUSED_PRODUCTION_LEASE_HELD,
  releaseProductionLease,
  shouldHoldProductionLease,
} from './foundryProductionLease'
import {
  canonicalizeMemoryPath,
  classifyMemoryProvenance,
  isCanonicalRepoFileRef,
  readEngineeringMemory,
  recallFeatureOwnership,
  rememberEngineeringFact,
  rememberFeatureOwnership,
  verifyFact,
} from './foundryEngineeringMemory'
import { resourcesForTool } from './foundryToolLifecycle'
import { FOUNDRY_LOCK_ORDER } from './foundryOperationsTypes'
import { loadMission, saveMission } from './foundryMissionStore'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { releaseMissionResources } from './foundryResourceLocks'
import { LEGAL_TRANSITIONS, type FoundryMissionRecord, type FoundryMissionState } from './foundryMissionTypes'
import {
  authorizeProductionActivation,
  isLiveProductionMission,
  LIVE_PRODUCTION_STATES,
  recordProductionOwner,
  REFUSED_FOREIGN_INSTALL,
  REFUSED_STALE_PRODUCTION_OWNER,
  type FoundryProductionOwner,
} from './foundryProductionOwnership'
import {
  activationNextRequiredAction,
  applyActivationPendingState,
  bindMissionInstallId,
  formatForeignInstallRefusal,
  missionBoundInstallId,
  missionIdentityAccepted,
  sourceEditsAllowed,
  toolchainRebuildRequired,
  verifyInstallArtifactIntegrity,
} from './foundryActivationHandoff'
import { buildEngineeringGateTable } from './foundryEngineeringGateTable'
import { evaluateCompletionGate } from './productionCompletionGate'
import { realInstallOptRoot } from './installerTool'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const ROOT = resolveRepoRoot()
const FIX = 'scripts/foundry/bounded-edit/pass012-chip.tsx'
const SHA_FIX = 'scripts/foundry/bounded-edit/pass012-memory-sha.txt'
const PASS009 = '9eb76d1e-66fe-44f8-8393-ea19c2638f3b'

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function cleanupPass009Fixture(): Promise<CaseResult> {
  const { listAllMissions } = await import('./foundryMissionStore')
  const missions = await listAllMissions()
  const stale = missions.filter(mission =>
    /PASS 009 archive protection fixture/.test(mission.userRequest)
    && mission.plan.every(step => step.status === 'pending'),
  )
  const ids: string[] = []
  for (const mission of stale) {
    ids.push(mission.missionId)
    await cancelMission(mission.missionId).catch(() => undefined)
    mission.visibility = 'system'
    mission.testArtifact = true
    mission.archived = true
    mission.resumeEligible = false
    mission.archivedAt = mission.archivedAt ?? new Date().toISOString()
    await releaseMissionResources(mission.missionId).catch(() => undefined)
    await saveMission(mission)
    await archiveConfirmedSystemTestMission(mission).catch(() => undefined)
  }
  const canonical = await loadMission(PASS009)
  const leftover = stale.length
    ? (await Promise.all(stale.map(item => loadMission(item.missionId)))).every(item => item?.archived === true && item.resumeEligible === false)
    : true
  return check(
    'pass009_stale_fixture_cleanup',
    leftover && (!canonical || canonical.archived === true || canonical.resumeEligible === false),
    `cleaned=${ids.join(',') || 'none'} canonical=${canonical?.status ?? 'absent'}`,
  )
}

async function run() {
  const results: CaseResult[] = []
  results.push(await cleanupPass009Fixture())
  results.push(check(
    'production_lease_in_lock_order',
    FOUNDRY_LOCK_ORDER.includes('PRODUCTION_LEASE') && FOUNDRY_LOCK_ORDER.indexOf('PRODUCTION_LEASE') < FOUNDRY_LOCK_ORDER.indexOf('BUILD_PIPELINE'),
    FOUNDRY_LOCK_ORDER.join(' → '),
  ))
  results.push(check(
    'build_requires_production_lease',
    resourcesForTool('build.run').includes('PRODUCTION_LEASE') && resourcesForTool('installer.activate').includes('PRODUCTION_LEASE'),
    JSON.stringify({ build: resourcesForTool('build.run'), activate: resourcesForTool('installer.activate') }),
  ))

  const leaseDir = await mkdtemp(path.join(tmpdir(), 'wr-pass012-lease-'))
  const leaseFile = path.join(leaseDir, 'production-lease.json')
  const missionA = startMissionInput('PASS 012 production lease fixture A. Not a production install.')
  missionA.missionId = 'pass012-lease-a'
  missionA.status = 'BUILDING'
  missionA.kind = 'application'
  missionA.archived = false
  missionA.resumeEligible = true
  const missionB = startMissionInput('PASS 012 production lease fixture B. Not a production install.')
  missionB.missionId = 'pass012-lease-b'
  missionB.status = 'INSTALLING'
  missionB.kind = 'application'
  missionB.archived = false
  missionB.resumeEligible = true
  const gotA = await acquireProductionLease({ mission: missionA, waitMs: 0, skipLiveMachine: true, pathOverride: leaseFile, installTarget: 'install-a' })
  const gotB = await acquireProductionLease({ mission: missionB, waitMs: 0, skipLiveMachine: true, pathOverride: leaseFile, installTarget: 'install-b' })
  results.push(check('peer_production_block', gotA.ok === true && gotB.ok === false && /REFUSED_PRODUCTION_LEASE_HELD/.test(gotB.ok === false ? gotB.error : ''), JSON.stringify({ a: gotA, b: gotB })))

  const helper = startMissionInput('PASS 012 helper child fixture. Not a production install.')
  helper.missionId = 'pass012-helper-c'
  helper.parentMissionId = missionA.missionId
  helper.productionRole = 'HELPER'
  helper.productionOwner = false
  helper.status = 'EXECUTING'
  helper.kind = 'application'
  helper.archived = false
  helper.resumeEligible = true
  const gotHelper = await acquireProductionLease({ mission: helper, waitMs: 0, skipLiveMachine: true, pathOverride: leaseFile, installTarget: 'install-helper' })
  results.push(check('helper_non_inheritance', gotHelper.ok === false && /REFUSED_HELPER_NOT_PRODUCTION_OWNER/.test(gotHelper.ok === false ? gotHelper.error : ''), JSON.stringify(gotHelper)))

  await releaseProductionLease(missionA.missionId, leaseFile)
  const concurrentDir = await mkdtemp(path.join(tmpdir(), 'wr-pass012-atomic-'))
  const concurrentFile = path.join(concurrentDir, 'production-lease.json')
  const [win1, win2] = await Promise.all([
    acquireProductionLease({ mission: missionA, waitMs: 0, skipLiveMachine: true, pathOverride: concurrentFile, installTarget: 'install-a' }),
    acquireProductionLease({ mission: missionB, waitMs: 0, skipLiveMachine: true, pathOverride: concurrentFile, installTarget: 'install-b' }),
  ])
  const winners = [win1, win2].filter(item => item.ok)
  const losers = [win1, win2].filter(item => !item.ok)
  results.push(check('atomic_production_acquire', winners.length === 1 && losers.length === 1 && /REFUSED_PRODUCTION_LEASE_HELD/.test(losers[0].ok === false ? losers[0].error : ''), JSON.stringify({ win1, win2 })))
  if (win1.ok) await releaseProductionLease(missionA.missionId, concurrentFile)
  if (win2.ok) await releaseProductionLease(missionB.missionId, concurrentFile)
  rmSync(concurrentDir, { recursive: true, force: true })

  const relaunchRefuse = await acquireProductionLease({ mission: missionA, waitMs: 0, skipLiveMachine: true, pathOverride: leaseFile, mode: 'RELAUNCH_CURRENT' })
  results.push(check('relaunch_cannot_acquire', relaunchRefuse.ok === false, JSON.stringify(relaunchRefuse)))
  await releaseProductionLease(missionA.missionId, leaseFile)
  const gotB2 = await acquireProductionLease({ mission: missionB, waitMs: 0, skipLiveMachine: true, pathOverride: leaseFile, installTarget: 'install-b' })
  results.push(check('lease_release_then_acquire', gotB2.ok === true, JSON.stringify(gotB2)))
  await releaseProductionLease(missionB.missionId, leaseFile)

  const crashLease = {
    ownerMissionId: 'missing-pass012-owner',
    ownerClass: 'COMMANDER_REAL',
    productionGeneration: 1,
    missionId: 'missing-pass012-owner',
    generation: 1,
    targetInstallId: null,
    installTarget: null,
    acquiredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    leaseUpdatedAt: new Date().toISOString(),
    phase: 'BUILDING',
    mode: 'MISSION' as const,
    pid: 2147483646,
  }
  writeFileSync(leaseFile, JSON.stringify(crashLease, null, 2))
  const inspect = await inspectLeaseOwnerLiveness(crashLease)
  const reclaimed = await reclaimProductionLeaseIfSafe(leaseFile)
  results.push(check('crash_recovery', inspect.reclaimable === true && reclaimed.released === true, JSON.stringify({ inspect, reclaimed })))
  const completeDead = {
    ownerMissionId: '5d4b64e1-cb71-41f9-b4d8-0410cdb96818',
    ownerClass: 'COMMANDER_REAL',
    productionGeneration: 9,
    missionId: '5d4b64e1-cb71-41f9-b4d8-0410cdb96818',
    generation: 9,
    targetInstallId: null,
    installTarget: null,
    acquiredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    leaseUpdatedAt: new Date().toISOString(),
    phase: 'VERIFYING',
    mode: 'MISSION' as const,
    pid: 2147483645,
  }
  const completeInspect = await inspectLeaseOwnerLiveness(completeDead)
  results.push(check(
    'complete_dead_owner_reclaimable',
    completeInspect.reclaimable === true && completeInspect.ownerLive === false,
    JSON.stringify(completeInspect),
  ))
  results.push(check('blocked_with_pending_holds_lease', shouldHoldProductionLease({
    ...missionA,
    status: 'BLOCKED',
    sourceState: { ...missionA.sourceState, changedFiles: ['components/war-room/foundry/FoundryMissionControllerPanel.tsx'] },
    installState: { ok: null, installId: null, detail: null },
  }), 'BLOCKED pending production'))

  mkdirSync(path.join(ROOT, 'scripts/foundry/bounded-edit'), { recursive: true })
  writeFileSync(path.join(ROOT, FIX), [
    'export function ReviewChip(selected: { engineeringReview?: \'PASS\' | \'FAIL\' | \'PENDING\'; engineeringReviewDetail?: string | null }) {',
    '  return (',
    '    <div data-testid="foundry-engineering-review">',
    '      <p className="text-sm">{selected.engineeringReview === \'PASS\' ? \'PASS\' : selected.engineeringReview === \'FAIL\' ? \'FAIL\' : \'PENDING\'}</p>',
    '    </div>',
    '  )',
    '}',
    '',
  ].join('\n'))
  const read = await compactFileRead({
    path: FIX,
    aroundMatch: 'selected.engineeringReview',
    focused: true,
  }, startMissionInput('Show Checked detail from engineeringReviewDetail. Keep selected.engineeringReview.'))
  const compact = String((read.result as { compact?: string } | undefined)?.compact ?? '')
  results.push(check('local_edit_contract', /EDIT_CONTRACT:/.test(compact) && /REQUIRED_BINDINGS:/.test(compact) && /selected\.engineeringReview/.test(compact), compact.slice(0, 600)))
  const shape = describeReplacementShape('<p>{selected.engineeringReview === \'PASS\' ? \'PASS\' : \'PENDING\'} {selected.engineeringReviewDetail}</p>')
  results.push(check('structural_replacement_context', shape.TARGET_NODE_KIND === 'JSX_ELEMENT' && shape.PRESERVE_EXPRESSIONS.includes('selected.engineeringReview'), JSON.stringify(shape)))
  const contract = formatEditContract({
    goal: 'show Checked detail',
    anchorId: 'anc_test',
    matchText: '<p>{selected.engineeringReview}</p>',
    requiredBindings: ['selected.engineeringReview', 'selected.engineeringReviewDetail'],
  })
  results.push(check('edit_contract_must_not_hardcode', /MUST_NOT:/.test(contract) && /hardcode PASS/.test(contract), contract))
  const invalid = validateReplacementText({
    matchText: '<p>{selected.engineeringReview}</p>',
    replacementText: '<p>PASS</p>',
    request: 'Show Checked detail from engineeringReviewDetail. Keep selected.engineeringReview.',
    fileContent: readFileSync(path.join(ROOT, FIX), 'utf8'),
  })
  results.push(check('invalid_replacement_safety', typeof invalid === 'string' && /selected\.engineeringReview/.test(invalid), String(invalid)))
  const empty = validateReplacementText({
    matchText: '  plan: Array<{ id: string }>',
    replacementText: '',
    request: 'Keep the plan field.',
  })
  results.push(check('empty_replacement_refused', typeof empty === 'string' && /EMPTY_REPLACEMENT/.test(empty), String(empty)))

  results.push(check('canonical_path_accepts_repo_relative', canonicalizeMemoryPath('components/war-room/foundry/FoundryMissionControllerPanel.tsx') === 'components/war-room/foundry/FoundryMissionControllerPanel.tsx', 'panel'))
  results.push(check('canonical_path_rejects_script_name', canonicalizeMemoryPath('validate:foundry-autonomous-engineering-depth-pass011') === null, 'validate:'))
  results.push(check('canonical_path_rejects_overlay', canonicalizeMemoryPath('/home/chosenone/.local/opt/war-room-os-0.1.0-75f49a0-foundry-2013affd/opt/War Room OS/resources/runtime/components/x.tsx') === null, 'overlay'))
  results.push(check('non_file_ref_not_canonical', isCanonicalRepoFileRef('validate:foo') === false, 'validate:foo'))

  writeFileSync(path.join(ROOT, SHA_FIX), 'alpha\n')
  const remembered = await rememberEngineeringFact({
    topic: 'pass012-sha-fixture',
    summary: 'SHA invalidation fixture',
    files: [SHA_FIX],
    sourceMission: 'pass012-memory-fixture',
    confidence: 'CONFIRMED',
  })
  results.push(check('memory_confirmed_real_path', remembered.stale !== true && remembered.confidence === 'CONFIRMED' && remembered.files[0] === SHA_FIX, JSON.stringify(remembered)))
  writeFileSync(path.join(ROOT, SHA_FIX), 'beta\n')
  const after = verifyFact(remembered)
  results.push(check('memory_sha_invalidation', after.stale === true && /differs from current/.test(after.staleReason ?? ''), after.staleReason ?? ''))
  const refreshed = await rememberEngineeringFact({
    topic: 'pass012-sha-fixture',
    summary: 'SHA invalidation fixture refreshed',
    files: [SHA_FIX],
    sourceMission: 'pass012-memory-fixture',
    confidence: 'CONFIRMED',
  })
  results.push(check('memory_refresh', refreshed.stale !== true && refreshed.fileSha256 === sha('beta\n'), refreshed.fileSha256 ?? ''))

  const falseStale = await rememberFeatureOwnership({
    feature: 'Foundry Engineering Review detail',
    owners: ['components/war-room/foundry/FoundryMissionControllerPanel.tsx'],
    tests: ['validate:foundry-autonomous-engineering-depth-pass011', 'lib/native-builder/foundryAutonomousEngineeringDepth.pass011.validation.ts'],
    sourceMission: '2013affd-896c-44c4-9622-4619a59aebd7',
    confidence: 'CONFIRMED',
    uiControl: 'Advanced session details',
  })
  results.push(check('memory_false_stale_fix', falseStale.stale !== true && falseStale.confidence === 'CONFIRMED' && falseStale.tests.every(item => !item.startsWith('validate:')), JSON.stringify({ stale: falseStale.stale, tests: falseStale.tests, owners: falseStale.owners })))
  const recalled = recallFeatureOwnership(await readEngineeringMemory(), 'Engineering Review')
  results.push(check('engineering_review_memory_recall', Boolean(recalled && recalled.owners.includes('components/war-room/foundry/FoundryMissionControllerPanel.tsx')), JSON.stringify(recalled)))
  results.push(check('fixture_memory_is_test_provenance', classifyMemoryProvenance([SHA_FIX]) === 'TEST_PROVENANCE', SHA_FIX))

  rmSync(leaseDir, { recursive: true, force: true })
  results.push(...await runActivationHandoffCases())
  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  console.log(`Foundry PASS 012 unit: ${results.filter(item => item.pass).length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

function installedMission(id: string, installId: string, status: FoundryMissionState): FoundryMissionRecord {
  const mission = startMissionInput('PASS 012 activation-handoff fixture. Harmless authorization proof. Not a production install.')
  mission.missionId = id
  mission.status = status
  mission.kind = 'application'
  mission.archived = false
  mission.superseded = false
  mission.testArtifact = false
  mission.resumeEligible = true
  mission.visibility = 'commander'
  mission.buildState = { ok: true, detail: 'PASS' }
  mission.packageState = { ok: true, detail: 'PASS' }
  mission.installState = { ok: true, installId, detail: 'PASS' }
  mission.runtimeClaims = ['ACTIVE_RUNTIME']
  for (const step of mission.plan) {
    if (['BUILD', 'PACKAGE', 'INSTALL', 'PATCH_SOURCE'].includes(step.intent)) step.status = 'done'
  }
  return mission
}

function ownerRecord(partial: Partial<FoundryProductionOwner> & { installId: string; productionOwnerMissionId: string }): FoundryProductionOwner {
  return {
    ownerMissionId: partial.ownerMissionId ?? partial.productionOwnerMissionId,
    ownerClass: partial.ownerClass ?? 'COMMANDER_REAL',
    activatedAt: partial.activatedAt ?? new Date().toISOString(),
    productionGeneration: partial.productionGeneration ?? 6,
    activeInstallId: partial.activeInstallId ?? partial.installId,
    ...partial,
    installId: partial.installId,
    productionOwnerMissionId: partial.productionOwnerMissionId,
  }
}

async function authorizePair(input: {
  requester: FoundryMissionRecord
  ownerMission: FoundryMissionRecord | null
  owner: FoundryProductionOwner
  installId?: string
  currentActive?: string
}) {
  return authorizeProductionActivation({
    installId: input.installId ?? input.requester.installState.installId!,
    commanderConfirmed: true,
    activationMode: 'MISSION',
    missionId: input.requester.missionId,
    missionOverride: input.requester,
    ownerOverride: input.owner,
    ownerMissionOverride: input.ownerMission,
    currentActiveInstallIdOverride: input.currentActive ?? input.owner.activeInstallId,
    skipLiveMachine: true,
  })
}

async function runActivationHandoffCases(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const provenInstall = 'war-room-os-0.1.0-75f49a0-foundry-5d4b64e1'
  const missionInstall = 'war-room-os-0.1.0-75f49a0-foundry-pass012-unit'
  const occupantInstall = 'war-room-os-0.1.0-75f49a0-pass011-88356e33'
  const pending = installedMission('pass012-pending', missionInstall, 'ACTIVATION_PENDING')
  const liveOwner = installedMission('pass012-live-owner', occupantInstall, 'EXECUTING')
  const completedOwner = installedMission('pass012-completed-owner', occupantInstall, 'COMPLETE')
  const failedOwner = installedMission('pass012-failed-owner', occupantInstall, 'FAILED')
  const cancelledOwner = installedMission('pass012-cancelled-owner', occupantInstall, 'CANCELLED')
  const archivedOwner = installedMission('pass012-archived-owner', occupantInstall, 'COMPLETE')
  archivedOwner.archived = true
  archivedOwner.resumeEligible = false
  const occupant = ownerRecord({
    installId: occupantInstall,
    productionOwnerMissionId: liveOwner.missionId,
    productionGeneration: 6,
  })

  results.push(check('build_package_install_success', pending.buildState.ok === true && pending.packageState.ok === true && pending.installState.ok === true, JSON.stringify({
    build: pending.buildState.ok,
    pkg: pending.packageState.ok,
    install: pending.installState.ok,
  })))
  results.push(check('mission_install_id_persisted', missionBoundInstallId(pending) === missionInstall, String(missionBoundInstallId(pending))))
  results.push(check('foreign_active_never_substitutes', bindMissionInstallId(pending, occupantInstall, occupantInstall).ok === false, JSON.stringify(bindMissionInstallId(pending, occupantInstall, occupantInstall))))

  const liveBlock = await authorizePair({ requester: pending, ownerMission: liveOwner, owner: occupant, currentActive: occupantInstall })
  results.push(check('live_production_owner_blocks_activation', liveBlock.ok === false && liveBlock.code === REFUSED_STALE_PRODUCTION_OWNER, JSON.stringify(liveBlock)))

  applyActivationPendingState(pending, {
    blockingOwnerMission: liveOwner.missionId,
    blockingGeneration: 6,
    blockingOwnerState: 'EXECUTING',
  })
  const pendingStatus = String(pending.status)
  results.push(check('blocked_activation_enters_activation_pending_not_failed', pendingStatus === 'ACTIVATION_PENDING' && pending.installState.installId === missionInstall, pendingStatus))
  results.push(check('activation_pending_preserves_install_evidence', pending.buildState.ok === true && pending.packageState.ok === true && pending.installState.ok === true && pending.engineering?.activationPending?.missionInstallId === missionInstall, JSON.stringify(pending.engineering?.activationPending)))

  const afterComplete = await authorizePair({
    requester: pending,
    ownerMission: completedOwner,
    owner: ownerRecord({ ...occupant, productionOwnerMissionId: completedOwner.missionId }),
    currentActive: occupantInstall,
  })
  results.push(check('completed_owner_releases_claim', afterComplete.ok === true && afterComplete.generation === 7, JSON.stringify(afterComplete)))

  const afterFailed = await authorizePair({
    requester: pending,
    ownerMission: failedOwner,
    owner: ownerRecord({ ...occupant, productionOwnerMissionId: failedOwner.missionId }),
  })
  results.push(check('failed_owner_releases_stale_claim', afterFailed.ok === true, JSON.stringify(afterFailed)))

  const afterCancelled = await authorizePair({
    requester: pending,
    ownerMission: cancelledOwner,
    owner: ownerRecord({ ...occupant, productionOwnerMissionId: cancelledOwner.missionId }),
  })
  results.push(check('cancelled_owner_releases_stale_claim', afterCancelled.ok === true, JSON.stringify(afterCancelled)))

  results.push(check('archived_owner_is_not_live', isLiveProductionMission(archivedOwner) === false, `archived=${archivedOwner.archived} live=${isLiveProductionMission(archivedOwner)}`))
  results.push(check('genuinely_executing_owner_remains_protected', isLiveProductionMission(liveOwner) === true && liveBlock.ok === false, `live=${isLiveProductionMission(liveOwner)}`))

  for (const state of ['BUILDING', 'PACKAGING', 'INSTALLING', 'VERIFYING'] as const) {
    const mutating = installedMission(`pass012-live-${state.toLowerCase()}`, occupantInstall, state)
    const blocked = await authorizePair({
      requester: pending,
      ownerMission: mutating,
      owner: ownerRecord({ ...occupant, productionOwnerMissionId: mutating.missionId }),
    })
    results.push(check(`pending_cannot_steal_from_live_${state.toLowerCase()}`, blocked.ok === false && blocked.code === REFUSED_STALE_PRODUCTION_OWNER && LIVE_PRODUCTION_STATES.has(state), JSON.stringify({ state, blocked })))
  }

  results.push(check('pending_can_acquire_after_owner_non_live', afterComplete.ok === true && isLiveProductionMission(completedOwner) === false, JSON.stringify({ afterComplete, live: isLiveProductionMission(completedOwner) })))

  const provenPending = installedMission('pass012-proven', provenInstall, 'ACTIVATION_PENDING')
  const integrity = verifyInstallArtifactIntegrity(provenInstall, provenPending)
  const toolchain = toolchainRebuildRequired(provenPending, integrity)
  results.push(check('activation_retry_does_not_rebuild', toolchain.rebuild === false && integrity.ok, integrity.detail))
  results.push(check('activation_retry_does_not_repackage', toolchain.repackage === false, JSON.stringify(toolchain)))
  results.push(check('activation_retry_does_not_reinstall', toolchain.reinstall === false, JSON.stringify(toolchain)))
  results.push(check('artifact_integrity_checked_before_retry', integrity.ok && integrity.exists && integrity.stampValid && integrity.executableExists, integrity.detail))

  const missingIntegrity = verifyInstallArtifactIntegrity('war-room-os-missing-install', pending)
  results.push(check('missing_install_fails_integrity_honestly', missingIntegrity.ok === false, missingIntegrity.detail))

  const foreignActivate = await authorizeProductionActivation({
    installId: occupantInstall,
    commanderConfirmed: true,
    activationMode: 'MISSION',
    missionId: pending.missionId,
    missionOverride: pending,
    ownerOverride: occupant,
    ownerMissionOverride: completedOwner,
    currentActiveInstallIdOverride: occupantInstall,
    skipLiveMachine: true,
  })
  results.push(check('foreign_install_activation_refused', foreignActivate.ok === false && foreignActivate.code === REFUSED_FOREIGN_INSTALL, JSON.stringify(foreignActivate)))

  const foreignTransition = formatForeignInstallRefusal({
    missionId: pending.missionId,
    missionInstallId: missionInstall,
    requestedInstallId: occupantInstall,
    currentActiveInstallId: occupantInstall,
  })
  results.push(check('foreign_runtime_transition_refused', foreignTransition.ok === false && foreignTransition.code === REFUSED_FOREIGN_INSTALL && /MISSION_INSTALL_ID=/.test(foreignTransition.error), foreignTransition.error))

  const ownActivate = await authorizePair({
    requester: { ...pending, status: 'ACTIVATION_PENDING' },
    ownerMission: completedOwner,
    owner: ownerRecord({ ...occupant, productionOwnerMissionId: completedOwner.missionId }),
    installId: missionInstall,
    currentActive: occupantInstall,
  })
  results.push(check('mission_install_activation_succeeds', ownActivate.ok === true && ownActivate.generation === 7, JSON.stringify(ownActivate)))
  const boundTransition = bindMissionInstallId(pending, missionInstall, occupantInstall)
  results.push(check('transition_uses_same_mission_install', boundTransition.ok === true && boundTransition.ok && boundTransition.installId === missionInstall, JSON.stringify(boundTransition)))

  const ownerDir = await mkdtemp(path.join(tmpdir(), 'wr-pass012-owner-'))
  const ownerFile = path.join(ownerDir, 'production-owner.json')
  writeFileSync(ownerFile, JSON.stringify(occupant, null, 2))
  const recorded = await recordProductionOwner({
    installId: missionInstall,
    mission: pending,
    mode: 'MISSION',
    authorized: true,
    ownerPathOverride: ownerFile,
  })
  const reread = JSON.parse(readFileSync(ownerFile, 'utf8')) as FoundryProductionOwner
  results.push(check('generation_ownership_updates_correctly', recorded.productionGeneration === 7 && recorded.productionOwnerMissionId === pending.missionId && reread.productionGeneration === 7 && reread.installId === missionInstall, JSON.stringify(recorded)))
  results.push(check('no_double_active_generation', reread.productionGeneration === recorded.productionGeneration && reread.productionOwnerMissionId === pending.missionId, JSON.stringify(reread)))
  rmSync(ownerDir, { recursive: true, force: true })

  pending.runtimeState = {
    ...pending.runtimeState,
    activeInstallId: occupantInstall,
    runningInstallId: occupantInstall,
    identityMatch: true,
  }
  results.push(check('foreign_identity_match_does_not_count', missionIdentityAccepted(pending) === false, JSON.stringify(pending.runtimeState)))
  const foreignGate = evaluateCompletionGate({
    sourceChanged: true,
    validationOk: true,
    buildOk: true,
    packageOk: true,
    installOk: true,
    activeInstallId: occupantInstall,
    missionInstallId: missionInstall,
    runningInstallId: occupantInstall,
    uiHealthOk: true,
    coreHealthOk: true,
    identityMatch: true,
    browserAcceptanceOk: true,
    consoleAcceptanceOk: true,
    networkAcceptanceOk: true,
    computerUseAcceptance: 'PASS',
    localDeploymentAcceptanceOk: true,
  })
  results.push(check('identity_equality_required', foreignGate.flags.ACTIVE_RUNNING_IDENTITY_MATCH === false && foreignGate.complete === false, JSON.stringify(foreignGate.flags)))
  pending.runtimeState.activeInstallId = missionInstall
  pending.runtimeState.runningInstallId = missionInstall
  pending.runtimeState.identityMatch = true
  results.push(check('mission_identity_accepted_only_for_own_install', missionIdentityAccepted(pending) === true, JSON.stringify(pending.runtimeState)))

  results.push(check('activation_pending_can_reach_complete', LEGAL_TRANSITIONS.ACTIVATION_PENDING.includes('EXECUTING') && LEGAL_TRANSITIONS.EXECUTING.includes('VERIFYING') && LEGAL_TRANSITIONS.VERIFYING.includes('COMPLETE'), LEGAL_TRANSITIONS.ACTIVATION_PENDING.join(',')))
  results.push(check('failed_to_executing_not_needed', !LEGAL_TRANSITIONS.FAILED.includes('EXECUTING') && LEGAL_TRANSITIONS.FAILED.includes('ACTIVATION_PENDING'), LEGAL_TRANSITIONS.FAILED.join(',')))

  const ownershipSrc = readFileSync(path.join(ROOT, 'lib/native-builder/foundryProductionOwnership.ts'), 'utf8')
  results.push(check('audit_logs_ownership_handoff', /foundry-ops: production-ownership-handoff/.test(ownershipSrc) && /Old generation record is not rewritten/.test(ownershipSrc), 'handoff audit present'))
  const bypass = await authorizeProductionActivation({
    installId: missionInstall,
    commanderConfirmed: false,
    skipLiveMachine: true,
    missionOverride: pending,
    ownerOverride: occupant,
  })
  results.push(check('no_production_ownership_bypass', bypass.ok === false, JSON.stringify(bypass)))

  const opt = realInstallOptRoot()
  results.push(check('rollback_installs_preserved', existsSync(path.join(opt, occupantInstall)) && existsSync(path.join(opt, 'war-room-os-0.1.0-75f49a0-foundry-4083e095')) && existsSync(path.join(opt, provenInstall)), 'occupant, baseline, and historical install remain'))

  const panel = readFileSync(path.join(ROOT, 'components/war-room/foundry/FoundryMissionControllerPanel.tsx'), 'utf8')
  results.push(check('pass011_edit_contracts_remain', /selected\.engineeringReview\b/.test(panel) && /Foundry checked all required gates and tests/.test(panel) && /PENDING/.test(panel) && /FAIL/.test(panel), 'panel binding intact'))
  const opsPanel = readFileSync(path.join(ROOT, 'components/war-room/foundry/FoundryOperationsPanel.tsx'), 'utf8')
  results.push(check('advanced_production_owner_chip', /data-testid="foundry-production-owner"/.test(opsPanel) && /data-testid="foundry-production-owner-generation"/.test(opsPanel) && /CURRENT/.test(opsPanel) && /G\$\{productionLease\.generation\}/.test(opsPanel), 'Advanced-only PRODUCTION OWNER CURRENT'))
  const pass011 = readFileSync(path.join(ROOT, 'lib/native-builder/foundryAutonomousEngineeringDepth.pass011.validation.ts'), 'utf8')
  results.push(check('bounded_retry_remains_passing_contract', /BOUNDED_RETRY/.test(pass011) && /file\.replace_unique/.test(pass011), 'pass011 bounded retry cases remain'))
  results.push(check('protected_binding_extraction_remains', /PROTECTED_BINDINGS|selected\.engineeringReview/.test(pass011) && /selected\.engineeringReview/.test(panel), 'protected binding still required'))

  pending.status = 'ACTIVATION_PENDING'
  const next = activationNextRequiredAction(pending)
  const table = buildEngineeringGateTable(pending)
  results.push(check('next_required_action_is_activate_own_install', next === `installer.activate(${missionInstall})` && table.recommendedToolClass === 'installer.activate' && table.availableTools.includes('installer.activate') && !table.availableTools.includes('build.run'), `${next} ${table.recommendedToolClass} ${table.availableTools.join(',')}`))
  results.push(check('no_source_edits_while_activation_pending', sourceEditsAllowed(pending) === false, `status=${pending.status}`))

  const notLive: FoundryMissionState[] = ['COMPLETE', 'FAILED', 'CANCELLED']
  const blockedIdle = installedMission('pass012-blocked-idle', occupantInstall, 'BLOCKED')
  blockedIdle.plan = blockedIdle.plan.map(step => ({ ...step, status: 'done' }))
  const blockedPending = installedMission('pass012-blocked-pending', occupantInstall, 'BLOCKED')
  results.push(check('live_production_state_definition', notLive.every(state => isLiveProductionMission({ ...completedOwner, status: state, archived: false, resumeEligible: true }) === false) && isLiveProductionMission(liveOwner) === true && isLiveProductionMission(pending) === false && isLiveProductionMission(blockedIdle) === false && isLiveProductionMission(blockedPending) === true && !LIVE_PRODUCTION_STATES.has('ACTIVATION_PENDING'), [...LIVE_PRODUCTION_STATES].join(',')))

  const cookieSrc = readFileSync(path.join(ROOT, 'lib/native-builder/foundryBrowserService.ts'), 'utf8')
  results.push(check('browser_local_session_url_only', /url: origin/.test(cookieSrc) && !/domain:/.test(cookieSrc) && /Playwright rejects domain cookies for IP hosts/.test(cookieSrc), 'url-only cookie'))

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
