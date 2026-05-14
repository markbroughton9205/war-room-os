export type PermissionState = boolean | 'approval_required'

/** First column = index, second = work tree (git status --porcelain v1). */
export type ChangedFileMetadata = {
  path: string
  indexStatus: string
  workTreeStatus: string
  /** Raw two-column status from porcelain (e.g. `M `, `??`, `MM`). */
  porcelain: string
}

export type LastCommitHash = {
  short: string
  full: string
}

/** Raw OS / git facts for the repo root. Not subject to War Room approval policy. */
export type RepoCapabilities = {
  canWriteFilesystem: boolean
  /** Git identity configured and repository is not bare — a commit could succeed if invoked. */
  canGitCommit: boolean
  /** Filesystem allows creating `.war-room/checkpoints` metadata (user-initiated POST only). */
  canCreateCheckpoint: boolean
}

/** Fixed policy flags for Phase 1; future phases may expose toggles or session state. */
export type RepoPolicy = {
  writeRequiresApproval: true
  commitRequiresApproval: true
  rollbackRequiresApproval: true
}

/**
 * What the War Room allows without an approval gate.
 * Phase 1: always false (no approval/session endpoint yet). A future phase may set these
 * from signed headers, session approval, or similar while keeping `capabilities` truthful.
 */
export type RepoAllowed = {
  write: boolean
  commit: boolean
  rollback: boolean
}

export type RepoStatus = {
  repoPath: string
  gitAvailable: boolean
  currentBranch: string
  workingTreeStatus: 'clean' | 'dirty' | 'unknown'
  uncommittedFilesCount: number
  changedFiles: ChangedFileMetadata[]
  lastCommitHash: LastCommitHash | null
  remoteConfigured: boolean
  canReadRepo: boolean
  /**
   * Policy answer: may the War Room perform **unsanctioned** repo writes (agents, automation)?
   * Phase 1 mirrors `allowed.write` (false). See `capabilities.canWriteFilesystem` for OS truth.
   */
  canWriteRepo: boolean
  /**
   * Policy answer: may the War Room create git commits without approval?
   * Phase 1 mirrors `allowed.commit` (false). See `capabilities.canGitCommit` for git readiness.
   */
  canCommit: boolean
  /**
   * Policy answer: may rollback **apply** run without approval?
   * Phase 1 mirrors `allowed.rollback` (false). Checkpoint presence is on `GET /api/repo/rollback/status`.
   */
  canRollback: boolean
  capabilities: RepoCapabilities
  policy: RepoPolicy
  allowed: RepoAllowed
  permissions: {
    canRead: boolean
    canProposeDiff: boolean
    canModifyFiles: PermissionState
    canCommit: PermissionState
    canDeploy: PermissionState
    canRollback: PermissionState
    canUseInternet: boolean
    canExecuteShell: false
  }
  checkedAt: string
}

export type DiffPreviewResponse = {
  diff: string
  truncated?: boolean
  staged: boolean
  repoPath: string
}

export type RollbackCheckpoint = {
  checkpointId: string
  timestamp: string
  branch: string
  commitHash: LastCommitHash | null
  workingTreeStatus: 'clean' | 'dirty' | 'unknown'
  changedFiles: ChangedFileMetadata[]
  /** Optional fingerprint of a bounded diff sample at checkpoint time. */
  diffSummaryHash?: string | null
}

export type RollbackStatus = {
  latestCheckpoint: RollbackCheckpoint | null
  rollbackAvailable: boolean
  checkpointRequiredBeforeApply: boolean
  message: string
  approvalRequired: true
  checkedAt: string
}

export type RollbackCheckpointCreateResponse = {
  checkpoint: RollbackCheckpoint
  approvalRequiredForRollback: true
  message: string
}
