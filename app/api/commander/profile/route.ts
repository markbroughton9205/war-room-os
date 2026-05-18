import { NextResponse } from 'next/server'

import { listCommanderSnapshot, upsertCommanderProfile, type CommanderProfileInput } from '@/lib/commander'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item).trim()).filter(Boolean).slice(0, 30)
}

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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function GET() {
  const snapshot = await listCommanderSnapshot()
  return NextResponse.json({
    generatedAt: snapshot.generatedAt,
    persistenceAvailable: snapshot.persistenceAvailable,
    persistenceNote: snapshot.persistenceNote,
    profile: snapshot.profile,
    metrics: snapshot.metrics,
    momentum: snapshot.momentum,
    lifePositioning: snapshot.lifePositioning,
    guardrails: snapshot.guardrails,
  }, {
    headers: {
      'x-war-room-commander-persistence': snapshot.persistenceAvailable ? 'available' : 'unavailable',
    },
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
  const payload: CommanderProfileInput = {
    activeGoals: textArray(input.activeGoals),
    unfinishedInitiatives: textArray(input.unfinishedInitiatives),
    recurringBottlenecks: textArray(input.recurringBottlenecks),
    strongestLeverageZones: textArray(input.strongestLeverageZones),
    distractionPatterns: textArray(input.distractionPatterns),
    bestExecutionWindows: textArray(input.bestExecutionWindows),
    bestWorkflows: textArray(input.bestWorkflows),
    stressLoadScore: numberValue(input.stressLoadScore),
    familyImpactScore: numberValue(input.familyImpactScore),
    notes: textValue(input.notes),
    evidence: {
      explicitCommanderProfile: true,
      ...(objectValue(input.evidence)),
    },
  }

  try {
    const result = await upsertCommanderProfile(payload)
    return NextResponse.json(result, {
      status: 201,
      headers: {
        'x-war-room-commander-persistence': result.persistenceAvailable ? 'available' : 'unavailable',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Commander profile update failed.' },
      { status: 500 },
    )
  }
}
