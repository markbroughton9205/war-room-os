/**
 * Source + live model-route proofs for Mission 09 model-driven graduation.
 * Does not apply reference solutions. Does not package, install, commit, push, or deploy.
 * Cursor is optional via FoundryModelRouter. No OS daemon. No HVU.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  FoundryModelGraduationHarness,
  probeModelGraduationProviders,
  selectModelGraduationBenchmarkIds,
} from './foundryModelGraduation'
import { getGraduationBenchmark } from './foundryEngineeringGraduationFixtures'
import {
  buildEngineeringCapabilitiesView,
  countFalseProductionProven,
  countFalseReliable,
  deriveGraduationLevel,
  listCertifications,
  listGraduationAttempts,
  listGraduationRuns,
  writeGraduationReport,
} from './foundryEngineeringGraduationStore'
import { mapGraduationLevelToAtlas } from './foundryEngineeringGraduationAtlas'
import {
  EMPTY_MODEL_DRIVEN_GOVERNANCE,
  FOUNDRY_ENGINEERING_PROJECT_CLASSES,
  FOUNDRY_MODEL_DRIVEN_BUDGET,
  FOUNDRY_MODEL_DRIVEN_GRADUATION_BENCHMARK_IDS,
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
      counts[key] += row[key]
    }
  }
  return counts
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const repo = resolveRepoRoot()
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-mgrad-c-'))
  const projectsRoot = mkdtempSync(path.join(tmpdir(), 'wr-mgrad-p-'))
  const ccRoot = mkdtempSync(path.join(tmpdir(), 'wr-mgrad-cc-'))
  const previous = {
    contracts: process.env.FOUNDRY_CONTRACTS_ROOT,
    projects: process.env.FOUNDRY_PROJECTS_ROOT,
    cc: process.env.FOUNDRY_COMMAND_CENTER_ROOT,
    select: process.env.FOUNDRY_GRADUATION_BENCHMARKS,
  }
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  process.env.FOUNDRY_PROJECTS_ROOT = projectsRoot
  process.env.FOUNDRY_COMMAND_CENTER_ROOT = ccRoot
  resetFoundryRuntimeClock()
  resetFoundryRuntimeTestHooks()
  setFoundryRuntimeTiming({ heartbeatMs: 1, leaseTtlMs: 50 })

  try {
    results.push(check('repo_workspace', /war-room-os$/.test(repo), repo))
    const driver = source('lib/native-builder/foundryModelGraduation.ts')
    const harnessSrc = source('lib/native-builder/foundryEngineeringGraduationHarness.ts')
    const types = source('lib/native-builder/foundryEngineeringGraduationTypes.ts')
    const storeSrc = source('lib/native-builder/foundryEngineeringGraduationStore.ts')
    const ui = source('components/war-room/foundry/FoundryEngineeringCapabilitiesPanel.tsx')
    const pkg = source('package.json')

    results.push(check(
      'MODEL_DRIVEN_DRIVER',
      /class FoundryModelGraduationHarness/.test(driver) && /FoundryModelRouter/.test(driver) && /No OS daemon/.test(driver),
      'model-driven harness present',
    ))
    results.push(check(
      'NO_REFERENCE_APPLY',
      !/referenceSolution\(/.test(driver) && /referenceApply:disabled/.test(driver),
      'driver never calls referenceSolution',
    ))
    results.push(check(
      'CURSOR_CORE_DEPENDENCY',
      !/new CursorAgentProvider/.test(driver) && /configuredFoundryModels/.test(driver),
      'router-only; Cursor optional',
    ))
    results.push(check(
      'TOOL_BROKER_ONLY',
      /unattendedToolBrokerWrite/.test(driver) && /Mutations only through Tool Broker/.test(driver),
      'mutations go through Tool Broker',
    ))
    results.push(check(
      'BUDGET_BOUNDED',
      FOUNDRY_MODEL_DRIVEN_BUDGET.maxModelCalls > 0 && FOUNDRY_MODEL_DRIVEN_BUDGET.maxWallClockMs > 0 && FOUNDRY_MODEL_DRIVEN_BUDGET.maxTotalTokens > 0,
      JSON.stringify(FOUNDRY_MODEL_DRIVEN_BUDGET),
    ))
    results.push(check(
      'CERT_SEPARATION',
      /referencePassCount/.test(types) && /modelDrivenPassCount/.test(types) && /modelDrivenDistinctFixturePassCount/.test(storeSrc),
      'reference vs model-driven counts',
    ))
    results.push(check(
      'RELIABLE_USES_MODEL_DRIVEN',
      /modelDrivenDistinctFixturePassCount/.test(storeSrc) && deriveGraduationLevel({
        attemptCount: 3,
        passCount: 3,
        distinctFixturePassCount: 3,
        modelDrivenDistinctFixturePassCount: 0,
        partial: false,
        productionEvidenceRefs: [],
        criticalGovernanceFailures: 0,
      }) !== 'RELIABLE',
      'three reference fixtures do not mint RELIABLE',
    ))
    results.push(check(
      'UI_DISTINGUISHES',
      /MODEL DRIVEN/.test(ui) && /REFERENCE VERIFIED/.test(ui) && /model-driven/.test(ui),
      'capabilities panel labels',
    ))
    results.push(check(
      'SCRIPT_PRESENT',
      /validate:foundry-model-graduation/.test(pkg) && /foundryModelGraduation.validation.ts/.test(pkg),
      'package script',
    ))
    const savedSelect = process.env.FOUNDRY_GRADUATION_BENCHMARKS
    const savedModelSelect = process.env.FOUNDRY_MODEL_GRADUATION_BENCHMARKS
    delete process.env.FOUNDRY_GRADUATION_BENCHMARKS
    delete process.env.FOUNDRY_MODEL_GRADUATION_BENCHMARKS
    results.push(check(
      'SINGLE_BENCHMARK_SELECT',
      selectModelGraduationBenchmarkIds().join(',') === FOUNDRY_MODEL_DRIVEN_GRADUATION_BENCHMARK_IDS.join(','),
      selectModelGraduationBenchmarkIds().join(','),
    ))
    process.env.FOUNDRY_GRADUATION_BENCHMARKS = 'GRAD-E-CLI'
    results.push(check(
      'SINGLE_BENCHMARK_ENV',
      selectModelGraduationBenchmarkIds().join(',') === 'GRAD-E-CLI',
      selectModelGraduationBenchmarkIds().join(','),
    ))
    delete process.env.FOUNDRY_GRADUATION_BENCHMARKS
    if (savedSelect !== undefined) process.env.FOUNDRY_GRADUATION_BENCHMARKS = savedSelect
    if (savedModelSelect !== undefined) process.env.FOUNDRY_MODEL_GRADUATION_BENCHMARKS = savedModelSelect
    results.push(check(
      'PROTECTED_PRODUCTS',
      /GRADUATION_PROTECTED_TARGET/.test(driver) && /Harbor Desk|Lane & Box/.test(driver),
      'protected product refuse',
    ))
    results.push(check(
      'NO_HVU',
      !/\bHVU\b/.test(driver) && !/\bHVU\b/.test(types),
      'HVU absent',
    ))
    results.push(check(
      'ATLAS_NO_PRODUCTION_FROM_FIXTURE',
      mapGraduationLevelToAtlas('PASSED_FIXTURE').productionProven === false
        && mapGraduationLevelToAtlas('RELIABLE').productionProven === false,
      'fixtures cannot assign PRODUCTION_PROVEN',
    ))
    results.push(check(
      'REFERENCE_HARNESS_PRESERVED',
      /applyReference !== false/.test(harnessSrc) && /harness-reference/.test(harnessSrc),
      'Mission 08 reference path remains for its own validator',
    ))

    const probe = await probeModelGraduationProviders()
    results.push(check(
      'REAL_MODEL_ROUTE_PROBE',
      probe.available,
      probe.available ? probe.models.map(item => `${item.provider}:${item.model}`).join(',') : probe.reason,
    ))

    if (!probe.available) {
      results.push(check('MODEL_PROVIDER_UNAVAILABLE', false, probe.reason))
      results.push(check('MODEL_DRIVEN_CLI_RESULT', false, 'BLOCKED'))
      results.push(check('MODEL_DRIVEN_BUG_FIX_RESULT', false, 'BLOCKED'))
      results.push(check('MODEL_DRIVEN_FRONTEND_RESULT', false, 'BLOCKED'))
    } else {
      const selectedIds = selectModelGraduationBenchmarkIds()
      const harness = new FoundryModelGraduationHarness({
        benchmarkIds: selectedIds,
      })
      results.push(check(
        'required_classes',
        selectedIds.length > 0 && harness.listBenchmarks().every(item => selectedIds.includes(item.benchmarkId)),
        harness.listBenchmarks().map(item => item.letter).join(','),
      ))
      const suite = await harness.runSuite()
      const byId = Object.fromEntries(suite.runs.map(run => [run.benchmarkId, run]))
      for (const id of FOUNDRY_MODEL_DRIVEN_GRADUATION_BENCHMARK_IDS) {
        const run = byId[id]
        const label = id === 'GRAD-E-CLI' ? 'MODEL_DRIVEN_CLI_RESULT' : id === 'GRAD-G-BUGFIX' ? 'MODEL_DRIVEN_BUG_FIX_RESULT' : 'MODEL_DRIVEN_FRONTEND_RESULT'
        results.push(check(
          label,
          Boolean(run) && run.result === 'PASS' && run.engineeringMode === 'model-driven',
          run ? `${run.result} ${run.passedRequiredCount}/${run.requiredCount} providers=${run.providers.join(',')} models=${run.models.join(',')} ${run.failureClass ?? ''} ${run.criteria.filter(item => !item.passed).map(item => item.criterionId).join(',')} ${run.notes.filter(note => note.startsWith('actionTrace=') || note.startsWith('firstRoute=') || note.startsWith('patches=')).join(' | ')}` : 'missing',
        ))
        results.push(check(
          `${id}_REAL_MODEL_ROUTE`,
          Boolean(run?.providers.length) && !run!.providers.includes('none') && !run!.models.includes('harness-reference') && (run?.modelRouteCalls ?? []).some(item => item.ok),
          run ? `${run.providers.join(',')} ${run.models.join(',')} calls=${run.modelRouteCalls?.length ?? 0}` : 'missing',
        ))
        results.push(check(
          `${id}_NO_REFERENCE`,
          (run?.modelDrivenGovernance?.REFERENCE_SOLUTION_APPLY_COUNT ?? 1) === 0
            && (run?.modelDrivenGovernance?.REFERENCE_IMPLEMENTATION_WRITE_COUNT ?? 1) === 0
            && (run?.modelDrivenGovernance?.REFERENCE_FALLBACK_AFTER_MODEL_FAILURE_COUNT ?? 1) === 0,
          JSON.stringify(run?.modelDrivenGovernance ?? {}),
        ))
        results.push(check(
          `${id}_ISOLATED`,
          Boolean(run?.projectRoot.startsWith(projectsRoot) && run.projectRoot.includes('/graduation/')),
          run?.projectRoot ?? 'none',
        ))
        const bench = getGraduationBenchmark(id)
        results.push(check(
          `${id}_ATTEMPT_HISTORY`,
          listGraduationAttempts(id).length >= 1,
          String(listGraduationAttempts(id).length),
        ))
        results.push(check(
          `${id}_PROJECT_READY`,
          run?.result === 'PASS' ? run.projectReady === true : run?.projectReady === false,
          `ready=${run?.projectReady} result=${run?.result} criteria=${bench?.acceptanceCriteria.length}`,
        ))
      }

      const counts = sumCounts(suite.runs)
      for (const key of Object.keys(EMPTY_MODEL_DRIVEN_GOVERNANCE) as (keyof FoundryModelDrivenGovernanceCounts)[]) {
        results.push(check(key, counts[key] === 0, String(counts[key])))
      }
      const certs = listCertifications()
      results.push(check('RELIABLE_CERTIFICATION_COUNT', certs.filter(item => item.status === 'RELIABLE').length === 0, certs.map(item => `${item.projectClass}:${item.status}`).join(',')))
      results.push(check('PRODUCTION_PROVEN_CERTIFICATION_COUNT', certs.filter(item => item.status === 'PRODUCTION_PROVEN').length === 0 && countFalseProductionProven(certs) === 0, certs.map(item => item.status).join(',')))
      results.push(check('FALSE_RELIABLE', countFalseReliable(certs) === 0, 'ok'))
      const view = buildEngineeringCapabilitiesView(certs)
      results.push(check(
        'capabilities_rows',
        view.rows.length === FOUNDRY_ENGINEERING_PROJECT_CLASSES.length,
        String(view.rows.length),
      ))
      const requiredClasses = ['CLI_TOOL', 'BUG_FIX', 'FRONTEND_APP'] as const
      for (const projectClass of requiredClasses) {
        const row = view.rows.find(item => item.projectClass === projectClass)
        results.push(check(
          `${projectClass}_MODEL_DRIVEN_LABEL`,
          Boolean(row && (row.proofLabel === 'MODEL DRIVEN VERIFIED' || row.proofLabel === 'MIXED') && row.modelDrivenPassCount >= 1),
          row ? `${row.proofLabel} model=${row.modelDrivenPassCount} ref=${row.referencePassCount} ${row.status}` : 'missing',
        ))
      }
      results.push(check(
        'BACKEND_OPTIONAL_NOT_GATE',
        !suite.runs.some(run => run.benchmarkId === 'GRAD-C-BACKEND'),
        'optional backend not required',
      ))
      results.push(check(
        'no_continue_spam',
        suite.runs.every(run => run.notes.some(note => note.includes('continuePromptRequired=0')) || run.result === 'BLOCKED'),
        suite.runs.map(run => run.notes.find(note => note.includes('continuePrompt')) ?? 'none').join(','),
      ))
      const reportPath = writeGraduationReport({
        title: 'FOUNDRY_MODEL_DRIVEN_GRADUATION_REPORT',
        generatedAt: new Date().toISOString(),
        runs: suite.runs.map(run => ({
          benchmarkId: run.benchmarkId,
          result: run.result,
          providers: run.providers,
          models: run.models,
          criteria: run.criteria,
          routeCalls: run.modelRouteCalls?.map(item => ({
            kind: item.kind,
            provider: item.selectedProvider,
            model: item.selectedModel,
            ok: item.ok,
            decision: item.decision,
            latencyMs: item.latencyMs,
          })),
          governance: run.modelDrivenGovernance,
        })),
        certifications: certs,
        counts,
      }, 'FOUNDRY_MODEL_DRIVEN_GRADUATION_REPORT.json')
      results.push(check('machine_readable_report', existsSync(reportPath), reportPath))
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
  const destDir = path.join(resolveRepoRoot(), 'tmp/foundry-model-graduation')
  mkdirSync(destDir, { recursive: true })
  writeFileSync(path.join(destDir, 'validator.json'), JSON.stringify(payload, null, 2), 'utf8')
  if (failed.length) process.exitCode = 1
}

run().catch(error => {
  console.error(error)
  process.exit(1)
})
