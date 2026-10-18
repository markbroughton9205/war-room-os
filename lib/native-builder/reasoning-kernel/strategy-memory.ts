/**
 * Structured strategy memory. A lesson is reusable only when verified,
 * generic, and free of secrets, hidden answers, and exact fixture patches.
 */
import { lessonRetainsHiddenAnswer } from '../foundryEngineeringReasoning'
import { FOUNDRY_REASONING_SCHEMA_VERSION, type FoundryEngineeringLesson } from '../foundryEngineeringReasoningTypes'
import { clipText } from './text'
import type { FoundryStrategyLesson, FoundryTransferRecord } from './program-types'
import type { FoundryReasoningSession } from './types'

const SECRET = /BEGIN [A-Z ]*PRIVATE KEY|api[_-]?key\s*[:=]\s*\S{8,}|password\s*[:=]\s*\S+/i
const HIDDEN = /hidden\s+(answer|verifier|benchmark)|exact\s+expected\s+output|GRAD_HIDDEN/i
const EXACT_PATCH = /catalog\.mjs|fixture[-_ ]?id|expected return is/i

function asEngineering(lesson: FoundryStrategyLesson): FoundryEngineeringLesson {
  return {
    schemaVersion: FOUNDRY_REASONING_SCHEMA_VERSION,
    lessonId: lesson.lessonId,
    capabilityClass: 'MISSION',
    problemPattern: lesson.problemPattern,
    failedApproach: lesson.failedStrategies.join(' '),
    successfulApproach: `${lesson.successfulStrategy ?? ''} ${lesson.applicability}`,
    rootCause: lesson.contextFeatures.join(' '),
    toolEvidence: [lesson.evidencePattern],
    projectConstraints: [lesson.applicability],
    sourceMissionId: lesson.sourceMissionId,
  }
}

export function considerStrategyLesson(session: FoundryReasoningSession, lesson: FoundryStrategyLesson): { ok: boolean; reason: string } {
  const blob = JSON.stringify(lesson)
  if (!lesson.verified) return refuse(session, 'An unverified lesson is not reusable strategy memory.')
  if (!lesson.evidencePattern) return refuse(session, 'A lesson needs an evidence pattern.')
  if (lesson.providerIndependent !== true) return refuse(session, 'Strategy memory stays provider-independent.')
  if (lessonRetainsHiddenAnswer(asEngineering(lesson), []) || HIDDEN.test(blob)) return refuse(session, 'Refused. Memory does not retain hidden answers.')
  if (SECRET.test(blob)) return refuse(session, 'Refused. Memory does not retain secrets.')
  if (EXACT_PATCH.test(blob)) return refuse(session, 'Refused. Memory does not retain an exact fixture patch.')
  if (/because the model said|certainly caused/i.test(blob)) return refuse(session, 'Refused. Unsupported causal claim.')
  const stored: FoundryStrategyLesson = {
    ...lesson,
    problemPattern: clipText(lesson.problemPattern),
    applicability: clipText(lesson.applicability),
    antiPattern: clipText(lesson.antiPattern),
    status: 'ACTIVE',
  }
  session.strategyLessons.push(stored)
  return { ok: true, reason: 'Verified strategy lesson stored.' }
}

function refuse(session: FoundryReasoningSession, reason: string): { ok: boolean; reason: string } {
  session.rejectedLessons.push({ reason })
  return { ok: false, reason }
}

export function retrieveStrategyLessons(session: FoundryReasoningSession, query: { capability?: string; failure?: string; shape?: string; architecture?: string; constraint?: string; evidence?: string }): Array<{ lesson: FoundryStrategyLesson; similarPattern: true; sameAnswer: false }> {
  const tokens = [query.capability, query.failure, query.shape, query.architecture, query.constraint, query.evidence].filter((item): item is string => Boolean(item)).map(item => item.toLowerCase())
  return session.strategyLessons
    .filter(lesson => lesson.status === 'ACTIVE')
    .filter(lesson => {
      const blob = `${lesson.problemPattern} ${lesson.contextFeatures.join(' ')} ${lesson.capabilityFamily} ${lesson.evidencePattern} ${lesson.applicability}`.toLowerCase()
      return tokens.some(token => blob.includes(token))
    })
    .map(lesson => ({ lesson, similarPattern: true as const, sameAnswer: false as const }))
}

export function recordTransfer(input: Omit<FoundryTransferRecord, 'sameAnswer'>): FoundryTransferRecord {
  return { ...input, sameAnswer: false }
}

export function contradictLesson(session: FoundryReasoningSession, lessonId: string, evidence: string): FoundryStrategyLesson | null {
  const lesson = session.strategyLessons.find(item => item.lessonId === lessonId)
  if (!lesson) return null
  lesson.status = 'CONTRADICTED'
  lesson.contradictionPattern = clipText(evidence)
  lesson.updatedAt = lesson.createdAt
  return lesson
}

export function markLessonStale(session: FoundryReasoningSession, lessonId: string): FoundryStrategyLesson | null {
  const lesson = session.strategyLessons.find(item => item.lessonId === lessonId)
  if (!lesson) return null
  lesson.status = 'STALE'
  lesson.updatedAt = lesson.createdAt
  return lesson
}

export function supersedeLesson(session: FoundryReasoningSession, olderId: string, newerId: string): FoundryStrategyLesson | null {
  const older = session.strategyLessons.find(item => item.lessonId === olderId)
  const newer = session.strategyLessons.find(item => item.lessonId === newerId)
  if (!older || !newer || !newer.verified) return null
  older.status = 'SUPERSEDED'
  return newer.status === 'ACTIVE' ? newer : null
}

export function activeLessons(session: FoundryReasoningSession): FoundryStrategyLesson[] {
  return session.strategyLessons.filter(item => item.status === 'ACTIVE' && item.verified)
}

export function reasonWithoutMemory(session: FoundryReasoningSession): { ok: true; strategy: string | null } {
  return { ok: true, strategy: session.selectedStrategy }
}
