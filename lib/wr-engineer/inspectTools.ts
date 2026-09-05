/**
 * WR-Engineer Phase 4 inspect-tool dispatcher.
 *
 * Executes the allow-listed inspection tools by delegating to lib/wr-engineer/readSurface.ts
 * (which itself delegates to engineeringReadSurface → repositoryInspector → lib/repo). No second
 * filesystem reader, no second git implementation, no shell string, no write.
 *
 * Remote nodes: if the session's bound repository is not this server's workspace, execution is
 * FOUNDATION_ONLY — we return an honest failure rather than faking a remote READ_FILE success.
 * Protocol message types (READ_FILE, SEARCH_FILES, …) stay compatible for a future dispatcher.
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import * as readSurface from './readSurface'
import { sessionRepositoryMatchesServerWorkspace } from './proposalValidation'
import {
  MAX_CHANGED_FILES_IN_STATUS,
  MAX_FILE_BYTES_PER_READ,
  MAX_FILES_READ_PER_TURN,
  MAX_GIT_DIFF_BYTES,
  MAX_GIT_LOG_ENTRIES,
  MAX_SEARCH_RESULTS,
  MAX_TREE_ENTRIES,
} from './inspectBounds'
import type { InspectToolName } from './inspectContract'
import {
  normalizeRelPath,
  recordSuccessfulRead,
  sha256Text,
  type EngineeringTurnEvidence,
  type InspectionObservation,
} from './turnEvidence'
import type { EngineeringSession } from './session/types'

export type InspectExecutionMode = 'local_server_workspace' | 'FOUNDATION_ONLY'

export async function resolveInspectExecutionMode(session: EngineeringSession): Promise<{
  mode: InspectExecutionMode
  reason?: string
}> {
  const matches = await sessionRepositoryMatchesServerWorkspace(session)
  if (matches) return { mode: 'local_server_workspace' }
  return {
    mode: 'FOUNDATION_ONLY',
    reason: 'Remote node inspect dispatch is FOUNDATION_ONLY — this session\'s repository is not this server\'s workspace, and WR-Engineer cannot yet execute READ_FILE / SEARCH_FILES on a remote node. Not faking success.',
  }
}

export type InspectToolResult = {
  ok: boolean
  observation: InspectionObservation
  modelPayload: unknown
}

function isAbsolutePath(relPath: string): boolean {
  return path.isAbsolute(relPath) || /^[a-zA-Z]:[\\/]/.test(relPath) || relPath.startsWith('\\\\')
}

function hasTraversal(relPath: string): boolean {
  return normalizeRelPath(relPath).split('/').some(segment => segment === '..')
}

function rejectPath(relPath: string): string | null {
  if (!relPath.trim()) return 'Path is empty.'
  if (isAbsolutePath(relPath)) return `Absolute path not allowed: "${relPath}".`
  if (hasTraversal(relPath)) return `Path traversal ("..") not allowed: "${relPath}".`
  return null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : fallback
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function makeObservation(
  turn: EngineeringTurnEvidence,
  tool: InspectToolName,
  args: Record<string, unknown>,
  status: 'PASS' | 'FAIL',
  summary: string,
  extra: Partial<InspectionObservation> = {},
): InspectionObservation {
  return {
    observationId: randomUUID(),
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    tool,
    arguments: args,
    repositoryId: turn.repositoryId,
    nodeId: turn.nodeId,
    status,
    summary,
    resultReference: extra.resultReference ?? extra.observationId ?? `obs:${tool}`,
    occurredAt: new Date().toISOString(),
    ...extra,
  }
}

function fail(turn: EngineeringTurnEvidence, tool: InspectToolName, args: Record<string, unknown>, summary: string): InspectToolResult {
  const observation = makeObservation(turn, tool, args, 'FAIL', summary, { resultReference: `fail:${tool}` })
  turn.observations.push(observation)
  turn.toolCallCount += 1
  turn.rawObservedBytes += Buffer.byteLength(summary, 'utf8')
  return { ok: false, observation, modelPayload: { ok: false, error: summary } }
}

export async function executeInspectTool(
  session: EngineeringSession,
  turn: EngineeringTurnEvidence,
  tool: InspectToolName,
  rawArgs: Record<string, unknown>,
): Promise<InspectToolResult> {
  const requestedRepo = asString(rawArgs.repositoryId)
  if (requestedRepo && requestedRepo !== session.repositoryId) {
    return fail(turn, tool, rawArgs, `Cross-repository inspect rejected: requested ${requestedRepo}, session bound to ${session.repositoryId}.`)
  }

  const execution = await resolveInspectExecutionMode(session)
  if (execution.mode === 'FOUNDATION_ONLY') {
    return fail(turn, tool, rawArgs, execution.reason ?? 'FOUNDATION_ONLY')
  }

  switch (tool) {
    case 'read_file':
      return executeReadFile(turn, rawArgs)
    case 'search_files':
      return executeSearchFiles(turn, rawArgs)
    case 'list_repo_tree':
      return executeListRepoTree(turn, rawArgs)
    case 'git_status':
      return executeGitStatus(turn, rawArgs)
    case 'git_diff':
      return executeGitDiff(turn, rawArgs)
    case 'git_log':
      return executeGitLog(turn, rawArgs)
    case 'inspect_project_metadata':
      return executeProjectMetadata(turn, rawArgs)
    case 'inspect_runtime':
      return executeRuntime(session, turn, rawArgs)
    default: {
      const exhaustive: never = tool
      return fail(turn, exhaustive, rawArgs, `Unknown tool: ${String(tool)}`)
    }
  }
}

async function executeReadFile(turn: EngineeringTurnEvidence, args: Record<string, unknown>): Promise<InspectToolResult> {
  const relPath = asString(args.relPath) ?? asString(args.path) ?? ''
  const pathError = rejectPath(relPath)
  if (pathError) return fail(turn, 'read_file', args, pathError)
  if (turn.readFiles.length >= MAX_FILES_READ_PER_TURN && !turn.readFileContents[normalizeRelPath(relPath)]) {
    return fail(turn, 'read_file', args, `Bounded file-read limit reached (${MAX_FILES_READ_PER_TURN} files per turn).`)
  }

  const result = await readSurface.readFile(relPath)
  if (!result.ok) return fail(turn, 'read_file', args, result.error)

  let content = result.content
  let truncated = false
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES_PER_READ) {
    content = content.slice(0, MAX_FILE_BYTES_PER_READ)
    truncated = true
  }
  recordSuccessfulRead(turn, result.relPath, content, truncated)
  const record = turn.readFileContents[normalizeRelPath(result.relPath)]
  const summary = truncated
    ? `${result.relPath} truncated to ${record.bytesRead} bytes`
    : `${result.relPath} ${record.bytesRead} bytes`
  const observation = makeObservation(turn, 'read_file', args, 'PASS', summary, {
    filePath: record.relPath,
    contentHash: record.contentHash,
    bytesRead: record.bytesRead,
    truncated,
    resultReference: `read:${record.relPath}:${record.contentHash.slice(0, 12)}`,
  })
  turn.observations.push(observation)
  turn.toolCallCount += 1
  return {
    ok: true,
    observation,
    modelPayload: {
      ok: true,
      relPath: record.relPath,
      bytesRead: record.bytesRead,
      truncated,
      contentHash: record.contentHash,
      content,
    },
  }
}

async function executeSearchFiles(turn: EngineeringTurnEvidence, args: Record<string, unknown>): Promise<InspectToolResult> {
  const query = (asString(args.query) ?? '').trim()
  if (!query) return fail(turn, 'search_files', args, 'search_files requires a non-empty "query".')
  const pathPrefix = asString(args.pathPrefix)
  if (pathPrefix) {
    const pathError = rejectPath(pathPrefix)
    if (pathError) return fail(turn, 'search_files', args, pathError)
  }

  const hits = await readSurface.searchRepository(query, pathPrefix ? { pathPrefix } : undefined)
  const bounded = hits.slice(0, MAX_SEARCH_RESULTS)
  const returnedPaths = [...new Set(bounded.map(h => h.relPath))]
  turn.searches.push({ query, matchCount: bounded.length, returnedPaths })
  const summary = `${bounded.length} matches for "${query}"`
  const observation = makeObservation(turn, 'search_files', args, 'PASS', summary, {
    query,
    matchCount: bounded.length,
    returnedPaths,
    resultReference: `search:${sha256Text(query).slice(0, 12)}`,
  })
  turn.observations.push(observation)
  turn.toolCallCount += 1
  return {
    ok: true,
    observation,
    modelPayload: {
      ok: true,
      query,
      matchCount: bounded.length,
      truncated: hits.length > bounded.length,
      hits: bounded.map(h => ({ relPath: h.relPath, lineNumber: h.lineNumber, line: h.line })),
    },
  }
}

async function executeListRepoTree(turn: EngineeringTurnEvidence, args: Record<string, unknown>): Promise<InspectToolResult> {
  const pathPrefix = asString(args.pathPrefix)
  if (pathPrefix) {
    const pathError = rejectPath(pathPrefix)
    if (pathError) return fail(turn, 'list_repo_tree', args, pathError)
  }
  const maxDepth = asBoundedInt(args.maxDepth, 6, 1, 8)
  const files = await readSurface.listRepositoryFiles(pathPrefix)
  const filtered = files.filter(rel => rel.split('/').length <= maxDepth)
  const bounded = filtered.slice(0, MAX_TREE_ENTRIES)
  turn.listedPaths.push(...bounded)
  turn.metadataObservations.push({ tool: 'list_repo_tree', summary: `${bounded.length} paths` })
  const summary = `${bounded.length} paths (depth ≤ ${maxDepth})`
  const observation = makeObservation(turn, 'list_repo_tree', args, 'PASS', summary, {
    returnedPaths: bounded,
    resultReference: `tree:${bounded.length}`,
  })
  turn.observations.push(observation)
  turn.toolCallCount += 1
  return {
    ok: true,
    observation,
    modelPayload: { ok: true, pathCount: bounded.length, truncated: filtered.length > bounded.length, paths: bounded },
  }
}

async function executeGitStatus(turn: EngineeringTurnEvidence, args: Record<string, unknown>): Promise<InspectToolResult> {
  const ctx = await readSurface.getRepositoryContext()
  const dirty = ctx.status.workingTreeStatus === 'dirty'
  const branch = ctx.status.currentBranch
  const head = ctx.status.lastCommitHash?.full ?? null
  const changed = ctx.status.changedFiles.slice(0, MAX_CHANGED_FILES_IN_STATUS).map(f => f.path)
  const summary = `branch ${branch} HEAD ${head ? head.slice(0, 12) : 'unknown'} ${dirty ? 'dirty' : 'clean'}`
  turn.gitObservations.push({ tool: 'git_status', branch, head: head ?? undefined, dirty, summary })
  const observation = makeObservation(turn, 'git_status', args, 'PASS', summary, {
    branch,
    head: head ?? undefined,
    dirty,
    resultReference: `git-status:${head ?? 'unknown'}`,
  })
  turn.observations.push(observation)
  turn.toolCallCount += 1
  return {
    ok: true,
    observation,
    modelPayload: {
      ok: true,
      branch,
      head,
      dirty,
      workingTreeStatus: ctx.status.workingTreeStatus,
      uncommittedFilesCount: ctx.status.uncommittedFilesCount,
      changedFiles: changed,
      truncated: ctx.status.changedFiles.length > changed.length,
    },
  }
}

async function executeGitDiff(turn: EngineeringTurnEvidence, args: Record<string, unknown>): Promise<InspectToolResult> {
  const ctx = await readSurface.getRepositoryContext()
  let diff = ctx.recentDiff.diff
  let truncated = ctx.recentDiff.truncated
  if (Buffer.byteLength(diff, 'utf8') > MAX_GIT_DIFF_BYTES) {
    diff = diff.slice(0, MAX_GIT_DIFF_BYTES)
    truncated = true
  }
  const summary = truncated ? `diff truncated to ${Buffer.byteLength(diff, 'utf8')} bytes` : `diff ${Buffer.byteLength(diff, 'utf8')} bytes`
  turn.gitObservations.push({
    tool: 'git_diff',
    branch: ctx.status.currentBranch,
    head: ctx.status.lastCommitHash?.full,
    dirty: ctx.status.workingTreeStatus === 'dirty',
    summary,
  })
  const observation = makeObservation(turn, 'git_diff', args, 'PASS', summary, {
    branch: ctx.status.currentBranch,
    head: ctx.status.lastCommitHash?.full,
    dirty: ctx.status.workingTreeStatus === 'dirty',
    truncated,
    resultReference: `git-diff:${sha256Text(diff).slice(0, 12)}`,
  })
  turn.observations.push(observation)
  turn.toolCallCount += 1
  turn.rawObservedBytes += Buffer.byteLength(diff, 'utf8')
  return { ok: true, observation, modelPayload: { ok: true, diff, truncated, branch: ctx.status.currentBranch } }
}

async function executeGitLog(turn: EngineeringTurnEvidence, args: Record<string, unknown>): Promise<InspectToolResult> {
  const limit = asBoundedInt(args.limit, MAX_GIT_LOG_ENTRIES, 1, MAX_GIT_LOG_ENTRIES)
  const entries = await readSurface.getRepositoryLog(limit)
  const ctx = await readSurface.getRepositoryContext()
  const summary = `${entries.length} commit(s) on ${ctx.status.currentBranch}`
  turn.gitObservations.push({
    tool: 'git_log',
    branch: ctx.status.currentBranch,
    head: ctx.status.lastCommitHash?.full,
    dirty: ctx.status.workingTreeStatus === 'dirty',
    summary,
  })
  const observation = makeObservation(turn, 'git_log', args, 'PASS', summary, {
    branch: ctx.status.currentBranch,
    head: ctx.status.lastCommitHash?.full,
    resultReference: `git-log:${entries[0]?.hash ?? 'empty'}`,
  })
  turn.observations.push(observation)
  turn.toolCallCount += 1
  return {
    ok: true,
    observation,
    modelPayload: { ok: true, branch: ctx.status.currentBranch, head: ctx.status.lastCommitHash, entries },
  }
}

const METADATA_FILES = ['package.json', 'tsconfig.json', 'next.config.ts', 'next.config.js', 'pyproject.toml', 'requirements.txt']

async function executeProjectMetadata(turn: EngineeringTurnEvidence, args: Record<string, unknown>): Promise<InspectToolResult> {
  const files: Record<string, unknown> = {}
  for (const rel of METADATA_FILES) {
    const result = await readSurface.readFile(rel)
    if (!result.ok) continue
    if (rel.endsWith('.json')) {
      try {
        files[rel] = JSON.parse(result.content)
      } catch {
        files[rel] = { parseError: true, bytes: result.sizeBytes }
      }
    } else {
      files[rel] = { present: true, bytes: result.sizeBytes, excerpt: result.content.slice(0, 1500) }
    }
  }
  const names = Object.keys(files)
  const summary = names.length ? `metadata: ${names.join(', ')}` : 'no project metadata files readable'
  turn.metadataObservations.push({ tool: 'inspect_project_metadata', summary })
  const observation = makeObservation(turn, 'inspect_project_metadata', args, 'PASS', summary, {
    returnedPaths: names,
    resultReference: `metadata:${names.join(',')}`,
  })
  turn.observations.push(observation)
  turn.toolCallCount += 1
  return { ok: true, observation, modelPayload: { ok: true, files } }
}

async function executeRuntime(session: EngineeringSession, turn: EngineeringTurnEvidence, args: Record<string, unknown>): Promise<InspectToolResult> {
  let packageManager: string | null = null
  const pkg = await readSurface.readFile('package.json')
  if (pkg.ok) {
    try {
      const parsed = JSON.parse(pkg.content) as { packageManager?: string }
      packageManager = parsed.packageManager ?? 'pnpm (lockfile convention)'
    } catch {
      packageManager = 'unknown'
    }
  }
  const ctx = await readSurface.getRepositoryContext()
  const payload = {
    ok: true as const,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    packageManager,
    repoRoot: resolveRepoRoot(),
    nodeId: session.nodeId,
    repositoryId: session.repositoryId,
    branch: ctx.status.currentBranch,
    head: ctx.status.lastCommitHash,
    canExecuteShell: false,
  }
  const summary = `${payload.platform} node ${payload.nodeVersion} ${payload.branch}`
  turn.metadataObservations.push({ tool: 'inspect_runtime', summary })
  const observation = makeObservation(turn, 'inspect_runtime', args, 'PASS', summary, {
    branch: payload.branch,
    head: payload.head?.full,
    resultReference: `runtime:${payload.nodeId}`,
  })
  turn.observations.push(observation)
  turn.toolCallCount += 1
  return { ok: true, observation, modelPayload: payload }
}
