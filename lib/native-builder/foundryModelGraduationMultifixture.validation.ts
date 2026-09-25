/**
 * Source + live model-route proofs for Mission 10 multi-fixture expansion.
 * Does not apply reference solutions. Does not package, install, commit, push, or deploy.
 * Fast: CLI_V2, BUG_FIX_V2, FRONTEND_V2, BACKEND_API.
 * Full: eight required targets, then Mission 09 v1 fixtures for reliability composition.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  FoundryModelGraduationHarness,
  probeModelGraduationProviders,
  selectModelGraduationBenchmarkIds,
  normalizeModelGraduationBenchmarkId,
} from './foundryModelGraduation'
import { getGraduationBenchmark, graduationBenchmarks } from './foundryEngineeringGraduationFixtures'
import { fixtureIdentityFor, modelDrivenMultiFixtureBenchmarks } from './foundryModelGraduationFixtures'
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
  FOUNDRY_MODEL_DRIVEN_MULTIFIXTURE_FAST_IDS,
  FOUNDRY_MODEL_DRIVEN_MULTIFIXTURE_FULL_IDS,
  FOUNDRY_MODEL_DRIVEN_RELIABILITY_PRIOR_IDS,
  FOUNDRY_MODEL_DRIVEN_D3_BENCHMARK_ID,
  FOUNDRY_SELECTED_D3_CLASS,
  type FoundryGraduationRun,
  type FoundryModelDrivenGovernanceCounts,
} from './foundryEngineeringGraduationTypes'
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

function selectedIds(): string[] {
  const env = process.env.FOUNDRY_GRADUATION_BENCHMARKS?.trim() || process.env.FOUNDRY_MODEL_GRADUATION_BENCHMARKS?.trim()
  if (env) return env.split(',').map(item => normalizeModelGraduationBenchmarkId(item)).filter(Boolean)
  if (process.env.FOUNDRY_GRADUATION_MULTIFIXTURE_FULL === '1') return [...FOUNDRY_MODEL_DRIVEN_MULTIFIXTURE_FULL_IDS]
  return [...FOUNDRY_MODEL_DRIVEN_MULTIFIXTURE_FAST_IDS]
}

function runGate(run: FoundryGraduationRun | undefined, label: string): CaseResult[] {
  return [
    check(
      label,
      Boolean(run) && run!.result === 'PASS' && run!.engineeringMode === 'model-driven',
      run ? `${run.result} ${run.passedRequiredCount}/${run.requiredCount} providers=${run.providers.join(',')} models=${run.models.join(',')} ${run.failureClass ?? ''} ${run.criteria.filter(item => !item.passed).map(item => item.criterionId).join(',')} ${run.notes.filter(note => note.startsWith('actionTrace=') || note.startsWith('firstRoute=') || note.startsWith('patches=')).join(' | ')}` : 'missing',
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
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-m10-c-'))
  const projectsRoot = mkdtempSync(path.join(tmpdir(), 'wr-m10-p-'))
  const ccRoot = mkdtempSync(path.join(tmpdir(), 'wr-m10-cc-'))
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

  const full = process.env.FOUNDRY_GRADUATION_MULTIFIXTURE_FULL === '1'
  const destDir = path.join(resolveRepoRoot(), 'tmp/foundry-model-graduation-multifixture')
  mkdirSync(destDir, { recursive: true })

  try {
    results.push(check('repo_workspace', /war-room-os$/.test(repo), repo))
    const driver = source('lib/native-builder/foundryModelGraduation.ts')
    const expansion = source('lib/native-builder/foundryModelGraduationFixtures.ts')
    const types = source('lib/native-builder/foundryEngineeringGraduationTypes.ts')
    const storeSrc = source('lib/native-builder/foundryEngineeringGraduationStore.ts')
    const ui = source('components/war-room/foundry/FoundryEngineeringCapabilitiesPanel.tsx')
    const pkg = source('package.json')
    const fixturesCore = source('lib/native-builder/foundryEngineeringGraduationFixtures.ts')

    results.push(check('MISSION_08_CATALOG_PRESERVED', graduationBenchmarks().length === 20, String(graduationBenchmarks().length)))
    results.push(check('EXPANSION_CATALOG', modelDrivenMultiFixtureBenchmarks().length === 7, String(modelDrivenMultiFixtureBenchmarks().length)))
    results.push(check('NO_REFERENCE_APPLY', !/referenceSolution\(/.test(driver) && /referenceApply:disabled/.test(driver) && !/referenceSolution\(/.test(expansion), 'no reference apply'))
    results.push(check('CURSOR_CORE_DEPENDENCY', !/new CursorAgentProvider/.test(driver), 'Cursor optional'))
    results.push(check('TOOL_BROKER_ONLY', /unattendedToolBrokerWrite/.test(driver), 'Tool Broker'))
    results.push(check('DISTINCTNESS_HASHES', /requirementsHash/.test(expansion) && /hiddenOracleHash/.test(expansion) && /fixtureIdentity/.test(types), 'fixture identity'))
    results.push(check('RELIABLE_MODEL_ONLY', /modelDrivenDistinctFixturePassCount/.test(storeSrc) && /requirementsHash/.test(storeSrc), 'model-driven distinct'))
    results.push(check('UI_DISTINCT_AND_PROVIDER', /model-driven distinct/.test(ui) && /Proven with/.test(ui) && /not universal/.test(ui), 'capabilities UI'))
    results.push(check('FAST_SCRIPT', /validate:foundry-model-graduation-multifixture/.test(pkg) && /foundryModelGraduationMultifixture.validation.ts/.test(pkg), 'fast script'))
    results.push(check('FULL_SCRIPT', /validate:foundry-model-graduation-multifixture:full/.test(pkg), 'full script'))
    results.push(check('MISSION_09_SCRIPT_PRESERVED', /validate:foundry-model-graduation"/.test(pkg), 'mission 09 script'))
    results.push(check('NO_HVU', !/\bHVU\b/.test(driver) && !/\bHVU\b/.test(expansion), 'HVU absent'))
    results.push(check('NO_NEW_LANGUAGES', !/python|golang|rust|java\b/i.test(expansion), 'JS/Node only'))
    results.push(check('D3_CLASS', FOUNDRY_SELECTED_D3_CLASS === 'FEATURE_EXTENSION' && FOUNDRY_MODEL_DRIVEN_D3_BENCHMARK_ID === 'GRAD-I-FEATURE-D3', FOUNDRY_SELECTED_D3_CLASS))
    results.push(check(
      'ATLAS_NO_PRODUCTION',
      mapGraduationLevelToAtlas('RELIABLE').productionProven === false && mapGraduationLevelToAtlas('PASSED_FIXTURE').productionProven === false,
      'fixtures cannot assign PRODUCTION_PROVEN',
    ))
    results.push(check('PROTECTED_PRODUCTS', /GRADUATION_PROTECTED_TARGET/.test(driver), 'protected refuse'))
    results.push(check('CORE_REFERENCE_UNCHANGED', /export function referenceSolution/.test(fixturesCore), 'mission 08 reference path file remains'))

    const identities = ['GRAD-E-CLI', 'GRAD-E-CLI-V2', 'GRAD-E-CLI-V3', 'GRAD-G-BUGFIX', 'GRAD-G-BUGFIX-V2', 'GRAD-G-BUGFIX-V3', 'GRAD-B-FRONTEND', 'GRAD-B-FRONTEND-V2', 'GRAD-B-FRONTEND-V3']
      .map(id => {
        const bench = getGraduationBenchmark(id)!
        return fixtureIdentityFor(bench, { marker: id }, 'v1')
      })
    const req = identities.map(item => item.requirementsHash)
    results.push(check('FIXTURE_REQUIREMENTS_UNIQUE', new Set(req).size === req.length, String(new Set(req).size)))

    const savedSelect = process.env.FOUNDRY_GRADUATION_BENCHMARKS
    const savedModelSelect = process.env.FOUNDRY_MODEL_GRADUATION_BENCHMARKS
    delete process.env.FOUNDRY_GRADUATION_BENCHMARKS
    delete process.env.FOUNDRY_MODEL_GRADUATION_BENCHMARKS
    process.env.FOUNDRY_GRADUATION_BENCHMARKS = 'GRAD-E-CLI-V2'
    results.push(check(
      'SINGLE_BENCHMARK_ENV',
      selectModelGraduationBenchmarkIds().join(',') === 'GRAD-E-CLI-V2',
      selectModelGraduationBenchmarkIds().join(','),
    ))
    delete process.env.FOUNDRY_GRADUATION_BENCHMARKS
    if (savedSelect !== undefined) process.env.FOUNDRY_GRADUATION_BENCHMARKS = savedSelect
    if (savedModelSelect !== undefined) process.env.FOUNDRY_MODEL_GRADUATION_BENCHMARKS = savedModelSelect

    const probe = await probeModelGraduationProviders()
    results.push(check('REAL_MODEL_ROUTE_PROBE', probe.available, probe.available ? probe.models.map(item => `${item.provider}:${item.model}`).join(',') : probe.reason))

    if (!probe.available) {
      results.push(check('MODEL_PROVIDER_UNAVAILABLE', false, probe.reason))
      results.push(check('MODEL_DRIVEN_MULTI_FIXTURE', false, 'BLOCKED'))
    } else {
      const ids = selectedIds()
      const harness = new FoundryModelGraduationHarness({ benchmarkIds: ids })
      results.push(check('selected_ids', harness.listBenchmarks().length === ids.length, ids.join(',')))
      const suite = await harness.runSuite()
      const byId = Object.fromEntries(suite.runs.map(run => [run.benchmarkId, run]))

      const requiredMap: Array<[string, string]> = [
        ['GRAD-E-CLI-V2', 'MODEL_DRIVEN_CLI_V2'],
        ['GRAD-E-CLI-V3', 'MODEL_DRIVEN_CLI_V3'],
        ['GRAD-G-BUGFIX-V2', 'MODEL_DRIVEN_BUG_FIX_V2'],
        ['GRAD-G-BUGFIX-V3', 'MODEL_DRIVEN_BUG_FIX_V3'],
        ['GRAD-B-FRONTEND-V2', 'MODEL_DRIVEN_FRONTEND_V2'],
        ['GRAD-B-FRONTEND-V3', 'MODEL_DRIVEN_FRONTEND_V3'],
        ['GRAD-C-BACKEND', 'MODEL_DRIVEN_BACKEND_API_RESULT'],
        ['GRAD-I-FEATURE-D3', 'MODEL_DRIVEN_D3_RESULT'],
      ]
      for (const [id, label] of requiredMap) {
        if (!ids.includes(id)) {
          if (full) results.push(check(label, false, 'missing from full suite'))
          continue
        }
        const run = byId[id]
        results.push(...runGate(run, label))
        results.push(check(
          `${id}_ISOLATED`,
          Boolean(run?.projectRoot.startsWith(projectsRoot) && run.projectRoot.includes('/graduation/')),
          run?.projectRoot ?? 'none',
        ))
        results.push(check(`${id}_ATTEMPT_HISTORY`, listGraduationAttempts(id).length >= 1, String(listGraduationAttempts(id).length)))
        results.push(check(
          `${id}_PROJECT_READY`,
          run?.result === 'PASS' ? run.projectReady === true : run?.projectReady === false,
          `ready=${run?.projectReady} result=${run?.result}`,
        ))
        results.push(check(
          `${id}_IDENTITY`,
          Boolean(run?.fixtureIdentity?.requirementsHash && run.fixtureIdentity.hiddenOracleHash && run.fixtureIdentity.variationHash),
          run?.fixtureIdentity?.fixtureId ?? 'none',
        ))
      }

      if (full) {
        const requiredPass = FOUNDRY_MODEL_DRIVEN_MULTIFIXTURE_FULL_IDS.every(id => byId[id]?.result === 'PASS')
        if (requiredPass && process.env.FOUNDRY_MULTIFIXTURE_SKIP_V1 !== '1') {
          const prior = new FoundryModelGraduationHarness({ benchmarkIds: [...FOUNDRY_MODEL_DRIVEN_RELIABILITY_PRIOR_IDS] })
          const priorSuite = await prior.runSuite()
          suite.runs.push(...priorSuite.runs)
          for (const run of priorSuite.runs) byId[run.benchmarkId] = run
          results.push(check(
            'RELIABILITY_V1_COMPOSITION',
            priorSuite.runs.every(run => run.result === 'PASS'),
            priorSuite.runs.map(run => `${run.benchmarkId}:${run.result}`).join(','),
          ))
        } else {
          results.push(check('RELIABILITY_V1_COMPOSITION', requiredPass, requiredPass ? 'skipped' : 'required targets not all PASS'))
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
        suite.runs.every(run => run.notes.some(note => note.includes('continuePromptRequired=0')) || run.result === 'BLOCKED'),
        suite.runs.map(run => run.notes.find(note => note.includes('continuePrompt')) ?? 'none').join(','),
      ))
      results.push(check(
        'D3_SELECTED_CLASS',
        getGraduationBenchmark(FOUNDRY_MODEL_DRIVEN_D3_BENCHMARK_ID)?.projectClass === FOUNDRY_SELECTED_D3_CLASS,
        FOUNDRY_SELECTED_D3_CLASS,
      ))
      results.push(check(
        'BACKEND_NOT_RELIABLE',
        (certs.find(item => item.projectClass === 'BACKEND_API')?.status ?? 'UNTESTED') !== 'RELIABLE',
        certs.find(item => item.projectClass === 'BACKEND_API')?.status ?? 'UNTESTED',
      ))

      const reportPath = writeGraduationReport({
        title: 'FOUNDRY_MODEL_DRIVEN_MULTI_FIXTURE_REPORT',
        generatedAt: new Date().toISOString(),
        suite: full ? 'full' : 'fast',
        selectedD3Class: FOUNDRY_SELECTED_D3_CLASS,
        runs: allRuns.map(run => ({
          benchmarkId: run.benchmarkId,
          result: run.result,
          providers: run.providers,
          models: run.models,
          fixtureIdentity: run.fixtureIdentity,
          criteria: run.criteria,
          failureClass: run.failureClass,
          resourceUsage: run.resourceUsage,
          governance: run.modelDrivenGovernance,
        })),
        certifications: certs,
        counts,
      }, 'FOUNDRY_MODEL_DRIVEN_MULTI_FIXTURE_REPORT.json')
      results.push(check('machine_readable_report', existsSync(reportPath), reportPath))

      const requiredRan = ids.filter(id => (FOUNDRY_MODEL_DRIVEN_MULTIFIXTURE_FULL_IDS as readonly string[]).includes(id))
      const requiredPass = requiredRan.every(id => byId[id]?.result === 'PASS')
      results.push(check('MODEL_DRIVEN_MULTI_FIXTURE', requiredPass && probe.available, requiredPass ? 'PASS' : 'required target failed'))
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
