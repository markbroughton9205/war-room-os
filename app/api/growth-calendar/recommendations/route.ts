import { NextResponse } from 'next/server'

import {
  GROWTH_CALENDAR_EVENT_TYPES,
  createGrowthCalendarRecommendation,
  listGrowthCalendarSnapshot,
  type GrowthCalendarEventType,
  type GrowthCalendarRecommendationInput,
  type GrowthCalendarSource,
} from '@/lib/growth-calendar'
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

function eventType(value: unknown): GrowthCalendarEventType | null {
  return typeof value === 'string' && (GROWTH_CALENDAR_EVENT_TYPES as readonly string[]).includes(value)
    ? value as GrowthCalendarEventType
    : null
}

function source(value: unknown): GrowthCalendarSource {
  const raw = textValue(value)
  return raw && ['revenue_engine', 'signal_radar', 'baby_daily_briefing', 'feature_builder', 'approval_queue', 'outcome_ledger', 'calendar_seed'].includes(raw)
    ? raw as GrowthCalendarSource
    : 'calendar_seed'
}

function family(value: unknown): BabyAgentKey | null {
  const raw = textValue(value)
  return raw && BABY_AI_AGENTS.some(agent => agent.key === raw) ? raw as BabyAgentKey : null
}

function scoreObject(value: unknown): GrowthCalendarRecommendationInput['scores'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  return {
    leverageScore: numberValue(input.leverageScore) ?? undefined,
    urgencyScore: numberValue(input.urgencyScore) ?? undefined,
    incomePotential: numberValue(input.incomePotential) ?? undefined,
    energyCost: numberValue(input.energyCost) ?? undefined,
    familyImpact: numberValue(input.familyImpact) ?? undefined,
    deadlinePressure: numberValue(input.deadlinePressure) ?? undefined,
    compoundingValue: numberValue(input.compoundingValue) ?? undefined,
  }
}

export async function GET(req: Request) {
  const snapshot = await listGrowthCalendarSnapshot()
  const status = new URL(req.url).searchParams.get('status')
  const recommendations = status
    ? snapshot.recommendations.filter(item => item.status === status)
    : snapshot.recommendations
  return NextResponse.json({
    generatedAt: snapshot.generatedAt,
    persistenceAvailable: snapshot.persistenceAvailable,
    persistenceNote: snapshot.persistenceNote,
    recommendations,
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
  const title = textValue(input.title)
  const selectedEventType = eventType(input.eventType)
  if (!title || !selectedEventType) {
    return NextResponse.json({ error: 'title and valid eventType are required.' }, { status: 400 })
  }

  try {
    const result = await createGrowthCalendarRecommendation({
      title,
      eventType: selectedEventType,
      source: source(input.source),
      sourceId: textValue(input.sourceId),
      description: textValue(input.description),
      assignedFamily: family(input.assignedFamily),
      reason: textValue(input.reason),
      recommendedDurationMinutes: numberValue(input.recommendedDurationMinutes),
      recommendedTimeWindow: textValue(input.recommendedTimeWindow),
      scores: scoreObject(input.score ?? input.scores),
      metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata as Record<string, unknown> : {},
    })
    return NextResponse.json(result, {
      status: 201,
      headers: {
        'x-war-room-growth-calendar-persistence': result.persistenceAvailable ? 'available' : 'unavailable',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Growth calendar recommendation failed.' },
      { status: 500 },
    )
  }
}
