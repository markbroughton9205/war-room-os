import { createHash } from 'node:crypto'
import type { Diagnosis, FailureClass, Rung, Subtask } from './types'
export type { Diagnosis, FailureClass, Rung }

/**
 * Failure diagnosis and the repair ladder. A failed mission is read for WHY it failed; the diagnosis (never the bare word FAILED) is what the next attempt is given.
 * Two failures with the same fingerprint never get the same strategy twice: the ladder moves on, and when it is exhausted the command is reported BLOCKED with every diagnosis.
 */

export type MissionFacts = {
  state: string
  stateReason: string
  result: { status: string; reason: string } | null
  receipt: { verifier: { exitCode: number | string; summary: string }; integration: { state: string; gates: { name: string; exitCode: number | string; summary: string; detail?: string }[]; refused: string[] }; install: { state: string; detail?: string } } | null
  events: { kind: string; detail: string }[]
  /** failing lines from re-running the independent verifier on the failed workspace (the engine reports only 'UNDETERMINED') */
  verifierLines?: string[]
}

const norm = (s: string) => s.toLowerCase().replace(/[0-9a-f]{8,}/g, '#').replace(/\d+/g, 'N').replace(/\/[\w./@-]+/g, (p) => p.split('/').pop() ?? p).replace(/\s+/g, ' ').trim()
const fp = (cls: string, text: string) => createHash('sha256').update(`${cls}|${norm(text).slice(0, 400)}`).digest('hex').slice(0, 12)

export function diagnose(m: MissionFacts): Diagnosis {
  const reason = `${m.stateReason} ${m.result?.reason ?? ''}`
  const make = (cls: FailureClass, summary: string, detail: string, retriable = true): Diagnosis => ({ cls, summary, detail: detail.slice(0, 1800), fingerprint: fp(cls, summary + ' ' + detail.slice(0, 300)), retriable })
  // the model runtime or the machine, not the code
  if (/ECONNREFUSED|not reachable|fetch failed|timeout or cancelled|HTTP 5\d\d|model error|no builder|is not installed in the local model|out of memory|CUDA|launch timed out/i.test(reason + ' ' + m.events.slice(-6).map((e) => e.detail).join(' '))) {
    if (!/independent verifier|integration gates|install failed/i.test(m.stateReason)) return make('INFRA', 'the local model runtime or the machine was unavailable', reason, true)
  }
  if (m.verifierLines?.length) return make('VERIFIER', 'the independent verifier rejected the final workspace', m.verifierLines.join('\n'))
  const r = m.receipt
  if (r?.install.state === 'FAILED') return make('INSTALL', `the installation build failed: ${r.install.detail ?? 'no detail'}`.slice(0, 300), r.install.detail ?? reason, /Export encountered|prerender|Type error|ReferenceError|is not defined|Module not found|Failed to compile/i.test(r.install.detail ?? '') && r.integration.state === 'APPLIED')
  if (r?.integration.state === 'REFUSED') return make('INTEGRATION', `integration was refused: ${r.integration.refused.join('; ')}`.slice(0, 300), r.integration.refused.join('\n'))
  if (r?.integration.state === 'GATES_FAILED') {
    const g = r.integration.gates.filter((x) => x.exitCode !== 0)
    const first = g[0]
    const errLines = (first?.detail ?? first?.summary ?? '').split('\n').filter((l) => /error TS\d+|Error:|not ok/.test(l)).slice(0, 8)
    return make('GATE', `repository gate "${first?.name ?? 'unknown'}" failed`, errLines.join('\n') || (first?.summary ?? reason))
  }
  if (r && typeof r.verifier.exitCode === 'number' && r.verifier.exitCode !== 0) {
    const lines = r.verifier.summary.split(' | ').filter((l) => /^not ok/.test(l)).slice(0, 8)
    return make('VERIFIER', 'the independent verifier rejected the final workspace', lines.join('\n') || r.verifier.summary)
  }
  if (/test|assert|expected/i.test(reason) && m.result?.status === 'FAILED') return make('TESTS', 'tests failed and the engine could not repair them within its budget', reason)
  if (m.result?.status === 'CONFLICT') return make('ENGINE', 'the workspace changed underneath the run', reason)
  if (m.result) return make('ENGINE', `the engine stopped: ${m.result.status}`, reason)
  return make('UNKNOWN', 'the mission failed without a recorded cause', reason)
}

/** The ladder, in order. A rung is skipped when it cannot apply to the step; the same fingerprint never gets the same rung twice. */
export const LADDER: Rung[] = ['initial', 'diagnosed', 'reverse-context', 'split']

export function nextRung(used: Rung[], step: Pick<Subtask, 'targets'>): Rung | null {
  for (const r of LADDER) {
    if (used.includes(r)) continue
    if (r === 'split' && step.targets.length < 3) continue // nothing to split
    return r
  }
  return null
}

/** What a rung changes in the draft. `diagnosis` is quoted to the builder as data about the previous attempt. */
export function applyRung(rung: Rung, s: Subtask, history: Diagnosis[]): Subtask {
  const last = history[history.length - 1]
  if (!last || rung === 'initial') return s
  const diag = `\n\nA PREVIOUS ATTEMPT AT THIS FAILED (${last.cls}): ${last.summary}\n${last.detail ? last.detail.split('\n').slice(0, 8).join('\n') : ''}\nDo not repeat that approach. Fix the cause stated above.`
  if (rung === 'diagnosed') return { ...s, request: s.request + diag, hints: [...s.hints, 'repair-attempt'] }
  if (rung === 'reverse-context') return { ...s, request: s.request + diag, reverseFirst: true, hints: [...s.hints, 'repair-attempt'] }
  return s
}

/** Split a multi-file step into a first part (logic and tests, no UI or mount) and the rest, so each part is small enough to get right. */
export function splitSubtask(s: Subtask): [Subtask, Subtask] | null {
  if (s.targets.length < 3) return null
  const isLogic = (p: string) => /^(lib|test)\//.test(p) && /\.(mjs|ts)$/.test(p)
  let first = s.targets.filter((t) => isLogic(t.path))
  if (first.length === 0 || first.length === s.targets.length) first = s.targets.slice(0, Math.ceil(s.targets.length / 2))
  const rest = s.targets.filter((t) => !first.includes(t))
  if (!first.length || !rest.length) return null
  const part = (targets: Subtask['targets'], title: string, n: number): Subtask => ({
    ...s, n, title, targets, ...(n === 1 ? { verifyKey: undefined } : {}), request: `${s.request}\n\nTHIS IS PART ${n} OF 2 of the work. Build only: ${targets.map((t) => `${t.action} ${t.path}`).join(', ')}.${n === 2 ? ' Part 1 is already in the repository: use it as it is.' : ''}`,
    scope: { paths: s.scope.paths, write: targets.map((t) => t.path) },
    acceptance: s.acceptance.filter((a) => targets.some((t) => a.includes(t.path))).length ? s.acceptance.filter((a) => targets.some((t) => a.includes(t.path))) : s.acceptance,
  })
  return [part(first, `${s.title} (part 1: logic and tests)`, 1), part(rest, `${s.title} (part 2: interface and wiring)`, 2)]
}
