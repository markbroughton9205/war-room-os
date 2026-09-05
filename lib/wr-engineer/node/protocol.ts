/**
 * WR-Engineer remote node protocol.
 *
 * Framework-free (no Next.js/Supabase imports) — imported identically by the War Room server side
 * and by wr-engineer-node/ (the machine-side package), so both speak exactly one shared contract,
 * never two hand-kept-in-sync copies. No transport is assumed here (HTTP request/response bodies,
 * SSE frames, or a future websocket — all can carry these same typed messages).
 *
 * Two message groups:
 *   - ENABLED_MESSAGE_TYPES: lifecycle + read-only inspection. Fully validated AND actionable today.
 *   - FUTURE_MESSAGE_TYPES: typed now so the contract is stable, but validateProtocolMessage()
 *     accepts their shape while isMessageTypeEnabled() reports false for them — a caller (the
 *     future command dispatcher) MUST check isMessageTypeEnabled() before acting on one, never
 *     infer enablement from "the type exists." This is what "no unrestricted execution merely
 *     because the type exists" means in code.
 */
import { ENABLED_NODE_CAPABILITIES, NODE_CAPABILITIES, NODE_PLATFORMS, type NodeCapability, type NodePlatform } from './types'

// ---------------------------------------------------------------------------
// Message type catalog
// ---------------------------------------------------------------------------

export const NODE_LIFECYCLE_MESSAGE_TYPES = [
  'NODE_HELLO',
  'NODE_AUTH',
  'NODE_HEARTBEAT',
  'NODE_STATUS',
  'NODE_OFFLINE',
  'NODE_CAPABILITIES',
  'NODE_ERROR',
] as const

export const NODE_INSPECTION_MESSAGE_TYPES = [
  'LIST_REPOSITORIES',
  'REPOSITORY_STATUS',
  'READ_FILE',
  'SEARCH_FILES',
  'GIT_STATUS',
  'GIT_DIFF',
  'GIT_LOG',
  'RUN_VALIDATION',
  'TOOL_EVENT',
  'ERROR',
] as const

/** Typed today, NEVER enabled in Phase 2 — see isMessageTypeEnabled(). */
export const NODE_CONTROLLED_FUTURE_MESSAGE_TYPES = ['PROPOSE_EDIT', 'APPLY_EDIT', 'RUN_COMMAND', 'ROLLBACK'] as const

export const ENABLED_MESSAGE_TYPES = [...NODE_LIFECYCLE_MESSAGE_TYPES, ...NODE_INSPECTION_MESSAGE_TYPES] as const
export const FUTURE_MESSAGE_TYPES = NODE_CONTROLLED_FUTURE_MESSAGE_TYPES

export const ALL_PROTOCOL_MESSAGE_TYPES = [...ENABLED_MESSAGE_TYPES, ...FUTURE_MESSAGE_TYPES] as const
export type ProtocolMessageType = (typeof ALL_PROTOCOL_MESSAGE_TYPES)[number]

export function isKnownMessageType(value: string): value is ProtocolMessageType {
  return (ALL_PROTOCOL_MESSAGE_TYPES as readonly string[]).includes(value)
}

export function isMessageTypeEnabled(type: ProtocolMessageType): boolean {
  return (ENABLED_MESSAGE_TYPES as readonly string[]).includes(type)
}

// ---------------------------------------------------------------------------
// Message payload shapes
// ---------------------------------------------------------------------------

export type NodeHelloMessage = {
  type: 'NODE_HELLO'
  nodeName: string
  platform: NodePlatform
  architecture: string
  hostname: string
  osVersion: string
  agentVersion: string
  capabilities: NodeCapability[]
}

export type NodeAuthMessage = { type: 'NODE_AUTH'; nodeId: string; credential: string }
export type NodeHeartbeatMessage = { type: 'NODE_HEARTBEAT'; nodeId: string; credential: string; agentVersion?: string }
export type NodeStatusMessage = { type: 'NODE_STATUS'; nodeId: string; platform: NodePlatform; capabilities: NodeCapability[] }
export type NodeOfflineMessage = { type: 'NODE_OFFLINE'; nodeId: string; reason?: string }
export type NodeCapabilitiesMessage = { type: 'NODE_CAPABILITIES'; nodeId: string; capabilities: NodeCapability[] }
export type NodeErrorMessage = { type: 'NODE_ERROR'; nodeId?: string; code: string; message: string }

export type ListRepositoriesMessage = { type: 'LIST_REPOSITORIES'; nodeId: string }
export type RepositoryStatusMessage = { type: 'REPOSITORY_STATUS'; repositoryId: string; currentBranch: string; headSha: string; workingTreeClean: boolean }
export type ReadFileMessage = { type: 'READ_FILE'; repositoryId: string; relPath: string }
export type SearchFilesMessage = { type: 'SEARCH_FILES'; repositoryId: string; query: string; pathPrefix?: string }
export type GitStatusMessage = { type: 'GIT_STATUS'; repositoryId: string }
export type GitDiffMessage = { type: 'GIT_DIFF'; repositoryId: string; staged?: boolean }
export type GitLogMessage = { type: 'GIT_LOG'; repositoryId: string; limit?: number }
export type RunValidationMessage = { type: 'RUN_VALIDATION'; repositoryId: string; operationId: string; targets?: string[] }
export type ToolEventMessage = {
  type: 'TOOL_EVENT'
  repositoryId: string
  tool: string
  detail: string
  outcome: 'PASS' | 'FAIL'
  occurredAt: string
}
export type ErrorMessage = { type: 'ERROR'; code: string; message: string }

/** Typed for contract stability; validateProtocolMessage() accepts the shape, but
 * isMessageTypeEnabled() always returns false for these — no dispatcher may act on them yet. */
export type ProposeEditMessage = { type: 'PROPOSE_EDIT'; repositoryId: string; proposalId: string }
export type ApplyEditMessage = { type: 'APPLY_EDIT'; repositoryId: string; proposalId: string; approvalGranted: boolean }
export type RunCommandMessage = { type: 'RUN_COMMAND'; repositoryId: string; command: string; args: string[] }
export type RollbackMessage = { type: 'ROLLBACK'; repositoryId: string; snapshotId: string }

export type ProtocolMessage =
  | NodeHelloMessage
  | NodeAuthMessage
  | NodeHeartbeatMessage
  | NodeStatusMessage
  | NodeOfflineMessage
  | NodeCapabilitiesMessage
  | NodeErrorMessage
  | ListRepositoriesMessage
  | RepositoryStatusMessage
  | ReadFileMessage
  | SearchFilesMessage
  | GitStatusMessage
  | GitDiffMessage
  | GitLogMessage
  | RunValidationMessage
  | ToolEventMessage
  | ErrorMessage
  | ProposeEditMessage
  | ApplyEditMessage
  | RunCommandMessage
  | RollbackMessage

// ---------------------------------------------------------------------------
// Validation — hand-rolled (no schema library dependency in this repo), same discipline as
// lib/modular-intelligence/toolRouter.ts's parse -> validate -> normalize pipeline.
// ---------------------------------------------------------------------------

export type ProtocolValidationResult =
  | { ok: true; message: ProtocolMessage }
  | { ok: false; error: string }

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}
function isString(v: unknown): v is string {
  return typeof v === 'string'
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString)
}
function isPlatform(v: unknown): v is NodePlatform {
  return typeof v === 'string' && (NODE_PLATFORMS as readonly string[]).includes(v)
}
function isCapabilityArray(v: unknown): v is NodeCapability[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string' && (NODE_CAPABILITIES as readonly string[]).includes(x))
}

/**
 * Validates an arbitrary decoded JSON value against the protocol. Rejects: missing `type`, unknown
 * `type`, or a known `type` whose required fields don't match — never partially accepts a
 * malformed message. This is intentionally strict: a node/UI bug should surface as a rejected
 * message, not a message silently coerced into something it wasn't.
 */
export function validateProtocolMessage(raw: unknown): ProtocolValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Protocol message must be a JSON object.' }
  }
  const obj = raw as Record<string, unknown>
  const type = obj.type
  if (!isNonEmptyString(type)) {
    return { ok: false, error: 'Protocol message is missing a string "type" field.' }
  }
  if (!isKnownMessageType(type)) {
    return { ok: false, error: `Unknown protocol message type: "${type}".` }
  }

  switch (type) {
    case 'NODE_HELLO':
      if (
        isNonEmptyString(obj.nodeName) && isPlatform(obj.platform) && isNonEmptyString(obj.architecture)
        && isNonEmptyString(obj.hostname) && isNonEmptyString(obj.osVersion) && isNonEmptyString(obj.agentVersion)
        && isCapabilityArray(obj.capabilities)
      ) {
        return { ok: true, message: obj as unknown as NodeHelloMessage }
      }
      break
    case 'NODE_AUTH':
      if (isNonEmptyString(obj.nodeId) && isNonEmptyString(obj.credential)) {
        return { ok: true, message: obj as unknown as NodeAuthMessage }
      }
      break
    case 'NODE_HEARTBEAT':
      if (isNonEmptyString(obj.nodeId) && isNonEmptyString(obj.credential) && (obj.agentVersion === undefined || isString(obj.agentVersion))) {
        return { ok: true, message: obj as unknown as NodeHeartbeatMessage }
      }
      break
    case 'NODE_STATUS':
      if (isNonEmptyString(obj.nodeId) && isPlatform(obj.platform) && isCapabilityArray(obj.capabilities)) {
        return { ok: true, message: obj as unknown as NodeStatusMessage }
      }
      break
    case 'NODE_OFFLINE':
      if (isNonEmptyString(obj.nodeId) && (obj.reason === undefined || isString(obj.reason))) {
        return { ok: true, message: obj as unknown as NodeOfflineMessage }
      }
      break
    case 'NODE_CAPABILITIES':
      if (isNonEmptyString(obj.nodeId) && isCapabilityArray(obj.capabilities)) {
        return { ok: true, message: obj as unknown as NodeCapabilitiesMessage }
      }
      break
    case 'NODE_ERROR':
      if (isNonEmptyString(obj.code) && isNonEmptyString(obj.message) && (obj.nodeId === undefined || isString(obj.nodeId))) {
        return { ok: true, message: obj as unknown as NodeErrorMessage }
      }
      break
    case 'LIST_REPOSITORIES':
      if (isNonEmptyString(obj.nodeId)) return { ok: true, message: obj as unknown as ListRepositoriesMessage }
      break
    case 'REPOSITORY_STATUS':
      if (isNonEmptyString(obj.repositoryId) && isNonEmptyString(obj.currentBranch) && isNonEmptyString(obj.headSha) && typeof obj.workingTreeClean === 'boolean') {
        return { ok: true, message: obj as unknown as RepositoryStatusMessage }
      }
      break
    case 'READ_FILE':
      if (isNonEmptyString(obj.repositoryId) && isNonEmptyString(obj.relPath)) {
        return { ok: true, message: obj as unknown as ReadFileMessage }
      }
      break
    case 'SEARCH_FILES':
      if (isNonEmptyString(obj.repositoryId) && isNonEmptyString(obj.query) && (obj.pathPrefix === undefined || isString(obj.pathPrefix))) {
        return { ok: true, message: obj as unknown as SearchFilesMessage }
      }
      break
    case 'GIT_STATUS':
      if (isNonEmptyString(obj.repositoryId)) return { ok: true, message: obj as unknown as GitStatusMessage }
      break
    case 'GIT_DIFF':
      if (isNonEmptyString(obj.repositoryId) && (obj.staged === undefined || typeof obj.staged === 'boolean')) {
        return { ok: true, message: obj as unknown as GitDiffMessage }
      }
      break
    case 'GIT_LOG':
      if (isNonEmptyString(obj.repositoryId) && (obj.limit === undefined || typeof obj.limit === 'number')) {
        return { ok: true, message: obj as unknown as GitLogMessage }
      }
      break
    case 'RUN_VALIDATION':
      if (isNonEmptyString(obj.repositoryId) && isNonEmptyString(obj.operationId) && (obj.targets === undefined || isStringArray(obj.targets))) {
        return { ok: true, message: obj as unknown as RunValidationMessage }
      }
      break
    case 'TOOL_EVENT':
      if (
        isNonEmptyString(obj.repositoryId) && isNonEmptyString(obj.tool) && isNonEmptyString(obj.detail)
        && (obj.outcome === 'PASS' || obj.outcome === 'FAIL') && isNonEmptyString(obj.occurredAt)
      ) {
        return { ok: true, message: obj as unknown as ToolEventMessage }
      }
      break
    case 'ERROR':
      if (isNonEmptyString(obj.code) && isNonEmptyString(obj.message)) {
        return { ok: true, message: obj as unknown as ErrorMessage }
      }
      break
    case 'PROPOSE_EDIT':
      if (isNonEmptyString(obj.repositoryId) && isNonEmptyString(obj.proposalId)) {
        return { ok: true, message: obj as unknown as ProposeEditMessage }
      }
      break
    case 'APPLY_EDIT':
      if (isNonEmptyString(obj.repositoryId) && isNonEmptyString(obj.proposalId) && typeof obj.approvalGranted === 'boolean') {
        return { ok: true, message: obj as unknown as ApplyEditMessage }
      }
      break
    case 'RUN_COMMAND':
      if (isNonEmptyString(obj.repositoryId) && isNonEmptyString(obj.command) && isStringArray(obj.args)) {
        return { ok: true, message: obj as unknown as RunCommandMessage }
      }
      break
    case 'ROLLBACK':
      if (isNonEmptyString(obj.repositoryId) && isNonEmptyString(obj.snapshotId)) {
        return { ok: true, message: obj as unknown as RollbackMessage }
      }
      break
  }

  return { ok: false, error: `Malformed payload for protocol message type "${type}".` }
}

export { ENABLED_NODE_CAPABILITIES }
