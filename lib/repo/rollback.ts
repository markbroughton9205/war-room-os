import { randomUUID } from 'node:crypto'
import { appendCheckpointJson, readLatestCheckpointRecord } from './checkpoint-store'
import { hashDiffSample, previewDiff } from './diff'
import { resolveRepoRoot } from './paths'
import { getRepoStatus } from './status'
import type { RollbackCheckpoint, RollbackStatus } from './types'

function buildRollbackMessage(params: {
  rollbackAvailable: boolean
  checkpointRequiredBeforeApply: boolean
  dirty: boolean
}): string {
  if (!params.rollbackAvailable) {
    return 'No checkpoints under .war-room/checkpoints yet. Create one before approving any write or rollback.'
  }
  if (params.checkpointRequiredBeforeApply && params.dirty) {
    return 'Working tree has uncommitted changes. Capture a fresh checkpoint before approving destructive or apply operations.'
  }
  if (params.checkpointRequiredBeforeApply) {
    return 'Checkpoint metadata exists; review latest snapshot before approving writes.'
  }
  return 'Latest checkpoint on disk. Rollback or file writes still require explicit human approval.'
}

export async function getRollbackStatus(): Promise<RollbackStatus> {
  const repoRoot = resolveRepoRoot()
  const repo = await getRepoStatus()
  const latestCheckpoint = await readLatestCheckpointRecord(repoRoot)
  const rollbackAvailable = Boolean(latestCheckpoint)
  const dirty = repo.workingTreeStatus === 'dirty'
  const checkpointRequiredBeforeApply = !rollbackAvailable || dirty

  return {
    latestCheckpoint,
    rollbackAvailable,
    checkpointRequiredBeforeApply,
    message: buildRollbackMessage({ rollbackAvailable, checkpointRequiredBeforeApply, dirty }),
    approvalRequired: true,
    checkedAt: new Date().toISOString(),
  }
}

export async function createCheckpoint(): Promise<RollbackCheckpoint> {
  const repoRoot = resolveRepoRoot()
  const repo = await getRepoStatus()

  let diffSummaryHash: string | null = null
  if (repo.gitAvailable) {
    try {
      const { diff } = await previewDiff({ paths: repo.changedFiles.map(f => f.path), maxBytes: 64 * 1024 })
      if (diff) diffSummaryHash = hashDiffSample(diff)
    } catch {
      diffSummaryHash = null
    }
  }

  const checkpoint: RollbackCheckpoint = {
    checkpointId: randomUUID(),
    timestamp: new Date().toISOString(),
    branch: repo.currentBranch,
    commitHash: repo.lastCommitHash,
    workingTreeStatus: repo.workingTreeStatus,
    changedFiles: repo.changedFiles,
    diffSummaryHash,
  }

  const fileName = `${checkpoint.timestamp.replaceAll(':', '-')}_${checkpoint.checkpointId}.json`
  await appendCheckpointJson(repoRoot, fileName, JSON.stringify(checkpoint, null, 2))

  return checkpoint
}
