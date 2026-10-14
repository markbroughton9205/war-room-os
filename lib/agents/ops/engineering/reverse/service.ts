import path from 'node:path'
import type { Actor } from '../../types'
import { AgentOpsLog } from '../../log'
import { engineeringRepo } from '../missions/service'
import { isSensitiveWrite } from '../missions/seed'
import { analyzeSnapshot } from './analyze'
import { SnapshotError, takeSnapshot, type Snapshot } from './snapshot'
import { AnalysisStore, isAnalysisId } from './store'
import { DEPTHS, OUTPUT_OPTIONS, type AnalysisRecord, type AnalysisRequest, type Depth, type OutputOption } from './types'

export class AnalysisError extends Error { constructor(public readonly code: 'INVALID' | 'SCOPE' | 'NOT_FOUND', msg: string) { super(msg) } }

export const SECTION_FOR: Record<Exclude<OutputOption, 'all'>, string[]> = {
  explanation: ['entryPoints', 'ui', 'routes', 'tests'],
  dependencyMap: ['dependencies', 'reverseDependents', 'maps'],
  dataFlowMap: ['flow', 'state', 'routes', 'maps'],
  changeImpact: ['changeImpact', 'reverseDependents', 'tests'],
}
const ALWAYS = ['summary', 'risks']
const ALL_SECTIONS = ['summary', 'entryPoints', 'flow', 'dependencies', 'reverseDependents', 'state', 'routes', 'ui', 'tests', 'changeImpact', 'risks', 'maps']

export function normalizeRequest(body: Record<string, unknown>): AnalysisRequest {
  const target = String(body.target ?? '').trim()
  if (target.length < 2) throw new AnalysisError('INVALID', 'a target is required: a file path, directory, /api route, symbol, or a description of the feature')
  if (target.length > 600) throw new AnalysisError('INVALID', 'the target is too long (600 characters at most)')
  const depth = (body.depth === undefined ? 'standard' : String(body.depth)) as Depth
  if (!DEPTHS.includes(depth)) throw new AnalysisError('INVALID', `depth must be one of ${DEPTHS.join(', ')}`)
  const outsIn = Array.isArray(body.outputs) ? body.outputs.map(String) : body.outputs === undefined ? ['all'] : [String(body.outputs)]
  const outputs = outsIn.filter((o): o is OutputOption => (OUTPUT_OPTIONS as string[]).includes(o))
  if (!outputs.length) throw new AnalysisError('INVALID', `outputs must include one of ${OUTPUT_OPTIONS.join(', ')}`)
  return { target, depth, outputs, ...(typeof body.question === 'string' && body.question.trim() ? { question: body.question.trim().slice(0, 400) } : {}) }
}

export type AnalysisDeps = { log?: AgentOpsLog; repo?: string | null; store?: AnalysisStore; now?: () => Date; snapshot?: (root: string) => Snapshot }

/**
 * Run one analysis. The repository root comes from server configuration (the same one engineering missions seed from), never from the request. The analysis reads a
 * snapshot, computes, then re-reads the tree: the record carries both fingerprints, so "no source was modified" is checked, not asserted.
 */
export function runAnalysis(body: Record<string, unknown>, actor: Actor | string, deps: AnalysisDeps = {}): AnalysisRecord {
  const req = normalizeRequest(body)
  const log = deps.log ?? new AgentOpsLog()
  const repo = deps.repo !== undefined ? deps.repo : engineeringRepo(log)
  if (!repo) throw new AnalysisError('SCOPE', 'no engineering repository is configured on this machine (WAR_ROOM_ENGINEERING_REPO or engineering-config.json)')
  const take = deps.snapshot ?? takeSnapshot
  const started = Date.now()
  let before: Snapshot
  try { before = take(repo) } catch (e) { throw new AnalysisError('SCOPE', e instanceof SnapshotError ? e.message : String(e)) }
  const out = analyzeSnapshot(before, req)
  const after = take(repo)
  const store = deps.store ?? new AnalysisStore(log)
  const now = (deps.now ?? (() => new Date()))()

  const want = new Set<string>(ALWAYS)
  if (req.outputs.includes('all')) ALL_SECTIONS.forEach((s) => want.add(s))
  else for (const o of req.outputs) for (const s of SECTION_FOR[o as Exclude<OutputOption, 'all'>]) want.add(s)
  const result: Record<string, unknown> = {}
  const omitted: string[] = []
  for (const s of ALL_SECTIONS) { if (want.has(s)) result[s] = (out.result as Record<string, unknown>)[s]; else omitted.push(s) }

  const rec: AnalysisRecord = {
    schema: 1, id: store.newId(now), createdAt: now.toISOString(), createdBy: String(actor), request: req, target: out.target,
    result: result as AnalysisRecord['result'], omitted, evidence: out.evidence,
    provenance: { ...out.provenance, model: null, commandsRun: [], snapshot: { root: path.basename(before.root), fileCount: before.files.size, skipped: before.skipped.length, truncated: before.truncated, fingerprint: before.fingerprint, head: before.head } },
    readOnly: { sourceModified: false, treeFingerprintBefore: before.fingerprint, treeFingerprintAfter: after.fingerprint, unchanged: before.fingerprint === after.fingerprint },
    handoff: out.handoff, durationMs: Date.now() - started,
  }
  if (!rec.readOnly.unchanged) rec.result.risks.push({ text: 'The repository changed while the analysis ran (another process wrote to it); the analysis is a view of the first snapshot. Foundry itself wrote nothing.', basis: 'UNKNOWN', evidence: [] })
  return store.create(rec)
}

export function listAnalyses(deps: AnalysisDeps = {}) {
  const store = deps.store ?? new AnalysisStore(deps.log ?? new AgentOpsLog())
  return store.list().map((r) => ({ id: r.id, createdAt: r.createdAt, createdBy: r.createdBy, target: r.request.target, depth: r.request.depth, outputs: r.request.outputs, kind: r.target.kind, owners: r.target.owners.slice(0, 6), evidenceCount: r.evidence.length, unknowns: r.result.risks.filter((c) => c.basis === 'UNKNOWN').length, readOnlyUnchanged: r.readOnly.unchanged, summary: r.result.summary?.[0]?.text ?? '' }))
}

export function getAnalysis(id: string, deps: AnalysisDeps = {}): AnalysisRecord | null {
  if (!isAnalysisId(id)) throw new AnalysisError('INVALID', 'invalid analysis id')
  const store = deps.store ?? new AnalysisStore(deps.log ?? new AgentOpsLog())
  return store.read(id)
}

/** What a build mission is seeded with from an analysis. FACT-resolved targets become the mission's file list; a natural-language (INFERENCE) resolution only seeds context. */
export function buildDraftFromAnalysis(a: AnalysisRecord, draft: { request: string; paths: string[]; write: string[]; targets: { path: string; action: 'create' | 'modify' }[] }, opts: { derivedFromProse?: boolean } = {}) {
  // write scope is never derived from prose, and sensitive surfaces are filtered out rather than failing the whole start
  const factual = a.target.basis === 'FACT' && !opts.derivedFromProse
  const safe = (f: string) => !isSensitiveWrite(f)
  const context = `\n\nREVERSE ENGINEER CONTEXT (analysis ${a.id}, ${a.target.kind} resolved by ${a.target.how}):\n${a.handoff.contextLines.map((l) => `- ${l.slice(0, 220)}`).join('\n')}`
  const request = (draft.request.slice(0, Math.max(200, 2000 - context.length)) + context).slice(0, 2000)
  const paths = draft.paths.length ? draft.paths : a.handoff.seedPaths
  const write = draft.write.length ? draft.write : factual ? a.handoff.targetFiles.filter(safe) : []
  const targets = draft.targets.length ? draft.targets : factual && write.length ? a.handoff.targetFiles.filter((f) => write.includes(f) && safe(f)).map((p) => ({ path: p, action: 'modify' as const })) : []
  return { request, paths, write, targets }
}
