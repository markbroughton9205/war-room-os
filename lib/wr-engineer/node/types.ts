/**
 * WR-Engineer remote node — domain types.
 *
 * Framework-free on purpose: this file imports nothing from Next.js, Supabase, or any
 * Node.js-only server API. wr-engineer-node/ (the lightweight cross-platform machine-side
 * package) imports these same types directly so the protocol/identity contract is defined
 * exactly once and shared verbatim by both sides — never duplicated or hand-kept-in-sync.
 *
 * Architecture (mission brief):
 *   WAR ROOM UI -> WR-ENGINEER CHAT -> WR-ENGINEER RUNTIME -> REMOTE NODE TRANSPORT ->
 *   WR-ENGINEER-NODE -> LOCAL REPOSITORY / TERMINAL / GIT / TESTS
 *
 * A node is a lightweight, explicitly-enrolled machine daemon — never a full second copy of
 * WR-Engineer's identity/soul/reasoning. It only ever exposes the capabilities listed below, and
 * only the INSPECTION ones are enabled in Phase 2 (see ENABLED_NODE_CAPABILITIES).
 */

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export const NODE_PLATFORMS = ['windows', 'macos', 'linux'] as const
export type NodePlatform = (typeof NODE_PLATFORMS)[number]

/** Pure mapping from Node.js's `os.platform()` values to our platform enum — used identically by
 * the server (for display) and by wr-engineer-node (to self-report at NODE_HELLO). Kept here, not
 * duplicated, so "Windows/macOS/Linux support" means "this one mapping is correct for all three,"
 * not three separate reimplementations that could drift. */
export function nodePlatformFromOsPlatform(osPlatform: string): NodePlatform | null {
  switch (osPlatform) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'macos'
    case 'linux':
      return 'linux'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Capabilities — inspection is enabled today; controlled actions are typed but NOT_ENABLED.
// ---------------------------------------------------------------------------

/** Read-only / inspection capabilities. Phase 2 enables exactly this set. */
export const NODE_INSPECTION_CAPABILITIES = [
  'read_file',
  'search_files',
  'list_repo_tree',
  'inspect_project_metadata',
  'git_status',
  'git_diff',
  'git_log',
  'current_branch',
  'head_sha',
  'run_validation',
  'inspect_runtime',
] as const
export type NodeInspectionCapability = (typeof NODE_INSPECTION_CAPABILITIES)[number]

/** Controlled future actions. Typed today so the protocol/contract is stable; deliberately never
 * added to ENABLED_NODE_CAPABILITIES in Phase 2 — see protocol.ts's handler, which rejects any
 * message mapped to one of these with a NOT_ENABLED error even though the type exists. */
export const NODE_CONTROLLED_FUTURE_CAPABILITIES = ['propose_edit', 'apply_edit', 'run_command', 'rollback'] as const
export type NodeControlledFutureCapability = (typeof NODE_CONTROLLED_FUTURE_CAPABILITIES)[number]

export const NODE_CAPABILITIES = [...NODE_INSPECTION_CAPABILITIES, ...NODE_CONTROLLED_FUTURE_CAPABILITIES] as const
export type NodeCapability = (typeof NODE_CAPABILITIES)[number]

/** Server-enforced allowlist — independent of whatever a node CLAIMS to support at NODE_HELLO/
 * NODE_CAPABILITIES. A node self-reporting `run_command` never gets to actually use it: the
 * protocol handler checks membership here, not the node's own claim. */
export const ENABLED_NODE_CAPABILITIES: readonly NodeCapability[] = NODE_INSPECTION_CAPABILITIES

export function isCapabilityEnabled(capability: NodeCapability): boolean {
  return (ENABLED_NODE_CAPABILITIES as readonly string[]).includes(capability)
}

// ---------------------------------------------------------------------------
// Node identity
// ---------------------------------------------------------------------------

export type NodeConnectionStatus = 'ONLINE' | 'OFFLINE'

export type WrEngineerNode = {
  nodeId: string
  nodeName: string
  platform: NodePlatform
  architecture: string
  hostname: string
  osVersion: string
  agentVersion: string
  /** Self-reported at NODE_HELLO/NODE_CAPABILITIES — a claim, not a grant. See
   * ENABLED_NODE_CAPABILITIES/isCapabilityEnabled for what actually runs. */
  capabilities: NodeCapability[]
  /** Device credential metadata only — the actual secret is never stored in plaintext once
   * issued (see identity.ts). This is enough to identify/rotate/revoke a credential without ever
   * holding the value that would let someone impersonate the node. */
  credential: {
    credentialId: string
    credentialHash: string
    issuedAt: string
  }
  lastSeenAt: string | null
  createdAt: string
  pairedAt: string | null
  revokedAt: string | null
}

/** Derived, never stored — a node's ONLINE/OFFLINE status is always computed from lastSeenAt at
 * read time (SOUL.md §6: never let a stale stored flag masquerade as OBSERVED current state). */
export function deriveNodeConnectionStatus(
  lastSeenAt: string | null,
  now: Date,
  staleAfterMs = 90_000,
): NodeConnectionStatus {
  if (!lastSeenAt) return 'OFFLINE'
  const lastSeenMs = new Date(lastSeenAt).getTime()
  if (Number.isNaN(lastSeenMs)) return 'OFFLINE'
  return now.getTime() - lastSeenMs <= staleAfterMs ? 'ONLINE' : 'OFFLINE'
}

// ---------------------------------------------------------------------------
// Repository registration — explicit only, never auto-crawled.
// ---------------------------------------------------------------------------

export type NodeRepository = {
  repositoryId: string
  nodeId: string
  name: string
  path: string
  defaultBranch: string
  currentBranch: string | null
  headSha: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

export const PAIRING_STATES = ['WAITING', 'PAIRING', 'AUTHORIZED', 'EXPIRED', 'REJECTED'] as const
export type PairingState = (typeof PAIRING_STATES)[number]

export type PairingToken = {
  tokenId: string
  /** sha256 of the plaintext pairing code. The plaintext itself is returned to the caller exactly
   * once at generation time and never persisted anywhere — see pairing.ts's header. */
  codeHash: string
  state: PairingState
  /** Self-reported machine facts submitted with the pairing attempt — recorded so a Commander
   * reviewing a pending PAIRING request can see what it claims to be before authorizing it. */
  candidate?: {
    nodeName: string
    platform: NodePlatform
    architecture: string
    hostname: string
    osVersion: string
    agentVersion: string
    capabilities: NodeCapability[]
  }
  authorizedNodeId?: string
  createdAt: string
  expiresAt: string
  consumedAt?: string
}
