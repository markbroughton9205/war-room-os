import { NextResponse } from 'next/server'
import { detectRedTeamCoderIssues } from '@/lib/red-team-coder/detector'
import { createLatestRepairPlan, createRepairPlan } from '@/lib/red-team-coder/repairPlanner'
import type { RedTeamCoderIssue, RedTeamCoderSignal } from '@/lib/red-team-coder/types'

export const dynamic = 'force-dynamic'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (isRecord(body) && isRecord(body.issue)) {
    return NextResponse.json({ repairPlan: createRepairPlan(body.issue as RedTeamCoderIssue) })
  }

  const signal = isRecord(body) && isRecord(body.signal) ? body.signal as RedTeamCoderSignal : {}
  const issues = detectRedTeamCoderIssues(signal)
  const repairPlan = createLatestRepairPlan(issues)
  return NextResponse.json({ issues, repairPlan })
}
