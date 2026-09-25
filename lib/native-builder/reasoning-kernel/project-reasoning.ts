/**
 * Long-horizon project reasoning.
 * Lower levels cannot silently change the project goal.
 * Reconstruction uses structured records, not a raw transcript.
 */
import { clipText } from './text'
import type { FoundryArchitectureDecisionRecord, FoundryProjectReasoningState } from './program-types'
import { nextSessionId } from './session'
import type { FoundryReasoningSession } from './types'

export function ensureProject(session: FoundryReasoningSession, goal: string): FoundryProjectReasoningState {
  if (!session.project) {
    session.project = {
      projectGoal: clipText(goal),
      milestones: [],
      dependencies: [],
      openQuestions: [],
      architecturalDecisions: [],
      riskRegister: [],
      acceptedConstraints: [],
      currentMission: session.missionId,
      futureMissions: [],
      blockedItems: [],
      verificationState: 'not proven',
      technicalDebt: [],
      lessons: [],
    }
  }
  return session.project
}

export function proposeGoalChange(session: FoundryReasoningSession, nextGoal: string): { ok: false; reason: string } {
  const project = ensureProject(session, session.problemModel.goal)
  if (nextGoal !== project.projectGoal) {
    return { ok: false, reason: 'A lower-level action cannot change the project goal.' }
  }
  return { ok: false, reason: 'The project goal is unchanged.' }
}

export function recordArchitectureDecision(session: FoundryReasoningSession, input: { decision: string; alternatives: string[]; evidence: string[]; constraints: string[] }): FoundryArchitectureDecisionRecord {
  const project = ensureProject(session, session.problemModel.goal)
  const record: FoundryArchitectureDecisionRecord = {
    decisionId: nextSessionId(session, 'architecture-decision'),
    decision: clipText(input.decision),
    alternatives: input.alternatives.map(clipText),
    evidence: input.evidence.map(clipText),
    constraints: input.constraints.map(clipText),
    date: session.createdAt,
    status: 'ACTIVE',
    supersededBy: null,
  }
  project.architecturalDecisions.push(record)
  return record
}

export function supersedeDecision(session: FoundryReasoningSession, decisionId: string, replacement: string): FoundryArchitectureDecisionRecord | null {
  const project = ensureProject(session, session.problemModel.goal)
  const current = project.architecturalDecisions.find(item => item.decisionId === decisionId)
  if (!current) return null
  const next = recordArchitectureDecision(session, {
    decision: replacement,
    alternatives: [current.decision],
    evidence: current.evidence,
    constraints: current.constraints,
  })
  current.status = 'SUPERSEDED'
  current.supersededBy = next.decisionId
  return next
}

export function replanFromEvidence(session: FoundryReasoningSession, input: { decisionId: string; evidence: string; impacted: string[]; unrelated: string[] }): { reopened: boolean; impacted: string[]; unrelatedBlocked: false } {
  const project = ensureProject(session, session.problemModel.goal)
  const decision = project.architecturalDecisions.find(item => item.decisionId === input.decisionId)
  if (decision) {
    decision.status = 'REOPENED'
    decision.evidence.push(clipText(input.evidence))
  }
  project.blockedItems = input.impacted
  for (const missionId of input.unrelated) {
    if (!project.futureMissions.includes(missionId)) project.futureMissions.push(missionId)
  }
  return { reopened: Boolean(decision), impacted: input.impacted, unrelatedBlocked: false }
}

export function dependencyBlock(project: FoundryProjectReasoningState, missionId: string): boolean {
  return project.dependencies.some(item => item.to === missionId && project.blockedItems.includes(item.from))
}

export function compressProjectContext(session: FoundryReasoningSession): { decisions: string[]; constraints: string[]; openQuestions: string[]; failures: string[]; lessons: string[]; acceptance: string; transcriptIncluded: false } {
  const project = ensureProject(session, session.problemModel.goal)
  return {
    decisions: project.architecturalDecisions.map(item => item.decision),
    constraints: project.acceptedConstraints,
    openQuestions: project.openQuestions,
    failures: project.riskRegister,
    lessons: project.lessons,
    acceptance: project.verificationState,
    transcriptIncluded: false,
  }
}

export function reconstructProject(payload: string): FoundryProjectReasoningState {
  const parsed = JSON.parse(payload) as FoundryProjectReasoningState
  if (!parsed.projectGoal) throw new Error('Project reasoning state is missing its goal.')
  return parsed
}
