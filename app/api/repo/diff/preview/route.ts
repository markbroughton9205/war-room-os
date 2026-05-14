import { NextResponse } from 'next/server'
import { previewDiff } from '@/lib/repo/diff'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const staged = url.searchParams.get('staged') === '1' || url.searchParams.get('staged') === 'true'
  const pathsRaw = url.searchParams.get('paths')?.trim()
  const paths = pathsRaw ? pathsRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined

  try {
    const result = await previewDiff({ paths, staged })
    await logWarRoomRepoAudit('Diff preview read.', {
      endpoint: 'GET /api/repo/diff/preview',
      staged,
      truncated: result.truncated,
    })
    return NextResponse.json({
      diff: result.diff,
      truncated: result.truncated,
      staged: result.staged,
      repoPath: result.repoPath,
    })
  } catch (error) {
    return NextResponse.json({
      message: error instanceof Error ? error.message : 'Diff preview failed',
    }, { status: 500 })
  }
}
