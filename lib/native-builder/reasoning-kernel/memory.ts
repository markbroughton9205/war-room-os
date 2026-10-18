/**
 * Generic engineering lessons. Hidden answers, secrets, and private reasoning are refused.
 * Retrieval returns a similar pattern and never the same sealed answer.
 */
import { lessonRetainsHiddenAnswer } from '../foundryEngineeringReasoning'
import {
  FOUNDRY_REASONING_PASS_STREAK,
  FOUNDRY_REASONING_SCHEMA_VERSION,
  type FoundryEngineeringLesson,
} from '../foundryEngineeringReasoningTypes'
import { atlasStatusForGraduationEvent } from '../foundryEngineeringGraduationAtlas'
import type { CapabilityStatus } from '../capability-atlas/types'
import type {
  FoundryDifficultyProfile,
  FoundryPracticeRecord,
  FoundryReasoningLesson,
  FrkCapability,
} from './types'
import { clipText } from './text'

const SECRET = /BEGIN [A-Z ]*PRIVATE KEY|api[_-]?key\s*[:=]\s*\S{8,}|password\s*[:=]\s*\S+/i
const HIDDEN_ANSWER = /hidden\s+(answer|verifier|benchmark)|exact\s+expected\s+output|GRAD_HIDDEN/i

function asEngineeringLesson(lesson: FoundryReasoningLesson): FoundryEngineeringLesson {
  return {
    schemaVersion: FOUNDRY_REASONING_SCHEMA_VERSION,
    lessonId: lesson.lessonId,
    capabilityClass: 'MISSION',
    problemPattern: lesson.pattern,
    failedApproach: lesson.failedApproach ?? '',
    successfulApproach: [lesson.successfulApproach ?? '', lesson.antiPattern ?? '', lesson.applicability].join(' '),
    rootCause: lesson.context,
    toolEvidence: lesson.evidence,
    projectConstraints: [lesson.applicability],
    sourceMissionId: 'frk-lesson',
  }
}

export function filterReasoningLesson(lesson: FoundryReasoningLesson): { ok: true; lesson: FoundryReasoningLesson } | { ok: false; reason: string } {
  const blob = JSON.stringify(lesson)
  if (lessonRetainsHiddenAnswer(asEngineeringLesson(lesson), [])) {
    return { ok: false, reason: 'Refused. Memory does not retain hidden answers or private reasoning.' }
  }
  if (SECRET.test(blob)) return { ok: false, reason: 'Refused. Memory does not retain secrets.' }
  if (HIDDEN_ANSWER.test(blob)) return { ok: false, reason: 'Refused. Memory does not retain hidden verifier answers.' }
  return {
    ok: true,
    lesson: {
      ...lesson,
      pattern: clipText(lesson.pattern),
      context: clipText(lesson.context),
      applicability: clipText(lesson.applicability),
      sameAnswer: false,
    },
  }
}

export function retrieveLessons(
  lessons: FoundryReasoningLesson[],
  query: { pattern?: string; capabilityFamily?: FrkCapability; architecture?: string; failureMode?: string },
): Array<{ lesson: FoundryReasoningLesson; similarPattern: true; sameAnswer: false }> {
  const tokens = [query.pattern, query.capabilityFamily, query.architecture, query.failureMode]
    .filter((item): item is string => Boolean(item))
    .map(item => item.toLowerCase())
  return lessons
    .filter(lesson => {
      const blob = `${lesson.pattern} ${lesson.context} ${lesson.capabilityFamily} ${lesson.failedApproach ?? ''} ${lesson.applicability}`.toLowerCase()
      return tokens.some(token => blob.includes(token))
    })
    .map(lesson => ({ lesson, similarPattern: true as const, sameAnswer: false as const }))
}

export function notePractice(input: {
  practiceId: string
  capability: FrkCapability
  chosen: string
  evidence: string
}): FoundryPracticeRecord {
  return {
    practiceId: input.practiceId,
    capability: input.capability,
    chosen: clipText(input.chosen),
    evaluated: true,
    evidence: clipText(input.evidence),
    commanderProjectsBlocked: false,
  }
}

export function capabilityAtlasStatus(): CapabilityStatus {
  return atlasStatusForGraduationEvent('fixture_pass')
}

export function bumpDifficulty(profile: FoundryDifficultyProfile): FoundryDifficultyProfile {
  const next = { ...profile, successStreak: profile.successStreak + 1 }
  if (next.successStreak < FOUNDRY_REASONING_PASS_STREAK) return next
  next.successStreak = 0
  const order: Array<keyof Omit<FoundryDifficultyProfile, 'successStreak'>> = [
    'ambiguity',
    'components',
    'constraints',
    'failureModes',
    'integrationDepth',
  ]
  const index = (profile.ambiguity + profile.components + profile.constraints + profile.failureModes + profile.integrationDepth) % order.length
  const key = order[index]
  next[key] += 1
  return next
}
