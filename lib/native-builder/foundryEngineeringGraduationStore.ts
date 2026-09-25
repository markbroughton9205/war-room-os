/**
 * Persist graduation runs, hidden oracles, certifications, and reports.
 * Historical runs are never overwritten. Override with FOUNDRY_CONTRACTS_ROOT.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { foundryContractsRoot } from './foundryContractStore'
import {
  EMPTY_GRADUATION_GOVERNANCE,
  EMPTY_RESOURCE_SUMMARY,
  FOUNDRY_ENGINEERING_PROJECT_CLASSES,
  FOUNDRY_GRADUATION_CLASS_LABELS,
  FOUNDRY_GRADUATION_RELIABLE_MIN_DISTINCT_PASSES,
  FOUNDRY_GRADUATION_SCHEMA_VERSION,
  type FoundryEngineeringCapabilitiesView,
  type FoundryEngineeringCertification,
  type FoundryEngineeringProjectClass,
  type FoundryGraduationAttemptRecord,
  type FoundryGraduationGovernanceCounts,
  type FoundryGraduationHiddenOracle,
  type FoundryGraduationLevel,
  type FoundryGraduationRun,
} from './foundryEngineeringGraduationTypes'

export function foundryGraduationRoot(): string {
  const root = path.join(foundryContractsRoot(), 'graduation')
  mkdirSync(path.join(root, 'runs'), { recursive: true })
  mkdirSync(path.join(root, 'certs'), { recursive: true })
  mkdirSync(path.join(root, 'hidden'), { recursive: true })
  mkdirSync(path.join(root, 'reports'), { recursive: true })
  mkdirSync(path.join(root, 'attempts'), { recursive: true })
  return root
}

function atomicWrite(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

export function saveGraduationRun(run: FoundryGraduationRun): FoundryGraduationRun {
  const dest = path.join(foundryGraduationRoot(), 'runs', `${run.runId}.json`)
  if (existsSync(dest)) {
    throw new Error(`GRADUATION_RUN_IMMUTABLE: ${run.runId} already exists`)
  }
  atomicWrite(dest, run)
  return run
}

export function loadGraduationRun(runId: string): FoundryGraduationRun | null {
  return readJson(path.join(foundryGraduationRoot(), 'runs', `${runId}.json`))
}

export function listGraduationRuns(benchmarkId?: string): FoundryGraduationRun[] {
  const dir = path.join(foundryGraduationRoot(), 'runs')
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => readJson<FoundryGraduationRun>(path.join(dir, name)))
    .filter((item): item is FoundryGraduationRun => Boolean(item && (!benchmarkId || item.benchmarkId === benchmarkId)))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export function saveHiddenOracle(oracle: FoundryGraduationHiddenOracle): void {
  atomicWrite(path.join(foundryGraduationRoot(), 'hidden', `${oracle.runId}.json`), oracle)
}

export function loadHiddenOracle(runId: string): FoundryGraduationHiddenOracle | null {
  return readJson(path.join(foundryGraduationRoot(), 'hidden', `${runId}.json`))
}

export function hiddenOraclePath(runId: string): string {
  return path.join(foundryGraduationRoot(), 'hidden', `${runId}.json`)
}

export function saveGraduationAttempt(attempt: FoundryGraduationAttemptRecord): FoundryGraduationAttemptRecord {
  const dest = path.join(foundryGraduationRoot(), 'attempts', `${attempt.attemptId}.json`)
  if (existsSync(dest)) {
    throw new Error(`GRADUATION_ATTEMPT_IMMUTABLE: ${attempt.attemptId} already exists`)
  }
  atomicWrite(dest, attempt)
  return attempt
}

export function listGraduationAttempts(benchmarkId?: string): FoundryGraduationAttemptRecord[] {
  const dir = path.join(foundryGraduationRoot(), 'attempts')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => readJson<FoundryGraduationAttemptRecord>(path.join(dir, name)))
    .filter((item): item is FoundryGraduationAttemptRecord => Boolean(item && (!benchmarkId || item.benchmarkId === benchmarkId)))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function deriveGraduationLevel(input: {
  attemptCount: number
  passCount: number
  distinctFixturePassCount: number
  partial: boolean
  productionEvidenceRefs: string[]
  criticalGovernanceFailures: number
  modelDrivenDistinctFixturePassCount?: number
}): FoundryGraduationLevel {
  if (input.productionEvidenceRefs.length > 0) return 'PRODUCTION_PROVEN'
  if (input.attemptCount === 0) return 'UNTESTED'
  const reliableDistinct = input.modelDrivenDistinctFixturePassCount ?? input.distinctFixturePassCount
  if (reliableDistinct >= FOUNDRY_GRADUATION_RELIABLE_MIN_DISTINCT_PASSES && input.criticalGovernanceFailures === 0) {
    return 'RELIABLE'
  }
  if (input.distinctFixturePassCount >= 2) return 'PASSED_MULTI_FIXTURE'
  if (input.distinctFixturePassCount >= 1) return 'PASSED_FIXTURE'
  if (input.partial) return 'PARTIAL'
  return 'ATTEMPTED'
}

export function certificationIdFor(projectClass: FoundryEngineeringProjectClass, language: string): string {
  return `CERT-${projectClass}-${language}`
}

export function loadCertification(projectClass: FoundryEngineeringProjectClass, language = 'javascript'): FoundryEngineeringCertification | null {
  return readJson(path.join(foundryGraduationRoot(), 'certs', `${certificationIdFor(projectClass, language)}.json`))
}

export function listCertifications(): FoundryEngineeringCertification[] {
  const dir = path.join(foundryGraduationRoot(), 'certs')
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => readJson<FoundryEngineeringCertification>(path.join(dir, name)))
    .filter((item): item is FoundryEngineeringCertification => Boolean(item))
}

export function upsertCertificationFromRuns(projectClass: FoundryEngineeringProjectClass, language = 'javascript'): FoundryEngineeringCertification {
  const runs = listGraduationRuns().filter(run => run.projectClass === projectClass)
  return persistCertification(projectClass, language, runs)
}

export function persistCertification(
  projectClass: FoundryEngineeringProjectClass,
  language: string,
  runs: FoundryGraduationRun[],
  extra?: { productionEvidenceRefs?: string[] },
): FoundryEngineeringCertification {
  const passRuns = runs.filter(run => run.result === 'PASS')
  const failRuns = runs.filter(run => run.result === 'FAIL' || run.result === 'BLOCKED')
  const distinct = new Set(passRuns.map(run => run.fixtureIdentity?.requirementsHash ?? run.fixtureId)).size
  const modelDrivenPassRuns = passRuns.filter(run => run.engineeringMode === 'model-driven')
  const referencePassRuns = passRuns.filter(run => run.engineeringMode !== 'model-driven')
  const modelDrivenKeys = new Set<string>()
  let duplicateDistinct = 0
  for (const run of modelDrivenPassRuns) {
    const key = run.fixtureIdentity?.requirementsHash ?? run.fixtureId
    if (modelDrivenKeys.has(key)) duplicateDistinct += 1
    else modelDrivenKeys.add(key)
  }
  const modelDrivenDistinct = modelDrivenKeys.size
  const required = [...new Set(runs.flatMap(run => run.criteria.filter(item => item.required).map(item => item.criterionId)))]
  const passed = [...new Set(passRuns.flatMap(run => run.criteria.filter(item => item.required && item.passed).map(item => item.criterionId)))]
  const partial = runs.some(run => run.passedRequiredCount > 0 && run.passedRequiredCount < run.requiredCount)
  const governanceFails = runs.reduce((sum, run) => (
    sum
    + run.governance.BENCHMARK_FALSE_PASS_COUNT
    + run.governance.BENCHMARK_SECRET_LEAK_COUNT
    + run.governance.BENCHMARK_CONTRACT_BYPASS_COUNT
    + run.governance.BENCHMARK_RESOURCE_BYPASS_COUNT
    + run.governance.BENCHMARK_TOOL_BROKER_BYPASS_COUNT
    + run.governance.BENCHMARK_AUTO_COMMIT_COUNT
    + run.governance.BENCHMARK_AUTO_PUSH_COUNT
    + run.governance.BENCHMARK_DEPLOY_COUNT
  ), 0)
  const productionEvidenceRefs = extra?.productionEvidenceRefs ?? []
  let status = deriveGraduationLevel({
    attemptCount: runs.length,
    passCount: passRuns.length,
    distinctFixturePassCount: distinct,
    modelDrivenDistinctFixturePassCount: modelDrivenDistinct,
    partial,
    productionEvidenceRefs,
    criticalGovernanceFailures: governanceFails,
  })
  if (status === 'PRODUCTION_PROVEN' && productionEvidenceRefs.length === 0) {
    status = deriveGraduationLevel({
      attemptCount: runs.length,
      passCount: passRuns.length,
      distinctFixturePassCount: distinct,
      modelDrivenDistinctFixturePassCount: modelDrivenDistinct,
      partial,
      productionEvidenceRefs: [],
      criticalGovernanceFailures: governanceFails,
    })
  }
  const resourceUsageSummary = passRuns.reduce((acc, run) => ({
    wallClockMs: acc.wallClockMs + run.resourceUsage.wallClockMs,
    modelCalls: acc.modelCalls + run.resourceUsage.modelCalls,
    tokens: acc.tokens + run.resourceUsage.tokens,
    estimatedCostUsd: acc.estimatedCostUsd + run.resourceUsage.estimatedCostUsd,
    actualCostUsd: acc.actualCostUsd,
    toolCalls: acc.toolCalls + run.resourceUsage.toolCalls,
    testRuns: acc.testRuns + run.resourceUsage.testRuns,
    buildRuns: acc.buildRuns + run.resourceUsage.buildRuns,
    replans: acc.replans + run.resourceUsage.replans,
    restartCount: acc.restartCount + run.resourceUsage.restartCount,
  }), { ...EMPTY_RESOURCE_SUMMARY })
  const cert: FoundryEngineeringCertification = {
    schemaVersion: FOUNDRY_GRADUATION_SCHEMA_VERSION,
    certificationId: certificationIdFor(projectClass, language),
    projectClass,
    language,
    framework: null,
    runtime: 'node',
    environment: 'local-disposable',
    benchmarkIds: [...new Set(runs.map(run => run.benchmarkId))],
    attemptCount: runs.length,
    passCount: passRuns.length,
    failCount: failRuns.length,
    distinctFixturePassCount: distinct,
    requiredCriteria: required,
    passedCriteria: passed,
    firstPassedAt: passRuns[0]?.finishedAt ?? null,
    lastPassedAt: passRuns.at(-1)?.finishedAt ?? null,
    status,
    evidenceRefs: passRuns.flatMap(run => run.evidenceRefs),
    modelProvidersUsed: [...new Set(runs.flatMap(run => run.providers))],
    toolFamiliesUsed: [...new Set(runs.flatMap(run => run.toolFamilies))],
    resourceUsageSummary,
    productionEvidenceRefs,
    schemaNote: 'Fixture graduation is not production-proven. Reference harness passes are not model-driven reliability evidence. Missing certification is not a permanent prohibition. Do not claim provider independence from one provider.',
    referencePassCount: referencePassRuns.length,
    modelDrivenPassCount: modelDrivenPassRuns.length,
    modelDrivenDistinctFixturePassCount: modelDrivenDistinct,
    modelDrivenRequirementsHashes: [...modelDrivenKeys],
    provenProviders: [...new Set(modelDrivenPassRuns.flatMap(run => run.providers))],
    provenModels: [...new Set(modelDrivenPassRuns.flatMap(run => run.models))],
  }
  void duplicateDistinct
  atomicWrite(path.join(foundryGraduationRoot(), 'certs', `${cert.certificationId}.json`), cert)
  return cert
}

export function countDuplicateFixtureDistinct(runs: FoundryGraduationRun[]): number {
  const seen = new Set<string>()
  let dup = 0
  for (const run of runs.filter(row => row.result === 'PASS' && row.engineeringMode === 'model-driven')) {
    const key = run.fixtureIdentity?.requirementsHash ?? run.fixtureId
    if (seen.has(key)) dup += 1
    else seen.add(key)
  }
  return dup
}

export function countReferenceUsedForModelReliability(certs: FoundryEngineeringCertification[]): number {
  return certs.filter(cert => {
    if (cert.status !== 'RELIABLE') return false
    return (cert.modelDrivenDistinctFixturePassCount ?? 0) < FOUNDRY_GRADUATION_RELIABLE_MIN_DISTINCT_PASSES
      && (cert.referencePassCount ?? 0) > 0
  }).length
}

export function countFalseReliable(certs: FoundryEngineeringCertification[]): number {
  return certs.filter(cert => {
    if (cert.status !== 'RELIABLE') return false
    const modelDistinct = cert.modelDrivenDistinctFixturePassCount ?? 0
    return cert.distinctFixturePassCount < FOUNDRY_GRADUATION_RELIABLE_MIN_DISTINCT_PASSES
      || (typeof cert.modelDrivenDistinctFixturePassCount === 'number' && modelDistinct < FOUNDRY_GRADUATION_RELIABLE_MIN_DISTINCT_PASSES)
  }).length
}

export function countFalseProductionProven(certs: FoundryEngineeringCertification[]): number {
  return certs.filter(cert => cert.status === 'PRODUCTION_PROVEN' && cert.productionEvidenceRefs.length === 0).length
}

export function aggregateGovernance(runs: FoundryGraduationRun[], certs: FoundryEngineeringCertification[]): FoundryGraduationGovernanceCounts {
  const counts = { ...EMPTY_GRADUATION_GOVERNANCE }
  for (const run of runs) {
    for (const key of Object.keys(counts) as (keyof FoundryGraduationGovernanceCounts)[]) {
      if (key === 'FALSE_RELIABLE_CERTIFICATION_COUNT' || key === 'FALSE_PRODUCTION_PROVEN_COUNT') continue
      counts[key] += run.governance[key]
    }
  }
  counts.FALSE_RELIABLE_CERTIFICATION_COUNT = countFalseReliable(certs)
  counts.FALSE_PRODUCTION_PROVEN_COUNT = countFalseProductionProven(certs)
  return counts
}

export function buildEngineeringCapabilitiesView(certs = listCertifications()): FoundryEngineeringCapabilitiesView {
  const byClass = new Map(certs.map(cert => [cert.projectClass, cert]))
  const rows = FOUNDRY_ENGINEERING_PROJECT_CLASSES.map(projectClass => {
    const cert = byClass.get(projectClass)
    const referencePassCount = cert?.referencePassCount ?? 0
    const modelDrivenPassCount = cert?.modelDrivenPassCount ?? 0
    const proofLabel = modelDrivenPassCount > 0 && referencePassCount > 0
      ? 'MIXED'
      : modelDrivenPassCount > 0
        ? 'MODEL DRIVEN VERIFIED'
        : referencePassCount > 0 || (cert?.passCount ?? 0) > 0
          ? 'REFERENCE VERIFIED'
          : 'UNTESTED'
    return {
      projectClass,
      label: FOUNDRY_GRADUATION_CLASS_LABELS[projectClass],
      language: cert?.language ?? 'javascript',
      status: cert?.status ?? 'UNTESTED',
      passCount: cert?.passCount ?? 0,
      attemptCount: cert?.attemptCount ?? 0,
      distinctFixturePassCount: cert?.distinctFixturePassCount ?? 0,
      referencePassCount,
      modelDrivenPassCount,
      modelDrivenDistinctFixturePassCount: cert?.modelDrivenDistinctFixturePassCount ?? 0,
      provenProviders: cert?.provenProviders ?? [],
      provenModels: cert?.provenModels ?? [],
      proofLabel,
    }
  })
  return {
    rows,
    generatedAt: new Date().toISOString(),
    note: 'Factual certification counts only. Not a subjective intelligence score. Not AGI.',
  }
}

export function writeGraduationReport(report: unknown, name = 'FOUNDRY_ENGINEERING_GRADUATION_REPORT.json'): string {
  const dest = path.join(foundryGraduationRoot(), 'reports', name)
  atomicWrite(dest, report)
  return dest
}
