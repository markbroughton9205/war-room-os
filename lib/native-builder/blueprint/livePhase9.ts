/**
 * Phase 9 sink for blueprint outcomes. Maps the validated blueprint outcome event (phase9.mjs v2) to attributable evaluation events in the live recursive-learning
 * log: one overall RUN event plus one VALIDATION event per stage that actually ran (source validation, dependency verification, build, package, artifact verification)
 * and a ROLLBACK event when work was rolled back. Ids are stable (idempotent redelivery). Cost and tokens are never fabricated: they stay absent (UNKNOWN).
 * Failure-safe: it throws on rejection so the broker outbox redelivers (at-least-once, deduped by id); it never touches mission/assignment state.
 */
import { defaultLearningLog } from '@/lib/recursive-learning/paths'
import { stableEventId } from '@/lib/recursive-learning/ingestion/ids'
import type { EvalOutcome, EvaluationEventInput, ValidationStatus } from '@/lib/recursive-learning/types'

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const str = (v: unknown, max = 80): string => String(v ?? '').replace(/[^\w.:@/ =,+-]/g, '_').slice(0, max)
const SUBJECT = { kind: 'workflow', id: 'blueprint-adapter' } as const

function overallOutcome(ev: Rec): { outcome: EvalOutcome; validation: ValidationStatus; errorClass?: string } {
  const claims = rec(ev.claims), stages = rec(ev.stages), name = String(ev.outcome ?? '')
  const failed = ['build', 'package', 'verifyArtifact'].some(s => ['FAIL', 'REFUSED', 'ERROR'].includes(String(rec(stages[s]).status)))
  if (name === 'VERIFIED_SOURCE') {
    if (failed) return { outcome: 'FAILURE', validation: 'FAILED', errorClass: str(['build', 'package', 'verifyArtifact'].map(s => rec(stages[s]).failureCode).find(Boolean) ?? 'STAGE_FAILED') }
    if (claims.packaged === true) return { outcome: 'SUCCESS', validation: 'PASSED' }
    return { outcome: 'PARTIAL', validation: 'PASSED' }
  }
  if (name === 'FAILED_ROLLED_BACK' || name === 'RECOVERED_ROLLED_BACK' || name === 'CANCELLED_ROLLED_BACK') return { outcome: 'ROLLED_BACK', validation: name === 'FAILED_ROLLED_BACK' ? 'FAILED' : 'UNKNOWN', errorClass: str(rec(ev.failure).code ?? name) }
  if (name === 'BLOCKED' || name === 'CANCELLED_NO_CHANGES') return { outcome: 'REJECTED', validation: 'UNKNOWN', errorClass: str(rec(ev.failure).code ?? name) }
  if (name === 'CANCELLED_RETAINED') return { outcome: 'PARTIAL', validation: 'UNKNOWN', errorClass: 'CANCELLED' }
  return { outcome: 'FAILURE', validation: 'FAILED', errorClass: str(rec(ev.failure).code ?? name) } // ROLLBACK_INCOMPLETE, NEEDS_OPERATOR_REVIEW*, anything unknown: never reported as success
}

const stageOutcome = (status: string): { outcome: EvalOutcome; validation: ValidationStatus } =>
  status === 'PASS' ? { outcome: 'SUCCESS', validation: 'PASSED' }
    : ['CANCELLED', 'INTERRUPTED'].includes(status) ? { outcome: 'PARTIAL', validation: 'UNKNOWN' }
      : { outcome: 'FAILURE', validation: 'FAILED' }

/** Pure mapping (unit-tested). `ev` must already have passed validateOutcomeEvent. */
export function blueprintEventToEvaluationInputs(evRaw: unknown): EvaluationEventInput[] {
  const ev = rec(evRaw), id = str(ev.eventId, 40), mission = rec(ev.mission), actor = rec(ev.actor), approved = rec(ev.approvedBy), lineage = rec(ev.lineage), stages = rec(ev.stages)
  const occurredAt = typeof ev.emittedAt === 'string' ? ev.emittedAt : new Date().toISOString()
  const base = `mission=${str(mission.missionId)} assignment=${str(mission.assignmentId)} workspace=${str(ev.workspaceId)} actor=${str(actor.actorId)}${approved.actorId ? ` approvedBy=${str(approved.actorId)}` : ''} scope=${str(ev.scopeLabel)}`
  const source = { kind: 'blueprint', ref: str(ev.execId, 60) }
  const provenance = { adapter: 'blueprint-adapter', backfilled: false }
  const retries = rec(lineage.retry), resumes = rec(ev.retries)
  const out: EvaluationEventInput[] = []
  const o = overallOutcome(ev)
  out.push({ id: stableEventId('blueprint', id, 'run'), subject: { ...SUBJECT }, taskClass: 'code_modification', outcome: o.outcome, signal: 'RUN', validation: o.validation, occurredAt,
    metrics: { ...(typeof ev.latencyMs === 'number' ? { latencyMs: ev.latencyMs } : {}), retries: Number(resumes.resumes ?? 0) + Number(resumes.recoveries ?? 0) + Math.max(0, Number(retries.build ?? 1) - 1) + Math.max(0, Number(retries.package ?? 1) - 1) },
    ...(o.errorClass ? { errorClass: o.errorClass } : {}), note: `outcome=${str(ev.outcome)} headline=${str(ev.headline)} ${base} sourceValidated=${rec(ev.claims).sourceValidated === true} built=${rec(ev.claims).built === true} packaged=${rec(ev.claims).packaged === true} installed=false taskComplete=false`.slice(0, 500), source, provenance })
  const dep = rec(lineage.dependencyResult)
  const stageRows: [string, string | undefined, Rec][] = [['source-validation', String(rec(stages.validateSource).status ?? 'NOT_RUN'), rec(stages.validateSource)], ['dependency-verification', dep.state ? (dep.state === 'VERIFIED_USABLE' ? 'PASS' : 'FAIL') : undefined, {}],
    ['build', String(rec(stages.build).status ?? 'NOT_RUN'), rec(stages.build)], ['package', String(rec(stages.package).status ?? 'NOT_RUN'), rec(stages.package)], ['artifact-verification', String(rec(stages.verifyArtifact).status ?? 'NOT_RUN'), rec(stages.verifyArtifact)]]
  for (const [name, status, row] of stageRows) {
    if (!status || status === 'NOT_RUN') continue
    const so = stageOutcome(status), attempt = Number(row.attempt ?? 1)
    out.push({ id: stableEventId('blueprint', id, name), subject: { ...SUBJECT }, taskClass: 'code_modification', outcome: so.outcome, signal: 'VALIDATION', validation: so.validation, occurredAt,
      metrics: { ...(typeof row.latencyMs === 'number' ? { latencyMs: row.latencyMs } : {}), retries: Math.max(0, attempt - 1) },
      ...(row.failureCode ? { errorClass: str(row.failureCode) } : {}), note: `stage=${name} status=${str(status)} attempt=${attempt}${row.toolIdentity ? ` tool=${str(row.toolIdentity, 60)}` : ''} ${base}`.slice(0, 500), source, provenance })
  }
  if (rec(ev.rollback).attempted !== undefined && Number(rec(ev.rollback).attempted) > 0) out.push({ id: stableEventId('blueprint', id, 'rollback'), subject: { ...SUBJECT }, taskClass: 'code_modification', outcome: 'ROLLED_BACK', signal: 'ROLLBACK', validation: 'UNKNOWN', occurredAt,
    note: `rollback attempted=${Number(rec(ev.rollback).attempted)} errors=${Number(rec(ev.rollback).errors ?? 0)} preserved=${Number(rec(ev.rollback).preserved ?? 0)} ${base}`.slice(0, 500), source, provenance })
  return out
}

export function createLivePhase9Sink() {
  return Object.freeze({
    emit(ev: unknown) {
      const inputs = blueprintEventToEvaluationInputs(ev)
      const res = defaultLearningLog().recordEvents(inputs)
      if (res.rejected.length > 0) throw new Error(`phase9 rejected ${res.rejected.length} event(s)`) // outbox keeps the event pending; nothing is silently dropped
    },
  })
}
