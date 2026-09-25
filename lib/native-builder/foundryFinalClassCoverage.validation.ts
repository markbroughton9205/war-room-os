/**
 * Source + live model-route proofs for Mission 13 final class coverage.
 * Fast: FEATURE_EXTENSION_V2, STATIC_WEB_V1.
 * Full: V2 + V3 + STATIC_WEB_V1, then prior GRAD-I-FEATURE-D3 for FEATURE_EXTENSION reliability composition.
 * Does not rerun the Mission 12 13-target suite.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  FoundryModelGraduationHarness,
  probeModelGraduationProviders,
  normalizeModelGraduationBenchmarkId,
} from './foundryModelGraduation'
import { getGraduationBenchmark, graduationBenchmarks } from './foundryEngineeringGraduationFixtures'
import { fixtureIdentityFor, modelDrivenMultiFixtureBenchmarks } from './foundryModelGraduationFixtures'
import { modelDrivenD3Benchmarks } from './foundryModelGraduationD3Fixtures'
import { hardEngineeringBenchmarks } from './foundryHardEngineeringFixtures'
import { finalClassCoverageBenchmarks } from './foundryFinalClassCoverageFixtures'
import {
  buildEngineeringCapabilitiesView,
  countDuplicateFixtureDistinct,
  countFalseProductionProven,
  countFalseReliable,
  countReferenceUsedForModelReliability,
  listCertifications,
  listGraduationAttempts,
  listGraduationRuns,
  writeGraduationReport,
} from './foundryEngineeringGraduationStore'
import { mapGraduationLevelToAtlas } from './foundryEngineeringGraduationAtlas'
import {
  EMPTY_MODEL_DRIVEN_GOVERNANCE,
  FOUNDRY_ENGINEERING_PROJECT_CLASSES,
  FOUNDRY_FINAL_CLASS_COVERAGE_FAST_IDS,
  FOUNDRY_FINAL_CLASS_COVERAGE_FULL_IDS,
  FOUNDRY_FINAL_CLASS_FEATURE_PRIOR_IDS,
  type FoundryGraduationRun,
  type FoundryModelDrivenGovernanceCounts,
} from './foundryEngineeringGraduationTypes'
import { applyFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { resetFoundryRuntimeClock } from './foundryRuntimeClock'
import { resetFoundryRuntimeTestHooks, setFoundryRuntimeTiming } from './foundryMissionRuntime'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

function sumCounts(runs: Array<{ modelDrivenGovernance?: FoundryModelDrivenGovernanceCounts }>): FoundryModelDrivenGovernanceCounts {
  const counts = { ...EMPTY_MODEL_DRIVEN_GOVERNANCE }
  for (const run of runs) {
    const row = run.modelDrivenGovernance
    if (!row) continue
    for (const key of Object.keys(counts) as (keyof FoundryModelDrivenGovernanceCounts)[]) {
      counts[key] += row[key] ?? 0
    }
  }
  return counts
}

function envSelected(): boolean {
  return Boolean(process.env.FOUNDRY_GRADUATION_BENCHMARKS?.trim() || process.env.FOUNDRY_MODEL_GRADUATION_BENCHMARKS?.trim())
}

function selectedIds(): string[] {
  const env = process.env.FOUNDRY_GRADUATION_BENCHMARKS?.trim() || process.env.FOUNDRY_MODEL_GRADUATION_BENCHMARKS?.trim()
  if (env) return env.split(',').map(item => normalizeModelGraduationBenchmarkId(item)).filter(Boolean)
  if (process.env.FOUNDRY_FINAL_CLASS_COVERAGE_FULL === '1') return [...FOUNDRY_FINAL_CLASS_COVERAGE_FULL_IDS]
  return [...FOUNDRY_FINAL_CLASS_COVERAGE_FAST_IDS]
}

function runGate(run: FoundryGraduationRun | undefined, label: string): CaseResult[] {
  return [
    check(
      label,
      Boolean(run) && run!.result === 'PASS' && run!.engineeringMode === 'model-driven',
      run ? `${run.result} ${run.passedRequiredCount}/${run.requiredCount} providers=${run.providers.join(',')} models=${run.models.join(',')} ${run.failureClass ?? ''} ${run.criteria.filter(item => !item.passed).map(item => item.criterionId).join(',')} ${run.notes.filter(note => note.startsWith('actionTrace=') || note.startsWith('firstRoute=') || note.startsWith('patches=') || note.startsWith('resourceBudget=')).join(' | ')}` : 'missing',
    ),
    check(
      `${run?.benchmarkId ?? label}_REAL_MODEL_ROUTE`,
      Boolean(run?.providers.length) && !run!.providers.includes('none') && !run!.models.includes('harness-reference') && (run?.modelRouteCalls ?? []).some(item => item.ok),
      run ? `${run.providers.join(',')} ${run.models.join(',')} calls=${run.modelRouteCalls?.length ?? 0}` : 'missing',
    ),
  ]
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const repo = resolveRepoRoot()
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-m13-c-'))
  const projectsRoot = mkdtempSync(path.join(tmpdir(), 'wr-m13-p-'))
  const ccRoot = mkdtempSync(path.join(tmpdir(), 'wr-m13-cc-'))
  const previous = {
    contracts: process.env.FOUNDRY_CONTRACTS_ROOT,
    projects: process.env.FOUNDRY_PROJECTS_ROOT,
    cc: process.env.FOUNDRY_COMMAND_CENTER_ROOT,
    select: process.env.FOUNDRY_GRADUATION_BENCHMARKS,
    modelSelect: process.env.FOUNDRY_MODEL_GRADUATION_BENCHMARKS,
  }
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  process.env.FOUNDRY_PROJECTS_ROOT = projectsRoot
  process.env.FOUNDRY_COMMAND_CENTER_ROOT = ccRoot
  resetFoundryRuntimeClock()
  resetFoundryRuntimeTestHooks()
  setFoundryRuntimeTiming({ heartbeatMs: 1, leaseTtlMs: 50 })

  const full = process.env.FOUNDRY_FINAL_CLASS_COVERAGE_FULL === '1'
  const destDir = path.join(resolveRepoRoot(), 'tmp/foundry-final-class-coverage')
  mkdirSync(destDir, { recursive: true })

  try {
    results.push(check('repo_workspace', /war-room-os$/.test(repo), repo))
    const driver = source('lib/native-builder/foundryModelGraduation.ts')
    const finalSrc = source('lib/native-builder/foundryFinalClassCoverageFixtures.ts')
    const finalVer = source('lib/native-builder/foundryFinalClassCoverageVerifiers.ts')
    const types = source('lib/native-builder/foundryEngineeringGraduationTypes.ts')
    const storeSrc = source('lib/native-builder/foundryEngineeringGraduationStore.ts')
    const ui = source('components/war-room/foundry/FoundryEngineeringCapabilitiesPanel.tsx')
    const pkg = source('package.json')
    const fixturesCore = source('lib/native-builder/foundryEngineeringGraduationFixtures.ts')
    const verifiers = source('lib/native-builder/foundryEngineeringGraduationVerifiers.ts')
    const hardSrc = source('lib/native-builder/foundryHardEngineeringFixtures.ts')

    results.push(check('MISSION_08_CATALOG_PRESERVED', graduationBenchmarks().length === 20, String(graduationBenchmarks().length)))
    results.push(check('MISSION_10_CATALOG_PRESERVED', modelDrivenMultiFixtureBenchmarks().length === 7, String(modelDrivenMultiFixtureBenchmarks().length)))
    results.push(check('MISSION_11_CATALOG_PRESERVED', modelDrivenD3Benchmarks().length === 8, String(modelDrivenD3Benchmarks().length)))
    results.push(check('MISSION_12_HARD_CATALOG_PRESERVED', hardEngineeringBenchmarks().length === 13, String(hardEngineeringBenchmarks().length)))
    results.push(check('FINAL_CLASS_CATALOG', finalClassCoverageBenchmarks().length === 3, String(finalClassCoverageBenchmarks().length)))
    results.push(check('NO_REFERENCE_APPLY', !/referenceSolution\(/.test(driver) && /referenceApply:disabled/.test(driver) && !/referenceSolution\(/.test(finalSrc), 'no reference apply'))
    results.push(check('CURSOR_CORE_DEPENDENCY', !/new CursorAgentProvider/.test(driver), 'Cursor optional'))
    results.push(check('TOOL_BROKER_ONLY', /unattendedToolBrokerWrite/.test(driver), 'Tool Broker'))
    results.push(check('D3_BUDGET', /FOUNDRY_MODEL_DRIVEN_D3_BUDGET/.test(types) && /budgetFor/.test(driver), 'bounded D3 budget'))
    results.push(check('RELIABLE_MODEL_ONLY', /modelDrivenDistinctFixturePassCount/.test(storeSrc) && /requirementsHash/.test(storeSrc), 'model-driven distinct'))
    results.push(check('UI_STATIC_WEB_SCOPE', /static browser site \/ no custom backend/.test(ui) && /SQLite via node:sqlite/.test(ui) && /Electron/.test(ui), 'capabilities UI'))
    results.push(check('FAST_SCRIPT', /validate:foundry-final-class-coverage"/.test(pkg) && /foundryFinalClassCoverage.validation.ts/.test(pkg), 'fast script'))
    results.push(check('FULL_SCRIPT', /validate:foundry-final-class-coverage:full/.test(pkg), 'full script'))
    results.push(check('MISSION_12_SCRIPT_PRESERVED', /validate:foundry-hard-engineering-expansion"/.test(pkg), 'mission 12 script'))
    results.push(check('MISSION_11_SCRIPT_PRESERVED', /validate:foundry-model-graduation-d3"/.test(pkg), 'mission 11 script'))
    results.push(check('NO_HVU', !/\bHVU\b/.test(driver) && !/\bHVU\b/.test(finalSrc), 'HVU absent'))
    results.push(check('FINAL_VERIFIER_WIRED', /verifyFinalClassCoverage/.test(verifiers) && /finalClassCoverageBenchmarks/.test(fixturesCore), 'wired'))
    results.push(check('ALIAS_FEATURE_V2', /FEATURE_EXTENSION_V2.*GRAD-FX-FEATURE-V2/.test(driver.replace(/\n/g, ' ')), 'alias remapped'))
    results.push(check('ALIAS_NOT_REPORT_CLI', !/FEATURE_EXTENSION_V2.*GRAD-I-FEATURE-V2/.test(driver.replace(/\n/g, ' ')), 'v2 is notes archive'))
    results.push(check('LEAKSCAN_PUBLIC_KEYS', /rel === token/.test(driver), 'mission 12 leakScan key inclusion preserved'))
    results.push(check(
      'ATLAS_NO_PRODUCTION',
      mapGraduationLevelToAtlas('RELIABLE').productionProven === false && mapGraduationLevelToAtlas('PASSED_FIXTURE').productionProven === false,
      'fixtures cannot assign PRODUCTION_PROVEN',
    ))
    results.push(check('PROTECTED_PRODUCTS', /GRADUATION_PROTECTED_TARGET/.test(driver), 'protected refuse'))
    results.push(check('NO_PROTECTED_PRODUCT_TOUCH', !/Harbor|Lane & Box|WRIM|HVS|\bTerra\b/.test(finalSrc) && !/Harbor|Lane & Box|WRIM|HVS|\bTerra\b/.test(finalVer), 'disposable fixtures'))
    results.push(check('STATIC_NOT_FRONTEND_CLONE', /atelier-static-site/.test(finalSrc) && /No custom backend/.test(finalSrc), 'static class'))
    results.push(check('FEATURE_V2_NOT_CLI', /notes-http-archive/.test(finalSrc) && /POST \/notes\/archive/.test(finalSrc), 'notes HTTP'))
    results.push(check('FEATURE_V3_NOT_CLONE', /tasks-http-priority/.test(finalSrc) && /minPriority/.test(finalSrc), 'tasks HTTP'))

    const prior = getGraduationBenchmark('GRAD-I-FEATURE-D3')
    const greeter = getGraduationBenchmark('GRAD-I-FEATURE')
    const reportCli = getGraduationBenchmark('GRAD-I-FEATURE-V2')
    const v2 = getGraduationBenchmark('GRAD-FX-FEATURE-V2')
    const v3 = getGraduationBenchmark('GRAD-FZ-FEATURE-V3')
    const sw = getGraduationBenchmark('GRAD-SW-STATIC-V1')
    const identityRows = [prior, v2, v3].filter(Boolean).map(item => fixtureIdentityFor(item!, { marker: item!.benchmarkId }, 'v1'))
    const req = new Set(identityRows.map(item => item.requirementsHash))
    const vars = new Set(identityRows.map(item => item.variationHash))
    const greeterHash = greeter ? fixtureIdentityFor(greeter, { marker: greeter.benchmarkId }, 'v1').requirementsHash : ''
    const reportHash = reportCli ? fixtureIdentityFor(reportCli, { marker: reportCli.benchmarkId }, 'v1').requirementsHash : ''
    const v2Hash = v2 ? fixtureIdentityFor(v2, { marker: v2.benchmarkId }, 'v1').requirementsHash : ''
    const v3Hash = v3 ? fixtureIdentityFor(v3, { marker: v3.benchmarkId }, 'v1').requirementsHash : ''
    const priorHash = prior ? fixtureIdentityFor(prior, { marker: prior.benchmarkId }, 'v1').requirementsHash : ''
    results.push(check('FEATURE_EXTENSION_FIXTURE_DISTINCT_HASHES', req.size === 3 && vars.size === 3, `req=${req.size} var=${vars.size}`))
    results.push(check(
      'FEATURE_EXTENSION_DUPLICATE_AS_DISTINCT_COUNT',
      req.size === 3 && v2Hash !== greeterHash && v2Hash !== reportHash && v3Hash !== greeterHash && v3Hash !== reportHash && v2Hash !== priorHash && v3Hash !== priorHash,
      `v2=${v2Hash.slice(0, 12)} v3=${v3Hash.slice(0, 12)} prior=${priorHash.slice(0, 12)}`,
    ))
    results.push(check('STATIC_WEB_LOOKUP', Boolean(sw) && sw!.projectClass === 'STATIC_WEB', sw?.benchmarkId ?? 'missing'))
    results.push(check('FEATURE_V2_LOOKUP', Boolean(v2) && v2!.startingFixture === 'notes-http-archive', v2?.startingFixture ?? 'missing'))
    results.push(check('FEATURE_V3_LOOKUP', Boolean(v3) && v3!.startingFixture === 'tasks-http-priority', v3?.startingFixture ?? 'missing'))
    results.push(check('PRIOR_FEATURE_LOOKUP', Boolean(prior) && prior!.startingFixture === 'inventory-cli-list-add', prior?.startingFixture ?? 'missing'))
    results.push(check('ALIAS_FEATURE_EXTENSION_V2', normalizeModelGraduationBenchmarkId('FEATURE_EXTENSION_V2') === 'GRAD-FX-FEATURE-V2', normalizeModelGraduationBenchmarkId('FEATURE_EXTENSION_V2')))
    results.push(check('ALIAS_FEATURE_EXTENSION_V3', normalizeModelGraduationBenchmarkId('FEATURE_EXTENSION_V3') === 'GRAD-FZ-FEATURE-V3', normalizeModelGraduationBenchmarkId('FEATURE_EXTENSION_V3')))
    results.push(check('ALIAS_STATIC_WEB_V1', normalizeModelGraduationBenchmarkId('STATIC_WEB_V1') === 'GRAD-SW-STATIC-V1', normalizeModelGraduationBenchmarkId('STATIC_WEB_V1')))
    results.push(check('ALIAS_PRIOR_FEATURE_EXTENSION', normalizeModelGraduationBenchmarkId('FEATURE_EXTENSION') === 'GRAD-I-FEATURE-D3', normalizeModelGraduationBenchmarkId('FEATURE_EXTENSION')))

    applyFoundryRuntimeConfig()
    const probe = await probeModelGraduationProviders()
    results.push(check('REAL_MODEL_ROUTE_AVAILABLE', probe.available, JSON.stringify(probe)))
    let policy = probe.models.find(item => item.provider === 'ollama')
      ? `ollama/${probe.models.find(item => item.provider === 'ollama')!.model}`
      : (probe.models[0] ? `${probe.models[0].provider}/${probe.models[0].model}` : 'none')

    if (!probe.available) {
      results.push(check('FINAL_CLASS_COVERAGE', false, probe.reason))
    } else {
      const ids = selectedIds()
      results.push(check('SINGLE_TARGET_NORMALIZED', ids.every(id => Boolean(getGraduationBenchmark(id))), ids.join(',')))
      const harness = new FoundryModelGraduationHarness({ benchmarkIds: ids })
      const suite = await harness.runSuite()
      const routed = suite.runs.find(runItem => runItem.providers[0] && runItem.providers[0] !== 'none')
      if (routed) policy = `${routed.providers[0]}/${routed.models[0]}`
      const byId = Object.fromEntries(suite.runs.map(runItem => [runItem.benchmarkId, runItem]))

      const requiredMap: Array<[string, string]> = [
        ['GRAD-FX-FEATURE-V2', 'MODEL_DRIVEN_FEATURE_EXTENSION_V2'],
        ['GRAD-FZ-FEATURE-V3', 'MODEL_DRIVEN_FEATURE_EXTENSION_V3'],
        ['GRAD-SW-STATIC-V1', 'MODEL_DRIVEN_STATIC_WEB_V1'],
      ]
      for (const [id, label] of requiredMap) {
        if (!ids.includes(id)) {
          if (full && !envSelected()) results.push(check(label, false, 'missing from full suite'))
          continue
        }
        const runItem = byId[id]
        results.push(...runGate(runItem, label))
        results.push(check(
          `${id}_ISOLATED`,
          Boolean(runItem?.projectRoot.startsWith(projectsRoot) && runItem.projectRoot.includes('/graduation/')),
          runItem?.projectRoot ?? 'none',
        ))
        results.push(check(`${id}_ATTEMPT_HISTORY`, listGraduationAttempts(id).length >= 1, String(listGraduationAttempts(id).length)))
        results.push(check(
          `${id}_PROJECT_READY`,
          runItem?.result === 'PASS' ? runItem.projectReady === true : runItem?.projectReady === false,
          `ready=${runItem?.projectReady} result=${runItem?.result}`,
        ))
        results.push(check(
          `${id}_IDENTITY`,
          Boolean(runItem?.fixtureIdentity?.requirementsHash && runItem.fixtureIdentity.hiddenOracleHash && runItem.fixtureIdentity.variationHash),
          runItem?.fixtureIdentity?.fixtureId ?? 'none',
        ))
      }

      if (full) {
        const requiredPass = FOUNDRY_FINAL_CLASS_COVERAGE_FULL_IDS.every(id => byId[id]?.result === 'PASS')
        if (requiredPass && process.env.FOUNDRY_FINAL_SKIP_FEATURE_PRIOR !== '1') {
          const priorHarness = new FoundryModelGraduationHarness({ benchmarkIds: [...FOUNDRY_FINAL_CLASS_FEATURE_PRIOR_IDS] })
          const priorSuite = await priorHarness.runSuite()
          suite.runs.push(...priorSuite.runs)
          for (const runItem of priorSuite.runs) byId[runItem.benchmarkId] = runItem
          results.push(check(
            'FEATURE_EXTENSION_PRIOR_COMPOSITION',
            priorSuite.runs.every(runItem => runItem.result === 'PASS'),
            priorSuite.runs.map(runItem => `${runItem.benchmarkId}:${runItem.result}`).join(','),
          ))
        } else {
          results.push(check('FEATURE_EXTENSION_PRIOR_COMPOSITION', requiredPass, requiredPass ? 'skipped' : 'required targets not all PASS'))
        }
      }

      const allRuns = listGraduationRuns()
      const counts = sumCounts(allRuns)
      counts.DUPLICATE_FIXTURE_COUNTED_AS_DISTINCT = countDuplicateFixtureDistinct(allRuns)
      const certs = listCertifications()
      counts.REFERENCE_PASS_COUNT_USED_FOR_MODEL_RELIABILITY = countReferenceUsedForModelReliability(certs)

      const requiredZero: Array<keyof FoundryModelDrivenGovernanceCounts> = [
        'REFERENCE_SOLUTION_APPLY_COUNT',
        'REFERENCE_IMPLEMENTATION_WRITE_COUNT',
        'REFERENCE_FALLBACK_AFTER_MODEL_FAILURE_COUNT',
        'HIDDEN_ORACLE_READ_BY_ENGINEER_COUNT',
        'BENCHMARK_SOLUTION_LEAK_COUNT',
        'MODEL_DIRECT_FILESYSTEM_WRITE_COUNT',
        'MODEL_ACTION_WITHOUT_DURABLE_ID_COUNT',
        'MODEL_GRADUATION_CONTINUE_PROMPT_COUNT',
        'MODEL_TEST_WEAKENING_COUNT',
        'BENCHMARK_CRITERIA_MUTATION_COUNT',
        'VERIFIER_MUTATION_COUNT',
        'MODEL_GRADUATION_SECRET_LEAK_COUNT',
        'FALSE_MODEL_DRIVEN_PASS_COUNT',
        'REFERENCE_PASS_COUNT_USED_FOR_MODEL_RELIABILITY',
        'DUPLICATE_FIXTURE_COUNTED_AS_DISTINCT',
        'REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT',
      ]
      for (const key of requiredZero) {
        results.push(check(key, counts[key] === 0, String(counts[key])))
      }

      results.push(check('PRODUCTION_PROVEN_CERTIFICATION_COUNT', certs.filter(item => item.status === 'PRODUCTION_PROVEN').length === 0 && countFalseProductionProven(certs) === 0, certs.map(item => `${item.projectClass}:${item.status}`).join(',')))
      results.push(check('FALSE_RELIABLE', countFalseReliable(certs) === 0, 'ok'))
      const view = buildEngineeringCapabilitiesView(certs)
      results.push(check('capabilities_rows', view.rows.length === FOUNDRY_ENGINEERING_PROJECT_CLASSES.length, String(view.rows.length)))
      results.push(check(
        'no_continue_spam',
        suite.runs.every(runItem => runItem.notes.some(note => note.includes('continuePromptRequired=0')) || runItem.result === 'BLOCKED'),
        suite.runs.map(runItem => runItem.notes.find(note => note.includes('continuePrompt')) ?? 'none').join(','),
      ))

      const byClass = (name: string) => certs.find(item => item.projectClass === name)
      const feature = byClass('FEATURE_EXTENSION')
      const staticWeb = byClass('STATIC_WEB')
      if (full) {
        results.push(check(
          'FEATURE_EXTENSION_STATUS_COMPUTED',
          Boolean(feature) && feature!.status === 'RELIABLE' && (feature!.modelDrivenDistinctFixturePassCount ?? 0) >= 3,
          feature ? `${feature.status} distinct=${feature.modelDrivenDistinctFixturePassCount}` : 'missing',
        ))
        results.push(check(
          'FEATURE_EXTENSION_DISTINCT_FIXTURES',
          (feature?.modelDrivenDistinctFixturePassCount ?? 0) >= 3,
          String(feature?.modelDrivenDistinctFixturePassCount ?? 0),
        ))
        results.push(check(
          'STATIC_WEB_STATUS_COMPUTED',
          Boolean(staticWeb) && staticWeb!.status === 'PASSED_FIXTURE' && staticWeb!.status !== 'RELIABLE' && staticWeb!.status !== 'PASSED_MULTI_FIXTURE' && (staticWeb!.modelDrivenDistinctFixturePassCount ?? 0) === 1,
          staticWeb ? `${staticWeb.status} distinct=${staticWeb.modelDrivenDistinctFixturePassCount}` : 'missing',
        ))
      } else {
        results.push(check(
          'STATIC_WEB_STATUS_COMPUTED',
          !staticWeb || (staticWeb.status !== 'RELIABLE' && staticWeb.status !== 'PASSED_MULTI_FIXTURE' && staticWeb.status !== 'PRODUCTION_PROVEN'),
          staticWeb ? `${staticWeb.status} distinct=${staticWeb.modelDrivenDistinctFixturePassCount}` : 'missing',
        ))
      }

      const reportPath = writeGraduationReport({
        title: 'FOUNDRY_FEATURE_EXTENSION_RELIABILITY_AND_STATIC_WEB_COVERAGE_REPORT',
        generatedAt: new Date().toISOString(),
        suite: full ? 'full' : 'fast',
        providerPolicy: policy,
        runs: allRuns.map(runItem => ({
          benchmarkId: runItem.benchmarkId,
          result: runItem.result,
          providers: runItem.providers,
          models: runItem.models,
          fixtureIdentity: runItem.fixtureIdentity,
          criteria: runItem.criteria,
          failureClass: runItem.failureClass,
          resourceUsage: runItem.resourceUsage,
          governance: runItem.modelDrivenGovernance,
          notes: runItem.notes.filter(note => note.startsWith('firstRoute=') || note.startsWith('actionTrace=') || note.startsWith('patches=') || note.startsWith('resourceBudget=') || note.startsWith('feature-extension=') || note.startsWith('static-web=')),
        })),
        certifications: certs,
        counts,
      }, 'FOUNDRY_FEATURE_EXTENSION_RELIABILITY_AND_STATIC_WEB_COVERAGE_REPORT.json')
      results.push(check('machine_readable_report', existsSync(reportPath), reportPath))
      try {
        writeFileSync(path.join(destDir, 'FOUNDRY_FEATURE_EXTENSION_RELIABILITY_AND_STATIC_WEB_COVERAGE_REPORT.json'), readFileSync(reportPath, 'utf8'))
      } catch { /* copy best-effort */ }

      const requiredRan = ids.filter(id => (FOUNDRY_FINAL_CLASS_COVERAGE_FULL_IDS as readonly string[]).includes(id))
      const requiredPass = requiredRan.every(id => byId[id]?.result === 'PASS')
      results.push(check('FINAL_CLASS_COVERAGE', requiredPass && probe.available, requiredPass ? 'PASS' : 'required target failed'))
      results.push(check('REAL_MODEL_ROUTE', probe.available && suite.runs.some(runItem => (runItem.modelRouteCalls ?? []).some(item => item.ok)), policy))
    }
  } finally {
    if (previous.contracts === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = previous.contracts
    if (previous.projects === undefined) delete process.env.FOUNDRY_PROJECTS_ROOT
    else process.env.FOUNDRY_PROJECTS_ROOT = previous.projects
    if (previous.cc === undefined) delete process.env.FOUNDRY_COMMAND_CENTER_ROOT
    else process.env.FOUNDRY_COMMAND_CENTER_ROOT = previous.cc
    if (previous.select === undefined) delete process.env.FOUNDRY_GRADUATION_BENCHMARKS
    else process.env.FOUNDRY_GRADUATION_BENCHMARKS = previous.select
    if (previous.modelSelect === undefined) delete process.env.FOUNDRY_MODEL_GRADUATION_BENCHMARKS
    else process.env.FOUNDRY_MODEL_GRADUATION_BENCHMARKS = previous.modelSelect
    try { rmSync(contractsRoot, { recursive: true, force: true }) } catch { /* tmp */ }
    try { rmSync(projectsRoot, { recursive: true, force: true }) } catch { /* tmp */ }
    try { rmSync(ccRoot, { recursive: true, force: true }) } catch { /* tmp */ }
  }

  const failed = results.filter(item => !item.pass)
  const payload = {
    ok: failed.length === 0,
    passed: results.filter(item => item.pass).length,
    failed: failed.length,
    full,
    results,
  }
  console.log(JSON.stringify(payload, null, 2))
  writeFileSync(path.join(destDir, full ? 'validator-full.json' : 'validator.json'), JSON.stringify(payload, null, 2), 'utf8')
  if (failed.length) process.exitCode = 1
}

run().catch(error => {
  console.error(error)
  process.exit(1)
})
