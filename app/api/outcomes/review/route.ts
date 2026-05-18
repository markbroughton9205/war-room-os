import { NextResponse } from 'next/server'

import { createRoiReview, listOutcomeSnapshot, type RoiReviewInput } from '@/lib/outcomes'
import { BABY_AI_AGENTS, type BabyAgentKey } from '@/lib/baby-ai/model'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function reviewerValue(value: unknown): RoiReviewInput['reviewer'] {
  const raw = textValue(value)
  if (!raw) return 'commander'
  if (raw === 'commander' || raw === 'system') return raw
  return BABY_AI_AGENTS.some(agent => agent.key === raw) ? raw as BabyAgentKey : 'commander'
}

function priorityChange(value: unknown): RoiReviewInput['recommendedPriorityChange'] {
  const raw = textValue(value)
  return raw && ['increase', 'hold', 'decrease', 'deprioritize'].includes(raw)
    ? raw as RoiReviewInput['recommendedPriorityChange']
    : 'hold'
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function GET() {
  const snapshot = await listOutcomeSnapshot()
  return NextResponse.json({
    generatedAt: snapshot.generatedAt,
    persistenceAvailable: snapshot.persistenceAvailable,
    persistenceNote: snapshot.persistenceNote,
    reviews: snapshot.reviews,
    realityCorrectionAlerts: snapshot.realityCorrectionAlerts,
    guardrails: snapshot.guardrails,
  })
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON object.' }, { status: 400 })
  }

  const input = body as Record<string, unknown>
  const outcomeId = textValue(input.outcomeId)
  const reviewSummary = textValue(input.reviewSummary)
  if (!outcomeId || !reviewSummary) {
    return NextResponse.json({ error: 'outcomeId and reviewSummary are required.' }, { status: 400 })
  }

  try {
    const result = await createRoiReview({
      outcomeId,
      reviewer: reviewerValue(input.reviewer),
      reviewSummary,
      confidenceBefore: numberValue(input.confidenceBefore),
      actualResultScore: numberValue(input.actualResultScore),
      estimateAccuracy: numberValue(input.estimateAccuracy),
      timeValueScore: numberValue(input.timeValueScore),
      distractionScore: numberValue(input.distractionScore),
      leverageAdjustment: numberValue(input.leverageAdjustment),
      recommendedPriorityChange: priorityChange(input.recommendedPriorityChange),
      evidence: objectValue(input.evidence),
    })
    return NextResponse.json(result, {
      status: 201,
      headers: {
        'x-war-room-outcomes-persistence': result.persistenceAvailable ? 'available' : 'unavailable',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'ROI review logging failed.' },
      { status: 500 },
    )
  }
}
