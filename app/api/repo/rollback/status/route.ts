import { NextResponse } from 'next/server'
import { getRollbackStatus } from '@/lib/repo/rollback'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const roll = await getRollbackStatus()
    await logWarRoomRepoAudit('Rollback status read.', { endpoint: 'GET /api/repo/rollback/status' })
    return NextResponse.json(roll)
  } catch (error) {
    return NextResponse.json({
      message: error instanceof Error ? error.message : 'Rollback status failed',
    }, { status: 500 })
  }
}
