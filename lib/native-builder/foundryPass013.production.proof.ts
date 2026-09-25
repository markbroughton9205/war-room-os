/**
 * PASS 013 live production: Advanced-only last production generation under exclusive lease.
 * Does not restore PASS 009/010/011/012 historical installs. Does not activate foundry-5d4b64e1.
 */
import { pathToFileURL } from 'node:url'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { startMission, runModelMission } from './foundryMissionController'
import { loadMission, saveMission } from './foundryMissionStore'
import { executeEngineerTool } from './engineerTools'
import { readProductionLease, releaseProductionLease, type FoundryProductionLease } from './foundryProductionLease'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { releaseMissionResources } from './foundryResourceLocks'
import { rememberEngineeringFact, rememberFeatureOwnership } from './foundryEngineeringMemory'
import { readProductionOwner } from './foundryProductionOwnership'
import { LEASE_RECOVERY_RELEASED, runProductionLeaseWatchdog } from './foundryProductionLeaseWatchdog'
import { CURRENT_AUTHORIZED_PRODUCTION_INSTALL_ID } from './foundryActivationScriptInventory'

const REQUEST = 'PASS 013 production lease watchdog. In Advanced Foundry Operations keep LAST PRODUCTION GENERATION showing the completed production-owner generation even when no live lease is held. Do not change the homepage. Validate, build, package, install and activate this mission production build. Do not retry Cursor. Do not touch Terra. Do not commit.'

type Identity = {
  activeInstallId?: string | null
  runningInstallId?: string | null
  identityMatch?: boolean | null
}

async function identity(repairId: string): Promise<Identity> {
  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, { repairId })
  return (verify.result ?? {}) as Identity
}

async function run() {
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'LOCAL',
  })
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  const before = await identity('pass013-identity')
  const ownerBefore = await readProductionOwner()
  const mission = await startMission(REQUEST, 'PASS 013 Production Lease Watchdog', {
    productionOwner: true,
    productionRole: 'PRODUCTION_OWNER',
  })
  const runLocal = await runModelMission(mission.missionId)
  const loaded = await loadMission(runLocal.missionId) ?? runLocal
  const after = await identity(loaded.missionId)
  if (loaded.status === 'COMPLETE') {
    await releaseProductionLease(loaded.missionId).catch(() => undefined)
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'wr-pass013-stale-lease-'))
    const leaseFile = path.join(fixtureRoot, 'production-lease.json')
    const ownerFile = path.join(fixtureRoot, 'production-owner.json')
    const ownerNow = await readProductionOwner()
    if (ownerNow) await writeFile(ownerFile, JSON.stringify(ownerNow, null, 2), 'utf8')
    const stale: FoundryProductionLease = {
      ownerMissionId: loaded.missionId,
      ownerClass: 'COMMANDER_REAL',
      productionGeneration: ownerNow?.productionGeneration ?? 10,
      missionId: loaded.missionId,
      generation: ownerNow?.productionGeneration ?? 10,
      targetInstallId: loaded.installState.installId ?? CURRENT_AUTHORIZED_PRODUCTION_INSTALL_ID,
      installTarget: loaded.installState.installId ?? CURRENT_AUTHORIZED_PRODUCTION_INSTALL_ID,
      acquiredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      leaseUpdatedAt: new Date().toISOString(),
      phase: 'COMPLETE',
      mode: 'MISSION',
      pid: 999999002,
    }
    await writeFile(leaseFile, JSON.stringify(stale, null, 2), 'utf8')
    const watchdog = await runProductionLeaseWatchdog({
      pathOverride: leaseFile,
      ownerPathOverride: ownerFile,
      skipLiveMachine: true,
      missionOverride: { ...loaded, status: 'COMPLETE' },
      processAliveOverride: false,
      productionProcessesOverride: false,
      runtimeIdentityOverride: {
        activeInstallId: after.activeInstallId ?? CURRENT_AUTHORIZED_PRODUCTION_INSTALL_ID,
        runningInstallId: after.runningInstallId ?? CURRENT_AUTHORIZED_PRODUCTION_INSTALL_ID,
      },
    })
    const ownerAfterWatchdog = JSON.parse(await readFile(ownerFile, 'utf8')) as { productionGeneration: number; installId: string }
    if (watchdog.code !== LEASE_RECOVERY_RELEASED || ownerAfterWatchdog.productionGeneration !== (ownerNow?.productionGeneration ?? ownerAfterWatchdog.productionGeneration)) {
      console.error('FAIL watchdog fixture', JSON.stringify({ watchdog, ownerAfterWatchdog }))
      process.exit(1)
    }
    await rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined)

    await rememberFeatureOwnership({
      feature: 'Foundry last production generation',
      owners: [
        'components/war-room/foundry/FoundryOperationsPanel.tsx',
        'lib/native-builder/foundryProductionLeaseWatchdog.ts',
        'lib/native-builder/foundryProductionOwnership.ts',
      ],
      tests: [
        'lib/native-builder/foundryProductionLeaseWatchdog.validation.ts',
        'lib/native-builder/foundryProductionOwnership.validation.ts',
      ],
      sourceMission: loaded.missionId,
      confidence: 'CONFIRMED',
      uiControl: 'Advanced Operations LAST PRODUCTION GENERATION',
    }).catch(() => undefined)
    await rememberEngineeringFact({
      topic: 'foundry-production-lease-watchdog',
      summary: 'Production-lease watchdog on operations recovery reclaims a stale PRODUCTION_LEASE only for terminal owners with a dead pid and no production-critical child. Live or ambiguous owners are deferred. Orphan leases are not blindly released. Heartbeat age is evidence only. Reclaim never increments production generation and never changes ACTIVE_INSTALL_ID, RUNNING_INSTALL_ID, or production-owner.json. Historical proof installs cannot activate except COMMANDER_EXPLICIT_ROLLBACK + exact id + maintenance lease. RELAUNCH_CURRENT is restricted to the current authorized install.',
      files: [
        'lib/native-builder/foundryProductionLeaseWatchdog.ts',
        'lib/native-builder/foundryOperationsManager.ts',
        'lib/native-builder/foundryProductionOwnership.ts',
        'lib/native-builder/foundryActivationScriptInventory.ts',
        'scripts/foundry-relaunch-active.ts',
        'components/war-room/foundry/FoundryOperationsPanel.tsx',
      ],
      sourceMission: loaded.missionId,
      confidence: 'CONFIRMED',
    }).catch(() => undefined)
  } else {
    await saveMission(loaded)
  }
  if (loaded.status === 'COMPLETE') {
    loaded.testArtifact = true
    loaded.visibility = 'system'
    loaded.resumeEligible = false
    loaded.archived = true
    await saveMission(loaded)
    await archiveConfirmedSystemTestMission(loaded)
    await releaseMissionResources(loaded.missionId).catch(() => undefined)
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
    lease: await readProductionLease(),
    ownerGenerationBefore: ownerBefore?.productionGeneration ?? null,
    ownerGenerationAfter: (await readProductionOwner())?.productionGeneration ?? null,
    model: loaded.modelState?.activeModel,
    writes: loaded.sourceState.changedFiles,
    missing: loaded.completionGate.missing,
  }, null, 2))
  if (loaded.status !== 'COMPLETE') process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
