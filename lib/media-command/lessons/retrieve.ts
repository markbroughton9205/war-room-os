/**
 * Lesson retrieval. CANDIDATE, SUPERSEDED, and RETIRED are not reusable.
 * Lessons are planning/review constraints, never automatic EditOps.
 */
import type {
  HvsLesson,
  HvsLessonClass,
  HvsLessonConstraintSet,
  HvsLessonQuery,
  HvsPlanningConstraint,
} from './types'
import { listLessons } from './store'

const SECRET = /\b(api[_-]?key|secret|password|token|service_role)\b/i

const CAPTURES: Array<{ pattern: RegExp; failure: HvsLessonClass; cause: string; rule: string }> = [
  { pattern: /\bpacing\b|\btoo fast\b|\btoo slow\b/i, failure: 'pacing', cause: 'Cut rhythm did not match the stated duration or beat.', rule: 'Hold shot length to the stated beat before adding coverage.' },
  { pattern: /\bframing\b/i, failure: 'framing', cause: 'Frame did not match the requested composition.', rule: 'Match the requested frame before adding camera movement.' },
  { pattern: /\btypograph|\btitle\b|\bcaption\b/i, failure: 'typography', cause: 'Type treatment did not match the requested style.', rule: 'Keep type inside the requested style and safe area.' },
  { pattern: /\bcinematic treatment\b|\bnot cinematic\b/i, failure: 'cinematic', cause: 'Treatment did not follow the stated visual plan.', rule: 'Stay inside the stated visual plan instead of adding unrequested coverage.' },
  { pattern: /\bcolor treatment\b|\bcolor\b/i, failure: 'color', cause: 'Color treatment drifted from the requested look.', rule: 'Apply only the requested look; do not invent a second grade.' },
  { pattern: /\baudio\b|\bmix\b|\bvolume\b/i, failure: 'audio', cause: 'Audio balance did not match the request.', rule: 'Balance dialogue and music to the requested level before delivery.' },
  { pattern: /\bvisual identity\b|\bidentity drifted\b/i, failure: 'identity', cause: 'Picture drifted from the project identity.', rule: 'Keep wardrobe, type, and look inside the project identity.' },
  { pattern: /\brender (is )?incorrect\b|\brender wrong\b/i, failure: 'render', cause: 'Render output did not match the requested spec.', rule: 'Re-render only after the spec (aspect, resolution, duration) matches.' },
  { pattern: /\bqc fail/i, failure: 'qc', cause: 'Deterministic QC failed.', rule: 'Do not deliver while a blocking QC class is FAIL.' },
  { pattern: /\brights\b|\bprovenance\b/i, failure: 'rights', cause: 'Rights or provenance blocked use.', rule: 'UNKNOWN and non-clear rights stay fail-closed. Do not substitute media.' },
]

export function captureLessonFromUtterance(input: {
  utterance: string
  productionType: string
  projectId?: string | null
  themeId?: string | null
  styleId?: string | null
  now?: string
}): HvsLesson | null {
  const text = input.utterance.trim()
  if (!text || SECRET.test(text)) return null
  const hit = CAPTURES.find(row => row.pattern.test(text))
  if (!hit) return null
  const now = input.now ?? new Date().toISOString()
  return {
    schema: 'hvs.lesson.v1',
    id: `lesson-${hit.failure}-${now.replace(/\W/g, '').slice(0, 15)}`,
    system: 'HVS',
    productionType: input.productionType,
    triggeringFailure: hit.failure,
    correction: text.slice(0, 240),
    rootCause: hit.cause,
    generalizedRule: hit.rule,
    scope: 'HVS_ONLY',
    projectId: input.projectId ?? null,
    themeId: input.themeId ?? null,
    styleId: input.styleId ?? null,
    mediaTypes: ['video'],
    visualContext: null,
    confidence: 0.4,
    evidence: [`utterance:${hit.failure}`],
    status: 'CANDIDATE',
    sourceUtterance: text.slice(0, 240),
    supersededBy: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function lessonApplies(lesson: HvsLesson, query: HvsLessonQuery): boolean {
  if (lesson.status !== 'ACTIVE' && lesson.status !== 'CONFIRMED') return false
  if (lesson.scope === 'PROJECT' && lesson.projectId && query.projectId && lesson.projectId !== query.projectId) return false
  if (lesson.scope === 'PROJECT' && lesson.projectId && !query.projectId) return false
  if (lesson.scope === 'THEME') {
    if (!query.themeId || lesson.themeId !== query.themeId) return false
  }
  if (lesson.themeId && query.themeId && lesson.themeId !== query.themeId) return false
  if (lesson.scope === 'STYLE') {
    if (!query.styleId || lesson.styleId !== query.styleId) return false
  }
  if (lesson.styleId && query.styleId && lesson.styleId !== query.styleId) return false
  if (lesson.scope === 'PRODUCTION_TYPE' && query.productionType && lesson.productionType !== query.productionType) return false
  if (query.productionType && lesson.productionType !== query.productionType && lesson.scope === 'PRODUCTION_TYPE') return false
  if (query.triggeringFailure && lesson.triggeringFailure !== query.triggeringFailure) return false
  if (query.visualContext && lesson.visualContext && lesson.visualContext !== query.visualContext) return false
  if (query.mediaTypes?.length && !query.mediaTypes.some(kind => lesson.mediaTypes.includes(kind))) return false
  return true
}

export async function retrieveLessons(query: HvsLessonQuery, root?: string): Promise<HvsLesson[]> {
  const all = await listLessons(root)
  return all.filter(lesson => lessonApplies(lesson, query))
}

export function lessonIsPlanningConstraint(lesson: HvsLesson): { automaticEditOp: false; usable: boolean } {
  return { automaticEditOp: false, usable: lesson.status === 'ACTIVE' || lesson.status === 'CONFIRMED' }
}

/** Honest query. Omits missing fields. Does not invent theme, style, or failure class. */
export function lessonQueryFromContext(input: {
  productionType?: string | null
  projectId?: string | null
  themeId?: string | null
  styleId?: string | null
  visualContext?: string | null
  mediaTypes?: string[]
  triggeringFailure?: HvsLessonClass | null
}): HvsLessonQuery {
  const query: HvsLessonQuery = {}
  if (input.productionType) query.productionType = input.productionType
  if (input.projectId) query.projectId = input.projectId
  if (input.themeId) query.themeId = input.themeId
  if (input.styleId) query.styleId = input.styleId
  if (input.visualContext) query.visualContext = input.visualContext
  if (input.mediaTypes?.length) query.mediaTypes = input.mediaTypes
  if (input.triggeringFailure) query.triggeringFailure = input.triggeringFailure
  return query
}

const SCOPE_RANK: Record<string, number> = {
  PROJECT: 4,
  THEME: 3,
  STYLE: 3,
  PRODUCTION_TYPE: 2,
  HVS_ONLY: 1,
}

function statusRank(status: string): number {
  if (status === 'CONFIRMED') return 2
  if (status === 'ACTIVE') return 1
  return 0
}

export function constraintFromLesson(lesson: HvsLesson): HvsPlanningConstraint | null {
  if (lesson.status !== 'ACTIVE' && lesson.status !== 'CONFIRMED') return null
  return {
    lessonId: lesson.id,
    source: 'HVS_LESSON',
    rule: lesson.generalizedRule,
    scope: lesson.scope,
    confidence: lesson.confidence,
    productionType: lesson.productionType,
    themeId: lesson.themeId ?? null,
    styleId: lesson.styleId ?? null,
    status: lesson.status,
    triggeringFailure: lesson.triggeringFailure,
    automaticEditOp: false,
  }
}

function rankConstraint(row: HvsPlanningConstraint): number {
  return statusRank(row.status ?? '') * 100 + (SCOPE_RANK[row.scope] ?? 0) * 10 + Math.min(9, Math.round((row.confidence || 0) * 9))
}

export function planningConstraintsFromLessons(lessons: HvsLesson[]): HvsLessonConstraintSet {
  const constraints = lessons
    .map(constraintFromLesson)
    .filter((row): row is HvsPlanningConstraint => Boolean(row))
    .sort((a, b) => rankConstraint(b) - rankConstraint(a))
  const conflicts: HvsLessonConstraintSet['conflicts'] = []
  const byClass = new Map<string, HvsPlanningConstraint[]>()
  for (const row of constraints) {
    const key = row.triggeringFailure ?? row.rule
    byClass.set(key, [...(byClass.get(key) ?? []), row])
  }
  for (const [triggeringFailure, group] of byClass) {
    const rules = new Set(group.map(row => row.rule))
    if (group.length < 2 || rules.size < 2) continue
    const top = group[0]
    const rival = group.find(row => row.rule !== top.rule)
    if (!rival) continue
    const tied = rankConstraint(top) === rankConstraint(rival)
    conflicts.push({
      lessonIds: group.map(row => row.lessonId),
      triggeringFailure,
      reason: tied
        ? 'Equal-rank lessons disagree. Commander must choose. No silent override.'
        : 'Lessons disagree. Higher-rank constraint is ordered first; both remain. No silent drop.',
    })
  }
  return {
    constraints,
    conflicts,
    needsHuman: conflicts.some(row => row.reason.includes('Equal-rank')),
    automaticEditOp: false,
  }
}

export function constraintsDoNotEmitEditOps(constraints: HvsPlanningConstraint[]): { automaticEditOp: false; commandCount: 0 } {
  void constraints
  return { automaticEditOp: false, commandCount: 0 }
}
