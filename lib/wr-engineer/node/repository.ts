/**
 * WR-Engineer node repository registration.
 *
 * Explicit registration only — WR-Engineer never crawls a paired machine's disk for repositories.
 * Each registered repository belongs to exactly one node and is looked up by (nodeId, path) so the
 * same physical path can't be silently double-registered under different names.
 *
 * Deliberately distinct from lib/native-builder/workspaceRegistry.ts: that registry tracks
 * repositories on the SAME filesystem the Next.js server itself runs on (validated via
 * `fs.realpath`/`.git` checks against a local allowlist) — meaningful only for same-machine
 * workspaces. A WrEngineerNode's repository path is meaningful on the REMOTE machine, not the
 * server's own filesystem, so the server cannot (and must not pretend to) validate it exists or is
 * a git repo — that check is the node's own job when it actually performs GIT_STATUS/LIST_REPOSITORIES
 * against it (see protocol.ts). This module validates only what the server CAN honestly know:
 * shape (non-empty name/path), node ownership (must be a real, non-revoked node), and no duplicate
 * registration for the same node+path.
 */
import { randomUUID } from 'node:crypto'
import type { NodeStore } from './store'
import type { NodeRepository } from './types'

export class RepositoryRegistrationError extends Error {
  constructor(
    message: string,
    public readonly reason: 'node_not_found' | 'node_revoked' | 'invalid_input' | 'already_registered',
  ) {
    super(message)
    this.name = 'RepositoryRegistrationError'
  }
}

export type RegisterRepositoryInput = {
  nodeId: string
  name: string
  path: string
  defaultBranch?: string
}

export async function registerRepository(
  store: NodeStore,
  input: RegisterRepositoryInput,
  now: Date = new Date(),
): Promise<NodeRepository> {
  const node = await store.getNode(input.nodeId)
  if (!node) throw new RepositoryRegistrationError(`Unknown node: ${input.nodeId}`, 'node_not_found')
  if (node.revokedAt) throw new RepositoryRegistrationError(`Node is revoked: ${input.nodeId}`, 'node_revoked')

  const name = input.name.trim()
  const repoPath = input.path.trim()
  if (!name || !repoPath) {
    throw new RepositoryRegistrationError('Repository name and path are both required.', 'invalid_input')
  }

  const existing = await store.listRepositoriesForNode(input.nodeId)
  if (existing.some(r => r.path === repoPath)) {
    throw new RepositoryRegistrationError(`Path already registered on this node: ${repoPath}`, 'already_registered')
  }

  const repository: NodeRepository = {
    repositoryId: randomUUID(),
    nodeId: input.nodeId,
    name,
    path: repoPath,
    defaultBranch: input.defaultBranch?.trim() || 'main',
    currentBranch: null,
    headSha: null,
    enabled: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
  await store.saveRepository(repository)
  return repository
}

export async function listRepositoriesForNode(store: NodeStore, nodeId: string): Promise<NodeRepository[]> {
  return store.listRepositoriesForNode(nodeId)
}

/** Applies a fresh REPOSITORY_STATUS report from the node (branch/HEAD) — the only legitimate way
 * currentBranch/headSha ever change, always attributed to a real reported observation, never
 * inferred or defaulted. */
export async function applyRepositoryStatusReport(
  store: NodeStore,
  repositoryId: string,
  report: { currentBranch: string; headSha: string },
  now: Date = new Date(),
): Promise<NodeRepository> {
  const repository = await store.getRepository(repositoryId)
  if (!repository) throw new RepositoryRegistrationError(`Unknown repository: ${repositoryId}`, 'invalid_input')
  const updated: NodeRepository = {
    ...repository,
    currentBranch: report.currentBranch,
    headSha: report.headSha,
    updatedAt: now.toISOString(),
  }
  await store.saveRepository(updated)
  return updated
}

/**
 * Validates that a repositoryId is a real, enabled repository actually belonging to the given
 * node — the check every session-binding call must pass. Throws, never silently substitutes a
 * different repository, per the mission brief's "node cannot silently switch repository."
 */
export async function requireBoundRepository(store: NodeStore, nodeId: string, repositoryId: string): Promise<NodeRepository> {
  const repository = await store.getRepository(repositoryId)
  if (!repository) {
    throw new RepositoryRegistrationError(`Unregistered repository: ${repositoryId}`, 'invalid_input')
  }
  if (repository.nodeId !== nodeId) {
    throw new RepositoryRegistrationError(
      `Repository ${repositoryId} does not belong to node ${nodeId}.`,
      'invalid_input',
    )
  }
  if (!repository.enabled) {
    throw new RepositoryRegistrationError(`Repository is disabled: ${repositoryId}`, 'invalid_input')
  }
  return repository
}
