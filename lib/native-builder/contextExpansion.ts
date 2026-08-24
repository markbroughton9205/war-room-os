/**
 * Phase H — Context Expansion. Improves what the hosted-coder path (repairPlanner.ts:
 * requestHostedModelProposal) is shown, using ONLY the existing read surface
 * (repositoryInspector.ts's readRepoFile/searchRepoText/inspectSymbolUsages/getRepoGitContext) —
 * no new filesystem access primitive is introduced here. Deterministic and local-model proposal
 * generation are untouched; this module is consumed only where runtime.ts's planRepair() has a
 * hosted coder configured, so the improved context is additive to hosted-coder quality, not a
 * behavior change for the other two proposal sources.
 *
 * Bounded, deliberately: this is a small, curated context set, never a full-repo dump. Every hard
 * cap below exists so a large repository can't blow up the prompt sent to a hosted provider.
 *
 * Every included excerpt is one of the same InspectionExcerpt shape repairPlanner.ts already
 * consumes (relPath/content) — this is a source-selection improvement only. Nothing about the
 * StructuredPatch contract, the parser (tryParseModelProposal), or patch policy changes.
 */
import { readRepoFile, searchRepoText, inspectSymbolUsages, getRepoGitContext } from './repositoryInspector'
import type { NativeIssueRecord, NativeContextSource, NativeContextSourceReason } from './types'
import type { InspectionExcerpt } from './repairPlanner'
import path from 'node:path'

export type ExpandedHostedCoderContext = {
  excerpts: InspectionExcerpt[]
  sources: NativeContextSource[]
  gitContextSummary: string
}

const MAX_PRIMARY_FILES = 5
const MAX_IMPORT_RELATED_FILES = 4
const MAX_SEARCH_RELATED_FILES = 2
const MAX_SYMBOL_USAGE_HITS = 6
const MAX_EXCERPT_CHARS_PER_FILE = 6000
const MAX_TOTAL_EXCERPT_CHARS = 32_000

const RELATIVE_IMPORT_PATTERN = /(?:import|export)(?:\s+type)?\s+[^'"]*from\s+['"](\.[^'"]+)['"]/g

/** Extracts this file's own relative (same-repo, `./` or `../`) import specifiers and resolves
 * them to repo-relative paths. Bounded to what the file's imports actually declare — no guessing,
 * no transitive walk beyond one hop (a target file's direct imports, not its imports' imports). */
function extractRelativeImportTargets(content: string, fromRelPath: string): string[] {
  const dir = path.posix.dirname(fromRelPath.replace(/\\/g, '/'))
  const targets = new Set<string>()
  let match: RegExpExecArray | null
  RELATIVE_IMPORT_PATTERN.lastIndex = 0
  while ((match = RELATIVE_IMPORT_PATTERN.exec(content))) {
    const resolved = path.posix.normalize(path.posix.join(dir, match[1]))
    targets.add(resolved)
  }
  return [...targets]
}

/** Bounded candidate resolution for an extension-less relative import (`./foo` -> `foo.ts`, etc.)
 * — tries the exact path first, then a small fixed set of extensions, then an `index` file. Not a
 * module resolver; just enough to usually find the real file for the common cases. */
async function resolveImportCandidate(basePath: string): Promise<InspectionExcerpt | null> {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
  ]
  for (const candidate of candidates) {
    const read = await readRepoFile(candidate)
    if (read.ok) return { relPath: read.relPath, content: read.content }
  }
  return null
}

/** Simple heuristic symbol candidate: the first CamelCase or snake_case-ish identifier-looking
 * token (4+ chars) in the issue's title or raw evidence text. Honest about being a heuristic —
 * this is a bounded best-effort signal for inspectSymbolUsages, not a claim of AST-level accuracy
 * (repositoryInspector.ts's own symbol search is already text-based, not AST-based). */
function guessSymbolCandidate(issue: NativeIssueRecord): string | null {
  const text = `${issue.title} ${issue.rawEvidenceText}`
  const match = text.match(/\b([A-Z][a-zA-Z0-9]{3,}|[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]{2,})\b/)
  return match?.[1] ?? null
}

function truncated(content: string): string {
  return content.length > MAX_EXCERPT_CHARS_PER_FILE ? content.slice(0, MAX_EXCERPT_CHARS_PER_FILE) : content
}

/**
 * Assembles a bounded, auditable context set for one hosted-coder request: the target file(s),
 * files they directly import (one hop), a small number of additional search matches for the
 * issue's own text, lightweight symbol-usage locations (path/line only, not full file reads), and
 * a git status/diff summary scoped to just the target files. Every included file is recorded in
 * `sources` with why it was included, for auditability — this is what actually gets attached to
 * the resulting NativeRepairProposal.contextSources.
 */
export async function gatherHostedCoderContext(
  issue: NativeIssueRecord,
  targetFiles: string[] | undefined,
  fallbackExcerpts: InspectionExcerpt[],
): Promise<ExpandedHostedCoderContext> {
  const excerpts: InspectionExcerpt[] = []
  const sources: NativeContextSource[] = []
  const seenPaths = new Set<string>()
  let totalChars = 0

  const add = (excerpt: InspectionExcerpt, reason: NativeContextSourceReason): boolean => {
    if (seenPaths.has(excerpt.relPath)) return false
    if (totalChars >= MAX_TOTAL_EXCERPT_CHARS) return false
    const content = truncated(excerpt.content)
    seenPaths.add(excerpt.relPath)
    totalChars += content.length
    excerpts.push({ relPath: excerpt.relPath, content })
    sources.push({ relPath: excerpt.relPath, reason, chars: content.length })
    return true
  }

  // 1. Primary target files — same candidates gatherExcerpts already used, so hosted-coder
  // context is a strict superset, never a divergent selection.
  const primaryCandidates = (targetFiles?.length ? targetFiles : [issue.affectedSubsystem]).slice(0, MAX_PRIMARY_FILES)
  const primaryReads: InspectionExcerpt[] = []
  for (const candidate of primaryCandidates) {
    const read = await readRepoFile(candidate)
    if (read.ok) {
      primaryReads.push({ relPath: read.relPath, content: read.content })
      add({ relPath: read.relPath, content: read.content }, 'target')
    }
  }

  // If nothing resolved, fall back to what runtime.ts's own gatherExcerpts already found (its
  // bounded title-seeded search), rather than leaving hosted-coder with zero context.
  if (primaryReads.length === 0 && fallbackExcerpts.length) {
    for (const excerpt of fallbackExcerpts) add(excerpt, 'target')
  }

  // 2. One-hop import relationships from the primary files.
  let importRelatedCount = 0
  for (const primary of primaryReads) {
    if (importRelatedCount >= MAX_IMPORT_RELATED_FILES) break
    const importTargets = extractRelativeImportTargets(primary.content, primary.relPath)
    for (const target of importTargets) {
      if (importRelatedCount >= MAX_IMPORT_RELATED_FILES) break
      const resolved = await resolveImportCandidate(target)
      if (resolved && add(resolved, 'import_relationship')) importRelatedCount += 1
    }
  }

  // 3. A small number of additional search matches for the issue's own text — supplements
  // (does not replace) the primary files, unlike gatherExcerpts' own search-as-fallback.
  const query = issue.title.split(/\s+/).find(w => w.length > 4) ?? issue.title
  const hits = await searchRepoText(query)
  const distinctSearchFiles = [...new Set(hits.map(h => h.relPath))].filter(p => !seenPaths.has(p)).slice(0, MAX_SEARCH_RELATED_FILES)
  for (const file of distinctSearchFiles) {
    const read = await readRepoFile(file)
    if (read.ok) add({ relPath: read.relPath, content: read.content }, 'search_match')
  }

  // 4. Lightweight symbol-usage locations (not full file reads) — recorded as sources with a
  // synthetic 0-length "reference" entry so they're auditable even though we don't spend excerpt
  // budget reading the whole file just for a usage location already covered by the excerpt text.
  const symbol = guessSymbolCandidate(issue)
  if (symbol) {
    const usageHits = (await inspectSymbolUsages(symbol)).slice(0, MAX_SYMBOL_USAGE_HITS)
    for (const hit of usageHits) {
      if (seenPaths.has(hit.relPath)) continue
      sources.push({ relPath: `${hit.relPath}:${hit.lineNumber}`, reason: 'symbol_usage', chars: 0 })
    }
  }

  // 5. Git context scoped to just the target files (never a full-repo diff).
  const gitContext = await getRepoGitContext(primaryReads.map(p => p.relPath))
  const gitContextSummary = gitContext.recentDiff.diff
    ? `${gitContext.status.currentBranch}: ${gitContext.status.changedFiles.length} changed file(s) repo-wide; scoped diff ${gitContext.recentDiff.truncated ? '(truncated) ' : ''}available.`
    : `${gitContext.status.currentBranch}: no pending diff for the target file(s).`

  return { excerpts, sources, gitContextSummary }
}
