/**
 * WR-Engineer proposal validation — session-scoped checks that run BEFORE a parsed model proposal
 * is ever handed to codeEditProposals.ts's proposeEdit()/nativeBuilderBridge.ts's
 * bridgeProposalToNativeBuilder().
 *
 * lib/native-builder/patchPolicy.ts's validatePatchPolicy() (already run inside proposeEdit) checks
 * path denylist/file-type/size against THIS SERVER's own repo root — it has no concept of "which
 * session asked for this" or "does this session's bound repository even correspond to something
 * Native Builder can act on." That is what this module adds: an explicit, honest check that a
 * session's bound repository IS this server's own workspace (the only repository Native Builder's
 * storage/patchApplier can ever touch, per lib/repo/paths.ts's resolveRepoRoot()) before attempting
 * to bridge anything. A session bound to a genuinely different machine's path is correctly rejected
 * here with a clear reason, rather than silently validating against the wrong repository or
 * crashing on a path that doesn't exist locally.
 */
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import type { StructuredPatchOperation } from '@/lib/native-builder/types'
import type { ModelProposedChange } from './structuredResponse'
import type { EngineeringSession } from './session/types'

const SUPPORTED_OPERATIONS: readonly StructuredPatchOperation[] = [
  'replace_range',
  'insert_after',
  'insert_before',
  'create_file',
  'delete_file',
]

export type ProposalValidationResult = { ok: true } | { ok: false; reasons: string[] }

/** Shape/containment checks only — no filesystem access, no session context. Defensive
 * re-validation of what structuredResponse.ts's parser already shaped, since a caller could in
 * principle construct ModelProposedChange[] some other way. */
export function validateProposedChangeShapes(changes: ModelProposedChange[]): ProposalValidationResult {
  const reasons: string[] = []
  if (changes.length === 0) reasons.push('Proposal contains no planned changes.')

  for (const change of changes) {
    const { patch } = change
    if (!SUPPORTED_OPERATIONS.includes(patch.operation)) {
      reasons.push(`Unsupported operation "${patch.operation}" for file "${patch.file}".`)
      continue
    }
    if (path.isAbsolute(patch.file)) {
      reasons.push(`Absolute path not allowed: "${patch.file}".`)
    }
    const normalized = patch.file.split('\\').join('/')
    if (normalized.split('/').some(segment => segment === '..')) {
      reasons.push(`Path traversal ("..") not allowed: "${patch.file}".`)
    }
    if (patch.operation === 'create_file' && !patch.newFileContent) {
      reasons.push(`"create_file" requires "newFileContent": "${patch.file}".`)
    }
    if (patch.operation === 'delete_file' && !patch.commanderConfirmed) {
      reasons.push(`"delete_file" requires explicit Commander confirmation, which chat cannot supply: "${patch.file}".`)
    }
    if ((patch.operation === 'replace_range' || patch.operation === 'insert_after' || patch.operation === 'insert_before') && !patch.matchText) {
      reasons.push(`"${patch.operation}" requires "matchText": "${patch.file}".`)
    }
  }

  return reasons.length ? { ok: false, reasons } : { ok: true }
}

/**
 * True only when the session's bound repository resolves to the exact same directory as this
 * server's own repo root — the one workspace Native Builder's storage/patchApplier can ever act on.
 * `realpath` failing (path doesn't exist on THIS filesystem — the normal case for a genuinely remote
 * node's path) is treated as "not a match," never as an error to propagate; a mismatch is an honest,
 * expected outcome for any node/repository that isn't this server's own local workspace.
 */
export async function sessionRepositoryMatchesServerWorkspace(session: EngineeringSession): Promise<boolean> {
  try {
    const [sessionReal, serverReal] = await Promise.all([
      realpath(session.repositoryPath),
      realpath(resolveRepoRoot()),
    ])
    return path.relative(sessionReal, serverReal) === ''
  } catch {
    return false
  }
}
