/**
 * WR-Engineer repository inspection + git awareness boundary.
 *
 * Pure delegation to lib/mission-runtime/engineeringReadSurface.ts, which is itself pure
 * delegation to lib/native-builder/repositoryInspector.ts (which wraps lib/repo/status.ts and
 * lib/repo/diff.ts). WR-Engineer introduces no second read path, no second containment/denylist
 * check, and no second git-access mechanism — this file exists only so a WR-Engineer caller
 * imports repo-inspection/git-awareness operations from its own module namespace instead of
 * reaching into mission-runtime or native-builder internals directly.
 *
 * Covers mission brief items:
 *   1. Repository inspection (read files, search files, understand directory structure)
 *   4. Git awareness (status, diff, log/branch/HEAD via repo status, working-tree diff)
 */
import {
  listEngineeringFiles,
  getEngineeringRepositoryContext,
  readEngineeringFile,
  searchEngineeringRepository,
  inspectEngineeringSymbolUsages,
  type RepoFileReadResult,
  type RepoSearchHit,
  type RepoGitContext,
} from '@/lib/mission-runtime/engineeringReadSurface'

export type { RepoFileReadResult, RepoSearchHit, RepoGitContext }

/** Flat, denylist-respecting directory listing. */
export async function listRepositoryFiles(pathPrefix?: string): Promise<string[]> {
  return listEngineeringFiles(pathPrefix)
}

/** Read one repo-relative file. Containment/denylist/size-cap enforcement lives in
 * repositoryInspector.ts and is unchanged here. */
export async function readFile(relPath: string): Promise<RepoFileReadResult> {
  return readEngineeringFile(relPath)
}

/** Bounded plain-text search under the repo root (or a given path prefix). */
export async function searchRepository(query: string, opts?: { pathPrefix?: string }): Promise<RepoSearchHit[]> {
  return searchEngineeringRepository(query, opts)
}

/** Approximate, text-search-based symbol usage lookup. */
export async function inspectSymbolUsages(symbol: string, opts?: { pathPrefix?: string }): Promise<RepoSearchHit[]> {
  return inspectEngineeringSymbolUsages(symbol, opts)
}

/** Git status + branch + HEAD + a bounded recent diff, in one call — covers "git awareness"
 * (status, diff, current branch, HEAD SHA) from the mission brief's runtime capability list. */
export async function getRepositoryContext(paths?: string[]): Promise<RepoGitContext> {
  return getEngineeringRepositoryContext(paths)
}
