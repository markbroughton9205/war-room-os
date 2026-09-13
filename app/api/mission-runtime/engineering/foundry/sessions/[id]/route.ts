import { NextResponse } from 'next/server'
import { appendFoundryChat, getFoundrySession } from '@/lib/native-builder/foundrySessions'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? undefined
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    const session = await getFoundrySession(id)
    if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
    return NextResponse.json({ session })
  })
  return result.ok ? result.value : result.response
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  let body: { text?: string; workspaceId?: string; waitForCompletion?: boolean } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.text?.trim()) return NextResponse.json({ error: 'text is required.' }, { status: 400 })
  const result = await runInResolvedWorkspace(body.workspaceId, async () => {
    const session = await getFoundrySession(id)
    if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
    await appendFoundryChat(id, 'COMMANDER', body.text!.trim())
    const strategy = getMissionExecutionStrategy('engineering')
    const mission = await strategy.create({
      title: body.text!.trim().slice(0, 80),
      description: body.text!.trim(),
      naturalLanguage: body.text!.trim(),
      subsystem: 'project',
      executionMode: 'bounded_coding',
      autoRun: true,
      waitForCompletion: body.waitForCompletion === true,
      sessionId: id,
    })
    return NextResponse.json({ session: await getFoundrySession(id), mission })
  })
  return result.ok ? result.value : result.response
}
