/**
 * PASS 012 live production: Advanced-only production-owner diagnostic under exclusive lease.
 * Does not restore PASS 009/010/011 installs. Does not activate foundry-5d4b64e1.
 */
import { pathToFileURL } from 'node:url'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { startMission, runModelMission } from './foundryMissionController'
import { loadMission } from './foundryMissionStore'
import { executeEngineerTool } from './engineerTools'
import { acquireProductionLease, readProductionLease, releaseProductionLease } from './foundryProductionLease'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { releaseMissionResources } from './foundryResourceLocks'
import { rememberEngineeringFact, rememberFeatureOwnership } from './foundryEngineeringMemory'

const REQUEST = 'PASS 012 production exclusivity. In Advanced Foundry Operations keep the Production owner CURRENT / WAITING / NONE diagnostic. Do not change the homepage. Validate, build, package, install and activate this mission production build. Do not retry Cursor. Do not touch Terra. Do not commit.'

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
  for (let i = 0; i < 90; i += 1) {
    const owner = await loadMission(ownerId)
    if (!owner) return { skipped: true, reason: 'owner missing' }
    if (['COMPLETE', 'FAILED', 'CANCELLED'].includes(owner.status)) {
      return { skipped: true, reason: `owner already ${owner.status}` }
    }
    if (owner.status === 'BUILDING' || owner.status === 'PACKAGING' || owner.status === 'INSTALLING') {
      const helper = await startMission(
        'PASS 012 peer/helper production attack fixture. Attempt installer.activate while the authorized owner holds PRODUCTION_LEASE. This is a test application fixture, not a production install.',
        'PASS 012 helper race',
        { parentMissionId: ownerId, productionRole: 'HELPER', requestId: 'pass012-peer-attack' },
      )
      helper.helperMissionId = helper.missionId
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
      }
    }
    await new Promise(resolve => setTimeout(resolve, 4_000))
  }
  return { skipped: true, reason: 'owner never entered BUILDING/PACKAGING/INSTALLING' }
}

async function run() {
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'LOCAL',
  })
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  const before = await identity('pass012-identity')
  const mission = await startMission(REQUEST, 'PASS 012 Production Exclusivity', {
    productionOwner: true,
    productionRole: 'PRODUCTION_OWNER',
  })
  const attack = peerAttack(mission.missionId, before.activeInstallId)
  const runLocal = await runModelMission(mission.missionId)
  const attackResult = await attack
  const loaded = await loadMission(runLocal.missionId) ?? runLocal
  const after = await identity(loaded.missionId)
  const lease = await readProductionLease()
  if (loaded.status === 'COMPLETE') {
    await rememberFeatureOwnership({
      feature: 'Foundry production owner diagnostic',
      owners: ['components/war-room/foundry/FoundryOperationsPanel.tsx', 'lib/native-builder/foundryProductionLease.ts'],
      tests: ['lib/native-builder/foundryProductionOwnership.validation.ts', 'lib/native-builder/foundryAutonomousEngineeringDepth.pass012.validation.ts'],
      sourceMission: loaded.missionId,
      confidence: 'CONFIRMED',
      uiControl: 'Advanced Operations PRODUCTION OWNER CURRENT/WAITING/NONE',
    }).catch(() => undefined)
    await rememberEngineeringFact({
      topic: 'foundry-production-lease',
      summary: 'Exactly one live PRODUCTION_LEASE owner. Helpers never inherit production authority from parentMissionId or requestId. Generation advances only on an authorized production transition with a valid live lease, authorized owner, target install ownership, and production phase. Lock order: PRODUCTION_LEASE → BUILD_PIPELINE → PACKAGE_PIPELINE → INSTALL_PIPELINE → ACTIVE_RUNTIME. Stale PASS 009 queued fixtures are cancelled, visibility=system, testArtifact=true, archived=true, resumeEligible=false; journals/audit preserved.',
      files: [
        'lib/native-builder/foundryProductionLease.ts',
        'lib/native-builder/foundryProductionOwnership.ts',
        'lib/native-builder/foundryOperationsTypes.ts',
        'lib/native-builder/foundryMissionVisibility.ts',
        'components/war-room/foundry/FoundryOperationsPanel.tsx',
      ],
      sourceMission: loaded.missionId,
      confidence: 'CONFIRMED',
    }).catch(() => undefined)
  }
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })
  console.log(JSON.stringify({
    ownerMissionId: loaded.missionId,
    status: loaded.status,
    installId: loaded.installState.installId,
    build: loaded.buildState.ok,
    pkg: loaded.packageState.ok,
    install: loaded.installState.ok,
    browser: loaded.browserState.ok,
    computer: loaded.computerUseState.ok,
    ACTIVE_INSTALL_ID_BEFORE: before.activeInstallId,
    RUNNING_INSTALL_ID_BEFORE: before.runningInstallId,
    ACTIVE_INSTALL_ID_AFTER: after.activeInstallId,
    RUNNING_INSTALL_ID_AFTER: after.runningInstallId,
    identityMatch: after.identityMatch,
    lease,
    attack: attackResult,
    model: loaded.modelState?.activeModel,
    writes: loaded.sourceState.changedFiles,
    missing: loaded.completionGate.missing,
  }, null, 2))
  if (loaded.status !== 'COMPLETE') process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
