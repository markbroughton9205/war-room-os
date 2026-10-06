import { NextResponse } from 'next/server'
import { listProjects, createProject } from '@/lib/media-command/store'
import { ensureStarrdomFixture } from '@/lib/media-command/starrdom'
import { PRODUCTION_MODES, type ProductionMode } from '@/lib/media-command/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  await ensureStarrdomFixture()
  const projects = await listProjects()
  return NextResponse.json({ projects })
}

export async function POST(req: Request) {
  let body: { name?: string; productionMode?: ProductionMode; starrdom?: boolean } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.name?.trim()) return NextResponse.json({ error: 'name is required.' }, { status: 400 })
  const mode = body.productionMode && (PRODUCTION_MODES as readonly string[]).includes(body.productionMode)
    ? body.productionMode
    : 'CUSTOM'
  const project = await createProject({ name: body.name.trim(), productionMode: mode, starrdom: body.starrdom })
  return NextResponse.json({ project }, { status: 201 })
}
