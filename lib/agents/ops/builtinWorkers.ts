import { existsSync, lstatSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { defaultLearningLog } from '@/lib/recursive-learning/paths'
import { buildSnapshot } from '@/lib/recursive-learning/readModel'
import type { SafePermission, WorkerCategory } from './types'
import { EffectBlockedError, type RunContext, type RunnerResult, type WorkerRunner } from './workers'

/** A runner may only use capabilities that are inside the worker's recorded permission scope (available != authorized). */
function requirePermission(ctx: RunContext, p: SafePermission): void {
  if (!ctx.worker.permissionScope.includes(p)) throw new Error(`capability not authorized for this worker: ${p}`)
}

/** Evaluation and scoring worker: read-only summary of Phase 9 evidence. Never writes learning data. */
export const evaluationScoringRunner: WorkerRunner = async (ctx): Promise<RunnerResult> => {
  requirePermission(ctx, 'read_learning_log')
  const snap = buildSnapshot(defaultLearningLog({ readOnly: true }), new Date(), { eventLimit: 1 })
  const top = [...snap.scores].sort((a, b) => b.card.rawSamples - a.card.rawSamples).slice(0, 5)
  return {
    toolsUsed: ['phase9.snapshot(read-only)'],
    outputs: [
      { kind: 'learning-summary', ref: 'phase9:snapshot', summary: `${snap.totals.active} active / ${snap.totals.superseded} superseded evidence events; ${snap.scores.length} scorecards; ${snap.failures.length} recurring failure group(s)` },
      ...top.map((s) => ({ kind: 'scorecard', ref: s.drill, summary: `${s.card.subject.id} ${s.card.taskClass}: score ${typeof s.card.score === 'number' ? s.card.score.toFixed(2) : 'UNKNOWN'}, confidence ${s.card.confidence.toFixed(2)}, ${s.card.rawSamples} evidence` })),
    ],
  }
}

/** Documentation freshness worker: reports stale docs by mtime. Honest NOT AVAILABLE when no docs directory exists. */
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res) => { const t = setTimeout(res, ms); signal.addEventListener('abort', () => { clearTimeout(t); res() }, { once: true }) })

/** Documentation freshness worker: reports stale docs by mtime. Read-only; symlinks are skipped; honest NOT AVAILABLE / truncation reporting. */
export const documentationFreshnessRunner: WorkerRunner = async (ctx): Promise<RunnerResult> => {
  requirePermission(ctx, 'read_docs')
  // acceptance-only pause (env, capped, abort-aware) so restart-during-work can be exercised against the installed runtime
  const hold = Math.min(Number(process.env.WAR_ROOM_AGENT_OPS_RUN_HOLD_MS) || 0, 30_000)
  if (hold > 0) await sleep(hold, ctx.signal)
  const dir = process.env.WAR_ROOM_DOCS_DIR?.trim() || path.join(resolveBaseRepoRoot(), 'docs')
  if (!existsSync(dir)) return { toolsUsed: ['fs.exists'], outputs: [{ kind: 'docs-freshness', ref: 'docs', summary: 'NOT AVAILABLE: docs directory not found in this runtime' }] }
  const MAX_ENTRIES = 20_000
  const files: { rel: string; ageDays: number }[] = []
  let entries = 0
  let truncated = false
  let skipped = 0
  const walk = (d: string, depth: number) => {
    if (depth > 3 || ctx.signal.aborted || ctx.shouldStop()) return
    let names: string[] = []
    try { names = readdirSync(d) } catch { skipped += 1; return }
    for (const name of names) {
      if (++entries > MAX_ENTRIES) { truncated = true; return }
      const p = path.join(d, name)
      let st
      try { st = lstatSync(p) } catch { skipped += 1; continue }
      if (st.isSymbolicLink()) { skipped += 1; continue }
      if (st.isDirectory()) walk(p, depth + 1)
      else if (/\.md$/i.test(name)) { if (files.length < 2000) files.push({ rel: path.relative(dir, p), ageDays: (Date.now() - st.mtimeMs) / 86_400_000 }); else truncated = true }
      if (truncated) return
    }
  }
  walk(dir, 0)
  const stale = files.filter((f) => f.ageDays > 90).sort((a, b) => b.ageDays - a.ageDays)
  return {
    toolsUsed: ['fs.readdir', 'fs.lstat'],
    outputs: [
      { kind: 'docs-freshness', ref: 'docs', summary: `${files.length} markdown docs scanned; ${stale.length} older than 90 days${truncated ? ' (TRUNCATED: entry/file cap reached)' : ''}${skipped ? `; ${skipped} entr${skipped === 1 ? 'y' : 'ies'} skipped (symlink/unreadable)` : ''}` },
      ...stale.slice(0, 5).map((f) => ({ kind: 'stale-doc', ref: f.rel, summary: `${f.rel}: ${Math.round(f.ageDays)} days since last modification` })),
    ],
  }
}

export const BUILTIN_RUNNERS: Partial<Record<WorkerCategory, WorkerRunner>> = {
  evaluation_scoring: evaluationScoringRunner,
  documentation_freshness: documentationFreshnessRunner,
}
export { EffectBlockedError }
