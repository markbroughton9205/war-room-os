import { NextResponse } from 'next/server'
import { getRepoStatus } from '@/lib/repo/status'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const repo = await getRepoStatus()
    return NextResponse.json({
      tool: 'repo',
      status: repo.canReadRepo ? 'complete' : 'unavailable',
      message: repo.canReadRepo
        ? 'Repo awareness is connected to the read-only repository status layer.'
        : 'Repo awareness cannot read the configured repository path.',
      repo,
    }, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return NextResponse.json({
      tool: 'repo',
      status: 'error',
      message: error instanceof Error ? error.message : 'Repo awareness failed.',
    }, { status: 500, headers: { 'cache-control': 'no-store' } })
  }
}
