import { deepRedact } from './redact'
import { createHash } from 'node:crypto'
import type { AgentOpsLog } from '../log'
import { isCommander, isSystem } from '../lifecycle'
import type { Actor, DebugEntry, DebugEvidence, EvidenceKind } from '../types'
import { deriveAssignments } from './assignments'
import type { CommandRecord } from './runtime/ports'
import type { WorkspaceIndex } from './workspaceIndex'

export const MAX_REPAIR_ATTEMPTS = 3
export class DebugError extends Error {
  constructor(public readonly code: 'NOT_A_REAL_RUN' | 'UNKNOWN' | 'NEEDS_EVIDENCE' | 'REPEATED_EDIT_WITHOUT_NEW_EVIDENCE' | 'BUDGET_EXHAUSTED' | 'INVALID' | 'NOT_AUTHORIZED', msg: string) { super(msg) }
}
const sha = (t: string) => createHash('sha256').update(t).digest('hex')

// ---- parsing real tool output (never narrative)
export type ParsedTests = { /** True when tests ran but none were NAMED tests (only whole-file entries): Node counts an empty test file as 1 passing test. */ vacuous: boolean; tests: number | 'UNKNOWN'; pass: number | 'UNKNOWN'; fail: number | 'UNKNOWN'; failures: { name: string; message: string }[]; syntaxError: { file: string; line: number | null; message: string } | null; typeErrors: string[] }
export function parseToolOutput(stdout: string, stderr = ''): ParsedTests {
  const all = `${stdout}\n${stderr}`
  const num = (re: RegExp) => { const m = re.exec(all); return m ? Number(m[1]) : ('UNKNOWN' as const) }
  const failures: { name: string; message: string }[] = []
  const lines = all.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*✖\s+(.+?)(?:\s+\(\d[\d.]*ms\))?\s*$/.exec(lines[i]) ?? /^\s*not ok \d+ - (.+)$/.exec(lines[i])
    if (m && !failures.some((f) => f.name === m[1].trim())) {
      let msg = ''
      for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) { const x = /(?:error|message): '?(.+?)'?\s*$/i.exec(lines[j]) ?? /^\s*(AssertionError.*|Error.*|TypeError.*|ReferenceError.*|SyntaxError.*)$/.exec(lines[j]); if (x) { msg = x[1]; break } }
      failures.push({ name: m[1].trim(), message: msg.slice(0, 240) })
    }
  }
  const sx = /([^\s:]+\.(?:m?js|ts|tsx|cjs)):(\d+)\n[\s\S]*?\n(SyntaxError: .+)/.exec(all) ?? /(SyntaxError: .+)/.exec(all)
  const syntaxError = sx ? (sx.length === 4 ? { file: sx[1], line: Number(sx[2]), message: sx[3].slice(0, 200) } : { file: 'UNKNOWN', line: null, message: sx[1].slice(0, 200) }) : null
  const typeErrors = [...all.matchAll(/^(.+?\(\d+,\d+\): error TS\d+: .+)$/gm)].map((m) => m[1]).slice(0, 20)
  const named = [...all.matchAll(/^\s*[✔✖]\s+(.+?)\s+\(\d[\d.]*ms\)\s*$/gm)].map((m) => m[1].trim())
  const total = num(/(?:ℹ|#) tests (\d+)/)
  const vacuous = typeof total === 'number' && total > 0 && failures.length === 0 && named.length > 0 && named.every((n) => /\.(m?js|ts|tsx|cjs)$/.test(n))
  return { vacuous, tests: total, pass: num(/(?:ℹ|#) pass (\d+)/), fail: num(/(?:ℹ|#) fail (\d+)/), failures, syntaxError, typeErrors }
}

/** Stable fingerprint of a failure: what failed and how, not when or where on disk. */
export function failureSignature(parsed: ParsedTests, fallbackOutput = ''): string {
  const norm = (t: string) => t.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<ts>').replace(/\/[\w./-]+\//g, '<path>/').replace(/\b\d+(\.\d+)?ms\b/g, '<ms>').replace(/\b\d{6,}\b/g, '<n>').replace(/[0-9a-f]{12,}/g, '<hash>').replace(/\s+/g, ' ').trim()
  if (parsed.syntaxError) return `syntax|${norm(parsed.syntaxError.message)}`
  if (parsed.typeErrors.length) return `types|${norm(parsed.typeErrors[0])}`
  if (parsed.failures.length) return parsed.failures.slice(0, 3).map((f) => `${norm(f.name)}::${norm(f.message)}`).sort().join(' ; ')
  return `output|${norm(fallbackOutput.split('\n').filter(Boolean).slice(-2).join(' ')).slice(0, 160)}`
}

// ---- ledger storage
type DebugRec = Extract<ReturnType<AgentOpsLog['view']>['records'][number], { t: 'debug' }>
const entries = (log: AgentOpsLog, assignmentId: string): DebugRec[] => log.view().records.filter((r): r is DebugRec => r.t === 'debug' && r.assignmentId === assignmentId).sort((a, b) => a.seq - b.seq)
export const debugEntries = (log: AgentOpsLog, assignmentId: string) => entries(log, assignmentId).map((r) => r.entry)
function append(log: AgentOpsLog, assignmentId: string, entry: DebugEntry, by: Actor, now: Date) {
  if (!isCommander(by) && !isSystem(by)) throw new DebugError('NOT_AUTHORIZED', 'the debug ledger is written by a Commander or a system runner')
  if (!deriveAssignments(log).assignments.has(assignmentId)) throw new DebugError('UNKNOWN', `unknown assignment: ${assignmentId}`)
  return log.withLock(() => { const seq = entries(log, assignmentId).length + 1; log.append({ t: 'debug', assignmentId, seq, at: now.toISOString(), entry: deepRedact(entry) }); return seq })
}

export type LedgerView = {
  failures: Map<string, Extract<DebugEntry, { kind: 'FAILURE' }>>
  evidence: Map<string, DebugEvidence & { failureId: string }>
  hypotheses: Map<string, { failureId: string; statement: string; status: 'OPEN' | 'SUPPORTED' | 'REFUTED' | 'UNDETERMINED'; reason: string; supporting: string[]; refuting: string[]; revisionOf?: string; whyRevised?: string }>
  repairs: Extract<DebugEntry, { kind: 'REPAIR' }>[]
  validations: Extract<DebugEntry, { kind: 'VALIDATION' }>[]
  undetermined: Map<string, Extract<DebugEntry, { kind: 'UNDETERMINED' }>>
}
export function deriveLedger(log: AgentOpsLog, assignmentId: string): LedgerView {
  const v: LedgerView = { failures: new Map(), evidence: new Map(), hypotheses: new Map(), repairs: [], validations: [], undetermined: new Map() }
  for (const e of debugEntries(log, assignmentId)) {
    if (e.kind === 'FAILURE') v.failures.set(e.failureId, e)
    else if (e.kind === 'EVIDENCE') v.evidence.set(e.evidence.id, { ...e.evidence, failureId: e.failureId })
    else if (e.kind === 'HYPOTHESIS') v.hypotheses.set(e.hypothesisId, { failureId: e.failureId, statement: e.statement, status: 'OPEN', reason: 'proposed', supporting: e.supporting, refuting: e.refuting, revisionOf: e.revisionOf, whyRevised: e.whyRevised })
    else if (e.kind === 'HYPOTHESIS_STATUS') { const h = v.hypotheses.get(e.hypothesisId); if (h) { h.status = e.status; h.reason = e.reason } }
    else if (e.kind === 'REPAIR') v.repairs.push(e)
    else if (e.kind === 'VALIDATION') v.validations.push(e)
    else if (e.kind === 'UNDETERMINED') v.undetermined.set(e.failureId, e)
  }
  return v
}

/** Record a failure from a command that REALLY ran. Narrative failures are refused. */
export function recordFailure(log: AgentOpsLog, assignmentId: string, cmd: CommandRecord, by: Actor, now: Date = new Date()): { failureId: string; signature: string; parsed: ParsedTests; duplicate: boolean } {
  if (!cmd || cmd.refused || !cmd.argv?.length || !cmd.startedAt || !cmd.outputHash) throw new DebugError('NOT_A_REAL_RUN', 'a failure must come from a command that actually ran (argv, start time, output hash)')
  if (cmd.exitCode === 0 && !cmd.timedOut) throw new DebugError('INVALID', 'the command succeeded: nothing to record as a failure')
  const parsed = parseToolOutput(cmd.stdout, cmd.stderr)
  const signature = failureSignature(parsed, `${cmd.stdout}\n${cmd.stderr}`)
  const led = deriveLedger(log, assignmentId)
  const dup = [...led.failures.values()].find((f) => f.signature === signature && f.outputHash === cmd.outputHash)
  if (dup) return { failureId: dup.failureId, signature, parsed, duplicate: true }
  const failureId = `fail-${sha(`${assignmentId}|${signature}|${cmd.startedAt}`).slice(0, 10)}`
  const targeted = cmd.argv.filter((a) => /\.(m?js|ts|tsx|cjs)$/.test(a) || a.endsWith('/'))
  append(log, assignmentId, { kind: 'FAILURE', failureId, argv: cmd.argv, ran: true, exitCode: cmd.exitCode, startedAt: cmd.startedAt, outputHash: cmd.outputHash, excerpt: `${cmd.stdout}\n${cmd.stderr}`.slice(-1500), signature, testsTargeted: targeted, testsRun: parsed.tests, failingTests: parsed.failures.map((f) => f.name) }, by, now)
  return { failureId, signature, parsed, duplicate: false }
}

export function addEvidence(log: AgentOpsLog, assignmentId: string, failureId: string, e: { kind: EvidenceKind; ref: string; content?: string; summary: string; available?: boolean; unavailableReason?: string }, by: Actor, now: Date = new Date()): DebugEvidence {
  if (!deriveLedger(log, assignmentId).failures.has(failureId)) throw new DebugError('UNKNOWN', `unknown failure: ${failureId}`)
  const available = e.available !== false
  if (!available && !e.unavailableReason) throw new DebugError('INVALID', 'unavailable evidence must say why (e.g. no browser console in this environment)')
  const evidence: DebugEvidence = { id: `ev-${sha(`${failureId}|${e.kind}|${e.ref}|${e.content ?? e.summary}`).slice(0, 10)}`, kind: e.kind, ref: e.ref.slice(0, 200), excerptHash: sha(e.content ?? ''), summary: e.summary.slice(0, 300), available, ...(available ? {} : { unavailableReason: e.unavailableReason }) }
  if (!deriveLedger(log, assignmentId).evidence.has(evidence.id)) append(log, assignmentId, { kind: 'EVIDENCE', failureId, evidence }, by, now)
  return evidence
}

export function proposeHypothesis(log: AgentOpsLog, assignmentId: string, failureId: string, h: { statement: string; supporting: string[]; refuting?: string[]; revisionOf?: string; whyRevised?: string }, by: Actor, now: Date = new Date()): string {
  const led = deriveLedger(log, assignmentId)
  if (!led.failures.has(failureId)) throw new DebugError('UNKNOWN', `unknown failure: ${failureId}`)
  const ids = [...h.supporting, ...(h.refuting ?? [])]
  if (ids.some((id) => !led.evidence.get(id)?.available)) throw new DebugError('NEEDS_EVIDENCE', 'a hypothesis may cite only recorded, available evidence')
  if (!h.supporting.length) throw new DebugError('NEEDS_EVIDENCE', 'a hypothesis needs at least one piece of supporting evidence')
  if (h.revisionOf && (!led.hypotheses.has(h.revisionOf) || !h.whyRevised?.trim())) throw new DebugError('INVALID', 'a revised hypothesis must reference the earlier one and say what evidence changed it')
  const hypothesisId = `hyp-${sha(`${failureId}|${h.statement}`).slice(0, 10)}`
  if (!led.hypotheses.has(hypothesisId)) {
    append(log, assignmentId, { kind: 'HYPOTHESIS', failureId, hypothesisId, statement: h.statement.slice(0, 400), supporting: h.supporting, refuting: h.refuting ?? [], ...(h.revisionOf ? { revisionOf: h.revisionOf, whyRevised: h.whyRevised!.slice(0, 300) } : {}) }, by, now)
    if (h.revisionOf && led.hypotheses.get(h.revisionOf)?.status === 'OPEN') append(log, assignmentId, { kind: 'HYPOTHESIS_STATUS', hypothesisId: h.revisionOf, status: 'REFUTED', reason: `revised: ${h.whyRevised!.slice(0, 200)}` }, by, now)
  }
  return hypothesisId
}

/**
 * Gate BEFORE applying a repair. A repeat attempt on the same failure signature needs NEW evidence not used by earlier
 * attempts and an explanation of why it differs; the budget is bounded; exhausted budget means UNDETERMINED, never a invented cause.
 */
export function authorizeRepair(log: AgentOpsLog, assignmentId: string, failureId: string, plan: { hypothesisId: string; newEvidence: string[]; differsFromPrevious: string | null; files: string[] }): { ok: true; attempt: number } | { ok: false; code: 'REPEATED_EDIT_WITHOUT_NEW_EVIDENCE' | 'BUDGET_EXHAUSTED' | 'NEEDS_EVIDENCE'; reason: string } {
  const led = deriveLedger(log, assignmentId)
  const f = led.failures.get(failureId)
  if (!f) throw new DebugError('UNKNOWN', `unknown failure: ${failureId}`)
  const hyp = led.hypotheses.get(plan.hypothesisId)
  if (!hyp || hyp.failureId !== failureId) return { ok: false, code: 'NEEDS_EVIDENCE', reason: 'repair must be based on a recorded hypothesis for this failure' }
  if (hyp.status === 'REFUTED') return { ok: false, code: 'NEEDS_EVIDENCE', reason: 'that hypothesis was refuted; revise it with new evidence first' }
  const prior = led.repairs.filter((r) => r.failureId === failureId)
  if (prior.length >= MAX_REPAIR_ATTEMPTS) return { ok: false, code: 'BUDGET_EXHAUSTED', reason: `${prior.length} repair attempts already failed; the cause is UNDETERMINED, stop and escalate` }
  if (prior.length > 0) {
    const used = new Set(prior.flatMap((r) => [...r.newEvidence, ...(led.hypotheses.get(r.hypothesisId)?.supporting ?? [])]))
    const fresh = plan.newEvidence.filter((id) => !used.has(id) && led.evidence.get(id)?.available)
    if (!fresh.length) return { ok: false, code: 'REPEATED_EDIT_WITHOUT_NEW_EVIDENCE', reason: 'the same failure persists and no new evidence has been gathered since the last attempt' }
    if (!plan.differsFromPrevious?.trim()) return { ok: false, code: 'REPEATED_EDIT_WITHOUT_NEW_EVIDENCE', reason: 'explain why this repair differs from the previous one' }
  }
  return { ok: true, attempt: prior.length + 1 }
}

export function recordRepair(log: AgentOpsLog, assignmentId: string, failureId: string, r: { hypothesisId: string; filesEdited: { path: string; afterHash: string }[]; rationale: string; differsFromPrevious: string | null; newEvidence: string[] }, by: Actor, now: Date = new Date()): { repairId: string; attempt: number } {
  const gate = authorizeRepair(log, assignmentId, failureId, { hypothesisId: r.hypothesisId, newEvidence: r.newEvidence, differsFromPrevious: r.differsFromPrevious, files: r.filesEdited.map((f) => f.path) })
  if (!gate.ok) throw new DebugError(gate.code, gate.reason)
  const repairId = `rep-${sha(`${failureId}|${gate.attempt}|${r.filesEdited.map((f) => f.afterHash).join(',')}`).slice(0, 10)}`
  append(log, assignmentId, { kind: 'REPAIR', failureId, repairId, hypothesisId: r.hypothesisId, filesEdited: r.filesEdited, rationale: r.rationale.slice(0, 400), differsFromPrevious: r.differsFromPrevious?.slice(0, 300) ?? null, newEvidence: r.newEvidence, attempt: gate.attempt }, by, now)
  return { repairId, attempt: gate.attempt }
}

/** Wrong-test detection: a run that executed no tests, or whose targets cannot exercise anything that was changed. */
export function detectWrongTest(cmd: CommandRecord, changedFiles: string[], index: WorkspaceIndex | null): { suspected: boolean; reason: string | null } {
  const parsed = parseToolOutput(cmd.stdout, cmd.stderr)
  if (parsed.tests === 0 || parsed.vacuous) return { suspected: true, reason: parsed.tests === 0 ? 'the command executed 0 tests: it proves nothing' : 'the command executed no named tests (only whole files): it proves nothing' }
  if (!index || !changedFiles.length) return { suspected: false, reason: null }
  // only workspace-relative test files can be judged; an absolute path is a harness-supplied end-to-end verification
  const targets = cmd.argv.filter((a) => !a.startsWith('/') && /\.(m?js|ts|tsx|cjs)$/.test(a))
  if (!targets.length) return { suspected: false, reason: null } // a directory/script run: cannot judge by target
  const covered = changedFiles.some((f) => targets.some((t) => (index.testsFor[f] ?? []).includes(t) || t === f))
  return covered ? { suspected: false, reason: null } : { suspected: true, reason: `none of the targeted tests (${targets.join(', ')}) import any changed file (${changedFiles.join(', ')})` }
}

/** Validate a repair against the ORIGINAL failure by re-running the original reproducer and comparing signatures. */
export function recordValidation(log: AgentOpsLog, assignmentId: string, failureId: string, repairId: string, rerun: CommandRecord, ctx: { changedFiles: string[]; index: WorkspaceIndex | null }, by: Actor, now: Date = new Date()): Extract<DebugEntry, { kind: 'VALIDATION' }> {
  const led = deriveLedger(log, assignmentId)
  const f = led.failures.get(failureId)
  const rep = led.repairs.find((r) => r.repairId === repairId)
  if (!f || !rep) throw new DebugError('UNKNOWN', 'unknown failure or repair')
  if (rerun.refused || !rerun.outputHash) throw new DebugError('NOT_A_REAL_RUN', 'validation must be a real command run')
  if (JSON.stringify(rerun.argv) !== JSON.stringify(f.argv)) throw new DebugError('INVALID', 'validation must re-run the original reproducer command')
  const parsed = parseToolOutput(rerun.stdout, rerun.stderr)
  const wrong = detectWrongTest(rerun, ctx.changedFiles, ctx.index)
  const signature = rerun.exitCode === 0 ? null : failureSignature(parsed, `${rerun.stdout}\n${rerun.stderr}`)
  let outcome: Extract<DebugEntry, { kind: 'VALIDATION' }>['outcome']
  let note = ''
  if (rerun.exitCode === 0 && (parsed.tests === 0 || parsed.vacuous)) { outcome = 'VACUOUS'; note = 'exit 0 but no named tests ran' }
  else if (rerun.exitCode === 0 && wrong.suspected) { outcome = 'WRONG_TEST_SUSPECTED'; note = wrong.reason! }
  else if (rerun.exitCode === 0) { outcome = 'ORIGINAL_FIXED'; note = `original reproducer now exits 0${parsed.tests !== 'UNKNOWN' ? ` with ${parsed.tests} test(s)` : ''}` }
  else if (signature === f.signature) { outcome = 'SAME_FAILURE'; note = 'the original failure persists unchanged' }
  else { outcome = 'NEW_FAILURE'; note = `the original failure changed: ${signature!.slice(0, 160)}` }
  const entry: Extract<DebugEntry, { kind: 'VALIDATION' }> = { kind: 'VALIDATION', failureId, repairId, argv: rerun.argv, exitCode: rerun.exitCode, testsRun: parsed.tests, outcome, signature, note }
  append(log, assignmentId, entry, by, now)
  // hypothesis status follows the evidence
  const hs = (status: 'SUPPORTED' | 'REFUTED', reason: string) => append(log, assignmentId, { kind: 'HYPOTHESIS_STATUS', hypothesisId: rep.hypothesisId, status, reason }, by, now)
  if (outcome === 'ORIGINAL_FIXED') hs('SUPPORTED', `repair ${repairId} fixed the original failure`)
  else if (outcome === 'SAME_FAILURE') hs('REFUTED', `repair ${repairId} based on this hypothesis left the failure unchanged`)
  if ((outcome === 'SAME_FAILURE' || outcome === 'NEW_FAILURE') && deriveLedger(log, assignmentId).repairs.filter((r) => r.failureId === failureId).length >= MAX_REPAIR_ATTEMPTS) markUndetermined(log, assignmentId, failureId, `${MAX_REPAIR_ATTEMPTS} evidence-based repair attempts did not fix the failure`, by, now)
  return entry
}

export function markUndetermined(log: AgentOpsLog, assignmentId: string, failureId: string, reason: string, by: Actor, now: Date = new Date()) {
  const led = deriveLedger(log, assignmentId)
  if (led.undetermined.has(failureId)) return
  append(log, assignmentId, { kind: 'UNDETERMINED', failureId, reason: reason.slice(0, 300), attempts: led.repairs.filter((r) => r.failureId === failureId).length }, by, now)
}

/** Everything a Commander or successor needs: exactly what failed and ran, what was tried and why, current state. */
export function debugSummary(log: AgentOpsLog, assignmentId: string) {
  const led = deriveLedger(log, assignmentId)
  return [...led.failures.values()].map((f) => {
    const reps = led.repairs.filter((r) => r.failureId === f.failureId)
    const last = led.validations.filter((v) => v.failureId === f.failureId).at(-1)
    const state = led.undetermined.has(f.failureId) ? 'UNDETERMINED' : last?.outcome === 'ORIGINAL_FIXED' ? 'FIXED' : 'OPEN'
    return { failureId: f.failureId, command: f.argv.join(' '), exitCode: f.exitCode, signature: f.signature, state, attempts: reps.length, hypotheses: [...led.hypotheses.entries()].filter(([, h]) => h.failureId === f.failureId).map(([id, h]) => ({ id, statement: h.statement, status: h.status })), whyEachRepairDiffers: reps.map((r) => ({ attempt: r.attempt, differs: r.differsFromPrevious ?? 'first attempt' })), unavailableEvidence: [...led.evidence.values()].filter((e) => e.failureId === f.failureId && !e.available).map((e) => `${e.kind}: ${e.unavailableReason}`) }
  })
}
