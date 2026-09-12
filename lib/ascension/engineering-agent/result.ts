/**
 * #22 Phase 3 — ENGINEERING_AGENT structured result contract.
 * No hidden chain-of-thought.
 */
import type { EngineeringAgentIdentity } from './identity'
import type { EngineeringAgentScope } from './scope'
import type { EngineeringCommandResult } from './commands'

export const ENGINEERING_AGENT_STATUSES = [
  'COMPLETE',
  'PARTIAL',
  'DEGRADED',
  'FAILED',
  'DENIED',
] as const
export type EngineeringAgentStatus = (typeof ENGINEERING_AGENT_STATUSES)[number]

export type EngineeringAgentDenial = {
  capability_or_action: string
  reason_code: string
  reason: string
}

export type EngineeringFileChange = {
  path: string
  before_hash: string | null
  after_hash: string | null
  bytes_changed: number
  agent_created: boolean
}

export type EngineeringAgentResult = {
  agent_id: string
  agent_role: 'ENGINEERING_AGENT'
  status: EngineeringAgentStatus
  task: string
  base_sha: string | null
  worktree: string
  files_read: string[]
  files_modified: EngineeringFileChange[]
  diff_summary: string
  patch_reference: string | null
  bounded_diff: string
  validation_commands: string[]
  validation_results: EngineeringCommandResult[]
  warnings: string[]
  limitations: string[]
  denials: EngineeringAgentDenial[]
  preexisting_dirty: string[]
  agent_created_changes: string[]
  started_at: string
  completed_at: string
  owner_scope: string
  mission_id: string | null
  conversation_id: string | null
  audit_id: string | null
  identity: EngineeringAgentIdentity
  scope: EngineeringAgentScope
  plan_summary: string
  boundary_notes: readonly string[]
}

export const ENGINEERING_AGENT_BOUNDARY_NOTES = Object.freeze([
  'ENGINEERING_AGENT PATCH READY != COMMITTED',
  'ENGINEERING_AGENT PATCH READY != PUSHED',
  'ENGINEERING_AGENT PATCH READY != DEPLOYED',
  'RESEARCH_AGENT FINDING != ENGINEERING AUTHORIZATION',
  'TERRA EVENT != ENGINEERING AUTHORIZATION',
  'COUNCIL RECOMMENDATION != PUSH/DEPLOY AUTHORITY',
  'ASTRA MISSION != SCOPE EXPANSION',
  'CAPABILITY != AUTHORITY',
] as const)

export function classifyEngineeringStatus(input: {
  denied: boolean
  worktreeFailed: boolean
  mutationFailed: boolean
  validationFailed: boolean
  validationSkipped: boolean
  filesModified: number
}): EngineeringAgentStatus {
  if (input.denied || input.worktreeFailed) return 'DENIED'
  if (input.mutationFailed && input.filesModified === 0) return 'FAILED'
  if (input.validationFailed) return 'FAILED'
  if (input.mutationFailed) return 'PARTIAL'
  if (input.validationSkipped && input.filesModified > 0) return 'PARTIAL'
  if (input.filesModified === 0) return 'PARTIAL'
  return 'COMPLETE'
}
