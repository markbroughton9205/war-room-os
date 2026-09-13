import { NextResponse } from 'next/server'
import { createFoundrySession, listFoundrySessions } from '@/lib/native-builder/foundrySessions'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? undefined
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    const sessions = await listFoundrySessions(workspaceId)
    return NextResponse.json({ sessions })
  })
  return result.ok ? result.value : result.response
}

export async function POST(req: Request) {
  let body: { title?: string; workspaceId?: string; projectName?: string } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.title?.trim()) return NextResponse.json({ error: 'title is required.' }, { status: 400 })
  const result = await runInResolvedWorkspace(body.workspaceId, async () => {
    const session = await createFoundrySession({
      title: body.title!.trim(),
      workspaceId: body.workspaceId,
      projectName: body.projectName,
    })
    return NextResponse.json({ session })
  })
  return result.ok ? result.value : result.response
}
