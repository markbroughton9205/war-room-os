import { NextResponse } from 'next/server'

import {
  OUTCOME_APPROVAL_STATUSES,
  OUTCOME_CATEGORIES,
  OUTCOME_RECOMMENDATIONS,
  OUTCOME_RESULT_STATUSES,
  createOutcomeEntry,
  listOutcomeSnapshot,
  type OutcomeApprovalStatus,
  type OutcomeCategory,
  type OutcomeEntryInput,
  type OutcomeRecommendation,
  type OutcomeResultStatus,
} from '@/lib/outcomes'
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

function categoryValue(value: unknown): OutcomeCategory | null {
  return typeof value === 'string' && (OUTCOME_CATEGORIES as readonly string[]).includes(value)
    ? value as OutcomeCategory
    : null
}

function resultStatusValue(value: unknown): OutcomeResultStatus | null {
  return typeof value === 'string' && (OUTCOME_RESULT_STATUSES as readonly string[]).includes(value)
    ? value as OutcomeResultStatus
    : null
}

function recommendationValue(value: unknown): OutcomeRecommendation | null {
  return typeof value === 'string' && (OUTCOME_RECOMMENDATIONS as readonly string[]).includes(value)
    ? value as OutcomeRecommendation
    : null
}

function approvalStatusValue(value: unknown): OutcomeApprovalStatus | null {
  return typeof value === 'string' && (OUTCOME_APPROVAL_STATUSES as readonly string[]).includes(value)
    ? value as OutcomeApprovalStatus
    : null
}

function familyValue(value: unknown): BabyAgentKey | null {
  const raw = textValue(value)
  return raw && BABY_AI_AGENTS.some(agent => agent.key === raw) ? raw as BabyAgentKey : null
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function limitFromUrl(req: Request): number {
  const value = new URL(req.url).searchParams.get('limit')
  const parsed = value ? Number(value) : 80
  return Number.isFinite(parsed) ? Math.max(1, Math.min(200, Math.round(parsed))) : 80
}

export async function GET(req: Request) {
  const snapshot = await listOutcomeSnapshot(limitFromUrl(req))
  return NextResponse.json(snapshot, {
    headers: {
      'x-war-room-outcomes-persistence': snapshot.persistenceAvailable ? 'available' : 'unavailable',
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
  const title = textValue(input.title)
  const selectedCategory = categoryValue(input.category)
  const selectedStatus = resultStatusValue(input.resultStatus)
  const selectedRecommendation = recommendationValue(input.recommendedRepeatAvoid)

  if (!title || !selectedCategory || !selectedStatus || !selectedRecommendation) {
    return NextResponse.json(
      { error: 'title, valid category, resultStatus, and recommendedRepeatAvoid are required.' },
      { status: 400 },
    )
  }

  const payload: OutcomeEntryInput = {
    title,
    category: selectedCategory,
    relatedOpportunity: textValue(input.relatedOpportunity),
    estimatedRevenue: numberValue(input.estimatedRevenue),
    actualRevenue: numberValue(input.actualRevenue),
    timeInvestedHours: numberValue(input.timeInvestedHours ?? input.timeInvested),
    stressLoad: numberValue(input.stressLoad),
    leverageScore: numberValue(input.leverageScore),
    repeatabilityScore: numberValue(input.repeatabilityScore),
    scalabilityScore: numberValue(input.scalabilityScore),
    familyImpact: numberValue(input.familyImpact),
    executionDifficulty: numberValue(input.executionDifficulty),
    resultStatus: selectedStatus,
    whatWorked: textValue(input.whatWorked),
    whatFailed: textValue(input.whatFailed),
    lessonsLearned: textValue(input.lessonsLearned),
    recommendedRepeatAvoid: selectedRecommendation,
    linkedFeatureProject: textValue(input.linkedFeatureProject),
    linkedBabyAiFamily: familyValue(input.linkedBabyAiFamily),
    approvalStatus: approvalStatusValue(input.approvalStatus),
    sourceUri: textValue(input.sourceUri),
    evidence: objectValue(input.evidence),
    metadata: objectValue(input.metadata),
  }

  try {
    const result = await createOutcomeEntry(payload)
    return NextResponse.json(result, {
      status: 201,
      headers: {
        'x-war-room-outcomes-persistence': result.persistenceAvailable ? 'available' : 'unavailable',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Outcome logging failed.' },
      { status: 500 },
    )
  }
}
