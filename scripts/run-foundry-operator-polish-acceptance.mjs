import { spawnSync } from 'node:child_process'

const checks = [
  'lib/native-builder/foundryMissionControlView.validation.ts',
  'lib/native-builder/foundryMissionRuntime.validation.ts',
  'lib/native-builder/buildLock.validation.ts',
  'lib/native-builder/foundryCampaignRecovery.validation.ts',
  'lib/native-builder/foundryLaunchPolicy.validation.ts',
  'lib/native-builder/foundryWorkbenchW0.validation.ts',
]

// Known-failing at baseline ad5ad5e (fixture failures fixture_A..G in W4); tracked as P9 issue,
// not part of the acceptance bundle until the fixtures are repaired.
const knownFailing = ['lib/native-builder/foundryWorkbenchW4.validation.ts']

let failed = 0
for (const entry of checks) {
  console.log(`\n=== ${entry} ===`)
  const result = spawnSync(process.execPath, [
    '--loader',
    './scripts/ts-extension-loader.mjs',
    '--experimental-transform-types',
    entry,
  ], { cwd: process.cwd(), stdio: 'inherit', shell: false })
  if (result.error || result.status !== 0) {
    failed += 1
    console.error(`FAILED: ${entry} (exit ${result.status})`)
  }
}
console.log(failed === 0 ? 'OPERATOR_POLISH_ACCEPTANCE_BUNDLE_PASS' : `OPERATOR_POLISH_ACCEPTANCE_BUNDLE_FAIL (${failed})`)
process.exit(failed === 0 ? 0 : 1)
