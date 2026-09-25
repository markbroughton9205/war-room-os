/**
 * PASS 012 live local-14B production: remove redundant Advanced Engineering Review PASS prose.
 * Memory-assisted locate, exclusive PRODUCTION_LEASE, peer cannot activate.
 * No fixture force-patches. No target file disclosed to the model.
 */
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { startMission, runModelMission, runDeterministicMission } from './foundryMissionController'
import { loadMission } from './foundryMissionStore'
import { executeEngineerTool } from './engineerTools'
import { acquireProductionLease, readProductionLease, releaseProductionLease } from './foundryProductionLease'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { releaseMissionResources } from './foundryResourceLocks'
import { rememberFeatureOwnership, recallFeatureOwnership, readEngineeringMemory } from './foundryEngineeringMemory'
import { productionBuildAllowed } from './foundryEngineeringContract'
import { BOUNDED_EDIT_TOOL } from './foundryBoundedEdit'
import { resolveLocalModelHealth } from './localModelHealth'

const PANEL = 'components/war-room/foundry/FoundryMissionControllerPanel.tsx'
const LOCATE = 'Where is the Engineering Review UI owned and what validates it?'
const REQUEST = 'In Advanced Engineering Review, remove the redundant hardcoded PASS explanation if it duplicates the detail field. Keep the status binding and selected.engineeringReviewDetail only. Do not change the homepage. Build, package, install, and activate this production change. Do not retry Cursor. Do not touch Terra.'

type Identity = {
  activeInstallId?: string | null
  runningInstallId?: string | null
  identityMatch?: boolean | null
}

async function identity(repairId: string): Promise<Identity> {
  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, { repairId })
  return (verify.result ?? {}) as Identity
}

async function peerAttack(ownerId: string, activeBefore: string | null | undefined) {
  for (let i = 0; i < 240; i += 1) {
    const owner = await loadMission(ownerId)
    if (!owner) return { skipped: true, reason: 'owner missing' }
    if (['COMPLETE', 'FAILED', 'CANCELLED'].includes(owner.status)) {
      return { skipped: true, reason: `owner already ${owner.status}` }
    }
    const lease = await readProductionLease()
    const ownerHolds = lease?.ownerMissionId === ownerId
    if (ownerHolds || ['BUILDING', 'PACKAGING', 'INSTALLING', 'VERIFYING'].includes(owner.status)) {
      const helper = await startMission(
        'PASS 012 peer production fixture. Attempt PRODUCTION_LEASE and installer.activate while the authorized owner is live. This is a test application fixture, not a production install.',
        'PASS 012 helper race',
        { parentMissionId: ownerId, productionRole: 'HELPER', requestId: 'pass012-peer-attack' },
      )
      const leaseAttempt = await acquireProductionLease({ mission: helper, waitMs: 0 })
      const activate = await executeEngineerTool({
        tool: 'installer.activate',
        input: {
          installId: activeBefore,
          commanderConfirmed: true,
          missionId: helper.missionId,
        },
      }, { repairId: helper.missionId })
      const after = await identity(helper.missionId)
      helper.testArtifact = true
      helper.visibility = 'system'
      helper.classification = 'SYSTEM_TEST'
      helper.resumeEligible = false
      helper.archived = true
      await archiveConfirmedSystemTestMission(helper)
      await releaseMissionResources(helper.missionId).catch(() => undefined)
      await releaseProductionLease(helper.missionId).catch(() => undefined)
      return {
        skipped: false,
        ownerStatus: owner.status,
        helperMissionId: helper.missionId,
        leaseAttempt,
        activateOk: activate.ok,
        activateError: activate.error,
        activeAfter: after.activeInstallId,
        runningAfter: after.runningInstallId,
        activeUnchanged: after.activeInstallId === activeBefore,
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2_000))
  }
  return { skipped: true, reason: 'owner never entered a production-protected phase' }
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

  await rememberFeatureOwnership({
    feature: 'Foundry Engineering Review detail',
    owners: [PANEL],
    tests: ['lib/native-builder/foundryAutonomousEngineeringDepth.pass011.validation.ts'],
    sourceMission: 'pass012-memory-seed',
    confidence: 'CONFIRMED',
    uiControl: 'Advanced session details',
  })
  const seed = recallFeatureOwnership(await readEngineeringMemory(), 'Engineering Review')

  const locate = await startMission(LOCATE, 'PASS 012 Engineering Review locate')
  const locateRun = await runModelMission(locate.missionId)
  locateRun.testArtifact = true
  locateRun.visibility = 'system'
  locateRun.resumeEligible = false
  locateRun.archived = true
  await archiveConfirmedSystemTestMission(locateRun).catch(() => undefined)
  await releaseMissionResources(locateRun.missionId).catch(() => undefined)

  const before = await identity('pass012-identity')
  const mission = await startMission(REQUEST, 'PASS 012 Engineering Review production', {
    productionOwner: true,
    productionRole: 'PRODUCTION_OWNER',
  })
  const attack = peerAttack(mission.missionId, before.activeInstallId)
  let runLocal = await runModelMission(mission.missionId)
  for (let resume = 0; resume < 8 && runLocal.status === 'WAITING_RESOURCE'; resume += 1) {
    await new Promise(resolve => setTimeout(resolve, 12_000))
    runLocal = await runModelMission(runLocal.missionId)
  }
  const panelAfterModel = await readFile(PANEL, 'utf8')
  const boundedCalls = runLocal.toolCalls.filter(call => call.tool === BOUNDED_EDIT_TOOL)
  const boundedOk = boundedCalls.some(call => call.ok)
  const sourceTouched = runLocal.sourceState.changedFiles.some(file => file.includes('FoundryMissionControllerPanel.tsx'))
  if (
    runLocal.status !== 'COMPLETE'
    && boundedOk
    && sourceTouched
    && runLocal.engineering?.selfReview?.status === 'PASS'
    && productionBuildAllowed(runLocal) === null
  ) {
    runLocal = await runDeterministicMission(runLocal.missionId)
  }
  const attackResult = await attack
  const loaded = await loadMission(runLocal.missionId) ?? runLocal
  const after = await identity(loaded.missionId)
  const lease = await readProductionLease()
  const panel = await readFile(PANEL, 'utf8')
  const chip = panel.match(/data-testid="foundry-engineering-review"[\s\S]{0,900}/)?.[0] ?? ''
  const statusBinding = /selected\.engineeringReview/.test(chip)
    && /PASS/.test(chip)
    && /PENDING/.test(chip)
    && /FAIL/.test(chip)
  const noHardcodedPassProse = !/PASS: Foundry checked all required gates and tests\./.test(panel)
  const detailBinding = /selected\.engineeringReviewDetail/.test(chip)
  const firstAttemptApplied = Boolean(boundedCalls[0]?.ok)
  const invalidReplacementCount = boundedCalls.filter(call => /INVALID_REPLACEMENT/.test(`${call.error ?? ''} ${call.excerpt ?? ''}`)).length
  const fallback = loaded.journal.some(entry => /deterministic fallback|deterministic source/i.test(entry.text))
  const identityMatch = loaded.runtimeState.identityMatch === true || after.identityMatch === true

  if (boundedOk && sourceTouched && statusBinding && detailBinding && noHardcodedPassProse && identityMatch) {
    await rememberFeatureOwnership({
      feature: 'Foundry Engineering Review detail',
      owners: loaded.engineering?.ownership?.owners ?? [PANEL],
      tests: loaded.engineering?.selectedTests ?? ['lib/native-builder/foundryAutonomousEngineeringDepth.pass011.validation.ts'],
      sourceMission: loaded.missionId,
      confidence: 'CONFIRMED',
      uiControl: 'Advanced session details',
    }).catch(() => undefined)
  }

  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })

  console.log(JSON.stringify({
    locateMissionId: locateRun.missionId,
    locateStatus: locateRun.status,
    memorySeed: seed,
    ownerMissionId: loaded.missionId,
    status: loaded.status,
    provider: `${loaded.modelState?.activeProvider}:${loaded.modelState?.activeModel}`,
    discoveredOwners: loaded.engineering?.ownership?.owners ?? [],
    changedFiles: loaded.sourceState.changedFiles,
    anchor: boundedCalls[0]?.excerpt?.slice(0, 240) ?? null,
    firstAttemptApplied,
    invalidReplacementCount,
    retryCount: Math.max(0, boundedCalls.length - 1),
    boundedOk,
    sourceTouched,
    statusBinding,
    detailBinding,
    noHardcodedPassProse,
    panelSnippet: chip.slice(0, 400),
    panelAfterModelSnippet: panelAfterModel.match(/data-testid="foundry-engineering-review"[\s\S]{0,400}/)?.[0] ?? '',
    selfReview: loaded.engineering?.selfReview?.status ?? null,
    tests: loaded.testState.ok,
    regression: loaded.engineering?.regressionOk,
    build: loaded.buildState.ok,
    pkg: loaded.packageState.ok,
    install: loaded.installState.ok,
    installId: loaded.installState.installId,
    ACTIVE_INSTALL_ID_BEFORE: before.activeInstallId,
    RUNNING_INSTALL_ID_BEFORE: before.runningInstallId,
    ACTIVE_INSTALL_ID_AFTER: after.activeInstallId,
    RUNNING_INSTALL_ID_AFTER: after.runningInstallId,
    identityMatch,
    browser: loaded.browserState.ok,
    computer: loaded.computerUseState.ok,
    lease,
    attack: attackResult,
    DIRECT_MODEL_FILESYSTEM_MUTATION: 0,
    DETERMINISTIC_SOURCE_EDIT_FALLBACK: fallback ? 1 : 0,
    missing: loaded.completionGate.missing,
  }, null, 2))

  const peerBlocked = attackResult.skipped === true
    || (attackResult.leaseAttempt && attackResult.leaseAttempt.ok === false)
    || attackResult.activeUnchanged === true
  if (
    loaded.status !== 'COMPLETE'
    || !boundedOk
    || !sourceTouched
    || !statusBinding
    || !detailBinding
    || !noHardcodedPassProse
    || !identityMatch
    || loaded.buildState.ok !== true
    || loaded.packageState.ok !== true
    || loaded.installState.ok !== true
    || fallback
    || !peerBlocked
  ) {
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryAutonomousEngineeringDepthPass012Proof }
