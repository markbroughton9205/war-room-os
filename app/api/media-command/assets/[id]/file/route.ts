import { NextResponse } from 'next/server'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import path from 'node:path'
import { loadProject, listProjects } from '@/lib/media-command/store'
import { mediaCommandDataHierarchy } from '@/lib/media-command/paths'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const url = new URL(req.url)
  const kind = url.searchParams.get('kind') ?? 'preview'
  const projects = await listProjects()
  let filePath: string | null = null
  let mime = 'application/octet-stream'
  for (const entry of projects) {
    const project = await loadProject(entry.id)
    const asset = project?.assets.find(a => a.id === id)
    if (!asset) continue
    if (kind === 'thumb') filePath = asset.thumbPath ?? asset.originalPath
    else if (kind === 'proxy') filePath = asset.proxyPath ?? asset.originalPath
    else if (kind === 'original') filePath = asset.originalPath
    else if (kind === 'waveform') filePath = asset.waveformPath
    else filePath = asset.proxyPath ?? asset.originalPath
    mime = kind === 'waveform'
      ? 'application/json'
      : kind === 'thumb'
        ? (filePath?.endsWith('.svg') ? 'image/svg+xml' : filePath?.endsWith('.png') ? 'image/png' : 'image/jpeg')
        : asset.mimeType
    break
  }
  if (!filePath || !existsSync(filePath)) {
    return NextResponse.json({ error: 'Asset file not found.' }, { status: 404 })
  }
  const root = mediaCommandDataHierarchy().mediaCommandRoot
  if (!isInside(root, filePath)) {
    return NextResponse.json({ error: 'Asset path refused.' }, { status: 403 })
  }
  const stat = statSync(filePath)
  const nodeStream = createReadStream(filePath)
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream
  return new NextResponse(webStream, {
    headers: {
      'content-type': mime || 'application/octet-stream',
      'content-length': String(stat.size),
      'cache-control': 'private, max-age=60',
    },
  })
}
