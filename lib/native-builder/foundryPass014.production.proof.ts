/**
 * PASS 014 live production: mission write-set + rebuild from canonical Terra source.
 * Does not restore historical installs. Does not activate foundry-544de899.
 */
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { startMission, runModelMission } from './foundryMissionController'
import { loadMission, saveMission } from './foundryMissionStore'
import { executeEngineerTool } from './engineerTools'
import { readProductionLease, releaseProductionLease } from './foundryProductionLease'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { releaseMissionResources } from './foundryResourceLocks'
import { rememberEngineeringFact, rememberFeatureOwnership } from './foundryEngineeringMemory'
import { readProductionOwner } from './foundryProductionOwnership'
import { runProductionLeaseWatchdog } from './foundryProductionLeaseWatchdog'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { CURRENT_AUTHORIZED_PRODUCTION_INSTALL_ID } from './foundryActivationScriptInventory'
import { REFUSED_OUTSIDE_WRITE_SET, REFUSED_PROTECTED_SUBSYSTEM } from './foundryMissionWriteSet'

const REQUEST = 'PASS 014 production write-set. In Advanced Foundry Operations show the last production watchdog scan result. Keep LAST PRODUCTION GENERATION. Do not change the homepage. Do not touch Terra. Stay inside Foundry Operations write set. Validate, build, package, install and activate this mission production build from current canonical source. Do not retry Cursor. Do not commit.'

const TERRA = 'components/war-room/foundry/FoundryTerraBackground.tsx'

type Identity = {
  activeInstallId?: string | null
  runningInstallId?: string | null
  identityMatch?: boolean | null
}

async function identity(repairId: string): Promise<Identity> {
  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, { repairId })
  return (verify.result ?? {}) as Identity
}

function shaRel(rel: string, text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function run() {
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'LOCAL',
  })
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  const terraBefore = shaRel(TERRA, await readFile(path.join(resolveRepoRoot(), TERRA), 'utf8'))
  const before = await identity('pass014-identity')
  const ownerBefore = await readProductionOwner()
  await runProductionLeaseWatchdog().catch(() => undefined)
  const mission = await startMission(REQUEST, 'PASS 014 Production Write Set', {
    productionOwner: true,
    productionRole: 'PRODUCTION_OWNER',
  })
  const runLocal = await runModelMission(mission.missionId)
  const loaded = await loadMission(runLocal.missionId) ?? runLocal
  const after = await identity(loaded.missionId)
  const terraAfter = shaRel(TERRA, await readFile(path.join(resolveRepoRoot(), TERRA), 'utf8'))
  const refused = loaded.toolCalls.filter(call =>
    !call.ok && /REFUSED_PROTECTED_SUBSYSTEM|REFUSED_OUTSIDE_WRITE_SET|TERRA_LOCKED/.test(`${call.error ?? ''} ${call.excerpt ?? ''}`),
  )
  const writes = loaded.sourceState.changedFiles
  const terraWrite = writes.some(file => /FoundryTerraBackground|\/terra\/|cesium|gibs/i.test(file))
  if (loaded.status === 'COMPLETE') {
    await releaseProductionLease(loaded.missionId).catch(() => undefined)
    await rememberFeatureOwnership({
      feature: 'Foundry mission write-set',
      owners: [
        'lib/native-builder/foundryMissionWriteSet.ts',
        'components/war-room/foundry/FoundryOperationsPanel.tsx',
        'lib/native-builder/foundryProductionLeaseWatchdog.ts',
      ],
      tests: [
        'lib/native-builder/foundryPass014.writeSet.validation.ts',
        'lib/native-builder/foundryProductionLeaseWatchdog.validation.ts',
      ],
      sourceMission: loaded.missionId,
      confidence: 'CONFIRMED',
      uiControl: 'Advanced Operations LAST WATCHDOG SCAN',
    }).catch(() => undefined)
    await rememberEngineeringFact({
      topic: 'foundry-mission-write-set',
      summary: 'Foundry engineering missions establish ALLOWED_WRITE_SET from owners/tests before mutation. code.impact dependents are READ_SCOPE only and do not authorize writes. Terra is a protected subsystem for non-Terra missions (REFUSED_PROTECTED_SUBSYSTEM). Write-set expansion requires reason and ownership evidence; Terra expansion is not authorized in PASS 014. Source/runtime parity requires rebuilding from current canonical Terra source rather than reusing foundry-544de899.',
      files: [
        'lib/native-builder/foundryMissionWriteSet.ts',
        'lib/native-builder/foundryEngineeringContract.ts',
        'lib/native-builder/engineerTools.ts',
        'lib/native-builder/foundryOperationsManager.ts',
        'components/war-room/foundry/FoundryOperationsPanel.tsx',
        'components/war-room/foundry/FoundryTerraBackground.tsx',
      ],
      sourceMission: loaded.missionId,
      confidence: 'CONFIRMED',
    }).catch(() => undefined)
    loaded.testArtifact = true
    loaded.visibility = 'system'
    loaded.resumeEligible = false
    loaded.archived = true
    await saveMission(loaded)
    await archiveConfirmedSystemTestMission(loaded)
    await releaseMissionResources(loaded.missionId).catch(() => undefined)
  } else {
    await saveMission(loaded)
  }
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })
  const pass = loaded.status === 'COMPLETE'
    && terraBefore === terraAfter
    && !terraWrite
    && after.identityMatch === true
    && loaded.installState.installId
    && loaded.installState.installId !== 'war-room-os-0.1.0-75f49a0-foundry-544de899'
    && after.activeInstallId === loaded.installState.installId
    && after.runningInstallId === loaded.installState.installId
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
    CURRENT_AUTHORIZED: CURRENT_AUTHORIZED_PRODUCTION_INSTALL_ID,
    lease: await readProductionLease(),
    ownerGenerationBefore: ownerBefore?.productionGeneration ?? null,
    ownerGenerationAfter: (await readProductionOwner())?.productionGeneration ?? null,
    model: loaded.modelState?.activeModel,
    writes,
    refused: refused.map(call => ({ tool: call.tool, error: call.error })),
    writeSet: loaded.writeSet,
    terraBefore,
    terraAfter,
    SOURCE_RUNTIME_TERRA_PARITY: terraBefore === terraAfter && !terraWrite,
    REFUSED_PROTECTED_SUBSYSTEM,
    REFUSED_OUTSIDE_WRITE_SET,
    missing: loaded.completionGate.missing,
    pass,
  }, null, 2))
  if (!pass) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
