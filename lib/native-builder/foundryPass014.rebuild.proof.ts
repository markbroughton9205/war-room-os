/**
 * PASS 014 canonical rebuild: production lease then build/package/install/activate.
 * Does not reuse foundry-544de899. Does not reactivate historical installs.
 */
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { startMission } from './foundryMissionController'
import { loadMission, saveMission, transitionMission } from './foundryMissionStore'
import { claimToolResources } from './foundryOperationsManager'
import { executeEngineerTool, type EngineerToolName } from './engineerTools'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { releaseMissionResources } from './foundryResourceLocks'
import { releaseProductionLease } from './foundryProductionLease'
import { rememberEngineeringFact, rememberFeatureOwnership } from './foundryEngineeringMemory'
import { readProductionOwner } from './foundryProductionOwnership'
import { runProductionLeaseWatchdog } from './foundryProductionLeaseWatchdog'

const TERRA = 'components/war-room/foundry/FoundryTerraBackground.tsx'
const PANEL = 'components/war-room/foundry/FoundryOperationsPanel.tsx'

async function leaseTool(
  missionId: string,
  tool: EngineerToolName,
  input: Record<string, unknown>,
) {
  const mission = await loadMission(missionId)
  if (!mission) throw new Error(`missing mission ${missionId}`)
  const claimed = await claimToolResources(mission, tool, input, 180_000)
  if (!claimed.ok) return { ok: false, error: claimed.error, result: null as unknown }
  try {
    const result = await executeEngineerTool({ tool, input }, { repairId: mission.missionId, mission })
    return result
  } finally {
    for (const release of claimed.releases) await release()
    await saveMission(mission)
  }
}

async function run() {
  const terraBefore = createHash('sha256').update(await readFile(path.join(resolveRepoRoot(), TERRA))).digest('hex')
  const panel = await readFile(path.join(resolveRepoRoot(), PANEL), 'utf8')
  if (!panel.includes('foundry-last-watchdog-scan') || !panel.includes('LAST WATCHDOG SCAN')) {
    throw new Error('Advanced LAST WATCHDOG SCAN is missing from canonical source.')
  }
  const ownerBefore = await readProductionOwner()
  const mission = await startMission(
    'PASS 014 rebuild from current canonical source. Show last production watchdog scan in Advanced Operations. Do not touch Terra. Do not commit.',
    'PASS 014 Canonical Rebuild',
    { productionOwner: true, productionRole: 'PRODUCTION_OWNER' },
  )
  process.env.FOUNDRY_PRODUCTION_MISSION_ID = mission.missionId
  await transitionMission(mission, 'UNDERSTANDING', 'PASS 014 rebuild')
  await transitionMission(mission, 'INSPECTING', 'PASS 014 rebuild')
  await transitionMission(mission, 'PLANNING', 'PASS 014 rebuild')
  await transitionMission(mission, 'EXECUTING', 'PASS 014 rebuild')
  await transitionMission(mission, 'BUILDING', 'PASS 014 rebuild')
  await saveMission(mission)

  const built = await leaseTool(mission.missionId, 'build.run', {})
  console.log('BUILD', built.ok, built.error ?? '')
  if (!built.ok) process.exit(1)
  const loadedBuild = await loadMission(mission.missionId)
  if (loadedBuild) await transitionMission(loadedBuild, 'PACKAGING', 'build ok')

  const packed = await leaseTool(mission.missionId, 'package.run', {})
  console.log('PACKAGE', packed.ok, packed.error ?? JSON.stringify({ appimage: (packed.result as { appimage?: { path?: string } })?.appimage?.path }))
  if (!packed.ok) process.exit(1)
  const pack = packed.result as {
    appimage: { path: string; sha256: string }
    deb: { path: string; sha256: string }
    linuxUnpackedDir: string
  }
  const loadedPkg = await loadMission(mission.missionId)
  if (loadedPkg) await transitionMission(loadedPkg, 'INSTALLING', 'package ok')

  const installed = await leaseTool(mission.missionId, 'installer.install_production', {
    appimage: pack.appimage,
    deb: pack.deb,
    linuxUnpackedDir: pack.linuxUnpackedDir,
    feature: 'foundry-pass014-write-set',
    commanderConfirmed: true,
  })
  console.log('INSTALL', installed.ok, installed.error ?? JSON.stringify(installed.result))
  if (!installed.ok) process.exit(1)
  const installId = (installed.result as { stamp?: { install_id?: string } } | undefined)?.stamp?.install_id
  if (!installId || /544de899/.test(installId)) {
    console.error('REFUSED reuse of foundry-544de899 or missing install id', installId)
    process.exit(1)
  }
  const loadedInst = await loadMission(mission.missionId)
  if (loadedInst) {
    loadedInst.installState.ok = true
    loadedInst.installState.installId = installId
    await saveMission(loadedInst)
  }

  const activated = await leaseTool(mission.missionId, 'installer.activate', {
    installId,
    commanderConfirmed: true,
  })
  console.log('ACTIVATE', activated.ok, activated.error ?? JSON.stringify(activated.result))
  if (!activated.ok) process.exit(1)

  const transition = await leaseTool(mission.missionId, 'runtime.transition_to_active', {
    commanderConfirmed: true,
  })
  console.log('TRANSITION', transition.ok, transition.error ?? JSON.stringify(transition.result))
  if (!transition.ok) process.exit(1)

  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, { repairId: mission.missionId })
  const identity = (verify.result ?? {}) as {
    activeInstallId?: string | null
    runningInstallId?: string | null
    identityMatch?: boolean | null
  }
  const terraAfter = createHash('sha256').update(await readFile(path.join(resolveRepoRoot(), TERRA))).digest('hex')
  const identityMatch = identity.identityMatch === true
    && identity.activeInstallId === installId
    && identity.runningInstallId === installId

  const origin = 'http://127.0.0.1:3848'
  const loadedUi = await loadMission(mission.missionId)
  const session = loadedUi
    ? await executeEngineerTool({ tool: 'browser.local_session', input: { origin } }, { repairId: mission.missionId, mission: loadedUi })
    : { ok: false, error: 'missing mission' }
  const nav = await executeEngineerTool({ tool: 'browser.navigate', input: { url: `${origin}/` } }, { repairId: mission.missionId, mission: loadedUi })
  const text = await executeEngineerTool({ tool: 'browser.get_text', input: {} }, { repairId: mission.missionId, mission: loadedUi })
  const consoleLog = await executeEngineerTool({ tool: 'browser.console', input: {} }, { repairId: mission.missionId, mission: loadedUi })
  const pageText = JSON.stringify(text.result ?? '')
  const browserOk = session.ok && nav.ok
    && /LAST WATCHDOG SCAN|LAST PRODUCTION GENERATION|Foundry Operations/i.test(pageText)

  const computer = await executeEngineerTool(
    { tool: 'computer.observe', input: { text: 'Advanced', name: 'Advanced' } },
    { repairId: mission.missionId, mission: loadedUi },
  )

  await rememberFeatureOwnership({
    feature: 'Foundry mission write-set',
    owners: [
      'lib/native-builder/foundryMissionWriteSet.ts',
      'components/war-room/foundry/FoundryOperationsPanel.tsx',
      'lib/native-builder/foundryProductionLeaseWatchdog.ts',
    ],
    tests: ['lib/native-builder/foundryPass014.writeSet.validation.ts'],
    sourceMission: mission.missionId,
    confidence: 'CONFIRMED',
    uiControl: 'Advanced Operations LAST WATCHDOG SCAN',
  }).catch(() => undefined)
  await rememberEngineeringFact({
    topic: 'foundry-mission-write-set',
    summary: 'ALLOWED_WRITE_SET is derived from owners/tests before mutation. Impact dependents are READ_SCOPE only. Terra is REFUSED_PROTECTED_SUBSYSTEM for non-Terra missions. foundry-544de899 packaged drifted Terra and must not be reused. Rebuild from current canonical Terra source for SOURCE_RUNTIME_TERRA_PARITY.',
    files: [
      'lib/native-builder/foundryMissionWriteSet.ts',
      'components/war-room/foundry/FoundryOperationsPanel.tsx',
      'components/war-room/foundry/FoundryTerraBackground.tsx',
    ],
    sourceMission: mission.missionId,
    confidence: 'CONFIRMED',
  }).catch(() => undefined)

  await runProductionLeaseWatchdog().catch(() => undefined)
  await releaseProductionLease(mission.missionId).catch(() => undefined)
  const final = await loadMission(mission.missionId)
  if (final) {
    final.testArtifact = true
    final.visibility = 'system'
    final.archived = true
    final.resumeEligible = false
    final.classification = 'SYSTEM_TEST'
    await saveMission(final)
    await archiveConfirmedSystemTestMission(final)
    await releaseMissionResources(final.missionId).catch(() => undefined)
  }

  const pass = identityMatch && terraBefore === terraAfter && !/544de899/.test(installId)
  console.log(JSON.stringify({
    pass,
    missionId: mission.missionId,
    MISSION_INSTALL_ID: installId,
    ACTIVE_INSTALL_ID: identity.activeInstallId,
    RUNNING_INSTALL_ID: identity.runningInstallId,
    identityMatch,
    terraBefore,
    terraAfter,
    SOURCE_RUNTIME_TERRA_PARITY: terraBefore === terraAfter,
    ownerGenerationBefore: ownerBefore?.productionGeneration ?? null,
    ownerGenerationAfter: (await readProductionOwner())?.productionGeneration ?? null,
    browser: { session: session.ok, nav: nav.ok, ok: browserOk, error: session.error ?? nav.error },
    computer: { ok: computer.ok, error: computer.error },
    console: consoleLog.ok,
    panelHasWatchdog: panel.includes('LAST WATCHDOG SCAN'),
  }, null, 2))
  if (!pass) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
