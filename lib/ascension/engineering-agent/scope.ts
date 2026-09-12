/**
 * #22 Phase 3 — Bounded engineering worktree scope contract.
 */
export const ENGINEERING_AGENT_DEFAULT_BOUNDS = Object.freeze({
  max_files_changed: 5,
  max_patch_bytes: 48_000,
  max_individual_file_bytes: 32_000,
  max_validation_commands: 4,
  max_runtime_ms: 180_000,
  max_retries: 0,
} as const)

export type EngineeringAgentScope = {
  repository_root: string
  worktree_path: string
  base_sha: string | null
  task_description: string
  allowed_paths: string[]
  denied_paths: string[]
  allowed_validation_commands: string[]
  max_files_changed: number
  max_patch_size: number
  max_individual_file_bytes: number
  max_validation_commands: number
  max_runtime_ms: number
  owner_user_id: string
  requested_by: string
  mission_id: string | null
  conversation_id: string | null
  created_at: string
  expires_at: string | null
}

export function createEngineeringAgentScope(input: {
  repositoryRoot: string
  worktreePath: string
  baseSha: string | null
  taskDescription: string
  allowedPaths: string[]
  deniedPaths?: string[]
  allowedValidationCommands: string[]
  ownerUserId: string
  requestedBy: string
  missionId?: string | null
  conversationId?: string | null
  expiresAt?: string | null
  nowIso?: string
  bounds?: Partial<typeof ENGINEERING_AGENT_DEFAULT_BOUNDS>
}): EngineeringAgentScope {
  const bounds = { ...ENGINEERING_AGENT_DEFAULT_BOUNDS, ...input.bounds }
  return {
    repository_root: input.repositoryRoot,
    worktree_path: input.worktreePath,
    base_sha: input.baseSha,
    task_description: input.taskDescription.trim(),
    allowed_paths: [...input.allowedPaths],
    denied_paths: [
      ...(input.deniedPaths ?? []),
      '.env',
      '.env.local',
      '.git',
      'node_modules',
      '.next',
    ],
    allowed_validation_commands: [...input.allowedValidationCommands],
    max_files_changed: bounds.max_files_changed,
    max_patch_size: bounds.max_patch_bytes,
    max_individual_file_bytes: bounds.max_individual_file_bytes,
    max_validation_commands: bounds.max_validation_commands,
    max_runtime_ms: bounds.max_runtime_ms,
    owner_user_id: input.ownerUserId,
    requested_by: input.requestedBy,
    mission_id: input.missionId ?? null,
    conversation_id: input.conversationId ?? null,
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
  }
}

export function isEngineeringScopeExpired(scope: EngineeringAgentScope, nowMs = Date.now()): boolean {
  if (!scope.expires_at) return false
  const t = Date.parse(scope.expires_at)
  return Number.isFinite(t) && nowMs > t
}
