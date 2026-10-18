/**
 * Structured reasoning export for a future WRIM curriculum.
 * This module does not train a model.
 */
import { createHash } from 'node:crypto'
import type { FoundryReasoningExportRecord } from './program-types'
import type { FoundryReasoningSession } from './types'

const SECRET = /BEGIN [A-Z ]*PRIVATE KEY|api[_-]?key\s*[:=]\s*\S{8,}|password\s*[:=]\s*\S+|sk-[A-Za-z0-9]{8,}/i
const HIDDEN = /hidden\s+(answer|verifier|benchmark)|GRAD_HIDDEN|hidden verifier implementation/i
const COT = /chain-of-thought|scratchpad|hidden reasoning|reasoning tokens/i

export const CURRICULUM_STAGES = [
  'A problem understanding',
  'B hypothesis reasoning',
  'C evidence selection',
  'D plan generation',
  'E plan-to-code fidelity',
  'F debug recovery',
  'G critic/reviewer reasoning',
  'H long-horizon engineering',
] as const

export function exportReasoningRecord(session: FoundryReasoningSession, className: string): { ok: true; record: FoundryReasoningExportRecord } | { ok: false; reason: string } {
  const verifiedSuccess = session.verificationState.projectReady && className === 'SUCCESSFUL_REASONING'
  if (className === 'SUCCESSFUL_REASONING' && !session.verificationState.projectReady) {
    return { ok: false, reason: 'A failure cannot be exported as successful reasoning.' }
  }
  const record: FoundryReasoningExportRecord = {
    recordId: session.sessionId,
    className,
    problem: session.problemModel.goal,
    constraints: session.constraints,
    knownFacts: session.problemModel.knownFacts.map(item => item.statement),
    unknowns: session.problemModel.unknowns.map(item => item.statement),
    assumptions: session.assumptions.map(item => item.statement),
    hypotheses: session.hypotheses.map(item => item.claim),
    evidence: session.evidence.map(item => item.statement),
    strategy: session.selectedStrategy ?? 'unselected',
    plan: session.currentPlan?.summary ?? 'none',
    observations: session.observations.map(item => item.summary),
    contradictions: session.contradictions.map(item => item.summary),
    repair: session.rootCause?.rootCause ?? 'none',
    verification: session.verificationState.projectReady ? 'PROJECT_READY' : (session.verificationState.refusal ?? 'not proven'),
    lesson: session.strategyLessons.find(item => item.status === 'ACTIVE')?.problemPattern ?? 'none',
    capabilityOutcome: session.capabilityGaps.at(-1)?.status ?? 'none',
    verifiedSuccess,
    problemHash: hash(session.problemModel.goal),
    requirementsHash: hash(session.acceptanceCriteria.join('|')),
    strategyHash: hash(session.selectedStrategy ?? ''),
    solutionStructureHash: hash(session.currentPlan?.summary ?? session.hypotheses.map(item => item.claim).join('|')),
  }
  const blob = JSON.stringify(record)
  if (SECRET.test(blob)) return { ok: false, reason: 'Secret export refused.' }
  if (HIDDEN.test(blob)) return { ok: false, reason: 'Hidden verifier export refused.' }
  if (COT.test(blob)) return { ok: false, reason: 'Raw chain-of-thought export refused.' }
  return { ok: true, record }
}

export function dedupeExports(records: FoundryReasoningExportRecord[]): FoundryReasoningExportRecord[] {
  const seen = new Set<string>()
  const kept: FoundryReasoningExportRecord[] = []
  for (const record of records) {
    const key = `${record.problemHash}:${record.requirementsHash}:${record.strategyHash}:${record.solutionStructureHash}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(record)
  }
  return kept
}

export function curriculumProposal(): { stages: readonly string[]; trainingAuthorized: false } {
  return { stages: CURRICULUM_STAGES, trainingAuthorized: false }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
