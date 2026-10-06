import { NextResponse } from 'next/server'
import { loadProject, saveProject } from '@/lib/media-command/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const project = await loadProject(id)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  return NextResponse.json({ project })
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const project = await loadProject(id)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  let body: { name?: string; notes?: string } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (typeof body.name === 'string' && body.name.trim()) project.name = body.name.trim()
  if (typeof body.notes === 'string') project.notes = body.notes
  const saved = await saveProject(project)
  return NextResponse.json({ project: saved })
}
