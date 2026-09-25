/**
 * Mission 03 validation. Real model route. Disposable fixtures.
 * No package, install, activate, commit, push, or deploy.
 */
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { canonicalPartsContradiction, deriveEngineeringPatchIntent, inspectPlanAgainstSource, mission03FailedCaseAudit } from './foundryReasoningFidelity'
import { selectFidelityCases } from './foundryReasoningFidelityCases'
import { passedResumeIds, reasoningFidelityOutcomes, runModelReasoningSuite, verifierRejectsSuperficial } from './foundryModelReasoning'
import { selectNextCapabilityTask } from './foundryEngineeringReasoning'

function git(command: string): string {
  try {
    return execSync(command, { cwd: resolveRepoRoot(), encoding: 'utf8' }).trim()
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 180) : 'unknown'
  }
}

function resumeWorks(): boolean {
  const file = path.join(tmpdir(), `wr-m3-resume-${Date.now()}.jsonl`)
  writeFileSync(file, `${JSON.stringify({ caseId: 'RESUME-OK', acceptanceResult: 'PASS' })}\n{"torn"\n`, 'utf8')
  const kept = passedResumeIds(file)
  rmSync(file, { force: true })
  return kept.has('RESUME-OK') && kept.get('RESUME-OK')?.acceptanceResult === 'PASS'
}

async function run(): Promise<void> {
  const full = process.env.FOUNDRY_REASONING_FULL === '1'
  const ids = process.env.FOUNDRY_REASONING_CASES?.split(',').map(item => item.trim()).filter(Boolean)
  const repo = resolveRepoRoot()
  const reportDir = path.join(repo, 'tmp', 'foundry-model-reasoning')
  mkdirSync(reportDir, { recursive: true })
  const audit = mission03FailedCaseAudit()
  writeFileSync(path.join(reportDir, 'mission03-failed-case-audit.json'), JSON.stringify(audit, null, 2), 'utf8')
  const partsCheck = canonicalPartsContradiction()
  const outside = inspectPlanAgainstSource({
    intent: deriveEngineeringPatchIntent({
      symptom: 'lookup() parses the whole catalog again on every row.',
      constraints: [],
      approach: 'parse once outside the loop',
    }),
    approach: 'parse once outside the loop',
    files: {
      'catalog.mjs': 'export function lookup(parts, id) { const rows = JSON.parse(JSON.stringify(parts)); return rows.find(item => item.id === id) }\n',
    },
  })
  console.log(`${partsCheck.status === 'CONTRADICTED' && partsCheck.planCorrectCodeWrong ? 'PASS' : 'FAIL'} CANONICAL_PARTS ${partsCheck.status} ${partsCheck.mismatch}`)
  console.log(`${outside.status === 'IMPLEMENTED' ? 'PASS' : 'FAIL'} PARSE_OUTSIDE ${outside.status}`)
  const resumeOk = resumeWorks()
  console.log(`${resumeOk ? 'PASS' : 'FAIL'} REASONING_SUITE_RESUME`)
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-m3-c-'))
  const memoryRoot = mkdtempSync(path.join(tmpdir(), 'wr-m3-mem-'))
  const previous = process.env.FOUNDRY_CONTRACTS_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  const cases = selectFidelityCases({ full, ids })
  for (const item of cases) {
    const superficial = verifierRejectsSuperficial(item)
    console.log(`${superficial.ok ? 'FAIL kept' : 'PASS rejected'} SUPERFICIAL ${item.caseId}`)
    if (superficial.ok) process.exitCode = 1
  }
  const suite = await runModelReasoningSuite({
    full,
    ids,
    memoryRoot,
    select: 'fidelity',
    resumePath: path.join(reportDir, 'fidelity-progress.jsonl'),
  })
  const outcomes = reasoningFidelityOutcomes(suite)
  outcomes.REASONING_SUITE_RESUME = resumeOk ? 'PASS' : 'FAIL'
  const originals = ['REASON-M2-HOLDS', 'REASON-M2-INVOICE', 'REASON-M2-PARTS', 'REASON-M2-ACTOR', 'REASON-M2-EVENTS', 'REASON-M2-CENTS', 'REASON-M2-BIN']
  const qualifyingPasses = suite.results.filter(item => originals.includes(item.caseId) && item.pass)
  const difficulty = selectNextCapabilityTask({
    capabilityClass: 'PERFORMANCE_BOTTLENECK',
    difficulty: 'D2',
    recentResults: qualifyingPasses.length >= 3 ? ['PASS', 'PASS', 'PASS'] : qualifyingPasses.map(() => 'PASS' as const),
  })
  const practice = suite.results.filter(item => item.caseId.startsWith('PRACTICE-M3-'))
  const failed = suite.results.filter(item => !item.pass && !item.trivial)
  const lines = [
    '# FOUNDRY_REASONING_TO_IMPLEMENTATION_FIDELITY_AND_RECOVERY_REPORT',
    '',
    '## 1. Repo identity',
    `${repo} ${git('git rev-parse --abbrev-ref HEAD')} ${git('git rev-parse HEAD')}`,
    '',
    '## 2. Live install identity',
    'Newest tree observed earlier in this program: /home/chosenone/.local/opt/war-room-os-0.1.0-e343c80-commander-chat-intel04. This mission did not install.',
    '',
    '## 3. Dirty baseline',
    `${git('git status --porcelain').split('\n').filter(Boolean).length} dirty or untracked paths. The tree was not cleaned.`,
    '',
    '## 4. Modified files',
    'foundryReasoningFidelity.ts, foundryReasoningFidelityCases.ts, foundryReasoningFidelity.validation.ts, foundryModelReasoning.ts, foundryModelReasoningCases.ts, foundryEngineeringReasoning.ts, foundryEngineeringReasoningTypes.ts, package.json',
    '',
    '## 5. Actual provider/model',
    `${suite.provider ?? 'none'} / ${suite.model ?? 'none'} policy ${suite.policy}`,
    '',
    '## 6. Failed-case audit',
    audit.map(row => `${row.caseId} ${row.failureGapCategory} calls=${row.modelCalls} ${row.verifierFailure}`).join('\n'),
    '',
    '## 7. Failure-gap taxonomy',
    audit.map(row => `${row.caseId} ${row.failureGapCategory}`).join('\n'),
    '',
    '## 8-14. Diagnoses',
    audit.map(row => `### ${row.caseId}\n${row.evidence}\nPatch: ${row.actualPatchSummary}`).join('\n'),
    '',
    '## 15. EngineeringPatchIntent',
    'targetBehavior, mustChange, mustPreserve, mustNotDo, expectedStructuralEffect, expectedRuntimeEffect. Derived from the public symptom, constraints, and the model summary.',
    '',
    '## 16. Plan-to-code checker',
    `Canonical PARTS sample: ${partsCheck.status}. Parse-outside sample: ${outside.status}.`,
    '',
    '## 17. Post-edit source inspection',
    suite.results.map(item => `${item.caseId} inspections=${item.postEditInspections}`).join('\n'),
    '',
    '## 18. Implementation fidelity states',
    suite.results.map(item => `${item.caseId} ${item.implementationFidelity} ${item.planToCodeStatus ?? 'none'}`).join('\n'),
    '',
    '## 19. Contradiction handling',
    `detected=${suite.counts.REASONING_IMPLEMENTATION_CONTRADICTION_COUNT} recovered=${suite.counts.CONTRADICTION_RECOVERED_COUNT} unresolved=${suite.counts.UNRESOLVED_PLAN_CODE_CONTRADICTION_COUNT}`,
    '',
    '## 20. Bounded self-repair',
    'At most 2 fidelity corrections skip the hidden verifier. The next disagreement still reaches the verifier, and a mismatch blocks acceptance.',
    '',
    '## 21. Independent verifier boundary',
    'The fidelity check does not replace verify.mjs. A match still has to pass the hidden Node check.',
    '',
    '## 22. Public/local test behavior',
    'A project test file runs before the hidden verifier. A failing public test returns to the debugger.',
    '',
    '## 23. Micro-evidence checks',
    'Predicates include parse-not-in-loop, absent assert.ok(true), returns.length, module binding, bare JSONL append, unbound helper, second JSON.parse, productCode, toUpperCase, and left-minus-right.',
    '',
    '## 24. Adversarial diff review',
    suite.results.filter(item => item.notes.some(note => note.includes('DID THE PATCH'))).map(item => item.caseId).join(', ') || 'no reviewer turn in this selection',
    '',
    '## 25. Contradiction metrics',
    `PLAN_CORRECT_BUT_CODE_WRONG_COUNT=${suite.counts.PLAN_CORRECT_BUT_CODE_WRONG_COUNT}`,
    '',
    '## 26. Practice architecture',
    practice.map(item => item.caseId).join(', ') || 'none in this selection',
    '',
    '## 27. Practice variant results',
    practice.map(item => `${item.acceptanceResult} ${item.caseId} ${item.processOutcome}`).join('\n') || 'none',
    '',
    '## 28. Original-case reevaluation',
    originals.map(id => {
      const row = suite.results.find(item => item.caseId === id)
      return row ? `${row.acceptanceResult} ${id} gap=${row.failureGapCategory ?? 'none'} process=${row.processOutcome}` : `${id} not in this selection`
    }).join('\n'),
    '',
    '## 29-31. Regressions',
    `TAG=${outcomes.TAG_REGRESSION} SKU=${outcomes.SKU_REGRESSION} SUM=${outcomes.SUM_CONTROL}`,
    '',
    '## 32-38. Recovery',
    originals.map(id => `${id}=${suite.results.find(item => item.caseId === id)?.pass ? 'PASS' : 'FAIL'}`).join('\n'),
    '',
    '## 39. Process versus model',
    suite.results.map(item => `${item.caseId} ${item.processOutcome}${item.providerFailure ? ' provider-failure' : ''}`).join('\n'),
    '',
    '## 40. Model-capability-limit observations',
    failed.filter(item => item.processOutcome === 'PROCESS_DETECTED_MISMATCH_MODEL_FAILED_TO_REPAIR').map(item => `${item.caseId} MODEL_CAPABILITY_LIMIT_OBSERVED`).join('\n') || 'none',
    '',
    '## 41. Suite resumability',
    outcomes.REASONING_SUITE_RESUME,
    '',
    '## 42. Case isolation',
    'Each case uses its own mission id and temp project. A thrown case is logged and the suite continues.',
    '',
    '## 43. Tool Broker path',
    `direct=${suite.counts.REASONING_MODEL_DIRECT_WRITE_COUNT} brokerBypass=${suite.counts.REASONING_TOOL_BROKER_BYPASS_COUNT}`,
    '',
    '## 44. Governance',
    `contract=${suite.counts.REASONING_CONTRACT_BYPASS_COUNT} resource=${suite.counts.REASONING_RESOURCE_BYPASS_COUNT}`,
    '',
    '## 45. Reasoning budget',
    'Per case remains 3 calls for the trivial path and 6 otherwise. Fidelity corrections spend those calls. The budget was not doubled.',
    '',
    '## 46. Repeated-patch prevention',
    `REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT=${suite.counts.REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT}`,
    '',
    '## 47. Lesson memory',
    suite.results.map(item => `${item.caseId} ${item.lesson?.category ?? 'none'}`).join('\n'),
    '',
    '## 48. Hidden-solution filtering',
    `HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT=${suite.counts.HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT}`,
    '',
    '## 49. Practice queue',
    failed.map(item => selectNextCapabilityTask({
      capabilityClass: item.capabilityClass,
      difficulty: item.difficulty === 'D1' ? 'D2' : item.difficulty,
      recentResults: ['FAIL'],
      gap: item.failureGapCategory ?? item.notes[0] ?? 'verifier failed',
    })).map(item => `${item.capabilityClass} ${item.action} commanderMayProceed=${item.commanderMayProceed}`).join('\n') || 'none',
    '',
    '## 50. Difficulty state',
    `Qualifying passes in this run=${qualifyingPasses.length}. Selector action=${qualifyingPasses.length >= 3 ? difficulty.action : 'PRACTICE'}. Practice results do not advance difficulty.`,
    '',
    '## 51. Capability Atlas',
    'PLAN_TO_CODE_FIDELITY, POST_EDIT_VERIFICATION, and STRUCTURAL_REASONING are recorded from the checker and the case results. No score is assigned.',
    '',
    '## 52. Metrics',
    `contradictions=${suite.counts.REASONING_IMPLEMENTATION_CONTRADICTION_COUNT} recovered=${suite.counts.CONTRADICTION_RECOVERED_COUNT} inspections=${suite.results.reduce((sum, item) => sum + item.postEditInspections, 0)} modelCalls=${suite.results.reduce((sum, item) => sum + item.modelCalls, 0)}`,
    '',
    '## 53. PLAN_CORRECT_BUT_CODE_WRONG_COUNT',
    String(suite.counts.PLAN_CORRECT_BUT_CODE_WRONG_COUNT),
    '',
    '## 54-63. Counts',
    Object.entries(suite.counts).map(([key, value]) => `${key}=${value}`).join('\n'),
    '',
    '## 64. Fast validator',
    'pnpm run validate:foundry-reasoning-fidelity',
    '',
    '## 65. Full validator',
    'pnpm run validate:foundry-reasoning-fidelity:full',
    '',
    '## 66. Existing validators',
    'Engineering-reasoning and command-center validators were not rewritten.',
    '',
    '## 67. Protected-product changes',
    'None.',
    '',
    '## 68-74. Release',
    'BUILD=NO\nPACKAGE=NO\nINSTALL=NO\nACTIVATE=NO\nCANONICAL_COMMIT=NO\nCANONICAL_PUSH=NO\nDEPLOY=NO\nHVU_AUTHORIZED=NO',
    '',
    '## 75. Remaining blockers',
    Object.entries(outcomes).filter(([, value]) => value !== 'PASS').map(([key, value]) => `${key}=${value}`).join('\n') || 'none',
    '',
    '## 76. Mission 03 acceptance verdict',
    outcomes.REASONING_TO_IMPLEMENTATION_FIDELITY,
    '',
    '## 77. Recommended next reasoning mission',
    'Where the checker names a mismatch and qwen2.5-coder:14b still cannot repair it inside 6 calls, record MODEL_CAPABILITY_LIMIT_OBSERVED and consider one already-configured stronger model. Do not raise the budget first.',
    '',
    '## 78. Commander decision required',
    'YES',
    '',
    '## Required outcomes',
    Object.entries(outcomes).map(([key, value]) => `${key}=${value}`).join('\n'),
    '',
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
  ]
  writeFileSync(path.join(reportDir, 'FOUNDRY_REASONING_TO_IMPLEMENTATION_FIDELITY_AND_RECOVERY_REPORT.md'), lines.join('\n'), 'utf8')
  if (previous === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
  else process.env.FOUNDRY_CONTRACTS_ROOT = previous
  rmSync(contractsRoot, { recursive: true, force: true })
  rmSync(memoryRoot, { recursive: true, force: true })
  const fastIds = ['PRACTICE-M3-STOCK', 'PRACTICE-M3-RECEIPT', 'REASON-M2-SKU']
  const fastPass = fastIds.every(id => !cases.some(item => item.caseId === id) || suite.results.some(item => item.caseId === id && item.pass))
  if (partsCheck.status !== 'CONTRADICTED' || !partsCheck.planCorrectCodeWrong || outside.status !== 'IMPLEMENTED' || !resumeOk) process.exitCode = 1
  if (!full && (!fastPass || outcomes.COUNTS !== 'PASS' || outcomes.POST_EDIT_SOURCE_REINSPECTION !== 'PASS')) process.exitCode = 1
  if (full && Object.values(outcomes).some(value => value !== 'PASS')) process.exitCode = 1
  console.log(JSON.stringify(outcomes))
}

run().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
