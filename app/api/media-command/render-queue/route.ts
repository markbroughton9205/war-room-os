import { NextResponse } from 'next/server'
import { listProjects, loadProject } from '@/lib/media-command/store'
import { processRenderQueue } from '@/lib/media-command/render-engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  if (projectId) {
    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    return NextResponse.json({ jobs: project.renderJobs, projectId })
  }
  const projects = await listProjects()
  const jobs = []
  for (const entry of projects) {
    const project = await loadProject(entry.id)
    if (!project) continue
    for (const job of project.renderJobs) jobs.push({ ...job, projectName: project.name })
  }
  return NextResponse.json({ jobs })
}

export async function POST(req: Request) {
  let body: { projectId?: string } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.projectId) return NextResponse.json({ error: 'projectId is required.' }, { status: 400 })
  const project = await processRenderQueue(body.projectId)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  return NextResponse.json({ project })
}
