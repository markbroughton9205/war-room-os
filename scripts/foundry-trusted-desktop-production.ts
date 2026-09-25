/**
 * CURRENT_PRODUCTION_SAFE — productionActivationFromEnv fail-closes without
 * FOUNDRY_PRODUCTION_MISSION_ID.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { buildRun } from '@/lib/native-builder/qualityTools'
import { packageRun } from '@/lib/native-builder/packageTool'
import { installerActivate, installerInstallProduction } from '@/lib/native-builder/installerTool'
import { runtimeTransitionToActive, runtimeVerify } from '@/lib/native-builder/runtimeControl'
import { productionActivationFromEnv } from '@/lib/native-builder/foundryProductionOwnership'
import { resolveRepoRoot } from '@/lib/repo/paths'

const repairId = `foundry-trusted-desktop-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').toLowerCase()}`
const feature = `foundry-trusted-local-auto-entry-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').toLowerCase()}`
const skipBuild = process.argv.includes('--skip-build')
  && existsSync(path.join(resolveRepoRoot(), '.next', 'BUILD_ID'))
  && existsSync(path.join(resolveRepoRoot(), '.next', 'standalone'))

function die(stage: string, error: unknown): never {
  console.error(`FAIL ${stage}`, error)
  process.exit(1)
}

console.log(`MISSION ${repairId} skipBuild=${skipBuild}`)

if (!skipBuild) {
  console.log('STAGE build.run')
  const built = await buildRun({ repairId, lockWaitMs: 300_000 })
  if (!built.ok) die('build.run', { error: built.stderr || built.stdout, lockState: built.lockState })
  console.log(JSON.stringify({ ok: built.ok, artifacts: built.artifacts, durationMs: built.durationMs }))
} else {
  console.log('STAGE build.run SKIP existing standalone artifacts')
}

console.log('STAGE package.run')
const packed = await packageRun({ repairId })
if (!packed.ok) die('package.run', packed)
console.log(JSON.stringify({
  ok: packed.ok,
  version: packed.ok ? packed.version : null,
  gitShort: packed.ok ? packed.gitShort : null,
  appimage: packed.ok ? packed.appimage.path : null,
  deb: packed.ok ? packed.deb.path : null,
  linuxUnpackedDir: packed.ok ? packed.linuxUnpackedDir : null,
  durationMs: packed.ok ? packed.durationMs : null,
}))

if (!packed.ok) die('package.run', packed)

console.log('STAGE installer.install_production')
const installed = await installerInstallProduction({
  appimage: packed.appimage,
  deb: packed.deb,
  linuxUnpackedDir: packed.linuxUnpackedDir,
  feature,
  commanderConfirmed: true,
})
if (!installed.ok) die('installer.install_production', installed)
console.log(JSON.stringify({
  ok: installed.ok,
  installId: installed.ok ? installed.stamp.install_id : null,
  installDir: installed.ok ? installed.installDir : null,
}))

if (!installed.ok) die('installer.install_production', installed)
const missionInstallId = installed.stamp.install_id

console.log('STAGE installer.activate')
let auth
try {
  auth = productionActivationFromEnv(missionInstallId)
} catch (error) {
  die('production-activation-authority', error)
}
const activated = await installerActivate(auth)
if (!activated.ok) die('installer.activate', activated)
console.log(JSON.stringify(activated))

console.log('STAGE runtime.transition_to_active')
const transition = await runtimeTransitionToActive({
  commanderConfirmed: true,
  graceMs: 20_000,
  bootTimeoutMs: 120_000,
  missionId: auth.missionId,
  commanderExplicitRollback: auth.commanderExplicitRollback === true,
  activationMode: auth.activationMode,
})
if (!transition.ok) die('runtime.transition_to_active', transition)
console.log(JSON.stringify({
  ok: transition.ok,
  steps: transition.steps,
  active: transition.finalVerify?.activeInstallId,
  running: transition.finalVerify?.runningInstallId,
  identityMatch: transition.finalVerify?.identityMatch,
}))

const verify = await runtimeVerify()
const identityMatch =
  verify.identityMatch === true
  && verify.activeInstallId === missionInstallId
  && verify.runningInstallId === missionInstallId

console.log('STAGE identity')
console.log(JSON.stringify({
  MISSION_INSTALL_ID: missionInstallId,
  ACTIVE_INSTALL_ID: verify.activeInstallId,
  RUNNING_INSTALL_ID: verify.runningInstallId,
  identityMatch,
  health: verify.health,
  corePort: verify.corePort,
  ownership: verify.ownership,
}, null, 2))

if (!identityMatch) process.exit(1)
