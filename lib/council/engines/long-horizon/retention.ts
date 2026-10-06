/**
 * Checkpoint retention policy hooks. Default is conservative: retain all.
 * No automatic historical checkpoint deletion in ENGINE-04.
 */
export type CheckpointRetentionPolicy = {
  retain_latest_n: number | null
  retain_milestones: boolean
  retain_terminal: boolean
  retain_authority: boolean
}

export const DEFAULT_CHECKPOINT_RETENTION: CheckpointRetentionPolicy = {
  retain_latest_n: null,
  retain_milestones: true,
  retain_terminal: true,
  retain_authority: true,
}

export function shouldRetainCheckpoint(reason: string, policy: CheckpointRetentionPolicy = DEFAULT_CHECKPOINT_RETENTION): boolean {
  if (policy.retain_latest_n === null) return true
  if (policy.retain_terminal && /completion|cancel/i.test(reason)) return true
  if (policy.retain_authority && /authority|approval|decline/i.test(reason)) return true
  if (policy.retain_milestones && /wave|ebc|replan/i.test(reason)) return true
  return true
}
