import { NextResponse } from 'next/server'

import { REVENUE_ENGINE_CATEGORIES, type RevenueEngineCategory, type RevenueOpportunityInput } from '@/lib/revenue-engine/model'
import { createRevenueOpportunity, listRevenueEngineSnapshot } from '@/lib/revenue-engine/persistence'
import { requireCommanderSession } from '@/lib/security/commanderSession'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function category(value: unknown): RevenueEngineCategory | null {
  return typeof value === 'string' && (REVENUE_ENGINE_CATEGORIES as readonly string[]).includes(value)
    ? value as RevenueEngineCategory
    : null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function GET() {
  // Wave 1 repair, audit finding P1-3: no auth check beyond the app-wide "any authenticated user"
  // middleware gate, despite exposing revenue-opportunity data and letting any authenticated
  // account create new opportunities below.
  const commander = await requireCommanderSession('Revenue engine')
  if (!commander.ok) return commander.response
  return NextResponse.json(await listRevenueEngineSnapshot())
}

export async function POST(req: Request) {
  const commander = await requireCommanderSession('Revenue engine')
  if (!commander.ok) return commander.response

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
  const selectedCategory = category(input.category)
  if (!title || !selectedCategory) {
    return NextResponse.json({ error: 'title and valid category are required.' }, { status: 400 })
  }

  const payload: RevenueOpportunityInput = {
    title,
    category: selectedCategory,
    notes: textValue(input.notes),
    source: textValue(input.source),
    estimatedRevenue: numberValue(input.estimatedRevenue),
    estimatedTimeHours: numberValue(input.estimatedTimeHours),
    startupCostUsd: numberValue(input.startupCostUsd),
    regionalSignal: textValue(input.regionalSignal),
    shipperPainPoint: textValue(input.shipperPainPoint),
    smbPainPoint: textValue(input.smbPainPoint),
    nextReviewAction: textValue(input.nextReviewAction),
  }

  try {
    const result = await createRevenueOpportunity(payload)
    return NextResponse.json(result, {
      status: 201,
      headers: {
        'x-war-room-revenue-persistence': result.persistenceAvailable ? 'available' : 'unavailable',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Revenue opportunity scoring failed.' },
      { status: 500 },
    )
  }
}

