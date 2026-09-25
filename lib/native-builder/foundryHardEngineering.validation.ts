/**
 * Source + live model-route proofs for Mission 12 hard-engineering expansion.
 * Fast: FULL_STACK_V3, DATABASE_V1, LEGACY_V1, DATA_PROCESSING_V1.
 * Full: 13 required targets, then Mission 11 FULL_STACK V1/V2 for reliability composition.
 * Provider diversity is optional and not a required gate.
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
  FOUNDRY_HARD_ENGINEERING_FAST_IDS,
  FOUNDRY_HARD_ENGINEERING_FULL_IDS,
  FOUNDRY_HARD_ENGINEERING_FULL_STACK_PRIOR_IDS,
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

function selectedIds(): string[] {
  const env = process.env.FOUNDRY_GRADUATION_BENCHMARKS?.trim() || process.env.FOUNDRY_MODEL_GRADUATION_BENCHMARKS?.trim()
  if (env) return env.split(',').map(item => normalizeModelGraduationBenchmarkId(item)).filter(Boolean)
  if (process.env.FOUNDRY_HARD_ENGINEERING_FULL === '1') return [...FOUNDRY_HARD_ENGINEERING_FULL_IDS]
  return [...FOUNDRY_HARD_ENGINEERING_FAST_IDS]
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
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-m12-c-'))
  const projectsRoot = mkdtempSync(path.join(tmpdir(), 'wr-m12-p-'))
  const ccRoot = mkdtempSync(path.join(tmpdir(), 'wr-m12-cc-'))
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

  const full = process.env.FOUNDRY_HARD_ENGINEERING_FULL === '1'
  const destDir = path.join(resolveRepoRoot(), 'tmp/foundry-hard-engineering')
  mkdirSync(destDir, { recursive: true })

  try {
    results.push(check('repo_workspace', /war-room-os$/.test(repo), repo))
    const driver = source('lib/native-builder/foundryModelGraduation.ts')
    const hardSrc = source('lib/native-builder/foundryHardEngineeringFixtures.ts')
    const hardVer = source('lib/native-builder/foundryHardEngineeringVerifiers.ts')
    const types = source('lib/native-builder/foundryEngineeringGraduationTypes.ts')
    const storeSrc = source('lib/native-builder/foundryEngineeringGraduationStore.ts')
    const ui = source('components/war-room/foundry/FoundryEngineeringCapabilitiesPanel.tsx')
    const pkg = source('package.json')
    const fixturesCore = source('lib/native-builder/foundryEngineeringGraduationFixtures.ts')
    const verifiers = source('lib/native-builder/foundryEngineeringGraduationVerifiers.ts')

    results.push(check('MISSION_08_CATALOG_PRESERVED', graduationBenchmarks().length === 20, String(graduationBenchmarks().length)))
    results.push(check('MISSION_10_CATALOG_PRESERVED', modelDrivenMultiFixtureBenchmarks().length === 7, String(modelDrivenMultiFixtureBenchmarks().length)))
    results.push(check('MISSION_11_CATALOG_PRESERVED', modelDrivenD3Benchmarks().length === 8, String(modelDrivenD3Benchmarks().length)))
    results.push(check('HARD_CATALOG', hardEngineeringBenchmarks().length === 13, String(hardEngineeringBenchmarks().length)))
    results.push(check('NO_REFERENCE_APPLY', !/referenceSolution\(/.test(driver) && /referenceApply:disabled/.test(driver) && !/referenceSolution\(/.test(hardSrc), 'no reference apply'))
    results.push(check('CURSOR_CORE_DEPENDENCY', !/new CursorAgentProvider/.test(driver), 'Cursor optional'))
    results.push(check('TOOL_BROKER_ONLY', /unattendedToolBrokerWrite/.test(driver), 'Tool Broker'))
    results.push(check('D3_BUDGET', /FOUNDRY_MODEL_DRIVEN_D3_BUDGET/.test(types) && /budgetFor/.test(driver), 'bounded D3 budget'))
    results.push(check('RELIABLE_MODEL_ONLY', /modelDrivenDistinctFixturePassCount/.test(storeSrc) && /requirementsHash/.test(storeSrc), 'model-driven distinct'))
    results.push(check('SQLITE_NOT_POSTGRES', /node:sqlite/.test(hardSrc) && /node:sqlite/.test(hardVer) && !/postgresql|postgres/i.test(hardSrc), 'sqlite only'))
    results.push(check('ELECTRON_NOT_ALL_FRAMEWORKS', /electron/.test(hardSrc) && /not all frameworks/.test(hardVer), 'electron recorded'))
    results.push(check('UI_NEW_CLASSES', /DATABASE_APP/.test(ui) && /DESKTOP_APP/.test(ui) && /SQLite via node:sqlite/.test(ui) && /Electron/.test(ui), 'capabilities UI'))
    results.push(check('FAST_SCRIPT', /validate:foundry-hard-engineering-expansion"/.test(pkg) && /foundryHardEngineering.validation.ts/.test(pkg), 'fast script'))
    results.push(check('FULL_SCRIPT', /validate:foundry-hard-engineering-expansion:full/.test(pkg), 'full script'))
    results.push(check('MISSION_11_SCRIPT_PRESERVED', /validate:foundry-model-graduation-d3"/.test(pkg), 'mission 11 script'))
    results.push(check('MISSION_10_SCRIPT_PRESERVED', /validate:foundry-model-graduation-multifixture/.test(pkg), 'mission 10 script'))
    results.push(check('MISSION_09_SCRIPT_PRESERVED', /validate:foundry-model-graduation"/.test(pkg), 'mission 09 script'))
    results.push(check('NO_HVU', !/\bHVU\b/.test(driver) && !/\bHVU\b/.test(hardSrc), 'HVU absent'))
    results.push(check('HARD_VERIFIER_WIRED', /verifyHardEngineering/.test(verifiers) && /hardEngineeringBenchmarks/.test(fixturesCore), 'wired'))
    results.push(check('NEW_GOVERNANCE_KEYS', /LEGACY_REWRITE_SHORTCUT_COUNT/.test(types) && /DESKTOP_FIXTURE_ORPHAN_PROCESS_COUNT/.test(types) && /REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT/.test(types), 'governance'))
    results.push(check(
      'ATLAS_NO_PRODUCTION',
      mapGraduationLevelToAtlas('RELIABLE').productionProven === false && mapGraduationLevelToAtlas('PASSED_MULTI_FIXTURE').productionProven === false,
      'fixtures cannot assign PRODUCTION_PROVEN',
    ))
    results.push(check('PROTECTED_PRODUCTS', /GRADUATION_PROTECTED_TARGET/.test(driver), 'protected refuse'))
    results.push(check('NO_PYTHON_RUST', !/python|golang|rust|java\b/i.test(hardSrc), 'JS/Node only'))
    const identities = hardEngineeringBenchmarks().map(item => fixtureIdentityFor(item, { marker: item.benchmarkId }, 'v1'))
    const req = new Set(identities.map(item => item.requirementsHash))
    const vars = new Set(identities.map(item => item.variationHash))
    results.push(check('HARD_FIXTURE_DISTINCT_HASHES', req.size === 13 && vars.size === 13, `req=${req.size} var=${vars.size}`))

    applyFoundryRuntimeConfig()
    const probe = await probeModelGraduationProviders()
    results.push(check('REAL_MODEL_ROUTE_AVAILABLE', probe.available, JSON.stringify(probe)))
    let policy = probe.models.find(item => item.provider === 'ollama')
      ? `ollama/${probe.models.find(item => item.provider === 'ollama')!.model}`
      : (probe.models[0] ? `${probe.models[0].provider}/${probe.models[0].model}` : 'none')

    if (!probe.available) {
      results.push(check('HARD_ENGINEERING_CLASS_EXPANSION', false, probe.reason))
    } else {
      const ids = selectedIds()
      results.push(check('SINGLE_TARGET_NORMALIZED', ids.every(id => Boolean(getGraduationBenchmark(id))), ids.join(',')))
      const harness = new FoundryModelGraduationHarness({ benchmarkIds: ids })
      const suite = await harness.runSuite()
      const routed = suite.runs.find(run => run.providers[0] && run.providers[0] !== 'none')
      if (routed) policy = `${routed.providers[0]}/${routed.models[0]}`
      const byId = Object.fromEntries(suite.runs.map(run => [run.benchmarkId, run]))

      const requiredMap: Array<[string, string]> = [
        ['GRAD-D-FULLSTACK-V3', 'MODEL_DRIVEN_FULL_STACK_V3'],
        ['GRAD-DA-DATABASE-V1', 'MODEL_DRIVEN_DATABASE_APP_V1'],
        ['GRAD-DA-DATABASE-V2', 'MODEL_DRIVEN_DATABASE_APP_V2'],
        ['GRAD-DK-DESKTOP-V1', 'MODEL_DRIVEN_DESKTOP_APP_V1'],
        ['GRAD-DK-DESKTOP-V2', 'MODEL_DRIVEN_DESKTOP_APP_V2'],
        ['GRAD-LV-LEGACY-V1', 'MODEL_DRIVEN_LEGACY_MODIFICATION_V1'],
        ['GRAD-LV-LEGACY-V2', 'MODEL_DRIVEN_LEGACY_MODIFICATION_V2'],
        ['GRAD-RF-REFACTOR-V1', 'MODEL_DRIVEN_REFACTOR_V1'],
        ['GRAD-RF-REFACTOR-V2', 'MODEL_DRIVEN_REFACTOR_V2'],
        ['GRAD-DP-DATA-V1', 'MODEL_DRIVEN_DATA_PROCESSING_V1'],
        ['GRAD-DP-DATA-V2', 'MODEL_DRIVEN_DATA_PROCESSING_V2'],
        ['GRAD-LP-LIBRARY-V1', 'MODEL_DRIVEN_LIBRARY_PACKAGE_V1'],
        ['GRAD-LP-LIBRARY-V2', 'MODEL_DRIVEN_LIBRARY_PACKAGE_V2'],
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
        const requiredPass = FOUNDRY_HARD_ENGINEERING_FULL_IDS.every(id => byId[id]?.result === 'PASS')
        if (requiredPass && process.env.FOUNDRY_HARD_SKIP_FULLSTACK_PRIOR !== '1') {
          const prior = new FoundryModelGraduationHarness({ benchmarkIds: [...FOUNDRY_HARD_ENGINEERING_FULL_STACK_PRIOR_IDS] })
          const priorSuite = await prior.runSuite()
          suite.runs.push(...priorSuite.runs)
          for (const run of priorSuite.runs) byId[run.benchmarkId] = run
          results.push(check(
            'FULL_STACK_PRIOR_COMPOSITION',
            priorSuite.runs.every(run => run.result === 'PASS'),
            priorSuite.runs.map(run => `${run.benchmarkId}:${run.result}`).join(','),
          ))
        } else {
          results.push(check('FULL_STACK_PRIOR_COMPOSITION', requiredPass, requiredPass ? 'skipped' : 'required targets not all PASS'))
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
        'LEGACY_REWRITE_SHORTCUT_COUNT',
        'DESKTOP_FIXTURE_ORPHAN_PROCESS_COUNT',
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
        suite.runs.every(run => run.notes.some(note => note.includes('continuePromptRequired=0')) || run.result === 'BLOCKED'),
        suite.runs.map(run => run.notes.find(note => note.includes('continuePrompt')) ?? 'none').join(','),
      ))

      const byClass = (name: string) => certs.find(item => item.projectClass === name)
      if (full) {
        const fullStack = byClass('FULL_STACK_APP')
        results.push(check(
          'FULL_STACK_STATUS_COMPUTED',
          Boolean(fullStack) && fullStack!.status !== 'PRODUCTION_PROVEN',
          fullStack ? `${fullStack.status} distinct=${fullStack.modelDrivenDistinctFixturePassCount}` : 'missing',
        ))
        for (const klass of ['DATABASE_APP', 'DESKTOP_APP', 'LEGACY_CODE_MODIFICATION', 'REFACTOR', 'DATA_PROCESSING', 'LIBRARY_PACKAGE'] as const) {
          const cert = byClass(klass)
          results.push(check(
            `${klass}_STATUS_COMPUTED`,
            Boolean(cert) && cert!.status !== 'PRODUCTION_PROVEN' && cert!.status !== 'RELIABLE',
            cert ? `${cert.status} distinct=${cert.modelDrivenDistinctFixturePassCount}` : 'missing',
          ))
        }
      }

      const reportPath = writeGraduationReport({
        title: 'FOUNDRY_HARD_ENGINEERING_CLASS_EXPANSION_REPORT',
        generatedAt: new Date().toISOString(),
        suite: full ? 'full' : 'fast',
        providerPolicy: policy,
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
          notes: run.notes.filter(note => note.startsWith('firstRoute=') || note.startsWith('actionTrace=') || note.startsWith('resourceBudget=') || note.startsWith('DESKTOP_ORPHANS=') || note.startsWith('LEGACY_REWRITE=') || note.startsWith('database-engine=') || note.startsWith('desktop-framework=')),
        })),
        certifications: certs,
        counts,
      }, 'FOUNDRY_HARD_ENGINEERING_CLASS_EXPANSION_REPORT.json')
      results.push(check('machine_readable_report', existsSync(reportPath), reportPath))

      const requiredRan = ids.filter(id => (FOUNDRY_HARD_ENGINEERING_FULL_IDS as readonly string[]).includes(id))
      const requiredPass = requiredRan.every(id => byId[id]?.result === 'PASS')
      results.push(check('HARD_ENGINEERING_CLASS_EXPANSION', requiredPass && probe.available, requiredPass ? 'PASS' : 'required target failed'))
      results.push(check('REAL_MODEL_ROUTE', probe.available && suite.runs.some(run => (run.modelRouteCalls ?? []).some(item => item.ok)), policy))
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
