/**
 * The safety-critical gate. No AI, no heuristics that can be "convinced" — every rule here is a
 * deterministic, structural check. patchApplier.ts must call this and refuse to write on any
 * violation; it also re-checks independently (defense in depth — never trust a caller alone).
 */
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import type { NativeRepairProposal, PatchPolicyResult, PatchPolicyViolation, StructuredPatch } from './types'

export const MAX_CHANGED_FILES = 5
export const MAX_CHANGED_LINES = 150

/** Directories/files a patch may never touch, regardless of extension. */
const BLOCKED_PATH_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.war-room(\/|$)/i,
  /^pnpm-lock\.yaml$/i,
  /^package-lock\.json$/i,
  /^yarn\.lock$/i,
  /^package\.json$/i, // dependency changes blocked even though .json is otherwise allowed
  /(^|\/)supabase\/.*\.sql$/i, // schema migrations
  /(^|\/)\.github\/workflows\//i, // deployment/CI config
  /(^|\/)vercel\.json$/i,
  /(^|\/)netlify\.toml$/i,
  /(^|\/)next\.config\.[jt]s$/i,
  /(^|\/)middleware\.[jt]s$/i, // auth/routing policy
  /(^|\/)lib\/permissions\//i, // approval/authorization policy itself
  /(^|\/)lib\/payments\//i,
  /(^|\/)app\/api\/payments\//i,
  /(^|\/)lib\/billing\//i,
  /secret/i,
  /credential/i,
]

const ALLOWED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.md'])

function normalizeRepoRelative(file: string): { rel: string; ok: boolean } {
  const root = path.resolve(resolveRepoRoot())
  const trimmed = file.trim().replace(/^[/\\]+/, '')
  if (!trimmed) return { rel: file, ok: false }
  const abs = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed)
  const rel = path.relative(root, abs).split(path.sep).join('/')
  const ok = !rel.startsWith('..') && !path.isAbsolute(rel)
  return { rel, ok }
}

function countChangedLines(patch: StructuredPatch): number {
  const text = patch.operation === 'create_file' ? patch.newFileContent ?? '' : patch.replacementText ?? ''
  const removed = patch.operation === 'replace_range' ? (patch.matchText ?? '').split('\n').length : 0
  const added = text ? text.split('\n').length : 0
  return removed + added
}

function validateOnePatch(patch: StructuredPatch, violations: PatchPolicyViolation[]): { rel: string; lines: number } | null {
  const { rel, ok } = normalizeRepoRelative(patch.file)
  if (!ok) {
    violations.push({ rule: 'workspace_containment', file: patch.file, detail: 'Path resolves outside the repository root.' })
    return null
  }
  if (BLOCKED_PATH_PATTERNS.some(pattern => pattern.test(rel))) {
    violations.push({ rule: 'path_denylist', file: rel, detail: 'Path matches a blocked pattern (secrets, lockfiles, deploy config, schema, auth/billing/permissions code).' })
    return null
  }
  const ext = path.extname(rel).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    violations.push({ rule: 'file_type_denylist', file: rel, detail: `File extension "${ext || '(none)'}" is not in the allowed set (${[...ALLOWED_EXTENSIONS].join(', ')}).` })
    return null
  }

  if (patch.operation === 'create_file') {
    if (!patch.newFileContent) {
      violations.push({ rule: 'malformed_patch', file: rel, detail: 'create_file requires newFileContent.' })
      return null
    }
    if (patch.expectedOriginalHash) {
      violations.push({ rule: 'malformed_patch', file: rel, detail: 'create_file must not declare expectedOriginalHash (file must not already exist).' })
      return null
    }
  } else {
    if (!patch.expectedOriginalHash) {
      violations.push({ rule: 'malformed_patch', file: rel, detail: `${patch.operation} requires expectedOriginalHash for stale-file protection.` })
      return null
    }
    if (!patch.matchText) {
      violations.push({ rule: 'malformed_patch', file: rel, detail: `${patch.operation} requires matchText as the anchor.` })
      return null
    }
    if (patch.operation === 'replace_range' && patch.replacementText === undefined) {
      violations.push({ rule: 'malformed_patch', file: rel, detail: 'replace_range requires replacementText (use "" to delete the matched text).' })
      return null
    }
    if ((patch.operation === 'insert_after' || patch.operation === 'insert_before') && !patch.replacementText) {
      violations.push({ rule: 'malformed_patch', file: rel, detail: `${patch.operation} requires non-empty replacementText.` })
      return null
    }
  }

  return { rel, lines: countChangedLines(patch) }
}

/**
 * Full policy evaluation for a proposal. Purely structural — reads nothing from disk (that's
 * patchApplier's job when it re-verifies expectedOriginalHash at apply time).
 */
export function validatePatchPolicy(proposal: NativeRepairProposal): PatchPolicyResult {
  const violations: PatchPolicyViolation[] = []
  const seenFiles = new Set<string>()
  let changedLineCount = 0

  if (proposal.plannedChanges.length === 0) {
    violations.push({ rule: 'malformed_patch', detail: 'Proposal has no planned changes.' })
  }

  for (const change of proposal.plannedChanges) {
    const result = validateOnePatch(change.patch, violations)
    if (result) {
      seenFiles.add(result.rel)
      changedLineCount += result.lines
    }
  }

  if (seenFiles.size > MAX_CHANGED_FILES) {
    violations.push({
      rule: 'max_files_exceeded',
      detail: `Patch touches ${seenFiles.size} files; limit is ${MAX_CHANGED_FILES}.`,
    })
  }
  if (changedLineCount > MAX_CHANGED_LINES) {
    violations.push({
      rule: 'max_lines_exceeded',
      detail: `Patch changes ~${changedLineCount} lines; limit is ${MAX_CHANGED_LINES}.`,
    })
  }

  // Issue-relevance check: every file actually patched must have been declared relevant by the
  // proposal itself. This blocks a proposal from quietly touching files it never claimed to need.
  const relevantSet = new Set(proposal.relevantFiles.map(f => normalizeRepoRelative(f).rel))
  for (const file of seenFiles) {
    if (!relevantSet.has(file)) {
      violations.push({
        rule: 'issue_relevance',
        file,
        detail: 'File is patched but was not declared in relevantFiles for this proposal.',
      })
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    changedFileCount: seenFiles.size,
    changedLineCount,
  }
}
