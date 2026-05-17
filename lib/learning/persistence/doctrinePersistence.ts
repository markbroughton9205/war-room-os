import 'server-only'

import { getLearningSupabase, type LearningStoreResult } from './learningPersistence'

export type DoctrineStoreStatus = 'candidate' | 'watching' | 'red_team_review' | 'promoted' | 'retired' | 'rejected'

export type DoctrineStoreRow = {
  id: string
  principle: string
  evidence: unknown[]
  origin_event: string | null
  recurrence_frequency: number
  confidence: number
  contradictions: unknown[]
  doctrine_status: DoctrineStoreStatus
  promoted_by: string | null
  red_team_review: Record<string, unknown>
  review_history: unknown[]
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  promoted_at: string | null
}

export type DoctrinePromotionReview = {
  eligible: boolean
  blockers: string[]
  required: {
    recurrenceThreshold: number
    minimumConfidence: number
    minimumEvidenceItems: number
    redTeamReviewRequired: true
    commanderPromotionRequired: true
  }
}

const DOCTRINE_COLUMNS = [
  'id',
  'principle',
  'evidence',
  'origin_event',
  'recurrence_frequency',
  'confidence',
  'contradictions',
  'doctrine_status',
  'promoted_by',
  'red_team_review',
  'review_history',
  'metadata',
  'created_at',
  'updated_at',
  'promoted_at',
].join(',')

export function evaluateDoctrinePromotionCandidate(input: {
  recurrenceFrequency: number
  confidence: number
  evidenceCount: number
  contradictionsReviewed: boolean
  redTeamReviewed: boolean
  promotedBy?: string | null
}): DoctrinePromotionReview {
  const blockers: string[] = []
  if (input.recurrenceFrequency < 3) blockers.push('Requires recurrence frequency of at least 3.')
  if (input.confidence < 0.75) blockers.push('Requires confidence of at least 0.75.')
  if (input.evidenceCount < 2) blockers.push('Requires at least two evidence items.')
  if (!input.contradictionsReviewed) blockers.push('Contradictions must be reviewed before promotion.')
  if (!input.redTeamReviewed) blockers.push('Red Team review is required before promotion.')
  if (!input.promotedBy) blockers.push('Commander promotion identity is required.')

  return {
    eligible: blockers.length === 0,
    blockers,
    required: {
      recurrenceThreshold: 3,
      minimumConfidence: 0.75,
      minimumEvidenceItems: 2,
      redTeamReviewRequired: true,
      commanderPromotionRequired: true,
    },
  }
}

export async function listDoctrineStoreEntries(limit = 25): Promise<LearningStoreResult<DoctrineStoreRow[]>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup

  const { data, error } = await sup.value
    .from('war_room_doctrine_entries')
    .select(DOCTRINE_COLUMNS)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) return { ok: false, error: error.message, persistenceAvailable: true }
  return { ok: true, value: (data ?? []) as unknown as DoctrineStoreRow[] }
}

export async function insertDoctrineCandidate(input: {
  principle: string
  evidence?: unknown[]
  originEvent?: string | null
  recurrenceFrequency?: number
  confidence?: number
  contradictions?: unknown[]
  redTeamReview?: Record<string, unknown>
  reviewHistory?: unknown[]
  metadata?: Record<string, unknown>
}): Promise<LearningStoreResult<string>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup

  const { data, error } = await sup.value
    .from('war_room_doctrine_entries')
    .insert({
      principle: input.principle,
      evidence: input.evidence ?? [],
      origin_event: input.originEvent ?? null,
      recurrence_frequency: input.recurrenceFrequency ?? 0,
      confidence: input.confidence ?? 0.5,
      contradictions: input.contradictions ?? [],
      doctrine_status: 'candidate',
      red_team_review: input.redTeamReview ?? {},
      review_history: input.reviewHistory ?? [],
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single()

  if (error || !data?.id) return { ok: false, error: error?.message ?? 'Doctrine candidate insert failed.', persistenceAvailable: true }
  return { ok: true, value: String(data.id) }
}
