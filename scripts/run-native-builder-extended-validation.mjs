import { spawnSync } from 'node:child_process'

/**
 * Extended native-builder validation runner — the feature-area suites beyond the core
 * nativeBuilder.validation.ts regression suite (which scripts/run-native-builder-validation.mjs
 * runs): context expansion, council assist, hosted coder proposal, system health & intelligence,
 * and the Code Operator gap-closure suite (delete_file, output redaction, live output buffer,
 * cancellation/process-tree kill, commit preparation). Any suite failing fails the whole run.
 */
const SUITES = [
  'lib/native-builder/contextExpansion.validation.ts',
  'lib/native-builder/councilAssist.validation.ts',
  'lib/native-builder/hostedCoderProposal.validation.ts',
  'lib/native-builder/systemHealthAndIntelligence.validation.ts',
  'lib/native-builder/codeOperatorGaps.validation.ts',
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
  console.error('\nExtended native-builder validation: FAILED')
  process.exit(1)
}
console.log('\nExtended native-builder validation: all suites PASS')
