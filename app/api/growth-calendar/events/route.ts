import { NextResponse } from 'next/server'

import {
  GROWTH_CALENDAR_EVENT_TYPES,
  createGrowthCalendarEvent,
  listGrowthCalendarSnapshot,
  type GrowthCalendarEventType,
  type GrowthCalendarRecommendation,
} from '@/lib/growth-calendar'

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

function recommendationValue(value: unknown): GrowthCalendarRecommendation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as GrowthCalendarRecommendation
}

export async function GET() {
  const snapshot = await listGrowthCalendarSnapshot()
  return NextResponse.json({
    generatedAt: snapshot.generatedAt,
    persistenceAvailable: snapshot.persistenceAvailable,
    persistenceNote: snapshot.persistenceNote,
    events: snapshot.events,
    proposed: snapshot.recommendations.filter(item => item.status === 'proposed'),
    approvedVsProposed: {
      approvedEvents: snapshot.stats.approvedEvents,
      proposedRecommendations: snapshot.stats.proposedRecommendations,
    },
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
  const recommendation = recommendationValue(input.recommendation)
  const title = textValue(input.title) ?? recommendation?.title
  const selectedEventType = eventType(input.eventType) ?? recommendation?.eventType
  const commanderApproved = input.commanderApproved === true

  if (!title || !selectedEventType) {
    return NextResponse.json({ error: 'title and valid eventType are required.' }, { status: 400 })
  }
  if (!commanderApproved) {
    return NextResponse.json({ error: 'Commander approval is required before saving a planned event.' }, { status: 403 })
  }

  try {
    const result = await createGrowthCalendarEvent({
      recommendationId: textValue(input.recommendationId) ?? recommendation?.id ?? null,
      recommendation,
      title,
      eventType: selectedEventType,
      plannedStart: textValue(input.plannedStart),
      plannedEnd: textValue(input.plannedEnd),
      durationMinutes: numberValue(input.durationMinutes) ?? recommendation?.recommendedDurationMinutes ?? null,
      commanderApproved,
      approvalNote: textValue(input.approvalNote),
    })
    return NextResponse.json(result, {
      status: 201,
      headers: {
        'x-war-room-growth-calendar-persistence': result.persistenceAvailable ? 'available' : 'unavailable',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Growth calendar event creation failed.' },
      { status: 500 },
    )
  }
}
