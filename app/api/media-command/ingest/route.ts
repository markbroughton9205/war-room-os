import { NextResponse } from 'next/server'
import { writeFile, mkdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadProject } from '@/lib/media-command/store'
import { ingestFile } from '@/lib/media-command/ingest'
import { mediaCommandDataHierarchy } from '@/lib/media-command/paths'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const form = await req.formData()
  const projectId = String(form.get('projectId') ?? '')
  const file = form.get('file')
  if (!projectId) return NextResponse.json({ error: 'projectId is required.' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required.' }, { status: 400 })
  const project = await loadProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const dirs = mediaCommandDataHierarchy()
  await mkdir(dirs.tmp, { recursive: true })
  const tmpPath = path.join(dirs.tmp, `${randomUUID()}-${file.name.replace(/[^\w.\-]+/g, '_')}`)
  const buf = Buffer.from(await file.arrayBuffer())
  await writeFile(tmpPath, buf)
  try {
    const result = await ingestFile({
      project,
      sourcePath: tmpPath,
      originalName: file.name,
      mimeType: file.type,
    })
    return NextResponse.json(result, { status: 201 })
  } finally {
    try { await unlink(tmpPath) } catch { /* ignore */ }
  }
}
