import { NextResponse } from 'next/server'
import { commitCommands, loadProject } from '@/lib/media-command/store'
import type { EditCommand } from '@/lib/media-command/edit-commands'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const project = await loadProject(id)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  let body: { commands?: EditCommand[]; preview?: boolean } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!Array.isArray(body.commands) || body.commands.length === 0) {
    return NextResponse.json({ error: 'commands[] is required.' }, { status: 400 })
  }
  const result = await commitCommands(project, body.commands, { preview: Boolean(body.preview) })
  return NextResponse.json(result, { status: result.errors.length ? 422 : 200 })
}
