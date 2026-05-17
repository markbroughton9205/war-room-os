import 'server-only'

import { getLearningSupabase, type LearningStoreResult } from './learningPersistence'

export type ForecastFeedbackStoreRow = {
  id: string
  forecast_id: string
  assumptions: unknown[]
  prediction: string
  actual_result: string | null
  predicted_probability: number | null
  actual_score: number | null
  variance: number | null
  confidence_accuracy: number | null
  provider_involved: string | null
  analyst_packet_id: string | null
  lessons_learned: string[]
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  resolved_at: string | null
}

const FORECAST_COLUMNS = [
  'id',
  'forecast_id',
  'assumptions',
  'prediction',
  'actual_result',
  'predicted_probability',
  'actual_score',
  'variance',
  'confidence_accuracy',
  'provider_involved',
  'analyst_packet_id',
  'lessons_learned',
  'metadata',
  'created_at',
  'updated_at',
  'resolved_at',
].join(',')

function bounded01(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(1, value))
}

export function calculateForecastFeedbackMetrics(input: {
  predictedProbability?: number | null
  actualScore?: number | null
}): { variance: number | null; confidenceAccuracy: number | null } {
  const predicted = bounded01(input.predictedProbability)
  const actual = bounded01(input.actualScore)
  if (predicted === null || actual === null) return { variance: null, confidenceAccuracy: null }
  const variance = Math.abs(predicted - actual)
  return {
    variance,
    confidenceAccuracy: Math.max(0, 1 - variance),
  }
}

export async function listForecastFeedback(limit = 25): Promise<LearningStoreResult<ForecastFeedbackStoreRow[]>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup

  const { data, error } = await sup.value
    .from('war_room_forecast_feedback')
    .select(FORECAST_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return { ok: false, error: error.message, persistenceAvailable: true }
  return { ok: true, value: (data ?? []) as unknown as ForecastFeedbackStoreRow[] }
}

export async function recordForecastFeedback(input: {
  forecastId: string
  assumptions?: unknown[]
  prediction: string
  actualResult?: string | null
  predictedProbability?: number | null
  actualScore?: number | null
  providerInvolved?: string | null
  analystPacketId?: string | null
  lessonsLearned?: string[]
  metadata?: Record<string, unknown>
  resolvedAt?: string | null
}): Promise<LearningStoreResult<string>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup
  const metrics = calculateForecastFeedbackMetrics({
    predictedProbability: input.predictedProbability,
    actualScore: input.actualScore,
  })

  const { data, error } = await sup.value
    .from('war_room_forecast_feedback')
    .insert({
      forecast_id: input.forecastId,
      assumptions: input.assumptions ?? [],
      prediction: input.prediction,
      actual_result: input.actualResult ?? null,
      predicted_probability: bounded01(input.predictedProbability),
      actual_score: bounded01(input.actualScore),
      variance: metrics.variance,
      confidence_accuracy: metrics.confidenceAccuracy,
      provider_involved: input.providerInvolved ?? null,
      analyst_packet_id: input.analystPacketId ?? null,
      lessons_learned: input.lessonsLearned ?? [],
      metadata: input.metadata ?? {},
      resolved_at: input.resolvedAt ?? null,
    })
    .select('id')
    .single()

  if (error || !data?.id) return { ok: false, error: error?.message ?? 'Forecast feedback insert failed.', persistenceAvailable: true }
  return { ok: true, value: String(data.id) }
}
