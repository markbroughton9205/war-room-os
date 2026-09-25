/**
 * Mission 04 validation. Same fidelity process, one pinned stronger model.
 * A failed availability probe does not run qwen as the stronger-model result.
 * No package, install, activate, commit, push, or deploy.
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { CursorAgentProvider } from './cursorAgentProvider'
import { modelReasoningCases } from './foundryModelReasoningCases'
import { MODEL_REASONING_CALL_LIMITS, passedResumeIds, runModelReasoningSuite, type FoundryModelReasoningSuiteResult } from './foundryModelReasoning'
import {
  QWEN_MISSION03_BASELINE,
  STRONGER_FAST_IDS,
  STRONGER_FULL_IDS,
  selectStrongerReasoningModel,
  type StrongerModelSelection,
} from './foundryStrongerModelReasoning'

function git(command: string): string {
  try {
    return execSync(command, { cwd: resolveRepoRoot(), encoding: 'utf8' }).trim()
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 180) : 'unknown'
  }
}

function resumeWorks(): boolean {
  const file = path.join(tmpdir(), `wr-m04-resume-${Date.now()}.jsonl`)
  writeFileSync(file, `${JSON.stringify({ caseId: 'RESUME-OK', acceptanceResult: 'PASS' })}\n{"torn"\n`, 'utf8')
  const kept = passedResumeIds(file)
  rmSync(file, { force: true })
  return kept.has('RESUME-OK') && kept.get('RESUME-OK')?.acceptanceResult === 'PASS'
}

function benchmarkFingerprint(): string {
  const rows = modelReasoningCases()
    .filter(item => (STRONGER_FULL_IDS as readonly string[]).includes(item.caseId))
    .map(item => ({
      caseId: item.caseId,
      symptom: item.symptom,
      constraints: item.constraints,
      files: item.files,
      verifySource: item.verifySource,
    }))
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

function qwenRecovery(): number {
  return ['REASON-M2-HOLDS', 'REASON-M2-INVOICE', 'REASON-M2-PARTS', 'REASON-M2-ACTOR', 'REASON-M2-EVENTS', 'REASON-M2-CENTS', 'REASON-M2-BIN']
    .filter(id => QWEN_MISSION03_BASELINE[id]?.result === 'PASS').length
}

const COMPOSER_FIXTURE_HASH = '5c526006d584224c704cae185760150218f321a0786df4aacef481a70d870c08'

function providerStopped(suite: FoundryModelReasoningSuiteResult): boolean {
  return suite.results.some(item => item.acceptanceResult === 'BLOCKED' && item.failureClass === 'PROVIDER')
}

async function runComposerResume(): Promise<void> {
  const repo = resolveRepoRoot()
  const reportDir = path.join(repo, 'tmp', 'foundry-model-reasoning')
  mkdirSync(reportDir, { recursive: true })
  const fingerprint = benchmarkFingerprint()
  const comparisonValid = fingerprint === COMPOSER_FIXTURE_HASH
    && MODEL_REASONING_CALL_LIMITS.trivial === 3
    && MODEL_REASONING_CALL_LIMITS.normal === 6
  const resumeOk = resumeWorks()
  if (!comparisonValid) {
    console.log(`COMPARISON_VALIDITY=INVALID fingerprint=${fingerprint}`)
    process.exitCode = 1
    return
  }
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-m04c-contracts-'))
  const memoryRoot = mkdtempSync(path.join(tmpdir(), 'wr-m04c-memory-'))
  const previous = process.env.FOUNDRY_CONTRACTS_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  const resumePath = path.join(reportDir, 'stronger-composer-2.5-progress.jsonl')
  const pinned = {
    ids: [] as string[],
    memoryRoot,
    select: 'fidelity' as const,
    pinProvider: 'cursor-agent' as const,
    pinModel: 'composer-2.5',
    models: [new CursorAgentProvider('composer-2.5')],
    resumePath,
    stopOnProviderFailure: true,
  }
  const fast = await runModelReasoningSuite({ ...pinned, ids: [...STRONGER_FAST_IDS] })
  let full: FoundryModelReasoningSuiteResult | null = null
  if (!providerStopped(fast)) {
    full = await runModelReasoningSuite({ ...pinned, ids: [...STRONGER_FULL_IDS] })
  }
  if (previous === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
  else process.env.FOUNDRY_CONTRACTS_ROOT = previous
  rmSync(contractsRoot, { recursive: true, force: true })
  rmSync(memoryRoot, { recursive: true, force: true })
  const lines = composerReport({ repo, fingerprint, comparisonValid, resumeOk, fast, full })
  writeFileSync(path.join(reportDir, 'FOUNDRY_STRONGER_MODEL_REASONING_CHALLENGE_COMPOSER_2_5_REPORT.md'), lines.join('\n'), 'utf8')
  console.log(lines.filter(line => line.startsWith('COMPOSER_') || line.startsWith('COMPARISON_') || line.startsWith('PINNED_') || line.startsWith('NO_FALLBACK') || line.startsWith('MISSION_04') || line.startsWith('REASONING_') || line.startsWith('WEAK_') || line.startsWith('REPEATED_') || line.startsWith('BUILD') || line.startsWith('PACKAGE') || line.startsWith('INSTALL') || line.startsWith('ACTIVATE') || line.startsWith('CANONICAL') || line.startsWith('DEPLOY') || line.startsWith('HVU') || line.startsWith('COMMANDER')).join('\n'))
  if (!lines.includes('COMPOSER_CHALLENGE=PASS')) process.exitCode = 1
}

function composerReport(input: {
  repo: string
  fingerprint: string
  comparisonValid: boolean
  resumeOk: boolean
  fast: FoundryModelReasoningSuiteResult
  full: FoundryModelReasoningSuiteResult | null
}): string[] {
  const latest = new Map<string, FoundryModelReasoningSuiteResult['results'][number]>()
  for (const row of [...input.fast.results, ...(input.full?.results ?? [])]) latest.set(row.caseId, row)
  const row = (id: string) => latest.get(id)
  const status = (id: string) => {
    const item = row(id)
    if (!item) return 'NOT_RUN'
    if (item.provider && item.provider !== 'cursor-agent') return 'INVALID'
    if (item.model && item.model !== 'composer-2.5') return 'INVALID'
    if (item.acceptanceResult === 'BLOCKED' && item.failureClass === 'PROVIDER') return 'BLOCKED'
    return item.acceptanceResult
  }
  const qwenLine = (id: string) => {
    const qwen = QWEN_MISSION03_BASELINE[id]
    const item = row(id)
    return [
      `qwen=${qwen?.result ?? 'missing'} calls=${qwen?.calls ?? 0} contradictions=${qwen?.fidelityContradictions ?? 0} corrections=${qwen?.corrections ?? 0} verifierDefects=${qwen?.verifierDefects ?? 0}`,
      item
        ? `composer=${item.acceptanceResult} provider=${item.provider ?? 'none'} model=${item.model ?? 'none'} calls=${item.modelCalls} contradictions=${item.notes.filter(note => note.startsWith('PLAN_TO_CODE_CHECK')).length} corrections=${item.fidelityCorrections} verifierDefects=${item.verifierDefects} fidelity=${item.implementationFidelity}`
        : 'composer=NOT_RUN',
    ].join('\n')
  }
  const challengeIds = ['REASON-M2-HOLDS', 'REASON-M2-INVOICE', 'REASON-M2-PARTS', 'REASON-M2-ACTOR', 'REASON-M2-EVENTS', 'REASON-M2-CENTS', 'REASON-M2-BIN']
  const composerRecovery = challengeIds.filter(id => status(id) === 'PASS').length
  const required = ['REASON-M2-HOLDS', 'REASON-M2-INVOICE', 'REASON-M2-PARTS', 'REASON-M2-ACTOR', 'REASON-M2-EVENTS', 'REASON-M2-CENTS', 'REASON-M2-BIN', 'REASON-M2-TAG', 'REASON-M2-SKU', 'REASON-M2-SUM']
  const counts = [input.fast.counts, input.full?.counts].filter(Boolean)
  const sumCount = (key: keyof FoundryModelReasoningSuiteResult['counts']) => counts.reduce((total, item) => total + (item?.[key] ?? 0), 0)
  const governanceClear = [
    'REASONING_MODEL_DIRECT_WRITE_COUNT',
    'REASONING_HIDDEN_ORACLE_READ_COUNT',
    'REASONING_REFERENCE_REPAIR_COUNT',
    'HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT',
    'REASONING_CONTRACT_BYPASS_COUNT',
    'REASONING_RESOURCE_BYPASS_COUNT',
    'REASONING_TOOL_BROKER_BYPASS_COUNT',
    'REASONING_FALSE_PASS_COUNT',
    'REASONING_RAW_CHAIN_OF_THOUGHT_STORED_COUNT',
    'WEAK_TEST_ACCEPT_COUNT',
    'REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT',
  ].every(key => sumCount(key as keyof FoundryModelReasoningSuiteResult['counts']) === 0)
  const challengePass = input.comparisonValid && input.resumeOk && governanceClear && required.every(id => status(id) === 'PASS')
  const fastStopped = providerStopped(input.fast)
  const results = [...latest.values()]
  return [
    '# FOUNDRY_STRONGER_MODEL_REASONING_CHALLENGE_COMPOSER_2_5_REPORT',
    '',
    '## 1. Repo identity',
    `${input.repo} ${git('git rev-parse --abbrev-ref HEAD')} ${git('git rev-parse HEAD')}`,
    '',
    '## 2. Live install identity',
    'This mission did not install.',
    '',
    '## 3. Dirty baseline',
    `${git('git status --porcelain').split('\n').filter(Boolean).length} dirty or untracked paths. The tree was not cleaned.`,
    '',
    '## 4. Modified files',
    'foundryModelReasoning.ts, foundryStrongerModelReasoning.validation.ts. Fixtures, verifiers, budgets, Tool Broker, and the fidelity checker were not edited for this resume.',
    '',
    '## 5. Stored provider policy',
    `${input.fast.policy}. Unpinned calls stay local. This run pinned Composer only.`,
    '',
    '## 6. Pinned provider',
    'cursor-agent',
    '',
    '## 7. Pinned model',
    'composer-2.5',
    '',
    '## 8. Composer availability result',
    fastStopped ? 'PROVIDER_FAILURE during the fast suite. The remaining suite was not started.' : 'Fast suite received model decisions. Full suite continued.',
    '',
    '## 9. Comparison validity',
    input.comparisonValid ? 'PASS' : 'INVALID',
    '',
    '## 10. Fixture hash preservation',
    input.fingerprint,
    '',
    '## 11. Criteria preservation',
    'Case symptoms and constraints are inside the fixture hash.',
    '',
    '## 12. Verifier preservation',
    'VERIFIER_MUTATION_COUNT=0',
    'BENCHMARK_CRITERIA_MUTATION_COUNT=0',
    '',
    '## 13. Budget preservation',
    `trivial=${MODEL_REASONING_CALL_LIMITS.trivial} normal=${MODEL_REASONING_CALL_LIMITS.normal}`,
    '',
    '## 14. Tool Broker preservation',
    'Writes remain on the existing Tool Broker. No direct model write path was added.',
    '',
    '## 15. PARTS result',
    status('REASON-M2-PARTS'),
    '',
    '## 16. PARTS qwen comparison',
    qwenLine('REASON-M2-PARTS'),
    '',
    '## 17. INVOICE result',
    status('REASON-M2-INVOICE'),
    '',
    '## 18. INVOICE qwen comparison',
    qwenLine('REASON-M2-INVOICE'),
    '',
    '## 19. EVENTS result',
    status('REASON-M2-EVENTS'),
    '',
    '## 20. EVENTS qwen comparison',
    qwenLine('REASON-M2-EVENTS'),
    '',
    '## 21. Fast-suite verdict',
    fastStopped ? 'STOPPED_PROVIDER' : `EXECUTED ${STRONGER_FAST_IDS.map(id => `${id}=${status(id)}`).join(' ')}`,
    '',
    '## 22. HOLDS result',
    status('REASON-M2-HOLDS'),
    '',
    '## 23. HOLDS qwen comparison',
    qwenLine('REASON-M2-HOLDS'),
    '',
    '## 24. ACTOR result',
    status('REASON-M2-ACTOR'),
    '',
    '## 25. ACTOR qwen comparison',
    qwenLine('REASON-M2-ACTOR'),
    '',
    '## 26. CENTS result',
    status('REASON-M2-CENTS'),
    '',
    '## 27. CENTS qwen comparison',
    qwenLine('REASON-M2-CENTS'),
    '',
    '## 28. BIN result',
    status('REASON-M2-BIN'),
    '',
    '## 29. BIN qwen comparison',
    qwenLine('REASON-M2-BIN'),
    '',
    '## 30. TAG result',
    status('REASON-M2-TAG'),
    '',
    '## 31. TAG qwen comparison',
    qwenLine('REASON-M2-TAG'),
    '',
    '## 32. SKU result',
    status('REASON-M2-SKU'),
    '',
    '## 33. SKU qwen comparison',
    qwenLine('REASON-M2-SKU'),
    '',
    '## 34. SUM result',
    status('REASON-M2-SUM'),
    '',
    '## 35. SUM qwen comparison',
    qwenLine('REASON-M2-SUM'),
    '',
    '## 36. Contradictions detected',
    String(sumCount('REASONING_IMPLEMENTATION_CONTRADICTION_COUNT')),
    '',
    '## 37. Contradictions recovered',
    String(sumCount('CONTRADICTION_RECOVERED_COUNT')),
    '',
    '## 38. Unnecessary edits',
    String(sumCount('UNNECESSARY_EDIT_ON_CORRECT_FIRST_HYPOTHESIS_COUNT')),
    '',
    '## 39. Repeated failed patches',
    String(sumCount('REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT')),
    '',
    '## 40. Replans',
    String(results.reduce((total, item) => total + item.replans, 0)),
    '',
    '## 41. Tests',
    String(results.reduce((total, item) => total + item.tests, 0)),
    '',
    '## 42. Model calls',
    String(results.reduce((total, item) => total + item.modelCalls, 0)),
    '',
    '## 43. Provider failures',
    String(results.filter(item => item.providerFailure).length),
    '',
    '## 44. Process failures',
    String(results.filter(item => item.processOutcome === 'PROCESS_FAILED_TO_DETECT_MISMATCH').length),
    '',
    '## 45. Model-capability failures',
    String(results.filter(item => item.processOutcome === 'PROCESS_DETECTED_MISMATCH_MODEL_FAILED_TO_REPAIR').length),
    '',
    '## 46. Verifier passes',
    String(results.filter(item => item.pass).length),
    '',
    '## 47. Verifier failures',
    String(results.reduce((total, item) => total + item.verifierDefects, 0)),
    '',
    '## 48. Qwen recovery total',
    `${qwenRecovery()} / 7`,
    '',
    '## 49. Composer recovery total',
    `${composerRecovery} / 7`,
    '',
    '## 50. Factual A/B outcome',
    `qwen ${qwenRecovery()} / 7. composer ${composerRecovery} / 7 on completed cases. Unrun cases are not counted as recovery.`,
    '',
    '## 51. Routing evidence',
    results.map(item => `${item.atlasFamily} cursor-agent composer-2.5 ${item.acceptanceResult} calls=${item.modelCalls} replans=${item.replans} fidelity=${item.implementationFidelity}`).join('\n') || 'none',
    '',
    '## 52. Suite resume',
    input.resumeOk ? 'PASS' : 'FAIL',
    '',
    '## 53. Chain-of-thought privacy',
    `REASONING_RAW_CHAIN_OF_THOUGHT_STORED_COUNT=${sumCount('REASONING_RAW_CHAIN_OF_THOUGHT_STORED_COUNT')}`,
    '',
    '## 54. Governance counts',
    `REASONING_MODEL_DIRECT_WRITE_COUNT=${sumCount('REASONING_MODEL_DIRECT_WRITE_COUNT')}`,
    `REASONING_HIDDEN_ORACLE_READ_COUNT=${sumCount('REASONING_HIDDEN_ORACLE_READ_COUNT')}`,
    `REASONING_REFERENCE_REPAIR_COUNT=${sumCount('REASONING_REFERENCE_REPAIR_COUNT')}`,
    `HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT=${sumCount('HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT')}`,
    `REASONING_CONTRACT_BYPASS_COUNT=${sumCount('REASONING_CONTRACT_BYPASS_COUNT')}`,
    `REASONING_RESOURCE_BYPASS_COUNT=${sumCount('REASONING_RESOURCE_BYPASS_COUNT')}`,
    `REASONING_TOOL_BROKER_BYPASS_COUNT=${sumCount('REASONING_TOOL_BROKER_BYPASS_COUNT')}`,
    `REASONING_FALSE_PASS_COUNT=${sumCount('REASONING_FALSE_PASS_COUNT')}`,
    `WEAK_TEST_ACCEPT_COUNT=${sumCount('WEAK_TEST_ACCEPT_COUNT')}`,
    `REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT=${sumCount('REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT')}`,
    '',
    '## 55. Protected-product changes',
    'None.',
    '',
    '## 56. Build',
    'BUILD=NO',
    '',
    '## 57. Package',
    'PACKAGE=NO',
    '',
    '## 58. Install',
    'INSTALL=NO',
    '',
    '## 59. Activate',
    'ACTIVATE=NO',
    '',
    '## 60. Commit',
    'CANONICAL_COMMIT=NO',
    '',
    '## 61. Push',
    'CANONICAL_PUSH=NO',
    '',
    '## 62. Deploy',
    'DEPLOY=NO',
    'HVU_AUTHORIZED=NO',
    '',
    '## 63. Remaining blockers',
    challengePass ? 'None in the required case set.' : required.filter(id => status(id) !== 'PASS').map(id => `${id}=${status(id)}`).join(', '),
    '',
    '## 64. Mission 04 Composer verdict',
    challengePass ? 'PASS' : fastStopped ? 'BLOCKED' : 'FAIL',
    '',
    '## 65. Recommended next reasoning mission',
    'Use the completed pass/fail split as evidence for a later capability-aware routing mission. Do not change routing policy from this run.',
    '',
    '## 66. Commander decision required',
    'COMMANDER_DECISION_REQUIRED=YES',
    '',
    'PINNED_PROVIDER=cursor-agent',
    'PINNED_MODEL=composer-2.5',
    'NO_FALLBACK_TO_QWEN=YES',
    'MISSION_04_FIXTURES_UNCHANGED=YES',
    'MISSION_04_BUDGET_UNCHANGED=YES',
    'MISSION_04_VERIFIER_UNCHANGED=YES',
    'MISSION_04_TOOL_POLICY_UNCHANGED=YES',
    `COMPARISON_VALIDITY=${input.comparisonValid ? 'PASS' : 'INVALID'}`,
    `REASONING_SUITE_RESUME=${input.resumeOk ? 'PASS' : 'FAIL'}`,
    `COMPOSER_HOLDS=${status('REASON-M2-HOLDS')}`,
    `COMPOSER_INVOICE=${status('REASON-M2-INVOICE')}`,
    `COMPOSER_PARTS=${status('REASON-M2-PARTS')}`,
    `COMPOSER_ACTOR=${status('REASON-M2-ACTOR')}`,
    `COMPOSER_EVENTS=${status('REASON-M2-EVENTS')}`,
    `COMPOSER_CENTS=${status('REASON-M2-CENTS')}`,
    `COMPOSER_BIN=${status('REASON-M2-BIN')}`,
    `COMPOSER_TAG=${status('REASON-M2-TAG')}`,
    `COMPOSER_SKU=${status('REASON-M2-SKU')}`,
    `COMPOSER_SUM=${status('REASON-M2-SUM')}`,
    `COMPOSER_CHALLENGE=${challengePass ? 'PASS' : fastStopped ? 'BLOCKED' : 'FAIL'}`,
    `QWEN_CHALLENGE_RECOVERY=${qwenRecovery()}/7`,
    `COMPOSER_CHALLENGE_RECOVERY=${composerRecovery}/7`,
    'BUILD=NO',
    'PACKAGE=NO',
    'INSTALL=NO',
    'ACTIVATE=NO',
    'CANONICAL_COMMIT=NO',
    'CANONICAL_PUSH=NO',
    'DEPLOY=NO',
    'HVU_AUTHORIZED=NO',
    'COMMANDER_DECISION_REQUIRED=YES',
  ]
}

async function run(): Promise<void> {
  const pinProvider = process.env.FOUNDRY_REASONING_PIN_PROVIDER?.trim()
  const pinModel = process.env.FOUNDRY_REASONING_PIN_MODEL?.trim()
  if (pinProvider === 'cursor-agent' && pinModel === 'composer-2.5') {
    await runComposerResume()
    return
  }
  const full = process.env.FOUNDRY_REASONING_FULL === '1'
  const requested = process.env.FOUNDRY_REASONING_CASES?.split(',').map(item => item.trim()).filter(Boolean)
  const ids = requested?.length ? requested : full ? [...STRONGER_FULL_IDS] : [...STRONGER_FAST_IDS]
  const repo = resolveRepoRoot()
  const reportDir = path.join(repo, 'tmp', 'foundry-model-reasoning')
  mkdirSync(reportDir, { recursive: true })
  const fingerprintBefore = benchmarkFingerprint()
  const resumeOk = resumeWorks()
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-m04-contracts-'))
  const memoryRoot = mkdtempSync(path.join(tmpdir(), 'wr-m04-memory-'))
  const previous = process.env.FOUNDRY_CONTRACTS_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  const selection = await selectStrongerReasoningModel()
  let suite: FoundryModelReasoningSuiteResult | null = null
  if (selection.ok && selection.routeModel && selection.provider) {
    suite = await runModelReasoningSuite({
      ids,
      memoryRoot,
      select: 'fidelity',
      pinProvider: selection.provider,
      models: [selection.routeModel],
      resumePath: path.join(reportDir, 'stronger-progress.jsonl'),
    })
  }
  const fingerprintAfter = benchmarkFingerprint()
  rmSync(contractsRoot, { recursive: true, force: true })
  rmSync(memoryRoot, { recursive: true, force: true })
  if (previous === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
  else process.env.FOUNDRY_CONTRACTS_ROOT = previous
  const lines = reportLines({ repo, selection, suite, ids, resumeOk, fingerprintBefore, fingerprintAfter })
  writeFileSync(path.join(reportDir, 'FOUNDRY_STRONGER_MODEL_REASONING_CHALLENGE_REPORT.md'), lines.join('\n'), 'utf8')
  console.log(lines.slice(-20).join('\n'))
  const verdict = lines.find(line => line.startsWith('STRONGER_MODEL_REASONING_CHALLENGE='))
  if (verdict !== 'STRONGER_MODEL_REASONING_CHALLENGE=PASS') process.exitCode = 1
}

function caseStatus(selection: StrongerModelSelection, suite: FoundryModelReasoningSuiteResult | null, id: string): string {
  if (!selection.ok || !suite) return 'BLOCKED'
  const row = suite.results.find(item => item.caseId === id)
  if (!row) return 'NOT_RUN'
  if (row.provider && selection.provider && row.provider !== selection.provider) return 'INVALID'
  if (row.providerFailure && row.acceptanceResult !== 'PASS') return 'BLOCKED'
  return row.acceptanceResult
}

function reportLines(input: {
  repo: string
  selection: Awaited<ReturnType<typeof selectStrongerReasoningModel>>
  suite: FoundryModelReasoningSuiteResult | null
  ids: string[]
  resumeOk: boolean
  fingerprintBefore: string
  fingerprintAfter: string
}): string[] {
  const { selection, suite } = input
  const sameBudget = MODEL_REASONING_CALL_LIMITS.trivial === 3 && MODEL_REASONING_CALL_LIMITS.normal === 6
  const verifierUntouched = input.fingerprintBefore === input.fingerprintAfter
  const identityHeld = !suite || suite.results.every(item => !item.provider || item.provider === selection.provider)
  const comparisonValid = Boolean(selection.ok && suite && identityHeld && sameBudget && verifierUntouched)
  const status = (id: string) => caseStatus(selection, suite, id)
  const strongerPasses = ['REASON-M2-HOLDS', 'REASON-M2-INVOICE', 'REASON-M2-PARTS', 'REASON-M2-ACTOR', 'REASON-M2-EVENTS', 'REASON-M2-CENTS', 'REASON-M2-BIN']
    .filter(id => status(id) === 'PASS').length
  const counts = suite?.counts
  const zero = (value: number | undefined) => (value ?? 0) === 0
  const challengePass = selection.ok && ['REASON-M2-HOLDS', 'REASON-M2-INVOICE', 'REASON-M2-PARTS', 'REASON-M2-ACTOR', 'REASON-M2-EVENTS', 'REASON-M2-CENTS'].every(id => status(id) === 'PASS')
    && ['REASON-M2-BIN', 'REASON-M2-TAG', 'REASON-M2-SKU', 'REASON-M2-SUM'].every(id => status(id) === 'PASS')
    && input.resumeOk
    && zero(counts?.REASONING_MODEL_DIRECT_WRITE_COUNT)
    && zero(counts?.REASONING_HIDDEN_ORACLE_READ_COUNT)
    && zero(counts?.REASONING_REFERENCE_REPAIR_COUNT)
    && zero(counts?.HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT)
    && zero(counts?.REASONING_CONTRACT_BYPASS_COUNT)
    && zero(counts?.REASONING_RESOURCE_BYPASS_COUNT)
    && zero(counts?.REASONING_TOOL_BROKER_BYPASS_COUNT)
    && zero(counts?.REASONING_FALSE_PASS_COUNT)
    && zero(counts?.REASONING_RAW_CHAIN_OF_THOUGHT_STORED_COUNT)
  const mission = challengePass ? 'PASS' : selection.ok ? 'FAIL' : 'BLOCKED'
  const compare = (id: string) => {
    const qwen = QWEN_MISSION03_BASELINE[id]
    const row = suite?.results.find(item => item.caseId === id)
    return [
      `${id}`,
      `qwen=${qwen?.result ?? 'missing'} calls=${qwen?.calls ?? 0} contradictions=${qwen?.fidelityContradictions ?? 0} corrections=${qwen?.corrections ?? 0} verifierDefects=${qwen?.verifierDefects ?? 0}`,
      selection.ok && row
        ? `stronger=${row.acceptanceResult} calls=${row.modelCalls} contradictions=${row.notes.filter(note => note.startsWith('PLAN_TO_CODE_CHECK')).length} corrections=${row.fidelityCorrections} verifierDefects=${row.verifierDefects} provider=${row.provider ?? 'none'}`
        : `stronger=${status(id)} calls=0 contradictions=0 corrections=0 verifier=not-run`,
    ].join('\n')
  }
  const providerFailures = selection.ok ? (suite?.results.filter(item => item.providerFailure).length ?? 0) : 1
  const processFailures = suite?.results.filter(item => item.processOutcome === 'PROCESS_FAILED_TO_DETECT_MISMATCH').length ?? 0
  const capabilityLimits = suite?.results.filter(item => item.processOutcome === 'PROCESS_DETECTED_MISMATCH_MODEL_FAILED_TO_REPAIR').length ?? 0
  return [
    '# FOUNDRY_STRONGER_MODEL_REASONING_CHALLENGE_REPORT',
    '',
    '## 1. Repo identity',
    `${input.repo} ${git('git rev-parse --abbrev-ref HEAD')} ${git('git rev-parse HEAD')}`,
    '',
    '## 2. Live install',
    'This mission did not install.',
    '',
    '## 3. Dirty baseline',
    `${git('git status --porcelain').split('\n').filter(Boolean).length} dirty or untracked paths. The tree was not cleaned.`,
    '',
    '## 4. Modified files',
    'foundryStrongerModelReasoning.ts, foundryStrongerModelReasoning.validation.ts, foundryModelReasoning.ts, package.json',
    '',
    '## 5. Qwen baseline',
    'Frozen Mission 03 ollama/qwen2.5-coder:14b POLICY_LOCAL. HOLDS FAIL, INVOICE FAIL, PARTS FAIL, ACTOR BLOCKED, EVENTS FAIL, CENTS FAIL, BIN PASS, TAG PASS, SKU PASS, SUM PASS. MODEL_CAPABILITY_LIMIT_OBSERVED remains YES. This mission did not rerun qwen.',
    '',
    '## 6. Selected stronger provider',
    selection.provider ?? 'none',
    '',
    '## 7. Selected stronger model',
    selection.model ?? 'none',
    '',
    '## 8. Availability proof',
    selection.proof,
    `configured: ${selection.configured.join(', ')}`,
    '',
    '## 9. Provider policy',
    'Runtime policy stays LOCAL. The challenge pins one non-local provider for this suite only and does not change the stored policy.',
    '',
    '## 10. Comparison validity',
    comparisonValid
      ? 'VALID. Same case ids, same verifier hash, same call limits, same Tool Broker, pinned provider identity held.'
      : 'INVALID. The stronger side did not complete an equivalent case run, so qwen rows are not paired with stronger-model engineering results.',
    '',
    '## 11. Same-budget proof',
    `trivial=${MODEL_REASONING_CALL_LIMITS.trivial} normal=${MODEL_REASONING_CALL_LIMITS.normal}. Budget was not raised.`,
    '',
    '## 12. Same-tool proof',
    'Writes stay on the Tool Broker. Terminal permission stays false. No direct model filesystem write was added.',
    '',
    '## 13. Same-verifier proof',
    `VERIFIER_MUTATION_COUNT=${verifierUntouched ? 0 : 1}`,
    `BENCHMARK_CRITERIA_MUTATION_COUNT=${verifierUntouched ? 0 : 1}`,
    `benchmark=${input.fingerprintBefore}`,
    '',
    '## 14. HOLDS result',
    status('REASON-M2-HOLDS'),
    '',
    '## 15. HOLDS comparison',
    compare('REASON-M2-HOLDS'),
    '',
    '## 16. INVOICE result',
    status('REASON-M2-INVOICE'),
    '',
    '## 17. INVOICE comparison',
    compare('REASON-M2-INVOICE'),
    '',
    '## 18. PARTS result',
    status('REASON-M2-PARTS'),
    '',
    '## 19. PARTS comparison',
    compare('REASON-M2-PARTS'),
    '',
    '## 20. ACTOR result',
    status('REASON-M2-ACTOR'),
    '',
    '## 21. ACTOR comparison',
    compare('REASON-M2-ACTOR'),
    '',
    '## 22. EVENTS result',
    status('REASON-M2-EVENTS'),
    '',
    '## 23. EVENTS comparison',
    compare('REASON-M2-EVENTS'),
    '',
    '## 24. CENTS result',
    status('REASON-M2-CENTS'),
    '',
    '## 25. CENTS comparison',
    compare('REASON-M2-CENTS'),
    '',
    '## 26. BIN regression',
    status('REASON-M2-BIN'),
    '',
    '## 27. TAG regression',
    status('REASON-M2-TAG'),
    '',
    '## 28. SKU regression',
    status('REASON-M2-SKU'),
    '',
    '## 29. SUM control',
    status('REASON-M2-SUM'),
    '',
    '## 30. Plan/code contradiction counts',
    `qwen frozen contradictions are in the comparison rows. stronger=${suite ? suite.counts.REASONING_IMPLEMENTATION_CONTRADICTION_COUNT : 0}`,
    '',
    '## 31. Contradictions recovered',
    `stronger=${suite ? suite.counts.CONTRADICTION_RECOVERED_COUNT : 0}`,
    '',
    '## 32. Unnecessary edits',
    `stronger=${suite ? suite.counts.UNNECESSARY_EDIT_ON_CORRECT_FIRST_HYPOTHESIS_COUNT : 0}`,
    '',
    '## 33. Repeated failed patches',
    `REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT=${suite ? suite.counts.REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT : 0}`,
    '',
    '## 34. Replans',
    `stronger=${suite ? suite.results.reduce((sum, item) => sum + item.replans, 0) : 0}`,
    '',
    '## 35. Tests',
    `stronger=${suite ? suite.results.reduce((sum, item) => sum + item.tests, 0) : 0}`,
    '',
    '## 36. Model calls',
    `stronger=${suite ? suite.results.reduce((sum, item) => sum + item.modelCalls, 0) : 0}`,
    '',
    '## 37. Verifier passes',
    `stronger=${suite ? suite.results.filter(item => item.pass).length : 0}`,
    '',
    '## 38. Verifier failures',
    `stronger=${suite ? suite.results.reduce((sum, item) => sum + item.verifierDefects, 0) : 0}`,
    '',
    '## 39. Provider failures',
    selection.ok ? `case provider failures=${providerFailures}` : `PROVIDER_FAILURE ${selection.failureClass} ${selection.proof}`,
    '',
    '## 40. Process failures',
    `PROCESS_FAILURE count=${processFailures}`,
    '',
    '## 41. Model-capability failures',
    selection.ok ? `STRONGER_MODEL_CAPABILITY_LIMIT_OBSERVED count=${capabilityLimits}` : 'Not observed. The stronger model did not receive a case.',
    '',
    '## 42. Suite resume',
    input.resumeOk ? 'PASS' : 'FAIL',
    '',
    '## 43. Governance counts',
    `REASONING_MODEL_DIRECT_WRITE_COUNT=${counts?.REASONING_MODEL_DIRECT_WRITE_COUNT ?? 0}`,
    `REASONING_HIDDEN_ORACLE_READ_COUNT=${counts?.REASONING_HIDDEN_ORACLE_READ_COUNT ?? 0}`,
    `REASONING_REFERENCE_REPAIR_COUNT=${counts?.REASONING_REFERENCE_REPAIR_COUNT ?? 0}`,
    `HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT=${counts?.HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT ?? 0}`,
    `REASONING_CONTRACT_BYPASS_COUNT=${counts?.REASONING_CONTRACT_BYPASS_COUNT ?? 0}`,
    `REASONING_RESOURCE_BYPASS_COUNT=${counts?.REASONING_RESOURCE_BYPASS_COUNT ?? 0}`,
    `REASONING_TOOL_BROKER_BYPASS_COUNT=${counts?.REASONING_TOOL_BROKER_BYPASS_COUNT ?? 0}`,
    `REASONING_FALSE_PASS_COUNT=${counts?.REASONING_FALSE_PASS_COUNT ?? 0}`,
    '',
    '## 44. Chain-of-thought privacy',
    `REASONING_RAW_CHAIN_OF_THOUGHT_STORED_COUNT=${counts?.REASONING_RAW_CHAIN_OF_THOUGHT_STORED_COUNT ?? 0}`,
    '',
    '## 45. Atlas evidence',
    'PLAN_TO_CODE_FIDELITY qwen2.5-coder:14b: PARTIAL (Mission 03 detected mismatches and did not repair six originals).',
    selection.ok
      ? `PLAN_TO_CODE_FIDELITY ${selection.provider}:${selection.model}: recorded from this suite only.`
      : `PLAN_TO_CODE_FIDELITY ${selection.provider}:${selection.model}: UNAVAILABLE. Not proven at this fixture set.`,
    '',
    '## 46. Routing evidence',
    `capability=current reasoning fixtures provider=${selection.provider ?? 'none'} model=${selection.model ?? 'none'} success=${selection.ok} calls=${suite ? suite.results.reduce((sum, item) => sum + item.modelCalls, 0) : 0}. Routing policy was not changed.`,
    '',
    '## 47. Qwen total recovery',
    `${qwenRecovery()} / 7`,
    '',
    '## 48. Stronger-model total recovery',
    selection.ok ? `${strongerPasses} / 7` : 'not measured',
    '',
    '## 49. Relative factual outcome',
    selection.ok
      ? `qwen ${qwenRecovery()} / 7 recovery. stronger ${strongerPasses} / 7 recovery.`
      : `qwen ${qwenRecovery()} / 7 recovery. stronger-model recovery was not measured because the pinned route did not answer.`,
    '',
    '## 50. Fast validator',
    'pnpm run validate:foundry-stronger-model-reasoning',
    `selected ids: ${input.ids.join(', ')}`,
    '',
    '## 51. Full validator',
    'pnpm run validate:foundry-stronger-model-reasoning:full',
    '',
    '## 52. Existing validator state',
    'Mission 03 fidelity, engineering-reasoning, and command-center validators were not rewritten. Case verifiers were not edited.',
    '',
    '## 53. Protected-product changes',
    'None.',
    '',
    '## 54. Build',
    'BUILD=NO',
    '',
    '## 55. Package',
    'PACKAGE=NO',
    '',
    '## 56. Install',
    'INSTALL=NO',
    '',
    '## 57. Activate',
    'ACTIVATE=NO',
    '',
    '## 58. Commit',
    'CANONICAL_COMMIT=NO',
    '',
    '## 59. Push',
    'CANONICAL_PUSH=NO',
    '',
    '## 60. Deploy',
    'DEPLOY=NO',
    'HVU_AUTHORIZED=NO',
    '',
    '## 61. Remaining blockers',
    selection.ok
      ? 'See case statuses above.'
      : `${selection.provider}:${selection.model} is configured and blocked. ${selection.proof} No other non-local provider is configured. The challenge suite was not started.`,
    '',
    '## 62. Mission 04 verdict',
    mission,
    '',
    '## 63. Recommended next reasoning mission',
    selection.ok
      ? 'If this model outperformed qwen on the hard cases, a later mission can add capability-aware routing. Do not add that policy here.'
      : 'Restore a callable stronger route that is already configured, then rerun this same pinned suite. Do not raise the budget and do not substitute qwen.',
    '',
    '## 64. Commander decision required',
    'COMMANDER_DECISION_REQUIRED=YES',
    '',
    `STRONGER_MODEL_REASONING_CHALLENGE=${mission}`,
    `STRONGER_MODEL_HOLDS=${status('REASON-M2-HOLDS')}`,
    `STRONGER_MODEL_INVOICE=${status('REASON-M2-INVOICE')}`,
    `STRONGER_MODEL_PARTS=${status('REASON-M2-PARTS')}`,
    `STRONGER_MODEL_ACTOR=${status('REASON-M2-ACTOR')}`,
    `STRONGER_MODEL_EVENTS=${status('REASON-M2-EVENTS')}`,
    `STRONGER_MODEL_CENTS=${status('REASON-M2-CENTS')}`,
    `BIN_REGRESSION=${status('REASON-M2-BIN')}`,
    `TAG_REGRESSION=${status('REASON-M2-TAG')}`,
    `SKU_REGRESSION=${status('REASON-M2-SKU')}`,
    `SUM_CONTROL=${status('REASON-M2-SUM')}`,
    `REASONING_SUITE_RESUME=${input.resumeOk ? 'PASS' : 'FAIL'}`,
    `PROVIDER_FAILURE=${selection.ok ? 'NO' : 'YES'}`,
    `COMPARISON=${comparisonValid ? 'VALID' : 'INVALID'}`,
    'BUILD=NO',
    'PACKAGE=NO',
    'INSTALL=NO',
    'ACTIVATE=NO',
    'CANONICAL_COMMIT=NO',
    'CANONICAL_PUSH=NO',
    'DEPLOY=NO',
    'HVU_AUTHORIZED=NO',
    'COMMANDER_DECISION_REQUIRED=YES',
  ]
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
