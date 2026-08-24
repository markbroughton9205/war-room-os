import { NextResponse } from 'next/server'
import { planRepair } from '@/lib/native-builder/runtime'
import { invokeDirectCouncilProvider, type DirectProviderFamily } from '@/lib/council/providerDirectCall'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Commander-requested manual replan (Standalone Builder Phase A "request replan"). Calls
 * native-builder's own planRepair() directly — the same function Foundation Hardening's replan
 * fix proved reachable from every one of the five iteration states — not a second orchestration
 * engine. This is explicit, single-shot, Commander-invoked replanning, never an autonomous retry
 * loop (that bounded-iteration policy is a distinct, not-yet-authorized later phase). No approval
 * gate: like native-builder's own /plan route, this is inspection + proposal generation only — no
 * file is written until a subsequent /approve call, which is already gated.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { targetFiles?: string[]; coderProvider?: { enabled: boolean; family?: DirectProviderFamily } } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }

  const hostedCoder = body.coderProvider?.enabled
    ? { family: body.coderProvider.family ?? 'claude', invoke: invokeDirectCouncilProvider }
    : undefined

  try {
    await planRepair(id, { targetFiles: body.targetFiles, hostedCoder })
    const strategy = getMissionExecutionStrategy('engineering')
    const mission = await strategy.get(id)
    if (!mission) return NextResponse.json({ error: 'Mission not found after replan.' }, { status: 404 })
    return NextResponse.json({ mission })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
