/**
 * Root-cause binding audit plus recovery of the four previously failed cases.
 * Same local route, same call ceiling, same hidden verifiers. No known-repair text.
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { selectNextCapabilityTask } from './foundryEngineeringReasoning'
import { MODEL_REASONING_CALL_LIMITS, runModelReasoningSuite, type FoundryModelReasoningCaseResult } from './foundryModelReasoning'
import { modelReasoningCases } from './foundryModelReasoningCases'
import {
  bindRootCauseClaim,
  correctedClaimFromPublicEvidence,
  type FoundryRootCauseClaim,
  type RootCauseStatus,
} from './foundryRootCauseBinding'

const PRIOR_IDS = ['REASON-M2-INVOICE', 'REASON-M2-PARTS', 'REASON-M2-ACTOR', 'REASON-M2-TAG', 'REASON-M2-SKU', 'REASON-M2-SUM'] as const
const FULL_RECOVERY_IDS = ['REASON-M2-HOLDS', 'REASON-M2-EVENTS', 'REASON-M2-CENTS', 'REASON-M2-BIN'] as const
const FAST_RECOVERY_IDS = ['REASON-M2-HOLDS', 'REASON-M2-EVENTS'] as const
const ROUTE = { provider: 'ollama', model: 'qwen2.5-coder:14b' } as const

type StoredCase = {
  caseId: string
  trivial?: boolean
  pass?: boolean
  acceptanceResult?: string
  planToCodeStatus?: string | null
  implementationFidelity?: string | null
  modelCalls?: number
  firstHypothesisCorrect?: boolean
  badHypothesisRecovered?: boolean
  postEditInspections?: number
  verifierDefects?: number
  replans?: number
  repeatedErrors?: number
  provider?: string | null
  model?: string | null
  routingReason?: string | null
  fallback?: boolean
  dossier?: { rootCause?: string; problemModel?: string; selectedApproach?: string }
  notes?: string[]
  processOutcome?: string
  failureGapCategory?: string | null
}

function git(command: string): string {
  try {
    return execSync(command, { cwd: resolveRepoRoot(), encoding: 'utf8' }).trim()
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 200) : 'unknown'
  }
}

function liveInstallId(): string {
  try {
    const text = readFileSync('/home/chosenone/.local/bin/war-room-os-user', 'utf8')
    const match = text.match(/war-room-os-[A-Za-z0-9._-]+/)
    return match?.[0] ?? 'launcher present, install id not parsed'
  } catch {
    return 'launcher not read'
  }
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function loadPrior(): StoredCase[] {
  const file = path.join(resolveRepoRoot(), 'tmp', 'foundry-model-reasoning', 'suite.json')
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { results?: StoredCase[] }
  return parsed.results ?? []
}

function auditPrior(stored: StoredCase[], caseId: string): { claim: FoundryRootCauseClaim; corrected: FoundryRootCauseClaim | null; stored: StoredCase | null } {
  const fixture = modelReasoningCases().find(item => item.caseId === caseId)
  const row = stored.find(item => item.caseId === caseId) ?? null
  if (!fixture || !row) {
    const missing = bindRootCauseClaim({
      caseId,
      symptom: fixture?.symptom ?? '',
      constraints: fixture?.constraints ?? [],
      rootCause: '',
      selectedApproach: '',
      engineeringPass: false,
      planToCodeStatus: null,
      verifierEvidence: 'stored result missing',
    })
    return { claim: missing, corrected: null, stored: row }
  }
  const claim = bindRootCauseClaim({
    caseId,
    trivial: row.trivial,
    symptom: fixture.symptom,
    constraints: fixture.constraints,
    rootCause: row.dossier?.rootCause ?? '',
    problemModel: row.dossier?.problemModel ?? '',
    selectedApproach: row.dossier?.selectedApproach ?? '',
    engineeringPass: row.acceptanceResult === 'PASS' || row.pass === true,
    planToCodeStatus: row.planToCodeStatus ?? null,
    implementationFidelity: row.implementationFidelity ?? null,
    verifierEvidence: row.acceptanceResult === 'PASS' ? 'verifier passed' : (row.notes ?? []).filter(note => note.includes('VERIFIER_FAIL')).at(-1) ?? 'verifier failed',
  })
  const corrected = caseId === 'REASON-M2-TAG'
    ? correctedClaimFromPublicEvidence({
      caseId,
      symptom: fixture.symptom,
      constraints: fixture.constraints,
      selectedApproach: row.dossier?.selectedApproach ?? '',
      engineeringPass: claim.engineeringPass,
      planToCodeStatus: row.planToCodeStatus ?? null,
      modelClaim: claim,
    })
    : null
  return { claim, corrected, stored: row }
}

function primaryCategory(result: FoundryModelReasoningCaseResult): string {
  if (result.providerFailure || result.failureClass === 'PROVIDER') return 'PROVIDER_FAILURE'
  if (result.failureClass === 'RESOURCE') return 'RESOURCE_FAILURE'
  if (result.rootCauseClaim.status === 'CONTRADICTED' && !result.engineeringPass) return 'ROOT_CAUSE_CONTRADICTED'
  if (result.failureGapCategory === 'PLAN_CORRECT_IMPLEMENTATION_WRONG' || result.notes.some(note => note.includes('planCorrect'))) return 'PLAN_CORRECT_IMPLEMENTATION_WRONG'
  if (result.processOutcome === 'PROCESS_DETECTED_MISMATCH_MODEL_FAILED_TO_REPAIR') return 'PROCESS_DETECTED_MISMATCH_MODEL_FAILED_TO_REPAIR'
  if (!result.engineeringPass && result.postEditInspections > 0) return 'PATCH_INCOMPLETE'
  if (!result.rootCauseClaim.rootCause) return 'ROOT_CAUSE_UNSUPPORTED'
  return result.engineeringPass ? 'NONE' : 'UNKNOWN'
}

async function run(): Promise<void> {
  const full = process.env.FOUNDRY_REASONING_RECOVERY_FULL === '1'
  const recoveryIds = full ? [...FULL_RECOVERY_IDS] : [...FAST_RECOVERY_IDS]
  const repo = resolveRepoRoot()
  const cases = modelReasoningCases()
  const verifierHashBefore = hashText(cases.filter(item => recoveryIds.includes(item.caseId as typeof recoveryIds[number])).map(item => item.verifySource).join('\n'))
  const criteriaHashBefore = hashText(cases.filter(item => recoveryIds.includes(item.caseId as typeof recoveryIds[number])).map(item => `${item.symptom}|${item.constraints.join('|')}`).join('\n'))
  const prior = loadPrior()
  const audits = PRIOR_IDS.map(id => auditPrior(prior, id))
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-m2r-'))
  const previous = process.env.FOUNDRY_CONTRACTS_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  const suite = await runModelReasoningSuite({
    ids: recoveryIds,
    pinProvider: 'ollama',
    pinModel: ROUTE.model,
    stopOnProviderFailure: true,
  })
  if (previous === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
  else process.env.FOUNDRY_CONTRACTS_ROOT = previous
  rmSync(contractsRoot, { recursive: true, force: true })
  const verifierHashAfter = hashText(modelReasoningCases().filter(item => recoveryIds.includes(item.caseId as typeof recoveryIds[number])).map(item => item.verifySource).join('\n'))
  const criteriaHashAfter = hashText(modelReasoningCases().filter(item => recoveryIds.includes(item.caseId as typeof recoveryIds[number])).map(item => `${item.symptom}|${item.constraints.join('|')}`).join('\n'))
  const runnerSource = readFileSync(path.join(repo, 'lib/native-builder/foundryModelReasoning.ts'), 'utf8')
  const injectionCount = ['The stored value is the argument itself', 'Guard that property read'].filter(phrase => runnerSource.includes(phrase)).length
  const routeHeld = suite.results.every(item => !item.provider || (item.provider === ROUTE.provider && item.model === ROUTE.model && item.fallback === false))
  const byId = (id: string) => suite.results.find(item => item.caseId === id)
  const auditById = (id: string) => audits.find(item => item.claim.caseId === id)
  const nonTrivialAudits = audits.filter(item => item.claim.caseId !== 'REASON-M2-SUM')
  const bindingCases = [
    ...suite.results.filter(item => !item.trivial).map(item => item.rootCauseClaim),
    ...nonTrivialAudits.map(item => item.claim),
  ]
  const bindingPass = full
    ? bindingCases.length > 0 && bindingCases.every(item => item.status === 'SUPPORTED')
    : false
  const recoveryEngineering = recoveryIds.every(id => byId(id)?.engineeringPass)
  const statusCount = (status: RootCauseStatus) => bindingCases.filter(item => item.status === status).length
  const capabilityLimit = suite.results.some(item =>
    !item.engineeringPass
    && item.provider === ROUTE.provider
    && item.model === ROUTE.model
    && (item.processOutcome === 'PROCESS_DETECTED_MISMATCH_MODEL_FAILED_TO_REPAIR' || item.postEditInspections > 0 || item.verifierDefects > 0)
  )
  const counts = {
    AUTOMATIC_BUDGET_INCREASE_COUNT: suite.counts.REASONING_RESOURCE_BYPASS_COUNT,
    VERIFIER_MUTATION_COUNT: verifierHashBefore === verifierHashAfter ? 0 : 1,
    CRITERIA_MUTATION_COUNT: criteriaHashBefore === criteriaHashAfter ? 0 : 1,
    KNOWN_REPAIR_INJECTION_COUNT: injectionCount,
    MODEL_DIRECT_WRITE_COUNT: suite.counts.REASONING_MODEL_DIRECT_WRITE_COUNT,
    HIDDEN_ORACLE_READ_COUNT: suite.counts.REASONING_HIDDEN_ORACLE_READ_COUNT,
    REFERENCE_REPAIR_COUNT: suite.counts.REASONING_REFERENCE_REPAIR_COUNT,
    HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT: suite.counts.HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT,
    CONTRACT_BYPASS_COUNT: suite.counts.REASONING_CONTRACT_BYPASS_COUNT,
    RESOURCE_BYPASS_COUNT: suite.counts.REASONING_RESOURCE_BYPASS_COUNT,
    TOOL_BROKER_BYPASS_COUNT: suite.counts.REASONING_TOOL_BROKER_BYPASS_COUNT,
    FALSE_PASS_COUNT: suite.counts.REASONING_FALSE_PASS_COUNT,
    RAW_CHAIN_OF_THOUGHT_STORED_COUNT: suite.counts.REASONING_RAW_CHAIN_OF_THOUGHT_STORED_COUNT,
    REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT: suite.counts.REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT,
  }
  const zeroCounts = Object.values(counts).every(value => value === 0)
  const budgetHeld = MODEL_REASONING_CALL_LIMITS.trivial === 3 && MODEL_REASONING_CALL_LIMITS.normal === 6
    && suite.results.every(item => item.modelCalls <= (item.trivial ? 3 : 6))
  const tag = auditById('REASON-M2-TAG')
  const failedPractice = suite.results.filter(item => !item.engineeringPass).map(item => selectNextCapabilityTask({
    capabilityClass: item.capabilityClass,
    difficulty: item.difficulty,
    recentResults: ['FAIL'],
    gap: item.notes[0] ?? item.failureClass ?? 'verifier failed',
  }))
  const engineeringPasses = suite.results.filter(item => item.engineeringPass).length
  const reasoningPasses = suite.results.filter(item => item.reasoningPass).length
  const missionPass = full
    && routeHeld
    && budgetHeld
    && zeroCounts
    && recoveryEngineering
    && bindingPass
    && suite.results.some(item => item.badHypothesisRecovered && item.engineeringPass)
    && (suite.results.some(item => item.firstHypothesisCorrect && item.engineeringPass) || audits.some(item => item.stored?.firstHypothesisCorrect && item.claim.engineeringPass))
  const lines = suite.results.map(item => `${item.engineeringPass ? 'ENGINEERING_PASS' : item.acceptanceResult} REASONING_${item.reasoningPass ? 'PASS' : 'FAIL'} ${item.caseId} root=${item.rootCauseClaim.status} fidelity=${item.planToCodeStatus ?? 'none'} calls=${item.modelCalls} ${primaryCategory(item)}`)
  for (const line of lines) console.log(line)
  for (const audit of audits) console.log(`AUDIT ${audit.claim.caseId} engineering=${audit.claim.engineeringPass} root=${audit.claim.status} reasoning=${audit.claim.reasoningPass}`)
  const dirty = git('git status --porcelain')
  const report = [
    '# FOUNDRY_MODEL_DRIVEN_ROOT_CAUSE_BINDING_AND_FAILED_CASE_RECOVERY_REPORT',
    '',
    '## 1. Repo identity',
    `${repo} branch ${git('git rev-parse --abbrev-ref HEAD')} HEAD ${git('git rev-parse HEAD')}`,
    '',
    '## 2. Live install identity',
    `${liveInstallId()}. This mission did not install or activate.`,
    '',
    '## 3. Dirty baseline',
    `${dirty ? dirty.split('\n').filter(Boolean).length : 0} dirty or untracked paths. The tree was not cleaned.`,
    '',
    '## 4. Modified files',
    'lib/native-builder/foundryRootCauseBinding.ts, foundryModelReasoning.ts, foundryModelReasoningRecovery.validation.ts, package.json',
    '',
    '## 5. Provider/model',
    `${suite.provider ?? 'none'} / ${suite.model ?? 'none'}`,
    '',
    '## 6. Routing policy',
    `${suite.policy}. Fallback was not accepted. Cursor was not used.`,
    '',
    '## 7. Call budgets',
    `trivial ${MODEL_REASONING_CALL_LIMITS.trivial}, normal ${MODEL_REASONING_CALL_LIMITS.normal}. AUTOMATIC_BUDGET_INCREASE_COUNT=${counts.AUTOMATIC_BUDGET_INCREASE_COUNT}.`,
    '',
    '## 8. Root-cause contract',
    'FoundryRootCauseClaim records caseId, symptom, rootCause, evidenceIds, contradictingEvidenceIds, repairImplication, and status SUPPORTED, PARTIAL, UNSUPPORTED, or CONTRADICTED.',
    '',
    '## 9. Root-cause evidence validator',
    'Status comes from the recorded sentence, the public symptom and constraints, and the plan-to-code result. Model confidence is not a status.',
    '',
    '## 10. Engineering pass versus reasoning pass',
    'ENGINEERING_PASS is the independent verifier. REASONING_PASS also needs a SUPPORTED root cause and a repair implication that matches the disk check.',
    '',
    '## 11. Prior-pass audit',
    'Invoice, parts, actor, tag, SKU, and sum were read from the stored suite. Their implementations were not rerun.',
    '',
    '## 12. Invoice root-cause status',
    `${auditById('REASON-M2-INVOICE')?.claim.status} engineering=${auditById('REASON-M2-INVOICE')?.claim.engineeringPass} claim=${auditById('REASON-M2-INVOICE')?.claim.rootCause || 'missing'}`,
    '',
    '## 13. Parts root-cause status',
    `${auditById('REASON-M2-PARTS')?.claim.status} engineering=${auditById('REASON-M2-PARTS')?.claim.engineeringPass} claim=${auditById('REASON-M2-PARTS')?.claim.rootCause || 'missing'}`,
    '',
    '## 14. Actor root-cause status',
    `${auditById('REASON-M2-ACTOR')?.claim.status} engineering=${auditById('REASON-M2-ACTOR')?.claim.engineeringPass} claim=${auditById('REASON-M2-ACTOR')?.claim.rootCause || 'missing'}`,
    '',
    '## 15. Tag root-cause status',
    `${tag?.claim.status}. The stored sentence is kept. Corrected public artifact status=${tag?.corrected?.status ?? 'none'} root=${tag?.corrected?.rootCause ?? 'none'}`,
    '',
    '## 16. SKU root-cause status',
    `${auditById('REASON-M2-SKU')?.claim.status} engineering=${auditById('REASON-M2-SKU')?.claim.engineeringPass} claim=${auditById('REASON-M2-SKU')?.claim.rootCause || 'missing'}`,
    '',
    '## 17. Sum applicability',
    `SUM is the trivial fast-path control, so it is excluded from ROOT_CAUSE_EVIDENCE_BINDING. Stored status=${auditById('REASON-M2-SUM')?.claim.status}.`,
    '',
    '## 18-33. Recovery cases',
    lines.join('\n') || 'No recovery case ran.',
    '',
    '## 34. Post-edit reinspections',
    String(suite.results.reduce((sum, item) => sum + item.postEditInspections, 0)),
    '',
    '## 35. Contradictions detected',
    String(suite.counts.REASONING_IMPLEMENTATION_CONTRADICTION_COUNT),
    '',
    '## 36. Contradictions recovered',
    String(suite.counts.CONTRADICTION_RECOVERED_COUNT),
    '',
    '## 37. Adversarial findings',
    suite.results.map(item => `${item.caseId} replan=${item.adversarialReplanApplied} advisory=${item.advisoryReviewCount}`).join('\n'),
    '',
    '## 38. Replans',
    String(suite.results.reduce((sum, item) => sum + item.replans, 0)),
    '',
    '## 39. Repeated patches',
    String(suite.results.reduce((sum, item) => sum + item.repeatedErrors, 0)),
    '',
    '## 40. Model calls',
    suite.results.map(item => `${item.caseId}=${item.modelCalls}`).join(' '),
    '',
    '## 41. Verifier failures',
    String(suite.results.reduce((sum, item) => sum + item.verifierDefects, 0)),
    '',
    '## 42. Process failures',
    String(suite.results.filter(item => item.processOutcome === 'PROCESS_FAILED_TO_DETECT_MISMATCH').length),
    '',
    '## 43. Model capability failures',
    String(suite.results.filter(item => item.processOutcome === 'PROCESS_DETECTED_MISMATCH_MODEL_FAILED_TO_REPAIR').length),
    '',
    '## 44. Provider failures',
    String(suite.results.filter(item => item.providerFailure || item.failureClass === 'PROVIDER').length),
    '',
    '## 45. Resource failures',
    String(suite.results.filter(item => item.failureClass === 'RESOURCE').length),
    '',
    '## 46. Engineering pass count',
    String(engineeringPasses),
    '',
    '## 47. Reasoning pass count',
    String(reasoningPasses),
    '',
    '## 48. Supported root causes',
    String(statusCount('SUPPORTED')),
    '',
    '## 49. Unsupported root causes',
    String(statusCount('UNSUPPORTED')),
    '',
    '## 50. Contradicted root causes',
    String(statusCount('CONTRADICTED')),
    '',
    '## 51. Bad-hypothesis recoveries',
    String(suite.results.filter(item => item.badHypothesisRecovered && item.engineeringPass).length),
    '',
    '## 52. First-plan successes',
    String(suite.results.filter(item => item.firstHypothesisCorrect && item.engineeringPass).length),
    '',
    '## 53. Plan-correct code-wrong count',
    String(suite.counts.PLAN_CORRECT_BUT_CODE_WRONG_COUNT),
    '',
    '## 54. Lessons',
    suite.results.map(item => `${item.caseId} lesson=${item.lesson ? 'yes' : 'no'}`).join('\n'),
    '',
    '## 55. Practice queue',
    failedPractice.length ? failedPractice.map(item => `${item.capabilityClass} ${item.action}`).join('\n') : 'No failed recovery case.',
    '',
    '## 56. Capability Atlas evidence',
    'No score. Recovery rows plus the stored audit are the evidence for diagnosis, binding, recovery, fidelity, misleading failure, cross-layer repair, and legacy constraint.',
    '',
    '## 57-66. Counts',
    Object.entries(counts).map(([key, value]) => `${key}=${value}`).join('\n'),
    '',
    '## 67. Build',
    'NO',
    '',
    '## 68. Package',
    'NO',
    '',
    '## 69. Install',
    'NO',
    '',
    '## 70. Activate',
    'NO',
    '',
    '## 71. Commit',
    'NO',
    '',
    '## 72. Push',
    'NO',
    '',
    '## 73. Deploy',
    'NO',
    '',
    '## 74. MODEL_DRIVEN_REASONING',
    recoveryEngineering && routeHeld ? 'PASS' : 'FAIL',
    '',
    '## 75. ROOT_CAUSE_EVIDENCE_BINDING',
    full && bindingPass ? 'PASS' : 'FAIL',
    '',
    '## 76. MODEL_CAPABILITY_LIMIT_OBSERVED',
    capabilityLimit ? 'YES' : 'NO',
    '',
    '## 77. Remaining blockers',
    [
      ...suite.results.filter(item => !item.engineeringPass).map(item => `${item.caseId} engineering FAIL ${primaryCategory(item)}`),
      ...nonTrivialAudits.filter(item => item.claim.status !== 'SUPPORTED').map(item => `${item.claim.caseId} stored root ${item.claim.status}`),
    ].join('\n') || 'None.',
    '',
    '## 78. Recommended next reasoning mission',
    capabilityLimit
      ? 'Keep this worker and budget. Do not wrap another orchestration layer around the same ceiling. A later mission can compare an already configured second model without changing this route.'
      : 'Bind a root-cause label during the normal repair turns of the cases whose stored ROOT field is empty. Do not add a prose-only call.',
    '',
    '## 79. Commander decision required',
    'YES',
    '',
    `MISSION_PASS=${missionPass ? 'PASS' : 'FAIL'}`,
    `REAL_REASONING_MODEL_ROUTE=${routeHeld && suite.realRoute ? 'PASS' : 'FAIL'}`,
    `SAME_BUDGET=${budgetHeld ? 'PASS' : 'FAIL'}`,
    'BUILD=NO',
    'PACKAGE=NO',
    'INSTALL=NO',
    'ACTIVATE=NO',
    'CANONICAL_COMMIT=NO',
    'CANONICAL_PUSH=NO',
    'DEPLOY=NO',
    'HVU_AUTHORIZED=NO',
    'COMMANDER_DECISION_REQUIRED=YES',
    '',
  ].join('\n')
  const reportDir = path.join(repo, 'tmp', 'foundry-model-reasoning')
  mkdirSync(reportDir, { recursive: true })
  writeFileSync(path.join(reportDir, 'FOUNDRY_MODEL_DRIVEN_ROOT_CAUSE_BINDING_AND_FAILED_CASE_RECOVERY_REPORT.md'), report, 'utf8')
  writeFileSync(path.join(reportDir, 'recovery-suite.json'), JSON.stringify({
    route: ROUTE,
    counts,
    audits: audits.map(item => ({ claim: item.claim, corrected: item.corrected })),
    results: suite.results.map(item => ({
      caseId: item.caseId,
      engineeringPass: item.engineeringPass,
      reasoningPass: item.reasoningPass,
      rootCauseClaim: item.rootCauseClaim,
      planToCodeStatus: item.planToCodeStatus,
      processOutcome: item.processOutcome,
      modelCalls: item.modelCalls,
      provider: item.provider,
      model: item.model,
      category: primaryCategory(item),
    })),
  }, null, 2), 'utf8')
if (!routeHeld || !budgetHeld || !zeroCounts || recoveryIds.some(id => !byId(id)) || (full && !missionPass)) process.exit(1)
}

run().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
