import { spawnSync } from 'node:child_process'

/**
 * Mission-runtime validation runner — executes every lib/mission-runtime/*.validation.ts suite
 * sequentially in this repo's standard ts-extension-loader mode (same convention as
 * scripts/run-native-builder-validation.mjs). Any suite failing fails the whole run.
 */
const SUITES = [
  'lib/mission-runtime/missionRuntime.validation.ts',
  'lib/mission-runtime/engineeringAudit.validation.ts',
  'lib/mission-runtime/engineeringHardening.validation.ts',
  'lib/mission-runtime/engineeringIteration.validation.ts',
  'lib/mission-runtime/engineeringProviderExperience.validation.ts',
  'lib/mission-runtime/engineeringStream.validation.ts',
]

let failed = false
for (const suite of SUITES) {
  console.log(`\n=== ${suite} ===`)
  const result = spawnSync(process.execPath, [
    '--loader',
    './scripts/ts-extension-loader.mjs',
    '--experimental-transform-types',
    suite,
  ], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) {
    console.error(result.error)
    failed = true
    continue
  }
  if (result.status !== 0) failed = true
}

if (failed) {
  console.error('\nMission-runtime validation: FAILED')
  process.exit(1)
}
console.log('\nMission-runtime validation: all suites PASS')
