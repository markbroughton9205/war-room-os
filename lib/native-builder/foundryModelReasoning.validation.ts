/**
 * Real routed-model reasoning validation.
 * Disposable fixtures only. No package, install, activate, commit, push, or deploy.
 */
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { selectModelReasoningCases } from './foundryModelReasoningCases'
import {
  modelReasoningOutcomes,
  reasoningAtlasStatus,
  runModelReasoningSuite,
  verifierRejectsSuperficial,
} from './foundryModelReasoning'
import { selectNextCapabilityTask } from './foundryEngineeringReasoning'

function git(command: string): string {
  try {
    return execSync(command, { cwd: resolveRepoRoot(), encoding: 'utf8' }).trim()
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 200) : 'unknown'
  }
}

function liveInstallId(): string {
  try {
    const names = readdirSync('/home/chosenone/.local/opt').filter(name => name.startsWith('war-room-os-'))
    return names[0] ?? 'none recorded'
  } catch {
    return 'none recorded'
  }
}

async function run(): Promise<void> {
  const full = process.env.FOUNDRY_REASONING_FULL === '1'
  const ids = process.env.FOUNDRY_REASONING_CASES?.split(',').map(item => item.trim()).filter(Boolean)
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-m2-c-'))
  const memoryRoot = mkdtempSync(path.join(tmpdir(), 'wr-m2-mem-'))
  const previous = process.env.FOUNDRY_CONTRACTS_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  const repo = resolveRepoRoot()
  const head = git('git rev-parse HEAD')
  const branch = git('git rev-parse --abbrev-ref HEAD')
  const dirty = git('git status --porcelain')
  const dirtyCount = dirty ? dirty.split('\n').filter(Boolean).length : 0
  const cases = selectModelReasoningCases({ full, ids })
  const superficial = cases.map(item => {
    const result = verifierRejectsSuperficial(item)
    return { caseId: item.caseId, rejected: result.ok === false, output: result.output.slice(0, 120) }
  })
  const suite = await runModelReasoningSuite({ full, ids, memoryRoot })
  const outcomes = modelReasoningOutcomes(suite)
  const atlas = reasoningAtlasStatus(suite.results)
  const failedPractice = suite.results.filter(item => !item.pass && !item.trivial).map(item => selectNextCapabilityTask({
    capabilityClass: item.capabilityClass,
    difficulty: item.difficulty === 'D1' ? 'D2' : item.difficulty,
    recentResults: ['FAIL'],
    gap: item.notes[0] ?? item.failureClass ?? 'verifier failed',
  }))
  const reportDir = path.join(repo, 'tmp', 'foundry-model-reasoning')
  mkdirSync(reportDir, { recursive: true })
  const lines = suite.results.map(item => `${item.pass ? 'PASS' : item.acceptanceResult} ${item.caseId} provider=${item.provider ?? 'none'} model=${item.model ?? 'none'} calls=${item.modelCalls} first=${item.firstHypothesisCorrect} recovered=${item.badHypothesisRecovered} edits=${item.unnecessaryEdits} ${item.notes.join('; ')}`)
  for (const line of lines) console.log(line)
  for (const item of superficial) console.log(`${item.rejected ? 'PASS' : 'FAIL'} SUPERFICIAL ${item.caseId} ${item.output}`)
  console.log(JSON.stringify(outcomes))
  const requiredFail = Object.entries(outcomes).filter(([, value]) => value !== 'PASS')
  const report = [
    '# FOUNDRY_MODEL_DRIVEN_DELIBERATE_ENGINEERING_REASONING_REPORT',
    '',
    '## 1. Repo identity',
    `${repo} branch ${branch} HEAD ${head}`,
    '',
    '## 2. Live install identity',
    liveInstallId(),
    '',
    '## 3. Dirty baseline',
    `${dirtyCount} dirty or untracked paths. Tree was not cleaned.`,
    '',
    '## 4. Modified files',
    'lib/native-builder/foundryModelReasoning.ts, foundryModelReasoningCases.ts, foundryModelReasoning.validation.ts, foundryEngineeringReasoning.ts, foundryAgentCommandCenter.ts, package.json',
    '',
    '## 5. Reasoning architecture',
    'Accepted dossier, roles, adversarial review, and replan path. This mission routes a real model through FoundryModelRouter and writes only with unattendedToolBrokerWrite.',
    '',
    '## 6. Actual provider/model',
    `${suite.provider ?? 'none'} / ${suite.model ?? 'none'}`,
    '',
    '## 7. Routing policy',
    suite.policy,
    '',
    '## 8. Dossier schema',
    'Model labels map onto FoundryEngineeringDossier: problemModel, assumptions, uncertainties, alternatives, selectedApproach, rejected, predictedFailureModes, observedFailures, rootCause. Lesson is a separate FoundryEngineeringLesson.',
    '',
    '## 9. Dossier bounds',
    'problemModel 1200, assumptions 12, uncertainties 12, alternatives 6, rejected 6, predicted 10, observed 10, rootCause 1600, lesson 1200.',
    '',
    '## 10. Role mapping',
    'ARCHITECT, TEST_ENGINEER, and REVIEWER are read-only. IMPLEMENTER and DEBUGGER may propose file.write or file.replace_unique. One routed model may fill every role.',
    '',
    '## 11-16. Role behavior',
    suite.results.map(item => `${item.caseId}: ${item.roles.map(role => role.role).join(' -> ') || 'none'}`).join('\n'),
    '',
    '## 17. Optional second model',
    suite.secondModel ? `Configured but not required and not forced: ${suite.secondModel}` : 'No second routed model was required.',
    '',
    '## 18. Hypothesis model',
    'SUPPORTED, REJECTED, or UNRESOLVED from verifier evidence. No separate science subsystem.',
    '',
    '## 19. Bad-hypothesis recovery',
    String(outcomes.MODEL_BAD_HYPOTHESIS_RECOVERY),
    '',
    '## 20. Correct-first-hypothesis behavior',
    String(outcomes.CORRECT_FIRST_HYPOTHESIS_EFFICIENCY),
    '',
    '## 21. Superficial-fix rejection',
    superficial.map(item => `${item.caseId} rejected=${item.rejected}`).join('\n'),
    '',
    '## 22-30. Cases',
    lines.join('\n'),
    '',
    '## 31. Verifier separation',
    'verify.mjs is written only while the independent check runs and deleted before the next model turn.',
    '',
    '## 32. Reference-repair state',
    `REASONING_REFERENCE_REPAIR_COUNT=${suite.counts.REASONING_REFERENCE_REPAIR_COUNT}`,
    '',
    '## 33. Tool Broker path',
    'Model file content is applied only by unattendedToolBrokerWrite.',
    '',
    '## 34. Resource budget',
    'Per case: 3 model calls on the trivial path, 6 otherwise. Token budget funds those calls and does not rise after the case starts. Automatic budget increase stays refused.',
    '',
    '## 35. Adaptive effort',
    'Debugger turns run only after a verifier contradiction. A passing verifier stops further edits.',
    '',
    '## 36. Trivial fast path',
    String(outcomes.REASONING_OVERHEAD),
    '',
    '## 37. Adversarial review',
    String(outcomes.ADVERSARIAL_REVIEW),
    '',
    '## 38. Adversarial replan',
    String(outcomes.ADVERSARIAL_REPLAN),
    '',
    '## 39. Reviewer false positives',
    `Advisory concerns: ${suite.results.reduce((sum, item) => sum + item.advisoryReviewCount, 0)}. Unsupported concerns do not open another repair cycle.`,
    '',
    '## 40. Reasoning metrics',
    suite.results.map(item => `${item.caseId} first=${item.firstHypothesisCorrect} recovered=${item.badHypothesisRecovered} rejected=${item.hypothesesRejected} edits=${item.unnecessaryEdits} regressions=${item.regressions} defects=${item.verifierDefects} repeats=${item.repeatedErrors} replans=${item.replans} tools=${item.toolCalls} models=${item.modelCalls} tests=${item.tests} acceptance=${item.acceptanceResult}`).join('\n'),
    '',
    '## 41. Lesson storage',
    suite.results.map(item => `${item.caseId} lesson=${item.lesson ? 'yes' : 'no'}`).join('\n'),
    '',
    '## 42. Hidden-answer filtering',
    `HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT=${suite.counts.HIDDEN_SOLUTION_LESSON_ACCEPT_COUNT}`,
    '',
    '## 43. Memory retrieval',
    suite.results.map(item => `${item.caseId} retrieved=${item.lessonRetrieved}`).join('\n'),
    '',
    '## 44. Memory-benefit observation',
    'Causation is ambiguous unless a later case both retrieved a generic lesson and passed with a correct first hypothesis. This run does not claim a stronger causal result.',
    '',
    '## 45. Difficulty progression',
    String(outcomes.DIFFICULTY_PROGRESSION),
    '',
    '## 46. Practice queue',
    failedPractice.length ? failedPractice.map(item => `${item.capabilityClass} ${item.action} ${item.gap ?? ''}`).join('\n') : 'No failed qualifying case.',
    '',
    '## 47. Capability Atlas integration',
    atlas.map(item => `${item.family} ${item.status}`).join('\n') || 'none',
    '',
    '## 48. Commander UI',
    'Existing review artifact can show Understanding, Uncertainties, Approach, Root Cause, Candidates, and Lesson. No new panel.',
    '',
    '## 49. Chain-of-thought privacy',
    `REASONING_RAW_CHAIN_OF_THOUGHT_STORED_COUNT=${suite.counts.REASONING_RAW_CHAIN_OF_THOUGHT_STORED_COUNT}`,
    '',
    '## 50. Model interchangeability',
    'The runner depends on FoundryModelRouter and the typed decision contract, not on a vendor name.',
    '',
    '## 51. Fast validator',
    'pnpm run validate:foundry-model-reasoning',
    '',
    '## 52. Full validator',
    'pnpm run validate:foundry-model-reasoning:full',
    '',
    '## 53. Existing validator results',
    'Mission 01 reasoning and command-center validators were not rewritten. Re-run them after this suite.',
    '',
    '## 54-62. Counts',
    Object.entries(suite.counts).map(([key, value]) => `${key}=${value}`).join('\n'),
    '',
    '## 63-69. Aggregate',
    `firstPlanSuccess=${suite.results.filter(item => item.firstHypothesisCorrect).length}`,
    `badHypothesisRecovery=${suite.results.filter(item => item.badHypothesisRecovered).length}`,
    `unnecessaryEdits=${suite.results.reduce((sum, item) => sum + item.unnecessaryEdits, 0)}`,
    `regressions=${suite.results.reduce((sum, item) => sum + item.regressions, 0)}`,
    `verifierDefects=${suite.results.reduce((sum, item) => sum + item.verifierDefects, 0)}`,
    `repeatedErrors=${suite.results.reduce((sum, item) => sum + item.repeatedErrors, 0)}`,
    `replanSuccess=${suite.results.filter(item => item.adversarialReplanApplied).length}`,
    '',
    '## 70. Provider evidence',
    suite.results.map(item => `${item.caseId} ${item.provider ?? 'none'}:${item.model ?? 'none'} reason=${item.routingReason ?? 'none'} fallback=${item.fallback} wallMs=${item.wallClockMs} tokens=${item.tokens} cost=${item.costState}`).join('\n'),
    '',
    '## 71. Protected-product modifications',
    'None. Terra, Harbor, Lane & Box, Inventory, Higher Vision Studios, and WRIM were not modified.',
    '',
    '## 72. Build',
    'NO',
    '',
    '## 73. Package',
    'NO',
    '',
    '## 74. Install',
    'NO',
    '',
    '## 75. Activate',
    'NO',
    '',
    '## 76. Canonical commit',
    'NO',
    '',
    '## 77. Canonical push',
    'NO',
    '',
    '## 78. Deploy',
    'NO',
    '',
    '## 79. Remaining blockers',
    requiredFail.length ? requiredFail.map(([key, value]) => `${key}=${value}`).join('\n') : 'None in this suite.',
    '',
    '## 80. Recommended next reasoning mission',
    'Run the same qualifying cases through a second already-configured provider without raising budgets, and compare recovery counts.',
    '',
    '## 81. Commander decision required',
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
  ].join('\n')
  writeFileSync(path.join(reportDir, 'FOUNDRY_MODEL_DRIVEN_DELIBERATE_ENGINEERING_REASONING_REPORT.md'), report, 'utf8')
  writeFileSync(path.join(reportDir, 'suite.json'), JSON.stringify({ outcomes, counts: suite.counts, results: suite.results.map(item => ({ ...item, dossier: { problemModel: item.dossier.problemModel, rootCause: item.dossier.rootCause, selectedApproach: item.dossier.selectedApproach } })) }, null, 2), 'utf8')
  if (previous === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
  else process.env.FOUNDRY_CONTRACTS_ROOT = previous
  rmSync(contractsRoot, { recursive: true, force: true })
  rmSync(memoryRoot, { recursive: true, force: true })
  if (superficial.some(item => !item.rejected) || requiredFail.length) process.exit(1)
}

run().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
