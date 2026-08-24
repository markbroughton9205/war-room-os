import { NextResponse } from 'next/server'
import { readEngineeringFile } from '@/lib/mission-runtime/engineeringReadSurface'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Read-only single-file read for a thin client's editor/viewer surface (Standalone Builder Phase
 * A). Delegates to repositoryInspector.readRepoFile via the Engineering Core read boundary — all
 * containment/denylist/size-cap enforcement lives there, unchanged. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const path = url.searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path query parameter is required.' }, { status: 400 })
  const result = await readEngineeringFile(path)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 })
  return NextResponse.json(result)
}
