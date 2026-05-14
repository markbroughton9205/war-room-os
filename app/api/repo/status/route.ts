import { NextResponse } from 'next/server'
import { getRepoStatus } from '@/lib/repo/status'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  // Standing permissions (Phase 4): read-only repo facts — no assertAutoOrApproval gate (GET is always allowed).
  try {
    const status = await getRepoStatus()
    await logWarRoomRepoAudit('Repo status read.', {
      endpoint: 'GET /api/repo/status',
      branch: typeof status.currentBranch === 'string' ? status.currentBranch : undefined,
    })
    return NextResponse.json(status)
  } catch (error) {
    return NextResponse.json({
      message: error instanceof Error ? error.message : 'Repo status failed',
    }, { status: 500 })
  }
}
