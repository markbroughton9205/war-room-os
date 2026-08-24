/**
 * Engineering Core read/inspect boundary (Post-Phase-1 Foundation Hardening §1).
 *
 * Pure delegation — every function below is a thin pass-through to the existing, already-real,
 * already-safe implementations in lib/native-builder/repositoryInspector.ts (which itself already
 * wraps lib/repo/status.ts and lib/repo/diff.ts, see that file's header). Nothing here mutates the
 * repository, nothing here re-implements containment/denylist/size-cap logic, and nothing here
 * introduces a second read path or a second git-access mechanism.
 *
 * Its only job is to be the one place a future client (Standalone Builder, War Room Engineering
 * UI) imports Engineering Core read operations from, instead of importing native-builder
 * internals directly — see the Engineering Core V4 delta analysis §B (Proposed Engineering Core
 * boundary). Presentation/client behavior — an API route, a UI component — is explicitly out of
 * scope for this phase per the Foundation Hardening authorization §1; this module is the boundary
 * such a route or client would call into later, not that route itself.
 *
 * Required capabilities covered here, each mapped to its existing production implementation:
 *   - repository status        -> getRepoGitContext().status      (lib/repo/status.ts)
 *   - git status                -> same as above
 *   - git diff / preview diff   -> getRepoGitContext().recentDiff  (lib/repo/diff.ts)
 *   - read file                 -> readEngineeringFile             (repositoryInspector.readRepoFile)
 *   - search repository         -> searchEngineeringRepository     (repositoryInspector.searchRepoText)
 *   - inspect symbol usages     -> inspectEngineeringSymbolUsages   (repositoryInspector.inspectSymbolUsages)
 */
import {
  readRepoFile,
  searchRepoText,
  inspectSymbolUsages,
  getRepoGitContext,
  type RepoFileReadResult,
  type RepoSearchHit,
  type RepoGitContext,
} from '@/lib/native-builder/repositoryInspector'

export type { RepoFileReadResult, RepoSearchHit, RepoGitContext }

/** Repository status plus a bounded recent diff — the same combined shape native-builder already
 * builds for itself internally, exposed here as one read-only Engineering Core call. Covers both
 * "repository status" and "git status" / "git diff" from §1's required-capabilities list. */
export async function getEngineeringRepositoryContext(paths?: string[]): Promise<RepoGitContext> {
  return getRepoGitContext(paths)
}

/** Read a single repo-relative file. All containment enforcement (path-escape rejection,
 * denylisted directories/files, size cap) lives in repositoryInspector.ts and is unchanged here. */
export async function readEngineeringFile(relPath: string): Promise<RepoFileReadResult> {
  return readRepoFile(relPath)
}

/** Bounded plain-text search under the repo root (or a given path prefix). */
export async function searchEngineeringRepository(
  query: string,
  opts?: { pathPrefix?: string },
): Promise<RepoSearchHit[]> {
  return searchRepoText(query, opts)
}

/** Approximate, text-search-based symbol usage lookup — same honest scope as
 * repositoryInspector.inspectSymbolUsages: good enough to surface likely call sites for a bounded
 * repair, not a substitute for real type-aware refactor tooling. Documented here rather than
 * silently implied, so a future client doesn't over-trust this as an AST-accurate result. */
export async function inspectEngineeringSymbolUsages(
  symbol: string,
  opts?: { pathPrefix?: string },
): Promise<RepoSearchHit[]> {
  return inspectSymbolUsages(symbol, opts)
}
