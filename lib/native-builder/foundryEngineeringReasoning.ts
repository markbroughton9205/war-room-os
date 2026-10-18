/**
 * Foundry engineering reasoning cycle.
 * Foundry owns the process, memory, verification, and learning loop.
 * The routed model owns hypothesis generation. The Tool Broker owns execution.
 * Commander owns authority. This module does not grant any.
 * Dossiers store concise rationale and evidence, never hidden chain-of-thought.
 */
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FoundryCommandCenterGraph } from './foundryAgentTypes'
import type { FoundryStructuredReplanProposal } from './foundryReplanTypes'
import {
  FOUNDRY_CAPABILITY_DIFFICULTIES,
  FOUNDRY_REASONING_MAX_ATTEMPTS,
  FOUNDRY_REASONING_PASS_STREAK,
  FOUNDRY_REASONING_ROLES,
  FOUNDRY_REASONING_SCHEMA_VERSION,
  type FoundryAdversarialFinding,
  type FoundryCapabilityClass,
  type FoundryCapabilityDifficulty,
  type FoundryEngineeringDossier,
  type FoundryEngineeringLesson,
  type FoundryEngineeringOutcomeMetrics,
  type FoundryReasoningHypothesis,
  type FoundryReasoningObservation,
  type FoundryReasoningRole,
  type FoundryReasoningRoleAssignment,
  type FoundryReasoningStage,
} from './foundryEngineeringReasoningTypes'

const RATIONALE_LIMIT = 280
const HIDDEN_REASONING = /chain[- ]of[- ]thought|<thinking>|hidden reasoning/i
const SECRET_MATERIAL = /BEGIN [A-Z ]*PRIVATE KEY|api[_-]?key\s*[:=]\s*['"][^'"]{8,}['"]|password\s*[:=]\s*['"][^'"]+['"]/i
const WEAK_TEST = /assert\.ok\(\s*true\s*\)|expect\(\s*true\s*\)\.toBe\(\s*true\s*\)|it\.skip\(/
const ORACLE_MARKER = /GRAD_HIDDEN/

export type FoundryReasoningModel = {
  provider: string
  model: string
  choose(input: {
    symptom: string
    observations: Array<{ id: string; text: string }>
    hypotheses: Array<{ id: string; statement: string }>
    rejectedIds: string[]
    verifierFailure: string | null
  }): { hypothesisId: string; rationale: string }
}

export type FoundryReasoningCase = {
  caseId: string
  capabilityClass: FoundryCapabilityClass
  difficulty: FoundryCapabilityDifficulty
  symptom: string
  constraints: string[]
  files: Record<string, string>
  observations: FoundryReasoningObservation[]
  hypotheses: FoundryReasoningHypothesis[]
  uncertainties: string[]
  predictedFailureModes: string[]
  verifySource: string
  hiddenAnswer: string
}

export type FoundryReasoningCycleResult = {
  caseId: string
  capabilityClass: FoundryCapabilityClass
  difficulty: FoundryCapabilityDifficulty
  stages: FoundryReasoningStage[]
  dossier: FoundryEngineeringDossier
  metrics: FoundryEngineeringOutcomeMetrics
  lesson: FoundryEngineeringLesson
  findings: FoundryAdversarialFinding[]
  oracleLeak: boolean
  model: { provider: string; model: string }
}

export function formatReasoningDossierSections(dossier: FoundryEngineeringDossier | null | undefined): string[] {
  if (!dossier) return []
  const lesson = dossier.excerpts.find(item => item.startsWith('LESSON:'))
  return [
    dossier.problemModel ? `Understanding: ${dossier.problemModel}` : '',
    dossier.uncertainties.length ? `Uncertainties: ${dossier.uncertainties.slice(0, 6).join('; ')}` : '',
    dossier.selectedApproach ? `Approach: ${dossier.selectedApproach}` : '',
    dossier.rootCause ? `Root Cause: ${dossier.rootCause}` : '',
    lesson ? lesson : '',
    dossier.alternatives.length ? `Candidates: ${dossier.alternatives.slice(0, 6).join(' | ')}` : '',
  ].filter(Boolean)
}

export function conciseRationale(value: string): string {
  return value.replace(HIDDEN_REASONING, '').replace(/\s+/g, ' ').trim().slice(0, RATIONALE_LIMIT)
}

export function operationalRoleForReasoningRole(
  role: FoundryReasoningRole,
  surface: 'backend' | 'frontend' | 'database' | 'any' = 'any',
): FoundryReasoningRoleAssignment['operationalRole'] {
  if (role === 'IMPLEMENTER') {
    if (surface === 'frontend') return 'FRONTEND'
    if (surface === 'database') return 'DATABASE'
    return 'BACKEND'
  }
  if (role === 'TEST_ENGINEER') return 'TEST'
  return role
}

export function assignReasoningRoles(input: {
  models: Array<{ provider: string; model: string }>
  surface?: 'backend' | 'frontend' | 'database' | 'any'
}): FoundryReasoningRoleAssignment[] {
  const models = input.models.filter(model => model.provider && model.model)
  const primary = models[0] ?? { provider: 'unconfigured', model: 'unconfigured' }
  const alternate = models[1] ?? primary
  const shared = models.length < 2
  return FOUNDRY_REASONING_ROLES.map(role => {
    const useAlternate = !shared && (role === 'REVIEWER' || role === 'VERIFIER')
    const selected = useAlternate ? alternate : primary
    return {
      reasoningRole: role,
      operationalRole: operationalRoleForReasoningRole(role, input.surface ?? 'any'),
      provider: selected.provider,
      model: selected.model,
      reason: shared
        ? 'Same routed model fills this reasoning role. Models stay interchangeable.'
        : useAlternate
          ? 'Distinct routed model fills review and verification. Models stay interchangeable.'
          : 'Routed model fills this reasoning role. Models stay interchangeable.',
    }
  })
}

export function detectReasoningShortcut(
  files: Record<string, string>,
  observations: FoundryReasoningObservation[],
): string | null {
  if (Object.keys(files).some(name => name === 'verify.mjs' || name.endsWith('.expected.json'))) return 'VERIFIER_MUTATION'
  const blob = Object.entries(files).map(([name, body]) => `${name}\n${body}`).join('\n')
  if (ORACLE_MARKER.test(blob) || HIDDEN_REASONING.test(blob)) return 'ORACLE_LEAK'
  if (WEAK_TEST.test(blob)) return 'WEAK_TEST'
  const surface = observations.find(item => item.facts.defectSurface)?.facts.defectSurface
  const testOnly = Object.keys(files).length > 0 && Object.keys(files).every(name => /\.(test|spec)\./.test(name))
  if (testOnly && surface === 'contract') {
    const field = observations.find(item => typeof item.facts.contractField === 'string')?.facts.contractField
    const stale = observations.find(item => typeof item.facts.testReads === 'string')?.facts.testReads
    const assertsContract = typeof field === 'string' && (blob.includes(`.${field}`) || blob.includes(`["${field}"]`))
    const stillStale = typeof stale === 'string' && stale !== field && blob.includes(`.${stale}`)
    if (!assertsContract || stillStale) return 'WEAK_TEST'
  } else if (testOnly && (surface === 'behavior' || surface === 'performance' || surface === 'architecture')) {
    return 'WEAK_TEST'
  }
  if (/LIMIT\s*=\s*\d{6,}/.test(blob)) return 'RAISE_LIMIT'
  if (observations.some(item => item.facts.signatureArity === 1) && /export function \w+\([^)\n]+,/.test(blob)) {
    return 'SIGNATURE_CHANGE'
  }
  if (/catch\s*\([^)]*\)\s*\{[^}]*return\s+(true|null|raw)\b/.test(blob)) return 'SWALLOW_ERROR'
  return null
}

function factsConflict(
  claim: Record<string, string | number | boolean>,
  observation: FoundryReasoningObservation,
): boolean {
  return Object.entries(claim).some(([key, value]) => key in observation.facts && observation.facts[key] !== value)
}

export function critiqueHypothesis(
  hypothesis: FoundryReasoningHypothesis,
  observations: FoundryReasoningObservation[],
): { admit: boolean; reason: string } {
  const shortcut = detectReasoningShortcut(hypothesis.files, observations)
  if (shortcut) return { admit: false, reason: `Rejected shortcut ${shortcut}. Evidence does not support a superficial patch.` }
  if (!hypothesis.cites.length) return { admit: false, reason: 'Rejected. No tool observation was cited.' }
  const cited = hypothesis.cites.map(id => observations.find(item => item.id === id))
  if (cited.some(item => !item)) return { admit: false, reason: 'Rejected. Cited observation does not exist.' }
  const known = cited.filter((item): item is FoundryReasoningObservation => Boolean(item))
  if (known.some(item => factsConflict(hypothesis.claimFacts, item))) {
    return { admit: false, reason: 'Rejected. Claim contradicts a cited tool observation.' }
  }
  return { admit: true, reason: 'Admitted for a trial. Cited observations do not contradict the claim.' }
}

export function dossierFromMission(input: { missionId: string; goal: string }): FoundryEngineeringDossier {
  return {
    schemaVersion: FOUNDRY_REASONING_SCHEMA_VERSION,
    missionId: input.missionId,
    capabilityClass: 'MISSION',
    problemModel: conciseRationale(input.goal || 'Mission goal not yet stated.'),
    assumptions: [],
    uncertainties: ['Edge cases stay open until a tool observation names them.'],
    codebaseModel: [],
    hypotheses: [],
    alternatives: [],
    selectedApproach: '',
    rejected: [],
    predictedFailureModes: [],
    observedFailures: [],
    rootCause: '',
    missingRequirementIds: [],
    excerpts: [],
  }
}

export function evaluateAdversarialReview(dossier: FoundryEngineeringDossier): FoundryAdversarialFinding[] {
  const findings: FoundryAdversarialFinding[] = []
  const push = (kind: FoundryAdversarialFinding['kind'], summary: string, evidenceRef: string, blocksReady: boolean) => {
    findings.push({
      findingId: `AF-${findings.length + 1}`,
      kind,
      summary: conciseRationale(summary),
      evidenceRef,
      blocksReady,
      resolved: false,
    })
  }
  for (const assumption of dossier.assumptions) {
    if (!assumption.statedAsFact) continue
    if (!assumption.evidenceIds.length) {
      push('INCORRECT_ASSUMPTION', `Assumption "${assumption.statement}" is stated as fact without tool evidence.`, assumption.id, true)
      continue
    }
  }
  const excerpt = dossier.excerpts.join('\n')
  if (SECRET_MATERIAL.test(excerpt)) push('SECURITY', 'Diff excerpt contains secret material.', 'excerpt', true)
  if (WEAK_TEST.test(excerpt)) push('WEAK_TEST', 'A test asserts true or is skipped instead of checking behavior.', 'excerpt', true)
  if (dossier.missingRequirementIds.length) {
    push('INCOMPLETE_REQUIREMENT', `Requirements lack evidence: ${dossier.missingRequirementIds.join(', ')}.`, 'requirements', true)
  }
  if (dossier.observedFailures.some(item => /regression|contract field/i.test(item)) && !dossier.selectedApproach) {
    push('REGRESSION', 'A regression was observed and no repaired approach is selected.', 'verifier', true)
  }
  if (dossier.capabilityClass === 'CROSS_STACK_INTEGRATION' && dossier.selectedApproach && /client only|server only|one side/i.test(dossier.selectedApproach)) {
    push('BROKEN_INTEGRATION', 'Selected approach changes only one side of a cross-stack contract.', 'integration', true)
  }
  if (dossier.uncertainties.some(item => /untested edge/i.test(item)) && dossier.predictedFailureModes.length === 0) {
    push('MISSING_EDGE', 'An untested edge is open and no failure mode was predicted.', 'uncertainties', false)
  }
  if (dossier.codebaseModel.length > 8 && /rewrite|new framework|second service/i.test(dossier.selectedApproach)) {
    push('ACCIDENTAL_COMPLEXITY', 'Selected approach expands a local defect into a stack rewrite.', 'approach', true)
  }
  return findings
}

export function findingsToReplanProposal(
  graph: FoundryCommandCenterGraph,
  findings: FoundryAdversarialFinding[],
): FoundryStructuredReplanProposal | null {
  const blocking = findings.filter(item => item.blocksReady && !item.resolved)
  if (!blocking.length) return null
  const traced = graph.tasks.find(task => (task.requirementIds?.length ?? 0) > 0 || (task.criterionIds?.length ?? 0) > 0)
  if (!traced) return null
  const lead = blocking[0]
  return {
    level: 'L2',
    reason: `Adversarial review: ${lead.kind}. ${lead.summary}`,
    failureClass: 'IMPLEMENTATION_BUG',
    changedTaskIds: [],
    newTasks: [{
      title: `Repair adversarial finding ${lead.kind}`,
      role: 'DEBUGGER',
      dependsOn: [],
      requirementIds: [...traced.requirementIds],
      criterionIds: [...(traced.criterionIds ?? [])],
      mutating: true,
      strategy: 'adversarial-repair',
    }],
    removedTaskIds: [],
    dependencyChanges: [],
    expectedProgressSignal: 'Blocking adversarial finding cleared with new tool evidence.',
    expandsMission: false,
    changesAcceptance: false,
    taskId: traced.taskId,
  }
}

export function reviewGraphForAdversarialFindings(graph: FoundryCommandCenterGraph): {
  findings: FoundryAdversarialFinding[]
  blocksReady: boolean
  proposal: FoundryStructuredReplanProposal | null
} {
  if (!graph.reasoningDossier) graph.reasoningDossier = dossierFromMission({ missionId: graph.missionId, goal: graph.goal })
  const dossier = graph.reasoningDossier
  const taskBlob = graph.tasks.map(task => `${task.result}\n${task.tests.detail}`).join('\n')
  if (taskBlob.trim()) dossier.excerpts = [...dossier.excerpts, taskBlob.slice(0, 500)]
  const findings = evaluateAdversarialReview(dossier)
  graph.adversarialFindings = findings
  const blocksReady = findings.some(item => item.blocksReady && !item.resolved)
  return {
    findings,
    blocksReady,
    proposal: blocksReady ? findingsToReplanProposal(graph, findings) : null,
  }
}

function emptyMetrics(): FoundryEngineeringOutcomeMetrics {
  return {
    firstPlanSuccess: false,
    failedHypothesisRecovery: false,
    unnecessaryEditCount: 0,
    regressionCount: 0,
    verifierFoundDefectCount: 0,
    repeatedErrorCount: 0,
    replanSuccess: false,
    toolCalls: 0,
    usefulToolCalls: 0,
    toolEfficiency: 0,
    modelCalls: 0,
    acceptanceSuccess: false,
  }
}

export function verifyHypothesisFiles(
  reasoningCase: FoundryReasoningCase,
  files: Record<string, string>,
): { ok: boolean; output: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'wr-reason-'))
  try {
    const merged = { ...reasoningCase.files, ...files, 'verify.mjs': reasoningCase.verifySource }
    for (const [name, body] of Object.entries(merged)) {
      const dest = path.join(dir, name)
      mkdirSync(path.dirname(dest), { recursive: true })
      writeFileSync(dest, body, 'utf8')
    }
    const result = spawnSync(process.execPath, ['verify.mjs'], { cwd: dir, encoding: 'utf8', timeout: 8000 })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    return { ok: result.status === 0, output: output || (result.status === 0 ? 'pass' : 'verifier failed') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function runCapabilityEvaluation(input: {
  reasoningCase: FoundryReasoningCase
  model: FoundryReasoningModel
  missionId?: string
}): FoundryReasoningCycleResult {
  const reasoningCase = input.reasoningCase
  const stages: FoundryReasoningStage[] = ['MISSION', 'UNDERSTAND', 'CODEBASE_MODEL', 'UNCERTAINTIES', 'CANDIDATES']
  const rejected: Array<{ statement: string; reason: string }> = []
  const observedFailures: string[] = []
  const hypotheses = reasoningCase.hypotheses.map(item => ({
    id: item.id,
    statement: conciseRationale(item.statement),
    status: 'open' as 'open' | 'rejected' | 'failed' | 'selected',
  }))
  const closed = new Set<string>()
  const metrics = emptyMetrics()
  metrics.toolCalls = reasoningCase.observations.length
  let selected = ''
  let rootCause = ''
  let replans = 0
  let hadFailure = false
  const seenFailure = new Map<string, number>()
  const usedEvidence = new Set<string>()

  for (let attempt = 0; attempt < FOUNDRY_REASONING_MAX_ATTEMPTS; attempt += 1) {
    stages.push('CRITIQUE')
    const choice = input.model.choose({
      symptom: reasoningCase.symptom,
      observations: reasoningCase.observations.map(item => ({ id: item.id, text: item.text })),
      hypotheses: reasoningCase.hypotheses.map(item => ({ id: item.id, statement: item.statement })),
      rejectedIds: [...closed],
      verifierFailure: observedFailures.at(-1) ?? null,
    })
    metrics.modelCalls += 1
    const rationale = conciseRationale(choice.rationale || '')
    void rationale
    const hypothesis = reasoningCase.hypotheses.find(item => item.id === choice.hypothesisId)
    const record = hypotheses.find(item => item.id === choice.hypothesisId)
    if (!hypothesis || !record) {
      hadFailure = true
      rejected.push({ statement: choice.hypothesisId, reason: 'Rejected. Unknown hypothesis.' })
      closed.add(choice.hypothesisId)
      replans += 1
      stages.push('REPLAN')
      continue
    }
    if (closed.has(hypothesis.id)) {
      hadFailure = true
      metrics.repeatedErrorCount += 1
      rejected.push({ statement: hypothesis.statement, reason: 'Rejected repeated failed hypothesis.' })
      replans += 1
      stages.push('REPLAN')
      if (metrics.repeatedErrorCount >= 2) break
      continue
    }
    const priorFails = seenFailure.get(hypothesis.id) ?? 0
    if (priorFails > 0) {
      metrics.repeatedErrorCount += 1
      hadFailure = true
      rejected.push({ statement: hypothesis.statement, reason: 'Rejected repeated failed hypothesis.' })
      closed.add(hypothesis.id)
      replans += 1
      stages.push('REPLAN')
      if (metrics.repeatedErrorCount >= 2) break
      continue
    }
    const critique = critiqueHypothesis(hypothesis, reasoningCase.observations)
    if (!critique.admit) {
      hadFailure = true
      record.status = 'rejected'
      closed.add(hypothesis.id)
      rejected.push({ statement: hypothesis.statement, reason: critique.reason })
      replans += 1
      stages.push('DIAGNOSE', 'REPLAN')
      continue
    }
    stages.push('SELECT')
    hypothesis.cites.forEach(id => usedEvidence.add(id))
    stages.push('IMPLEMENT', 'TEST', 'OBSERVE')
    const outcome = verifyHypothesisFiles(reasoningCase, hypothesis.files)
    if (!outcome.ok) {
      hadFailure = true
      record.status = 'failed'
      closed.add(hypothesis.id)
      seenFailure.set(hypothesis.id, priorFails + 1)
      metrics.unnecessaryEditCount += 1
      metrics.verifierFoundDefectCount += 1
      const failure = conciseRationale(outcome.output || 'Verifier failed.')
      observedFailures.push(failure)
      if (/regression|contract field/i.test(failure)) metrics.regressionCount += 1
      rejected.push({ statement: hypothesis.statement, reason: `Verifier failed: ${failure}` })
      replans += 1
      stages.push('DIAGNOSE', 'REPLAN')
      continue
    }
    record.status = 'selected'
    selected = hypothesis.statement
    rootCause = conciseRationale(reasoningCase.observations.map(item => item.text).join(' '))
    metrics.firstPlanSuccess = attempt === 0
    break
  }

  const citedAssumption = reasoningCase.observations[0]
  const dossier: FoundryEngineeringDossier = {
    schemaVersion: FOUNDRY_REASONING_SCHEMA_VERSION,
    missionId: input.missionId ?? reasoningCase.caseId,
    capabilityClass: reasoningCase.capabilityClass,
    problemModel: conciseRationale(reasoningCase.symptom),
    assumptions: citedAssumption ? [{
      id: 'A-observed',
      statement: conciseRationale(citedAssumption.text),
      evidenceIds: [citedAssumption.id],
      statedAsFact: true,
      claimFacts: citedAssumption.facts,
    }] : [],
    uncertainties: reasoningCase.uncertainties.map(conciseRationale),
    codebaseModel: Object.keys(reasoningCase.files),
    hypotheses,
    alternatives: reasoningCase.hypotheses.map(item => conciseRationale(item.statement)),
    selectedApproach: conciseRationale(selected),
    rejected: rejected.map(item => ({ statement: conciseRationale(item.statement), reason: conciseRationale(item.reason) })),
    predictedFailureModes: reasoningCase.predictedFailureModes.map(conciseRationale),
    observedFailures,
    rootCause,
    missingRequirementIds: [],
    excerpts: [],
  }
  stages.push('ADVERSARIAL_REVIEW')
  const findings = evaluateAdversarialReview(dossier).map(item => ({
    ...item,
    resolved: Boolean(selected) && item.kind !== 'SECURITY',
    blocksReady: Boolean(selected) ? false : item.blocksReady,
  }))
  const blocking = findings.some(item => item.blocksReady && !item.resolved)
  stages.push('VERIFY', 'LEARN')
  metrics.usefulToolCalls = usedEvidence.size
  metrics.toolEfficiency = metrics.toolCalls === 0 ? 0 : Number((metrics.usefulToolCalls / metrics.toolCalls).toFixed(2))
  metrics.failedHypothesisRecovery = hadFailure && Boolean(selected) && !blocking
  metrics.replanSuccess = replans > 0 && Boolean(selected) && !blocking
  metrics.acceptanceSuccess = Boolean(selected) && !blocking
  const lesson: FoundryEngineeringLesson = {
    schemaVersion: FOUNDRY_REASONING_SCHEMA_VERSION,
    lessonId: `LSN-${randomUUID()}`,
    capabilityClass: reasoningCase.capabilityClass,
    problemPattern: conciseRationale(reasoningCase.symptom),
    failedApproach: conciseRationale(rejected.map(item => item.statement).join(' | ') || 'None.'),
    successfulApproach: conciseRationale(selected || 'None verified.'),
    rootCause: rootCause || 'Unresolved.',
    toolEvidence: [...usedEvidence],
    projectConstraints: reasoningCase.constraints.map(conciseRationale),
    sourceMissionId: dossier.missionId,
  }
  const publicText = JSON.stringify({ dossier, metrics, lesson, findings })
  const oracleLeak = publicText.includes(reasoningCase.hiddenAnswer) || ORACLE_MARKER.test(publicText) || HIDDEN_REASONING.test(publicText)
  if (oracleLeak) metrics.acceptanceSuccess = false
  return {
    caseId: reasoningCase.caseId,
    capabilityClass: reasoningCase.capabilityClass,
    difficulty: reasoningCase.difficulty,
    stages: [...new Set(stages)],
    dossier,
    metrics,
    lesson,
    findings,
    oracleLeak,
    model: { provider: input.model.provider, model: input.model.model },
  }
}

const LESSON_FIELDS = ['problemPattern', 'failedApproach', 'successfulApproach', 'rootCause', 'projectConstraints', 'category'] as const

export function recallEngineeringLessons(root: string, query: string): FoundryEngineeringLesson[] {
  const dir = path.join(root, 'lessons')
  if (!existsSync(dir)) return []
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 4)
  const hits: FoundryEngineeringLesson[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      const lesson = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as FoundryEngineeringLesson
      if (lessonRetainsHiddenAnswer(lesson, [])) continue
      const blob = `${lesson.problemPattern} ${lesson.rootCause} ${lesson.successfulApproach}`.toLowerCase()
      if (tokens.some(token => blob.includes(token))) hits.push(lesson)
    } catch {
      continue
    }
  }
  return hits.slice(0, 3)
}

export function lessonRetainsHiddenAnswer(lesson: FoundryEngineeringLesson, forbiddenFragments: string[]): boolean {
  const blob = JSON.stringify(lesson)
  if (ORACLE_MARKER.test(blob) || HIDDEN_REASONING.test(blob)) return true
  return forbiddenFragments.some(fragment => fragment && blob.includes(fragment))
}

export function retainEngineeringLesson(
  lesson: FoundryEngineeringLesson,
  options?: { root?: string; forbiddenFragments?: string[] },
): { ok: boolean; reason: string; lesson?: FoundryEngineeringLesson } {
  if (!lesson.problemPattern || !lesson.rootCause) return { ok: false, reason: 'Lesson is missing the problem pattern or root cause.' }
  if (lessonRetainsHiddenAnswer(lesson, options?.forbiddenFragments ?? [])) {
    return { ok: false, reason: 'Refused. Engineering memory does not retain hidden graduation answers.' }
  }
  for (const field of LESSON_FIELDS) {
    const value = lesson[field]
    if (typeof value === 'string' && HIDDEN_REASONING.test(value)) {
      return { ok: false, reason: 'Refused. Lesson contained hidden reasoning.' }
    }
  }
  if (options?.root) {
    const dir = path.join(options.root, 'lessons')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, `${lesson.lessonId}.json`), JSON.stringify(lesson, null, 2), 'utf8')
  }
  return { ok: true, reason: 'Lesson retained as a reusable pattern without a hidden answer.', lesson }
}

export function selectNextCapabilityTask(input: {
  capabilityClass: FoundryCapabilityClass
  difficulty: FoundryCapabilityDifficulty
  recentResults: Array<'PASS' | 'FAIL'>
  gap?: string | null
}): {
  commanderMayProceed: true
  authorityUnchanged: true
  missionContractUnchanged: true
  action: 'INCREASE_DIFFICULTY' | 'PRACTICE' | 'DIAGNOSE_AND_PRACTICE'
  capabilityClass: FoundryCapabilityClass
  difficulty: FoundryCapabilityDifficulty
  nextDifficulty: FoundryCapabilityDifficulty
  gap: string | null
  practice: string
} {
  const recent = input.recentResults.slice(-FOUNDRY_REASONING_PASS_STREAK)
  const streak = recent.length === FOUNDRY_REASONING_PASS_STREAK && recent.every(item => item === 'PASS')
  const index = FOUNDRY_CAPABILITY_DIFFICULTIES.indexOf(input.difficulty)
  const nextDifficulty = streak
    ? FOUNDRY_CAPABILITY_DIFFICULTIES[Math.min(index + 1, FOUNDRY_CAPABILITY_DIFFICULTIES.length - 1)]
    : input.difficulty
  const failed = input.recentResults.at(-1) === 'FAIL'
  const gap = failed
    ? (input.gap || `Capability ${input.capabilityClass} failed at ${input.difficulty}. Diagnose the failed hypothesis, gather the missing observation, and practice the same class.`)
    : null
  const action = failed ? 'DIAGNOSE_AND_PRACTICE' : streak && nextDifficulty !== input.difficulty ? 'INCREASE_DIFFICULTY' : 'PRACTICE'
  return {
    commanderMayProceed: true,
    authorityUnchanged: true,
    missionContractUnchanged: true,
    action,
    capabilityClass: input.capabilityClass,
    difficulty: input.difficulty,
    nextDifficulty,
    gap,
    practice: `Practice ${input.capabilityClass} at ${nextDifficulty}. Commander projects stay available.`,
  }
}
