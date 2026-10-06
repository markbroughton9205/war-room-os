export const HVS_LESSON_SCHEMA = 'hvs.lesson.v1' as const

export const HVS_LESSON_STATUSES = ['CANDIDATE', 'ACTIVE', 'CONFIRMED', 'SUPERSEDED', 'RETIRED'] as const
export type HvsLessonStatus = (typeof HVS_LESSON_STATUSES)[number]

export const HVS_LESSON_SCOPES = ['HVS_ONLY', 'PROJECT', 'THEME', 'STYLE', 'PRODUCTION_TYPE'] as const
export type HvsLessonScope = (typeof HVS_LESSON_SCOPES)[number]

export const HVS_LESSON_CLASSES = [
  'pacing',
  'framing',
  'typography',
  'audio',
  'render',
  'rights',
  'color',
  'animation',
  'identity',
  'cinematic',
  'qc',
  'provenance',
] as const
export type HvsLessonClass = (typeof HVS_LESSON_CLASSES)[number]

export type HvsLesson = {
  schema: typeof HVS_LESSON_SCHEMA
  id: string
  system: 'HVS'
  productionType: string
  triggeringFailure: HvsLessonClass
  correction: string
  rootCause: string
  generalizedRule: string
  scope: HvsLessonScope
  projectId?: string | null
  themeId?: string | null
  styleId?: string | null
  mediaTypes: string[]
  visualContext?: string | null
  confidence: number
  evidence: string[]
  status: HvsLessonStatus
  sourceUtterance?: string | null
  supersededBy?: string | null
  createdAt: string
  updatedAt: string
}

export type HvsLessonQuery = {
  productionType?: string | null
  projectId?: string | null
  themeId?: string | null
  styleId?: string | null
  visualContext?: string | null
  mediaTypes?: string[]
  triggeringFailure?: HvsLessonClass | null
}

/** Read-only planning constraint. Never an EditOp. No source utterances. */
export type HvsPlanningConstraint = {
  lessonId: string
  source: 'HVS_LESSON'
  rule: string
  scope: string
  confidence: number
  productionType?: string
  themeId?: string | null
  styleId?: string | null
  status?: 'ACTIVE' | 'CONFIRMED'
  triggeringFailure?: HvsLessonClass
  automaticEditOp: false
}

export type HvsLessonConflict = {
  lessonIds: string[]
  triggeringFailure: string
  reason: string
}

export type HvsLessonConstraintSet = {
  constraints: HvsPlanningConstraint[]
  conflicts: HvsLessonConflict[]
  needsHuman: boolean
  automaticEditOp: false
}
