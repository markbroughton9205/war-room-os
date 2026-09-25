/**
 * Pinned Composer comparison against the frozen Qwen root-cause baseline.
 * Same fixtures, verifiers, budget, and checkers. No Qwen fallback.
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { CursorAgentProvider } from './cursorAgentProvider'
import { FoundryModelRouter } from './foundryModelRouter'
import { MODEL_REASONING_CALL_LIMITS, runModelReasoningSuite, type FoundryModelReasoningCaseResult } from './foundryModelReasoning'
import { modelReasoningCases } from './foundryModelReasoningCases'
import { publicProviderError } from './foundryStrongerModelReasoning'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'
import type { FoundryMissionPermissions } from './foundryMissionTypes'

const PIN = { provider: 'cursor-agent' as const, model: 'composer-2.5' }
const FAST_IDS = ['REASON-M2-HOLDS', 'REASON-M2-EVENTS', 'REASON-M2-BIN'] as const
const FULL_IDS = ['REASON-M2-HOLDS', 'REASON-M2-EVENTS', 'REASON-M2-CENTS', 'REASON-M2-BIN', 'REASON-M2-INVOICE', 'REASON-M2-PARTS', 'REASON-M2-ACTOR', 'REASON-M2-TAG', 'REASON-M2-SKU', 'REASON-M2-SUM'] as const
const CEILING = ['REASON-M2-HOLDS', 'REASON-M2-EVENTS', 'REASON-M2-CENTS', 'REASON-M2-BIN'] as const
const FROZEN = {
  fixture: '07fd168d43801e7e4b0ea010a844f7f53981d0eac4a7fb91932cdb8f9a58dc9b',
  verifier: '8c38d96e7081d6afc34c530f9a6c1cb214769dd093af8212116bfda29319172f',
  criteria: 'aefe7ca2590f75c9d13c4c97f3419811f86f1f5a605009cc9391778ed326075e',
  fidelity: 'f71e0249516733c2538f62159270d096c69142f4625dd5539a2c57ed26140b4b',
  broker: '71927e2a90b100a4361383fe8734c9341dcdc8bbaa6eb9b002b505382483ec8a',
  root: '8d9250bf0ed658309475fb385f730ef8a360ba7929e0345edd0c54d40d67d312',
} as const

type QwenRow = { engineering: 'PASS' | 'FAIL'; reasoning: 'PASS' | 'FAIL' | 'EXCLUDED'; root: string; calls: number; replans: string; fidelity: string }
const QWEN: Record<string, QwenRow> = {
  'REASON-M2-HOLDS': { engineering: 'FAIL', reasoning: 'FAIL', root: 'UNSUPPORTED', calls: 6, replans: 'yes', fidelity: 'PARTIAL' },
  'REASON-M2-EVENTS': { engineering: 'FAIL', reasoning: 'FAIL', root: 'UNSUPPORTED', calls: 5, replans: 'yes', fidelity: 'CONTRADICTED' },
  'REASON-M2-CENTS': { engineering: 'FAIL', reasoning: 'FAIL', root: 'UNSUPPORTED', calls: 6, replans: 'no', fidelity: 'CONTRADICTED' },
  'REASON-M2-BIN': { engineering: 'PASS', reasoning: 'FAIL', root: 'UNSUPPORTED', calls: 3, replans: 'no', fidelity: 'IMPLEMENTED' },
  'REASON-M2-INVOICE': { engineering: 'PASS', reasoning: 'FAIL', root: 'PARTIAL', calls: 6, replans: 'yes', fidelity: 'stored' },
  'REASON-M2-PARTS': { engineering: 'PASS', reasoning: 'FAIL', root: 'UNSUPPORTED', calls: 5, replans: 'no', fidelity: 'stored' },
  'REASON-M2-ACTOR': { engineering: 'PASS', reasoning: 'FAIL', root: 'UNSUPPORTED', calls: 2, replans: 'no', fidelity: 'stored' },
  'REASON-M2-TAG': { engineering: 'PASS', reasoning: 'FAIL', root: 'CONTRADICTED', calls: 2, replans: 'no', fidelity: 'IMPLEMENTED' },
  'REASON-M2-SKU': { engineering: 'PASS', reasoning: 'FAIL', root: 'UNSUPPORTED', calls: 2, replans: 'no', fidelity: 'stored' },
  'REASON-M2-SUM': { engineering: 'PASS', reasoning: 'EXCLUDED', root: 'EXCLUDED', calls: 2, replans: 'no', fidelity: 'stored' },
}

const PERMISSIONS: FoundryMissionPermissions = {
  filesystem: true, terminal: false, browser: false, computerUse: false, tests: true, lint: false,
  typecheck: false, build: false, package: false, installProduction: false, activateInstall: false,
  installedRuntimeControl: false, process: false, commit: false, push: false, liveDeploy: false, internetResearch: false,
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function git(command: string): string {
  try {
    return execSync(command, { cwd: resolveRepoRoot(), encoding: 'utf8' }).trim()
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 180) : 'unknown'
  }
}

function liveInstallId(): string {
  try {
    const text = readFileSync('/home/chosenone/.local/bin/war-room-os-user', 'utf8')
    const match = text.match(/exec "([^"]+)/)
    return match?.[1] ?? 'launcher present'
  } catch {
    return 'launcher not read'
  }
}

function currentHashes() {
  const repo = resolveRepoRoot()
  const cases = modelReasoningCases()
  return {
    fixture: hash(JSON.stringify(cases.map(item => ({ id: item.caseId, symptom: item.symptom, constraints: item.constraints, files: item.files, verify: item.verifySource })))),
    verifier: hash(cases.map(item => item.verifySource).join('\n')),
    criteria: hash(cases.map(item => `${item.symptom}|${item.constraints.join('|')}`).join('\n')),
    fidelity: hash(readFileSync(path.join(repo, 'lib/native-builder/foundryReasoningFidelity.ts'))),
    broker: hash(readFileSync(path.join(repo, 'lib/native-builder/foundryUnattendedEngineer.ts'))),
    root: hash(readFileSync(path.join(repo, 'lib/native-builder/foundryRootCauseBinding.ts'))),
  }
}

async function probeComposer(): Promise<{ ok: boolean; detail: string }> {
  const router = new FoundryModelRouter([new CursorAgentProvider(PIN.model)])
  let routed: Awaited<ReturnType<FoundryModelRouter['route']>>
  try {
    routed = await router.route('chooseNextAction', {
      kind: 'chooseNextAction',
      context: {
        missionId: 'composer-availability',
        missionKind: 'application',
        userRequest: 'Availability probe only. Return decision COMPLETE. Do not read or write files.',
        goal: 'Prove the pinned route answers.',
        successCriteria: ['A decision returns.'],
        constraints: [],
        permissions: PERMISSIONS,
        phase: 'EXECUTING',
        plan: [],
        hypotheses: [],
        changedFiles: [],
        importantFindings: [],
        relevantExcerpts: [],
        visualEvidence: [],
        recentToolResults: [],
        recentErrors: [],
        unresolvedQuestions: [],
        completionGate: { complete: false, missing: [], detail: 'probe' },
        tools: FOUNDRY_MODEL_TOOL_CATALOG.filter(tool => tool.name === 'file.read'),
      },
    }, { missionId: 'composer-availability', pinProvider: PIN.provider })
  } catch (error) {
    return { ok: false, detail: publicProviderError(error instanceof Error ? error.message : 'probe failed') }
  }
  const response = routed.response
  if (routed.selectedProvider !== PIN.provider || routed.selectedModel !== PIN.model) {
    return { ok: false, detail: 'Pinned Composer did not stay selected. Qwen was not used.' }
  }
  if (!response.ok && response.failureClass !== 'MALFORMED') {
    return { ok: false, detail: publicProviderError(response.error) }
  }
  return { ok: true, detail: response.ok ? 'decision returned' : 'provider answered; decision shape was repaired by the normal parser path' }
}

function compare(id: string, item: FoundryModelReasoningCaseResult | undefined): string {
  const qwen = QWEN[id]
  const composer = item
    ? `engineering=${item.engineeringPass ? 'PASS' : 'FAIL'} reasoning=${item.reasoningPass ? 'PASS' : 'FAIL'} root=${item.rootCauseClaim.status} calls=${item.modelCalls} replans=${item.replans} fidelity=${item.planToCodeStatus ?? item.implementationFidelity}`
    : 'NOT_RUN'
  return `qwen engineering=${qwen.engineering} reasoning=${qwen.reasoning} root=${qwen.root} calls=${qwen.calls} replans=${qwen.replans} fidelity=${qwen.fidelity}\ncomposer ${composer}`
}

async function run(): Promise<void> {
  const full = process.env.FOUNDRY_STRONGER_WORKER_FULL === '1'
  const ids = full ? [...FULL_IDS] : [...FAST_IDS]
  const repo = resolveRepoRoot()
  const hashes = currentHashes()
  const comparisonValid = hashes.fixture === FROZEN.fixture
    && hashes.verifier === FROZEN.verifier
    && hashes.criteria === FROZEN.criteria
    && hashes.fidelity === FROZEN.fidelity
    && hashes.broker === FROZEN.broker
    && hashes.root === FROZEN.root
    && MODEL_REASONING_CALL_LIMITS.trivial === 3
    && MODEL_REASONING_CALL_LIMITS.normal === 6
  const reportDir = path.join(repo, 'tmp', 'foundry-model-reasoning')
  mkdirSync(reportDir, { recursive: true })
  if (!comparisonValid) {
    writeFileSync(path.join(reportDir, 'FOUNDRY_STRONGER_WORKER_ROOT_CAUSE_AND_ENGINEERING_CHALLENGE_REPORT.md'), [
      '# FOUNDRY_STRONGER_WORKER_ROOT_CAUSE_AND_ENGINEERING_CHALLENGE_REPORT',
      '',
      'COMPARISON_VALIDITY=INVALID',
      'The fixture, verifier, criteria, budget, Tool Broker, fidelity checker, or root-cause validator hash does not match the frozen Qwen baseline.',
      'Composer was not run. Qwen was not rerun.',
      'QWEN_BASELINE_PRESERVED=YES',
      'POLICY_CHANGED=NO',
      'BUILD=NO',
      'COMMANDER_DECISION_REQUIRED=YES',
    ].join('\n'), 'utf8')
    console.log('COMPARISON_VALIDITY=INVALID')
    process.exit(1)
  }
  const probe = await probeComposer()
  if (!probe.ok) {
    writeFileSync(path.join(reportDir, 'FOUNDRY_STRONGER_WORKER_ROOT_CAUSE_AND_ENGINEERING_CHALLENGE_REPORT.md'), [
      '# FOUNDRY_STRONGER_WORKER_ROOT_CAUSE_AND_ENGINEERING_CHALLENGE_REPORT',
      '',
      '## 7. Availability result',
      `COMPOSER_PROVIDER_FAILURE ${probe.detail}`,
      '',
      'Composer cases were not started. Qwen was not used as a fallback.',
      'COMPARISON_VALIDITY=PASS',
      'QWEN_BASELINE_PRESERVED=YES',
      'FALLBACK_TO_QWEN=NO',
      'POLICY_CHANGED=NO',
      'BUILD=NO',
      'PACKAGE=NO',
      'INSTALL=NO',
      'ACTIVATE=NO',
      'CANONICAL_COMMIT=NO',
      'CANONICAL_PUSH=NO',
      'DEPLOY=NO',
      'HVU_AUTHORIZED=NO',
      'COMMANDER_DECISION_REQUIRED=YES',
    ].join('\n'), 'utf8')
    console.log(`COMPOSER_PROVIDER_FAILURE ${probe.detail}`)
    process.exit(1)
  }
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-composer-c-'))
  const memoryRoot = mkdtempSync(path.join(tmpdir(), 'wr-composer-m-'))
  const previous = process.env.FOUNDRY_CONTRACTS_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  const suite = await runModelReasoningSuite({
    ids,
    memoryRoot,
    pinProvider: PIN.provider,
    pinModel: PIN.model,
    models: [new CursorAgentProvider(PIN.model)],
    stopOnProviderFailure: true,
  })
  if (previous === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
  else process.env.FOUNDRY_CONTRACTS_ROOT = previous
  rmSync(contractsRoot, { recursive: true, force: true })
  rmSync(memoryRoot, { recursive: true, force: true })
  const after = currentHashes()
  const stillValid = JSON.stringify(after) === JSON.stringify(hashes)
  const byId = (id: string) => suite.results.find(item => item.caseId === id)
  const ran = (id: string) => byId(id)
  const qualifying = suite.results.filter(item => item.caseId !== 'REASON-M2-SUM')
  const bindingPass = qualifying.length > 0 && qualifying.every(item => item.rootCauseClaim.status === 'SUPPORTED' && item.reasoningPass)
  const ceilingEngineering = CEILING.every(id => byId(id)?.engineeringPass)
  const qwenFailed = ['REASON-M2-HOLDS', 'REASON-M2-EVENTS', 'REASON-M2-CENTS']
  const improvesEngineering = qwenFailed.some(id => byId(id)?.engineeringPass)
  const improvesRoot = suite.results.some(item => item.rootCauseClaim.status === 'SUPPORTED' && QWEN[item.caseId]?.root !== 'SUPPORTED')
  const capabilityLimit = suite.results.some(item => !item.engineeringPass && item.provider === PIN.provider && (item.processOutcome === 'PROCESS_DETECTED_MISMATCH_MODEL_FAILED_TO_REPAIR' || item.postEditInspections > 0))
  const rootLimit = suite.results.some(item => item.engineeringPass && item.rootCauseClaim.status !== 'SUPPORTED')
  const providerFailure = suite.results.some(item => item.failureClass === 'PROVIDER' || item.providerFailure)
  const fellBack = suite.results.some(item => item.provider && item.provider !== PIN.provider)
  const counts = suite.counts
  const zero = counts.REASONING_MODEL_DIRECT_WRITE_COUNT === 0
    && counts.REASONING_HIDDEN_ORACLE_READ_COUNT === 0
    && counts.REASONING_REFERENCE_REPAIR_COUNT === 0
    && counts.HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT === 0
    && counts.REASONING_CONTRACT_BYPASS_COUNT === 0
    && counts.REASONING_RESOURCE_BYPASS_COUNT === 0
    && counts.REASONING_TOOL_BROKER_BYPASS_COUNT === 0
    && counts.REASONING_FALSE_PASS_COUNT === 0
    && counts.REASONING_RAW_CHAIN_OF_THOUGHT_STORED_COUNT === 0
    && counts.REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT === 0
  const budgetHeld = suite.results.every(item => item.modelCalls <= (item.trivial ? 3 : 6))
  const missionPass = full && stillValid && !fellBack && !providerFailure && ceilingEngineering && bindingPass && zero && budgetHeld && suite.results.some(item => item.postEditInspections > 0)
  const row = (id: string) => {
    const item = ran(id)
    return item ? `${item.engineeringPass ? 'PASS' : item.acceptanceResult} reasoning=${item.reasoningPass ? 'PASS' : 'FAIL'} root=${item.rootCauseClaim.status} ${item.rootCauseClaim.rootCause || 'missing'} fidelity=${item.planToCodeStatus ?? 'none'}` : 'NOT_RUN'
  }
  const dirty = git('git status --porcelain')
  const report = [
    '# FOUNDRY_STRONGER_WORKER_ROOT_CAUSE_AND_ENGINEERING_CHALLENGE_REPORT',
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
    'lib/native-builder/foundryStrongerWorkerRootCause.validation.ts and package.json. Fixtures, verifiers, the fidelity checker, the Tool Broker, and the root-cause contract were not edited.',
    '',
    '## 5. Pinned provider',
    PIN.provider,
    '',
    '## 6. Pinned model',
    PIN.model,
    '',
    '## 7. Availability result',
    probe.detail,
    '',
    '## 8. Routing policy preservation',
    `${suite.policy}. POLICY_CHANGED=NO. The stored policy was not rewritten. This run pinned Composer.`,
    '',
    '## 9. Fixture hash preservation',
    hashes.fixture,
    '',
    '## 10. Verifier hash preservation',
    hashes.verifier,
    '',
    '## 11. Criteria preservation',
    hashes.criteria,
    '',
    '## 12. Budget preservation',
    `trivial ${MODEL_REASONING_CALL_LIMITS.trivial}, normal ${MODEL_REASONING_CALL_LIMITS.normal}.`,
    '',
    '## 13. Comparison validity',
    stillValid ? 'PASS' : 'INVALID',
    '',
    '## 14. Qwen frozen baseline',
    'QWEN_BASELINE_PRESERVED=YES. Qwen was not rerun. HOLDS FAIL, EVENTS FAIL, CENTS FAIL, BIN engineering PASS. Earlier engineering passes remain invoice, parts, actor, tag, SKU, and sum.',
    '',
    '## 15-17. Holds',
    row('REASON-M2-HOLDS'),
    '',
    '## 18. Holds comparison',
    compare('REASON-M2-HOLDS', byId('REASON-M2-HOLDS')),
    '',
    '## 19-21. Events',
    row('REASON-M2-EVENTS'),
    '',
    '## 22. Events comparison',
    compare('REASON-M2-EVENTS', byId('REASON-M2-EVENTS')),
    '',
    '## 23-25. Cents',
    row('REASON-M2-CENTS'),
    '',
    '## 26. Cents comparison',
    compare('REASON-M2-CENTS', byId('REASON-M2-CENTS')),
    '',
    '## 27-29. Bin',
    row('REASON-M2-BIN'),
    '',
    '## 30. Bin comparison',
    compare('REASON-M2-BIN', byId('REASON-M2-BIN')),
    '',
    '## 31. Invoice comparison',
    compare('REASON-M2-INVOICE', byId('REASON-M2-INVOICE')),
    '',
    '## 32. Parts comparison',
    compare('REASON-M2-PARTS', byId('REASON-M2-PARTS')),
    '',
    '## 33. Actor comparison',
    compare('REASON-M2-ACTOR', byId('REASON-M2-ACTOR')),
    '',
    '## 34. Tag comparison',
    compare('REASON-M2-TAG', byId('REASON-M2-TAG')),
    '',
    '## 35. SKU comparison',
    compare('REASON-M2-SKU', byId('REASON-M2-SKU')),
    '',
    '## 36. Sum control',
    'SUM stays the trivial fast-path control and is excluded from root-cause qualification.',
    compare('REASON-M2-SUM', byId('REASON-M2-SUM')),
    '',
    '## 37. Post-edit reinspections',
    String(suite.results.reduce((sum, item) => sum + item.postEditInspections, 0)),
    '',
    '## 38. Fidelity results',
    suite.results.map(item => `${item.caseId} ${item.planToCodeStatus ?? 'none'} ${item.implementationFidelity}`).join('\n'),
    '',
    '## 39. Contradictions detected',
    String(counts.REASONING_IMPLEMENTATION_CONTRADICTION_COUNT),
    '',
    '## 40. Contradictions recovered',
    String(counts.CONTRADICTION_RECOVERED_COUNT),
    '',
    '## 41. Adversarial findings',
    suite.results.map(item => `${item.caseId} replan=${item.adversarialReplanApplied} advisory=${item.advisoryReviewCount}`).join('\n'),
    '',
    '## 42. Replans',
    String(suite.results.reduce((sum, item) => sum + item.replans, 0)),
    '',
    '## 43. Repeated patches',
    String(suite.results.reduce((sum, item) => sum + item.repeatedErrors, 0)),
    '',
    '## 44. Model calls',
    suite.results.map(item => `${item.caseId}=${item.modelCalls}`).join(' '),
    '',
    '## 45. Process failures',
    String(suite.results.filter(item => item.processOutcome === 'PROCESS_FAILED_TO_DETECT_MISMATCH').length),
    '',
    '## 46. Provider failures',
    String(suite.results.filter(item => item.failureClass === 'PROVIDER' || item.providerFailure).length),
    '',
    '## 47. Resource failures',
    String(suite.results.filter(item => item.failureClass === 'RESOURCE').length),
    '',
    '## 48. Composer capability failures',
    String(suite.results.filter(item => !item.engineeringPass && item.processOutcome === 'PROCESS_DETECTED_MISMATCH_MODEL_FAILED_TO_REPAIR').length),
    '',
    '## 49. Composer root-cause-binding failures',
    String(suite.results.filter(item => item.engineeringPass && item.rootCauseClaim.status !== 'SUPPORTED').length),
    '',
    '## 50. Engineering pass totals',
    String(suite.results.filter(item => item.engineeringPass).length),
    '',
    '## 51. Reasoning pass totals',
    String(suite.results.filter(item => item.reasoningPass).length),
    '',
    '## 52. Supported root-cause totals',
    String(qualifying.filter(item => item.rootCauseClaim.status === 'SUPPORTED').length),
    '',
    '## 53. Unsupported root-cause totals',
    String(qualifying.filter(item => item.rootCauseClaim.status === 'UNSUPPORTED').length),
    '',
    '## 54. Contradicted root-cause totals',
    String(qualifying.filter(item => item.rootCauseClaim.status === 'CONTRADICTED').length),
    '',
    '## 55. Stronger-worker engineering comparison',
    improvesEngineering ? 'YES' : 'NO',
    '',
    '## 56. Stronger-worker root-cause comparison',
    improvesRoot ? 'YES' : 'NO',
    '',
    '## 57. Routing evidence',
    suite.results.map(item => `${item.atlasFamily} ${item.provider ?? 'none'} ${item.model ?? 'none'} engineering=${item.engineeringPass} reasoning=${item.reasoningPass} root=${item.rootCauseClaim.status} calls=${item.modelCalls} replans=${item.replans} contradictions=${item.notes.filter(note => note.startsWith('PLAN_TO_CODE')).length} verification=${item.acceptanceResult}`).join('\n'),
    '',
    '## 58. Policy changed',
    'NO',
    '',
    '## 59-69. Counts',
    `MODEL_DIRECT_WRITE_COUNT=${counts.REASONING_MODEL_DIRECT_WRITE_COUNT}`,
    `TOOL_BROKER_BYPASS_COUNT=${counts.REASONING_TOOL_BROKER_BYPASS_COUNT}`,
    `HIDDEN_ORACLE_READ_COUNT=${counts.REASONING_HIDDEN_ORACLE_READ_COUNT}`,
    `REFERENCE_REPAIR_COUNT=${counts.REASONING_REFERENCE_REPAIR_COUNT}`,
    'KNOWN_REPAIR_INJECTION_COUNT=0',
    `HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT=${counts.HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT}`,
    `CONTRACT_BYPASS_COUNT=${counts.REASONING_CONTRACT_BYPASS_COUNT}`,
    `RESOURCE_BYPASS_COUNT=${counts.REASONING_RESOURCE_BYPASS_COUNT}`,
    `FALSE_PASS_COUNT=${counts.REASONING_FALSE_PASS_COUNT}`,
    `RAW_CHAIN_OF_THOUGHT_STORED_COUNT=${counts.REASONING_RAW_CHAIN_OF_THOUGHT_STORED_COUNT}`,
    `REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT=${counts.REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT}`,
    '',
    '## 70. Protected-product changes',
    'None.',
    '',
    '## 71-77. Release',
    'BUILD=NO',
    'PACKAGE=NO',
    'INSTALL=NO',
    'ACTIVATE=NO',
    'CANONICAL_COMMIT=NO',
    'CANONICAL_PUSH=NO',
    'DEPLOY=NO',
    '',
    '## 78. Mission verdict',
    missionPass ? 'PASS' : 'FAIL',
    '',
    '## 79. STRONGER_WORKER_IMPROVES_ENGINEERING_RECOVERY',
    improvesEngineering ? 'YES' : 'NO',
    '',
    '## 80. STRONGER_WORKER_IMPROVES_ROOT_CAUSE_BINDING',
    improvesRoot ? 'YES' : 'NO',
    '',
    '## 81. COMPOSER_CAPABILITY_LIMIT_OBSERVED',
    capabilityLimit ? 'YES' : 'NO',
    '',
    '## 82. COMPOSER_ROOT_CAUSE_BINDING_LIMIT_OBSERVED',
    rootLimit ? 'YES' : 'NO',
    '',
    '## 83. Remaining blockers',
    suite.results.filter(item => !item.engineeringPass || !item.reasoningPass).map(item => `${item.caseId} engineering=${item.engineeringPass} reasoning=${item.reasoningPass} root=${item.rootCauseClaim.status}`).join('\n') || 'None.',
    '',
    '## 84. Recommended next reasoning mission',
    capabilityLimit
      ? 'Do not add another wrapper around this ceiling. A later mission can try a different already-configured worker or future WRIM.'
      : 'Use the routing evidence when choosing a worker. Do not change the stored local policy in that same step.',
    '',
    '## 85. Commander decision required',
    'YES',
    '',
    `COMPARISON_VALIDITY=${stillValid ? 'PASS' : 'INVALID'}`,
    `QWEN_BASELINE_PRESERVED=YES`,
    `FALLBACK_TO_QWEN=${fellBack ? 'YES' : 'NO'}`,
    `POLICY_CHANGED=NO`,
    'HVU_AUTHORIZED=NO',
    'COMMANDER_DECISION_REQUIRED=YES',
    '',
  ].join('\n')
  writeFileSync(path.join(reportDir, 'FOUNDRY_STRONGER_WORKER_ROOT_CAUSE_AND_ENGINEERING_CHALLENGE_REPORT.md'), report, 'utf8')
  writeFileSync(path.join(reportDir, 'composer-root-cause-suite.json'), JSON.stringify({
    probe: probe.detail,
    results: suite.results.map(item => ({
      caseId: item.caseId,
      engineeringPass: item.engineeringPass,
      reasoningPass: item.reasoningPass,
      root: item.rootCauseClaim.status,
      rootCause: item.rootCauseClaim.rootCause,
      calls: item.modelCalls,
      replans: item.replans,
      fidelity: item.planToCodeStatus,
      provider: item.provider,
      model: item.model,
      acceptance: item.acceptanceResult,
    })),
  }, null, 2), 'utf8')
  for (const item of suite.results) {
    console.log(`${item.acceptanceResult} ${item.caseId} engineering=${item.engineeringPass} reasoning=${item.reasoningPass} root=${item.rootCauseClaim.status} calls=${item.modelCalls}`)
  }
  if (!stillValid || fellBack || providerFailure || !budgetHeld || !zero || ids.some(id => !byId(id)) || (full ? !missionPass : suite.results.some(item => !item.engineeringPass))) process.exit(1)
}

run().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
