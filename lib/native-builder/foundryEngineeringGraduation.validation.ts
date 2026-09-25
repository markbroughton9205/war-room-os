/**
 * Source + disposable proofs for the Foundry engineering graduation harness.
 * Does not package, install, commit, push, deploy, or modify Harbor/Lane & Box/Inventory/Terra/WRIM/HVS/Workbench.
 * No OS daemon.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FoundryEngineeringGraduationHarness, selectGraduationBenchmarkIds } from './foundryEngineeringGraduationHarness'
import { graduationBenchmarks, seedFixture, referenceSolution } from './foundryEngineeringGraduationFixtures'
import { independentlyVerify } from './foundryEngineeringGraduationVerifiers'
import {
  aggregateGovernance,
  buildEngineeringCapabilitiesView,
  countFalseProductionProven,
  countFalseReliable,
  deriveGraduationLevel,
  listCertifications,
  listGraduationRuns,
  persistCertification,
  writeGraduationReport,
} from './foundryEngineeringGraduationStore'
import { atlasStatusForGraduationEvent, mapGraduationLevelToAtlas } from './foundryEngineeringGraduationAtlas'
import { FOUNDRY_ENGINEERING_PROJECT_CLASSES, FOUNDRY_FAST_GRADUATION_BENCHMARK_IDS, FOUNDRY_GRADUATION_LEVEL_DEFINITIONS, FOUNDRY_GRADUATION_SUPPORTED_LANGUAGES } from './foundryEngineeringGraduationTypes'
import { resetFoundryRuntimeClock } from './foundryRuntimeClock'
import { resetFoundryRuntimeTestHooks, setFoundryRuntimeTiming } from './foundryMissionRuntime'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const repo = resolveRepoRoot()
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-grad-c-'))
  const projectsRoot = mkdtempSync(path.join(tmpdir(), 'wr-grad-p-'))
  const ccRoot = mkdtempSync(path.join(tmpdir(), 'wr-grad-cc-'))
  const previous = {
    contracts: process.env.FOUNDRY_CONTRACTS_ROOT,
    projects: process.env.FOUNDRY_PROJECTS_ROOT,
    cc: process.env.FOUNDRY_COMMAND_CENTER_ROOT,
    full: process.env.FOUNDRY_GRADUATION_FULL,
    select: process.env.FOUNDRY_GRADUATION_BENCHMARKS,
  }
  const runFull = process.env.FOUNDRY_GRADUATION_FULL === '1'
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  process.env.FOUNDRY_PROJECTS_ROOT = projectsRoot
  process.env.FOUNDRY_COMMAND_CENTER_ROOT = ccRoot
  delete process.env.FOUNDRY_GRADUATION_FULL
  delete process.env.FOUNDRY_GRADUATION_BENCHMARKS
  resetFoundryRuntimeClock()
  resetFoundryRuntimeTestHooks()
  setFoundryRuntimeTiming({ heartbeatMs: 1, leaseTtlMs: 50 })

  try {
    results.push(check('repo_workspace', /war-room-os$/.test(repo), repo))
    const types = source('lib/native-builder/foundryEngineeringGraduationTypes.ts')
    const harnessSrc = source('lib/native-builder/foundryEngineeringGraduationHarness.ts')
    const storeSrc = source('lib/native-builder/foundryEngineeringGraduationStore.ts')
    const fixturesSrc = source('lib/native-builder/foundryEngineeringGraduationFixtures.ts')
    const verifiersSrc = source('lib/native-builder/foundryEngineeringGraduationVerifiers.ts')
    const atlasSrc = source('lib/native-builder/foundryEngineeringGraduationAtlas.ts')
    const ui = source('components/war-room/foundry/FoundryEngineeringCapabilitiesPanel.tsx')
    const ccUi = source('components/war-room/foundry/FoundryAgentCommandCenter.tsx')

    results.push(check(
      'GRADUATION_HARNESS',
      /class FoundryEngineeringGraduationHarness/.test(harnessSrc) && /No OS daemon/.test(harnessSrc),
      'typed harness present',
    ))
    results.push(check(
      'PROJECT_CLASS_MODEL',
      FOUNDRY_ENGINEERING_PROJECT_CLASSES.length >= 14 && /STATIC_WEB/.test(types) && /LEGACY_CODE_MODIFICATION/.test(types),
      FOUNDRY_ENGINEERING_PROJECT_CLASSES.join(','),
    ))
    results.push(check(
      'CERTIFICATION_MODEL',
      /FoundryEngineeringCertification/.test(types) && /distinctFixturePassCount/.test(storeSrc) && Boolean(FOUNDRY_GRADUATION_LEVEL_DEFINITIONS.RELIABLE),
      'certification + explicit levels',
    ))
    results.push(check(
      'INDEPENDENT_VERIFICATION',
      /independentlyVerify/.test(verifiersSrc) && /Do not trust model self-report/.test(verifiersSrc),
      'independent verifier',
    ))
    results.push(check(
      'ANTI_CHEATING',
      /function antiCheat/.test(verifiersSrc) && /hiddenOraclePath/.test(verifiersSrc) && /FOUNDRY_CONTRACTS_ROOT/.test(verifiersSrc),
      'hidden oracles outside project',
    ))
    results.push(check(
      'language_baseline',
      FOUNDRY_GRADUATION_SUPPORTED_LANGUAGES.join(',') === 'typescript,javascript' && !/python|rust|golang/i.test(types),
      'TS/JS only',
    ))
    results.push(check(
      'catalog_A_to_T',
      graduationBenchmarks().length === 20 && graduationBenchmarks().every(item => item.acceptanceCriteria.some(row => row.required)),
      String(graduationBenchmarks().length),
    ))
    results.push(check(
      'fast_ids',
      selectGraduationBenchmarkIds().join(',') === FOUNDRY_FAST_GRADUATION_BENCHMARK_IDS.join(','),
      selectGraduationBenchmarkIds().join(','),
    ))
    results.push(check(
      'no_daemon',
      /No OS daemon/.test(harnessSrc) && !/\bcron\b|\bsystemd\b/.test(harnessSrc),
      'no cron/systemd',
    ))
    results.push(check(
      'no_hvu',
      !/\bHVU\b/.test(harnessSrc) && !/\bHVU\b/.test(types),
      'HVU absent',
    ))
    results.push(check(
      'commander_ui',
      /Engineering Capabilities/.test(ui) && /FoundryEngineeringCapabilitiesPanel/.test(ccUi) && !/intelligence score/i.test(ui),
      'capabilities panel',
    ))
    results.push(check(
      'atlas_ladder',
      mapGraduationLevelToAtlas('PASSED_FIXTURE').atlasStatus === 'EVALUATED'
        && mapGraduationLevelToAtlas('RELIABLE').atlasStatus === 'PROVEN'
        && mapGraduationLevelToAtlas('PRODUCTION_PROVEN').productionProven
        && atlasStatusForGraduationEvent('discovered') === 'DISCOVERED'
        && atlasStatusForGraduationEvent('source_known') === 'SOURCE_BACKED'
        && atlasStatusForGraduationEvent('can_learn') === 'LEARNABLE'
        && atlasStatusForGraduationEvent('runtime_available') === 'AVAILABLE'
        && atlasStatusForGraduationEvent('benchmark_pending') === 'EVALUATION_PENDING',
      'ladder mapping',
    ))
    results.push(check(
      'atlas_source',
      /acquire_practice_evaluate_continue/.test(atlasSrc) && /PRODUCTION_PROVEN/.test(atlasSrc),
      'atlas mapping source',
    ))
    results.push(check(
      'atlas_not_prohibition',
      mapGraduationLevelToAtlas('UNTESTED').commanderMayStillBuild === true
        && mapGraduationLevelToAtlas('UNTESTED').missingMeans === 'acquire_practice_evaluate_continue',
      'missing cert is not prohibition',
    ))
    results.push(check(
      'no_skip_to_production',
      deriveGraduationLevel({ attemptCount: 3, passCount: 3, distinctFixturePassCount: 3, partial: false, productionEvidenceRefs: [], criticalGovernanceFailures: 0 }) === 'RELIABLE'
        && deriveGraduationLevel({ attemptCount: 1, passCount: 1, distinctFixturePassCount: 1, partial: false, productionEvidenceRefs: [], criticalGovernanceFailures: 0 }) === 'PASSED_FIXTURE',
      'RELIABLE needs 3; fixtures never skip to PRODUCTION_PROVEN',
    ))

    const benchE = graduationBenchmarks().find(item => item.letter === 'E')!
    const incomplete = seedFixture(benchE, 'v1')
    const incompleteRoot = path.join(projectsRoot, 'incomplete-e')
    writeTree(incompleteRoot, incomplete.files)
    const failVerify = await independentlyVerify({
      benchmark: benchE,
      projectRoot: incompleteRoot,
      hidden: { runId: 'hidden-e', benchmarkId: benchE.benchmarkId, values: incomplete.hidden },
    })
    const failRequired = failVerify.criteria.filter(item => item.required && !item.passed)
    results.push(check('anti_false_pass_cli', failRequired.length > 0 && failRequired.some(item => item.criterionId === 'E3' || item.criterionId === 'E1'), failVerify.criteria.map(item => `${item.criterionId}:${item.passed}`).join(',')))

    const completeRoot = path.join(projectsRoot, 'complete-e')
    writeTree(completeRoot, { ...incomplete.files, ...referenceSolution(benchE, incomplete) })
    const passVerify = await independentlyVerify({
      benchmark: benchE,
      projectRoot: completeRoot,
      hidden: { runId: 'hidden-e2', benchmarkId: benchE.benchmarkId, values: incomplete.hidden },
    })
    results.push(check(
      'independent_pass_cli',
      passVerify.criteria.filter(item => item.required).every(item => item.passed),
      passVerify.criteria.map(item => `${item.criterionId}:${item.passed}`).join(','),
    ))
    results.push(check(
      'hidden_oracle_outside_project',
      !existsSync(path.join(completeRoot, '.foundry-expected.json')) && !existsSync(path.join(completeRoot, 'hidden-e2.json')),
      completeRoot,
    ))

    const harness = new FoundryEngineeringGraduationHarness({ suite: 'fast' })
    results.push(check(
      'FAST_GRADUATION_SUITE_select',
      harness.listBenchmarks().length === FOUNDRY_FAST_GRADUATION_BENCHMARK_IDS.length
        && FOUNDRY_FAST_GRADUATION_BENCHMARK_IDS.every(id => harness.listBenchmarks().some(item => item.benchmarkId === id)),
      harness.listBenchmarks().map(item => item.letter).join(','),
    ))

    const fast = await harness.runSuite()
    const fastByLetter = Object.fromEntries(fast.runs.map(item => [item.benchmarkId, item]))
    for (const id of FOUNDRY_FAST_GRADUATION_BENCHMARK_IDS) {
      const run = fastByLetter[id]
      results.push(check(`fast_${id}`, Boolean(run) && run.result === 'PASS', run ? `${run.result} ${run.passedRequiredCount}/${run.requiredCount} ${run.forbiddenShortcutHits.join('|')}` : 'missing'))
    }

    const incompleteRun = await new FoundryEngineeringGraduationHarness().runBenchmark('GRAD-E-CLI', { skipReference: true, variant: 'v2' })
    results.push(check(
      'incomplete_not_pass',
      incompleteRun.result !== 'PASS' && incompleteRun.governance.BENCHMARK_FALSE_PASS_COUNT === 0,
      `${incompleteRun.result} falsePass=${incompleteRun.governance.BENCHMARK_FALSE_PASS_COUNT}`,
    ))

    const truth = await new FoundryEngineeringGraduationHarness().runBenchmark('GRAD-T-TRUTH', { variant: 'v1' })
    results.push(check(
      'completion_truth',
      truth.result === 'PASS' && truth.governance.PROJECT_READY_WITH_FAILED_CRITERION_COUNT === 0 && truth.projectReady,
      `${truth.result} ready=${truth.projectReady} failedReady=${truth.governance.PROJECT_READY_WITH_FAILED_CRITERION_COUNT} ${truth.criteria.map(item => `${item.criterionId}:${item.passed}`).join(',')}`,
    ))

    const security = await new FoundryEngineeringGraduationHarness().runBenchmark('GRAD-S-SECURITY', { variant: 'v1' })
    results.push(check(
      'security_no_leak',
      security.result === 'PASS' && security.governance.BENCHMARK_SECRET_LEAK_COUNT === 0,
      `${security.result} leak=${security.governance.BENCHMARK_SECRET_LEAK_COUNT} ${security.criteria.map(item => `${item.criterionId}:${item.passed}`).join(',')}`,
    ))

    const runs = listGraduationRuns()
    const certs = listCertifications()
    const counts = aggregateGovernance(runs, certs)
    results.push(check('BENCHMARK_FALSE_PASS_COUNT', counts.BENCHMARK_FALSE_PASS_COUNT === 0, String(counts.BENCHMARK_FALSE_PASS_COUNT)))
    results.push(check('PROJECT_READY_WITH_FAILED_CRITERION_COUNT', counts.PROJECT_READY_WITH_FAILED_CRITERION_COUNT === 0, String(counts.PROJECT_READY_WITH_FAILED_CRITERION_COUNT)))
    results.push(check('BENCHMARK_SECRET_LEAK_COUNT', counts.BENCHMARK_SECRET_LEAK_COUNT === 0, String(counts.BENCHMARK_SECRET_LEAK_COUNT)))
    results.push(check('BENCHMARK_CONTRACT_BYPASS_COUNT', counts.BENCHMARK_CONTRACT_BYPASS_COUNT === 0, String(counts.BENCHMARK_CONTRACT_BYPASS_COUNT)))
    results.push(check('BENCHMARK_RESOURCE_BYPASS_COUNT', counts.BENCHMARK_RESOURCE_BYPASS_COUNT === 0, String(counts.BENCHMARK_RESOURCE_BYPASS_COUNT)))
    results.push(check('BENCHMARK_TOOL_BROKER_BYPASS_COUNT', counts.BENCHMARK_TOOL_BROKER_BYPASS_COUNT === 0, String(counts.BENCHMARK_TOOL_BROKER_BYPASS_COUNT)))
    results.push(check('BENCHMARK_AUTO_COMMIT_COUNT', counts.BENCHMARK_AUTO_COMMIT_COUNT === 0, String(counts.BENCHMARK_AUTO_COMMIT_COUNT)))
    results.push(check('BENCHMARK_AUTO_PUSH_COUNT', counts.BENCHMARK_AUTO_PUSH_COUNT === 0, String(counts.BENCHMARK_AUTO_PUSH_COUNT)))
    results.push(check('BENCHMARK_DEPLOY_COUNT', counts.BENCHMARK_DEPLOY_COUNT === 0, String(counts.BENCHMARK_DEPLOY_COUNT)))
    results.push(check('FALSE_RELIABLE_CERTIFICATION_COUNT', countFalseReliable(certs) === 0, certs.map(item => `${item.projectClass}:${item.status}:${item.distinctFixturePassCount}`).join(',')))
    results.push(check('FALSE_PRODUCTION_PROVEN_COUNT', countFalseProductionProven(certs) === 0 && !certs.some(item => item.status === 'PRODUCTION_PROVEN'), certs.map(item => item.status).join(',')))

    const view = buildEngineeringCapabilitiesView(certs)
    results.push(check(
      'capabilities_view',
      view.rows.length === FOUNDRY_ENGINEERING_PROJECT_CLASSES.length && view.rows.every(row => row.status !== 'PRODUCTION_PROVEN'),
      view.rows.filter(row => row.attemptCount > 0).map(row => `${row.label} ${row.status} ${row.passCount}/${row.attemptCount}`).join(' | '),
    ))
    results.push(check(
      'history_not_overwritten',
      runs.length >= fast.runs.length + 3,
      `runs=${runs.length}`,
    ))
    results.push(check(
      'fixture_isolation',
      fast.runs.every(item => item.projectRoot.startsWith(projectsRoot) && item.projectRoot.includes('/graduation/')),
      fast.runs[0]?.projectRoot ?? 'none',
    ))
    results.push(check(
      'protected_products_untouched',
      !existsSync(path.join(projectsRoot, 'Harbor Desk')) && !existsSync(path.join(projectsRoot, 'Lane & Box')),
      projectsRoot,
    ))
    results.push(check(
      'report_written',
      existsSync(fast.reportPath),
      fast.reportPath,
    ))

    const reportPath = writeGraduationReport({
      title: 'FOUNDRY_ENGINEERING_GRADUATION_REPORT',
      generatedAt: new Date().toISOString(),
      suite: 'fast',
      runs: runs.map(item => ({ benchmarkId: item.benchmarkId, result: item.result, criteria: item.criteria, providers: item.providers, resources: item.resourceUsage, evidence: item.evidenceRefs, status: item.result })),
      certifications: certs,
      governance: counts,
    }, 'FOUNDRY_ENGINEERING_GRADUATION_REPORT.json')
    results.push(check('machine_readable_report', existsSync(reportPath), reportPath))

    if (runFull) {
      const full = new FoundryEngineeringGraduationHarness({ suite: 'full' })
      const remaining = full.listBenchmarks().filter(item => !fast.runs.some(run => run.benchmarkId === item.benchmarkId) && item.letter !== 'T' && item.letter !== 'S')
      for (const bench of remaining) {
        const run = await full.runBenchmark(bench.benchmarkId, { applyReference: true, variant: 'v1' })
        results.push(check(`full_${bench.benchmarkId}`, run.result === 'PASS', `${run.result} ${run.passedRequiredCount}/${run.requiredCount} ${run.criteria.filter(item => !item.passed).map(item => item.criterionId).join(',')}`))
      }
    }

    const fakeReliable = persistCertification('DESKTOP_APP', 'javascript', [])
    results.push(check('untested_desktop', fakeReliable.status === 'UNTESTED', fakeReliable.status))

  } finally {
    if (previous.contracts === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = previous.contracts
    if (previous.projects === undefined) delete process.env.FOUNDRY_PROJECTS_ROOT
    else process.env.FOUNDRY_PROJECTS_ROOT = previous.projects
    if (previous.cc === undefined) delete process.env.FOUNDRY_COMMAND_CENTER_ROOT
    else process.env.FOUNDRY_COMMAND_CENTER_ROOT = previous.cc
    if (previous.full === undefined) delete process.env.FOUNDRY_GRADUATION_FULL
    else process.env.FOUNDRY_GRADUATION_FULL = previous.full
    if (previous.select === undefined) delete process.env.FOUNDRY_GRADUATION_BENCHMARKS
    else process.env.FOUNDRY_GRADUATION_BENCHMARKS = previous.select
    try { rmSync(contractsRoot, { recursive: true, force: true }) } catch { /* tmp */ }
    try { rmSync(projectsRoot, { recursive: true, force: true }) } catch { /* tmp */ }
    try { rmSync(ccRoot, { recursive: true, force: true }) } catch { /* tmp */ }
  }

  const failed = results.filter(item => !item.pass)
  const payload = {
    ok: failed.length === 0,
    passed: results.filter(item => item.pass).length,
    failed: failed.length,
    results,
  }
  console.log(JSON.stringify(payload, null, 2))
  if (failed.length) process.exit(1)
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(root, rel)
    mkdirSync(path.dirname(dest), { recursive: true })
    writeFileSync(dest, content, 'utf8')
  }
}

void run().catch(error => {
  console.error(error)
  process.exit(1)
})

void pathToFileURL
