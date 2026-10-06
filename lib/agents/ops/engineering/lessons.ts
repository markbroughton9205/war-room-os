import { createHash } from 'node:crypto'
import type { AgentOpsLog } from '../log'
import type { Lesson, LessonClass } from '../types'
import { deriveLedger } from './debugLedger'
import { latestCheckpoint } from './continuity'

const sha = (t: string) => createHash('sha256').update(t).digest('hex')

export function classifyFailure(text: string): LessonClass {
  if (/Identifier '[^']+' has already been declared|more than once at the top level/.test(text)) return 'DUPLICATE_DECLARATION'
  if (/does not provide an export named|import names that do not exist|is not exported/.test(text)) return 'MISSING_EXPORT'
  if (/removes exports that other files still import/.test(text)) return 'REMOVED_EXPORT'
  if (/require is not defined|__dirname is not defined|__filename is not defined|Cannot use import statement/.test(text)) return 'ESM_COMMONJS_MIX'
  if (/ENOENT|no such file or directory/.test(text)) return 'MISSING_FILE'
  if (/SyntaxError/.test(text)) return 'SYNTAX'
  if (/AssertionError|not ok \d+/.test(text)) return 'ASSERTION'
  return 'OTHER'
}
const GUIDANCE: Record<LessonClass, string> = {
  DUPLICATE_DECLARATION: 'Never declare a name that already exists in the file (imports, functions, consts); extend or edit the existing declaration instead of redeclaring it.',
  MISSING_EXPORT: 'Import only names that the target module really exports (read RELATED CODE); add the export in the module first if it is needed.',
  REMOVED_EXPORT: 'Never delete or rename an export other files import; add new exports beside the old ones.',
  ESM_COMMONJS_MIX: 'This workspace is ES modules: use import/export, never require(); derive paths from import.meta.url instead of __dirname.',
  MISSING_FILE: 'Create parent directories and initialise missing data files before reading them (mkdirSync recursive, write an empty default).',
  SYNTAX: 'Re-read the whole file for balanced braces and valid syntax before replying.',
  ASSERTION: 'Make the code satisfy the exact assertion in the failing test output; do not weaken the test.',
  OTHER: '',
}

export function allLessons(log: AgentOpsLog): Lesson[] {
  return log.view().records.flatMap((r) => (r.t === 'lesson' ? [r.lesson] : []))
}

/** Capture lessons from this assignment's evidence: failures that were really FIXED, and gate rejections the model had to correct. Idempotent. */
export function captureLessons(log: AgentOpsLog, assignmentId: string, ctx: { taskClass: string; executor: string }, now: Date = new Date()): Lesson[] {
  const have = new Set(allLessons(log).map((l) => l.id))
  const made: Lesson[] = []
  const add = (l: Omit<Lesson, 'id'>) => {
    const id = `lesson-${sha(`${l.cls}|${l.evidence.assignmentId}|${l.evidence.failureId ?? l.observation}`).slice(0, 12)}`
    if (have.has(id)) return
    have.add(id); const lesson = { id, ...l }
    log.append({ t: 'lesson', lesson }); made.push(lesson)
  }
  const led = deriveLedger(log, assignmentId)
  for (const [failureId, f] of led.failures) {
    const fixed = led.validations.find((v) => v.failureId === failureId && v.outcome === 'ORIGINAL_FIXED')
    if (!fixed) continue
    const rep = led.repairs.find((r) => r.repairId === fixed.repairId)
    const cls = classifyFailure(f.excerpt)
    add({ cls, taskClass: ctx.taskClass, observation: `${f.signature.slice(0, 160)}`, correction: `${GUIDANCE[cls] || 'see repair'} Worked: ${(rep?.rationale ?? '').slice(0, 220)}`.trim(), evidence: { assignmentId, failureId, kind: 'FIXED_FAILURE' }, at: now.toISOString(), executor: ctx.executor })
  }
  for (const d of latestCheckpoint(log, assignmentId)?.state.doNotRepeat ?? []) {
    if (!d.key.startsWith('reject:')) continue
    const cls = classifyFailure(d.reason)
    if (cls === 'OTHER') continue
    add({ cls, taskClass: ctx.taskClass, observation: d.reason.slice(0, 200), correction: GUIDANCE[cls], evidence: { assignmentId, kind: 'GATE_REJECTION' }, at: now.toISOString(), executor: ctx.executor })
  }
  return made
}

/** Retrieve lessons for a later task (same task class), most-useful classes first; records the retrieval so effect can be measured. */
export function lessonsFor(log: AgentOpsLog, assignmentId: string, taskClass: string, now: Date = new Date()): { texts: string[]; ids: string[] } {
  const byCls = new Map<LessonClass, Lesson>()
  for (const l of allLessons(log).filter((x) => x.taskClass === taskClass && x.evidence.assignmentId !== assignmentId)) byCls.set(l.cls, l) // newest per class
  const picked = [...byCls.values()].slice(0, 5)
  const retrieved = new Set(log.view().records.flatMap((r) => (r.t === 'lessonUse' && r.assignmentId === assignmentId && r.kind === 'RETRIEVED' ? [r.lessonId] : [])))
  for (const l of picked) if (!retrieved.has(l.id)) log.append({ t: 'lessonUse', lessonId: l.id, assignmentId, at: now.toISOString(), kind: 'RETRIEVED', note: `retrieved for ${taskClass}` })
  return { texts: picked.map((l) => `[${l.cls}] ${l.correction}`), ids: picked.map((l) => l.id) }
}

/** After an assignment ran: for each lesson it was given, did the same error class recur? UNKNOWN if the assignment never reached validation. */
export function measureLessonEffect(log: AgentOpsLog, assignmentId: string, now: Date = new Date()): { avoided: number; repeated: number; unknown: number } {
  const recs = log.view().records
  const retrieved = recs.flatMap((r) => (r.t === 'lessonUse' && r.assignmentId === assignmentId && r.kind === 'RETRIEVED' ? [r.lessonId] : []))
  const done = new Set(recs.flatMap((r) => (r.t === 'lessonUse' && r.assignmentId === assignmentId && r.kind !== 'RETRIEVED' ? [r.lessonId] : [])))
  const lessons = new Map(allLessons(log).map((l) => [l.id, l]))
  const led = deriveLedger(log, assignmentId)
  const classes = new Set([...led.failures.values()].map((f) => classifyFailure(f.excerpt)))
  for (const d of latestCheckpoint(log, assignmentId)?.state.doNotRepeat ?? []) if (d.key.startsWith('reject:')) classes.add(classifyFailure(d.reason))
  const reached = led.failures.size > 0 || (latestCheckpoint(log, assignmentId)?.state.validations.length ?? 0) > 0
  const out = { avoided: 0, repeated: 0, unknown: 0 }
  for (const id of retrieved) {
    if (done.has(id)) continue
    const l = lessons.get(id); if (!l) continue
    const kind = !reached ? 'UNKNOWN' : classes.has(l.cls) ? 'REPEATED' : 'AVOIDED'
    out[kind === 'UNKNOWN' ? 'unknown' : kind === 'REPEATED' ? 'repeated' : 'avoided'] += 1
    log.append({ t: 'lessonUse', lessonId: id, assignmentId, at: now.toISOString(), kind, note: kind === 'REPEATED' ? `class ${l.cls} recurred despite the lesson` : kind === 'AVOIDED' ? `class ${l.cls} did not recur in this assignment` : 'assignment never reached validation' })
  }
  return out
}

export function learningReport(log: AgentOpsLog) {
  const recs = log.view().records
  const lessons = allLessons(log)
  const uses = recs.flatMap((r) => (r.t === 'lessonUse' ? [r] : []))
  const byClass: Record<string, { lessons: number; retrieved: number; avoided: number; repeated: number }> = {}
  for (const l of lessons) { const c = (byClass[l.cls] ??= { lessons: 0, retrieved: 0, avoided: 0, repeated: 0 }); c.lessons += 1 }
  for (const u of uses) { const l = lessons.find((x) => x.id === u.lessonId); if (!l) continue; const c = byClass[l.cls]; if (u.kind === 'RETRIEVED') c.retrieved += 1; else if (u.kind === 'AVOIDED') c.avoided += 1; else if (u.kind === 'REPEATED') c.repeated += 1 }
  return { lessons: lessons.length, byClass, note: 'avoided/repeated count only assignments that reached validation; no causal claim beyond "class recurred or not" per assignment' }
}
