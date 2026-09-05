/**
 * WR-Engineer Phase 4 turn-scoped inspection evidence.
 *
 * A proposal may only target files actually read during the CURRENT Commander turn — not an
 * earlier turn, not engineering memory, not a guessed filename. Full file bytes live on this
 * in-memory object for matchText validation; the session only stores a compact summary
 * (CompactTurnEvidence) so session JSON is not a blob dump.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { ModelProposal } from './structuredResponse'
import type { InspectToolName } from './inspectContract'

export const TARGET_NOT_READ_THIS_TURN = 'TARGET_NOT_READ_THIS_TURN'
export const MATCH_TEXT_NOT_OBSERVED = 'MATCH_TEXT_NOT_OBSERVED'
export const MATCH_TEXT_NOT_UNIQUE = 'MATCH_TEXT_NOT_UNIQUE'
export const CREATE_FILE_CONTEXT_NOT_INSPECTED = 'CREATE_FILE_CONTEXT_NOT_INSPECTED'

export type TurnPhase =
  | 'THINKING'
  | 'INSPECTING'
  | 'READING'
  | 'SEARCHING'
  | 'ANALYZING'
  | 'PROPOSING'
  | 'READY'
  | 'BLOCKED'
  | 'FAILED'

export type InspectionObservation = {
  observationId: string
  sessionId: string
  turnId: string
  tool: InspectToolName | string
  arguments: Record<string, unknown>
  repositoryId: string
  nodeId: string
  status: 'PASS' | 'FAIL'
  summary: string
  resultReference: string
  occurredAt: string
  filePath?: string
  contentHash?: string
  bytesRead?: number
  truncated?: boolean
  query?: string
  matchCount?: number
  returnedPaths?: string[]
  branch?: string
  head?: string
  dirty?: boolean
}

export type CompactReadFile = { relPath: string; bytesRead: number; truncated: boolean; contentHash: string }
export type CompactSearch = { query: string; matchCount: number; returnedPaths: string[] }
export type CompactGitObservation = { tool: string; branch?: string; head?: string; dirty?: boolean; summary: string }
export type CompactMetadataObservation = { tool: string; summary: string }

export type CompactTurnEvidence = {
  turnId: string
  readFiles: CompactReadFile[]
  searches: CompactSearch[]
  gitObservations: CompactGitObservation[]
  metadataObservations: CompactMetadataObservation[]
  listedPaths: string[]
  toolCallCount: number
  rawObservedBytes: number
  startedAt: string
  completedAt: string | null
}

export type ReadFileRecord = CompactReadFile & { content: string }

export type EngineeringTurnEvidence = CompactTurnEvidence & {
  sessionId: string
  nodeId: string
  repositoryId: string
  observations: InspectionObservation[]
  readFileContents: Record<string, ReadFileRecord>
}

export type ProposalFileGrounding = {
  file: string
  readThisTurn: boolean
  matchTextObserved: boolean | null
  nativeBuilderPolicy: 'PASS' | 'FAIL' | 'PENDING'
}

export type ProposalGroundingResult =
  | { ok: true; grounding: ProposalFileGrounding[] }
  | { ok: false; reasons: string[]; grounding: ProposalFileGrounding[] }

export function normalizeRelPath(relPath: string): string {
  return relPath.trim().replace(/\\/g, '/')
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function createTurnEvidence(input: {
  turnId: string
  sessionId: string
  nodeId: string
  repositoryId: string
  now?: Date
}): EngineeringTurnEvidence {
  return {
    turnId: input.turnId,
    sessionId: input.sessionId,
    nodeId: input.nodeId,
    repositoryId: input.repositoryId,
    readFiles: [],
    searches: [],
    gitObservations: [],
    metadataObservations: [],
    listedPaths: [],
    toolCallCount: 0,
    rawObservedBytes: 0,
    startedAt: (input.now ?? new Date()).toISOString(),
    completedAt: null,
    observations: [],
    readFileContents: {},
  }
}

export function compactTurnEvidence(turn: EngineeringTurnEvidence): CompactTurnEvidence {
  return {
    turnId: turn.turnId,
    readFiles: turn.readFiles,
    searches: turn.searches,
    gitObservations: turn.gitObservations,
    metadataObservations: turn.metadataObservations,
    listedPaths: turn.listedPaths,
    toolCallCount: turn.toolCallCount,
    rawObservedBytes: turn.rawObservedBytes,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
  }
}

export function recordSuccessfulRead(turn: EngineeringTurnEvidence, relPath: string, content: string, truncated: boolean): void {
  const normalized = normalizeRelPath(relPath)
  const record: ReadFileRecord = {
    relPath: normalized,
    content,
    bytesRead: Buffer.byteLength(content, 'utf8'),
    truncated,
    contentHash: sha256Text(content),
  }
  turn.readFileContents[normalized] = record
  const existing = turn.readFiles.findIndex(f => f.relPath === normalized)
  const compact: CompactReadFile = { relPath: normalized, bytesRead: record.bytesRead, truncated, contentHash: record.contentHash }
  if (existing >= 0) turn.readFiles[existing] = compact
  else turn.readFiles.push(compact)
  turn.rawObservedBytes += record.bytesRead
}

export function wasFileReadThisTurn(turn: EngineeringTurnEvidence, relPath: string): boolean {
  return Boolean(turn.readFileContents[normalizeRelPath(relPath)])
}

function parentDir(relPath: string): string {
  const normalized = normalizeRelPath(relPath)
  const dir = path.posix.dirname(normalized)
  return dir === '.' ? '' : dir
}

function hasCreateFileContext(turn: EngineeringTurnEvidence, relPath: string): boolean {
  if (turn.metadataObservations.some(m => m.tool === 'inspect_project_metadata' || m.tool === 'list_repo_tree')) return true
  const parent = parentDir(relPath)
  if (turn.readFiles.some(f => parentDir(f.relPath) === parent)) return true
  if (turn.listedPaths.some(p => parentDir(p) === parent || p === parent || p.startsWith(parent ? `${parent}/` : ''))) return true
  return false
}

function matchTextProvenance(content: string, matchText: string): { observed: boolean; unique: boolean; occurrences: number } {
  if (!matchText) return { observed: false, unique: false, occurrences: 0 }
  const occurrences = content.split(matchText).length - 1
  return { observed: occurrences > 0, unique: occurrences === 1, occurrences }
}

/** Current-turn grounding gate. Does not consult session.lastTurnEvidence, engineering memory, or
 * any other turn — callers must pass only THIS turn's evidence object. */
export function groundProposalAgainstTurn(proposal: ModelProposal, turn: EngineeringTurnEvidence): ProposalGroundingResult {
  const reasons: string[] = []
  const grounding: ProposalFileGrounding[] = []

  for (const change of proposal.changes) {
    const file = normalizeRelPath(change.file || change.patch.file)
    const op = change.patch.operation
    const read = turn.readFileContents[file]

    if (op === 'create_file') {
      const inspected = hasCreateFileContext(turn, file)
      grounding.push({ file, readThisTurn: Boolean(read), matchTextObserved: null, nativeBuilderPolicy: 'PENDING' })
      if (!inspected) reasons.push(`${CREATE_FILE_CONTEXT_NOT_INSPECTED}: "${file}"`)
      continue
    }

    if (!read) {
      grounding.push({ file, readThisTurn: false, matchTextObserved: false, nativeBuilderPolicy: 'PENDING' })
      reasons.push(`${TARGET_NOT_READ_THIS_TURN}: "${file}"`)
      continue
    }

    if (op === 'delete_file') {
      grounding.push({ file, readThisTurn: true, matchTextObserved: null, nativeBuilderPolicy: 'PENDING' })
      continue
    }

    const matchText = change.patch.matchText ?? ''
    const provenance = matchTextProvenance(read.content, matchText)
    grounding.push({ file, readThisTurn: true, matchTextObserved: provenance.observed && provenance.unique, nativeBuilderPolicy: 'PENDING' })
    if (!provenance.observed) reasons.push(`${MATCH_TEXT_NOT_OBSERVED}: "${file}"`)
    else if (!provenance.unique) reasons.push(`${MATCH_TEXT_NOT_UNIQUE}: "${file}" (${provenance.occurrences} occurrences)`)
  }

  return reasons.length ? { ok: false, reasons, grounding } : { ok: true, grounding }
}

export function turnPhaseForTool(tool: InspectToolName): TurnPhase {
  switch (tool) {
    case 'read_file':
      return 'READING'
    case 'search_files':
    case 'list_repo_tree':
      return 'SEARCHING'
    case 'git_status':
    case 'git_diff':
    case 'git_log':
    case 'inspect_project_metadata':
    case 'inspect_runtime':
      return 'INSPECTING'
    default:
      return 'INSPECTING'
  }
}
