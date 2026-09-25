/**
 * build.run / test.run / lint.run / typecheck.run validation.
 *
 * typecheck.run and test.run(fast suite) actually execute for real here — this repo's own
 * convention (see nativeBuilder.validation.ts's validation_exec_01) already runs real tsc inside
 * a validation suite, so this is consistent, not novel. build.run's real execution (next build,
 * several minutes) and package.run are deliberately NOT run here — they are proven for real once,
 * by the PASS 002 end-to-end acceptance proof, so this suite stays fast.
 */
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { lintRun, listTestSuites, testRun, typecheckRun } from './qualityTools'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function typecheckTests(): Promise<CaseResult[]> {
  const repairId = randomUUID()
  const result = await typecheckRun({ repairId, scopeGlob: 'lib/native-builder/' })
  return [
    check('typecheck_01_runs_for_real', typeof result.exitCode === 'number', JSON.stringify({ exitCode: result.exitCode, totalErrorCount: result.totalErrorCount })),
    check('typecheck_02_reports_total_and_scoped_counts', typeof result.totalErrorCount === 'number' && typeof result.scopedErrorCount === 'number', JSON.stringify({ total: result.totalErrorCount, scoped: result.scopedErrorCount })),
    check('typecheck_03_foundry_scope_itself_is_clean', result.scopedErrorCount === 0, JSON.stringify(result.scopedErrors)),
  ]
}

async function lintTests(): Promise<CaseResult[]> {
  const repairId = randomUUID()
  const clean = await lintRun({ repairId, targets: ['lib/native-builder/qualityTools.ts'] })
  const denied = await lintRun({ repairId, targets: ['../../../etc/passwd'] })
  return [
    check('lint_01_scoped_target_runs_for_real', typeof clean.exitCode === 'number', JSON.stringify({ exitCode: clean.exitCode, stderr: clean.stderr.slice(0, 200) })),
    check('lint_02_this_file_itself_is_clean', clean.ok, JSON.stringify(clean)),
    check('lint_03_path_escape_rejected', !denied.ok, JSON.stringify(denied)),
  ]
}

async function testRunPolicyTests(): Promise<CaseResult[]> {
  const repairId = randomUUID()
  const nonValidatePrefix = await testRun({ repairId, suite: 'build' })
  const liveExcluded = await testRun({ repairId, suite: 'validate:terra-cameras:live' })
  const unknown = await testRun({ repairId, suite: 'validate:definitely-not-a-real-script' })
  const suites = await listTestSuites()
  return [
    check('policy_01_non_validate_prefix_rejected', !nonValidatePrefix.ok, JSON.stringify(nonValidatePrefix)),
    check('policy_02_live_suffix_excluded', !liveExcluded.ok, JSON.stringify(liveExcluded)),
    check('policy_03_unknown_script_rejected', !unknown.ok, JSON.stringify(unknown)),
    check('policy_04_list_suites_never_includes_live', suites.every(s => !s.endsWith(':live')), String(suites.length)),
    check('policy_05_list_suites_includes_a_foundry_suite', suites.includes('validate:foundry-terminal-session'), JSON.stringify(suites.slice(0, 5))),
  ]
}

async function testRunRealExecutionTests(): Promise<CaseResult[]> {
  const repairId = randomUUID()
  // A genuinely fast existing suite (~1s) — real execution proof without a multi-minute suite.
  const result = await testRun({ repairId, suite: 'validate:foundry-terminal-session' })
  return [check('real_01_fast_suite_executes_and_passes', result.ok, JSON.stringify({ exitCode: result.exitCode, suite: result.suite, tail: result.stdout.slice(-200) }))]
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  add(await typecheckTests())
  add(await lintTests())
  add(await testRunPolicyTests())
  add(await testRunRealExecutionTests())
  const failed = results.filter(r => !r.pass)
  console.log(`qualityTools validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runQualityToolsValidation }
