import { NextResponse } from 'next/server'
import { createCheckpoint } from '@/lib/repo/rollback'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
  try {
    const checkpoint = await createCheckpoint()

    await logWarRoomRepoAudit('Rollback checkpoint metadata written (read-only metadata op).', {
      endpoint: 'POST /api/repo/rollback/checkpoint',
      checkpointId: checkpoint.checkpointId,
    })

    return NextResponse.json({
      checkpoint,
      approvalRequiredForRollback: true as const,
      message: 'Checkpoint metadata written under .war-room/checkpoints. No commit, reset, stash, or rollback was performed.',
    })
  } catch (error) {
    return NextResponse.json({
      message: error instanceof Error ? error.message : 'Checkpoint creation failed',
    }, { status: 500 })
  }
}
