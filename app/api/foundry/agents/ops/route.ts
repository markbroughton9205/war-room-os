import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { AgentOpsLog } from '@/lib/agents/ops/log'
import { commanderActor, handleOpsControl, handleOpsRead } from '@/lib/agents/ops/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/** Agent Foundry operations (Phase 10). GET is read-only. */
export async function GET(req: Request) {
  const commander = await requireCommanderSession('Foundry')
  if (!commander.ok) return commander.response
  const { status, body } = handleOpsRead(new URL(req.url), new AgentOpsLog(undefined, { readOnly: true }))
  return NextResponse.json(body, { status })
}

/**
 * Commander controls. The actor is derived from the authenticated session only (never from the body), and a custom
 * header is required so cross-site requests cannot reach this handler without a CORS preflight.
 */
export async function POST(req: Request) {
  const commander = await requireCommanderSession('Foundry')
  if (!commander.ok) return commander.response
  if (req.headers.get('x-wr-agent-ops') !== '1') return NextResponse.json({ error: 'missing control header' }, { status: 400 })
  let body: Record<string, unknown>
  try { const raw = await req.json(); if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object'); body = raw as Record<string, unknown> } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }
  const { status, body: out } = await handleOpsControl(body, commanderActor(commander.userId), new AgentOpsLog())
  return NextResponse.json(out, { status })
}
