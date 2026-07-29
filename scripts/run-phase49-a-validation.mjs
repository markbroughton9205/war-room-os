import { spawnSync } from 'node:child_process'

// Phase 49-A aggregate runner. Both suites below are plain Node scripts (not exported
// functions), so each runs as its own subprocess rather than being imported — this avoids
// modifying scripts/run-live-council-ui-fix-validation.mjs's existing shape. Neither suite
// calls a live provider, touches Supabase, or makes a network request; both are pure
// readFileSync + string/slice assertions against real source. No file or runtime state is
// mutated by either suite.
//
// scripts/run-live-council-ui-fix-validation.mjs is disclosed here honestly: it is a *shared*
// file. 15 of its cases (the `operationalWiringCases` block) are Phase 49-A owned. The other
// 26 (`structuralCases` + `behavioralCases`) are pre-existing, already-committed Live Council
// transcript / expanded-intel-workspace regression coverage — unrelated to this phase, but run
// here in full because the file is not split, and a regression in either half should still be
// visible. See docs/architecture/PHASE_49_A_RUNTIME_TRUTHFULNESS_UI_SWEEP.md section 19.
const suites = [
  [
    'Live Council UI fix (shared file: 15 Phase 49-A operational-wiring cases + 26 pre-existing, unrelated Live Council transcript/workspace cases)',
    'scripts/run-live-council-ui-fix-validation.mjs',
  ],
  [
    'Phase 49-A truth tests (new, this phase)',
    'scripts/run-phase49-a-truth-tests.mjs',
  ],
]

let anyFailed = false

for (const [name, script] of suites) {
  console.log(`\n== ${name} ==`)
  const result = spawnSync(process.execPath, [
    '--loader',
    './scripts/ts-extension-loader.mjs',
    '--experimental-transform-types',
    script,
  ], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) {
    console.error(result.error)
    anyFailed = true
    continue
  }
  if ((result.status ?? 1) !== 0) anyFailed = true
}

console.log(`\nPhase 49-A validation: ${anyFailed ? 'FAIL' : 'PASS'} across ${suites.length} suites`)
if (anyFailed) process.exit(1)
