import type { EvalSubject, EvaluationEventInput, TaskClass, ValidationStatus } from '../types'
import { stableEventId } from './ids'
import { commanderDecisionEvent, installedAcceptanceEvent, reviewFindingEvent } from './signalAdapters'
import { valueContainsSecret } from './redact'

export const ADAPTER = 'foundry-mission'
const TERMINAL: Record<string, 'SUCCESS' | 'FAILURE'> = { COMPLETE: 'SUCCESS', FAILED: 'FAILURE' }
/** Mission kinds that build/modify code. Anything else has no honest task-class mapping and is skipped. */
const CODE_KINDS = new Set(['application', 'app_builder', 'fixture'])
const INTERRUPTION = /→ (PAUSED|BLOCKED|RECOVERING|WAITING_[A-Z_]+)\b/

export type MissionAdapterOptions = {
  /** Mission classifications to ingest. Default: real Commander missions only (fixtures/system tests are excluded). */
  includeClassifications?: string[]
  backfilled: boolean
  sourcePath?: string
}
export type MissionAdapterResult = { events: EvaluationEventInput[]; skipped?: string }

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const SAFE_ID = /^[A-Za-z0-9._:/@+-]{1,120}$/

function subjectsOf(m: Rec): EvalSubject[] {
  const ms = isRec(m.modelState) ? m.modelState : {}
  const pin = isRec(m.pinnedModel) ? m.pinnedModel : {}
  const provider = str(ms.activeProvider) ?? str(pin.provider)
  const model = str(ms.activeModel) ?? str(pin.modelId)
  const out: EvalSubject[] = []
  if (provider && SAFE_ID.test(provider)) out.push({ kind: 'provider', id: provider })
  if (provider && model && SAFE_ID.test(model)) out.push({ kind: 'model', id: `${provider}/${model}` })
  return out
}

function taskClassOf(m: Rec): TaskClass | undefined {
  const interp = isRec(m.interpretation) ? m.interpretation : {}
  if (interp.locateOnly === true) return 'cross_reference'
  return typeof m.kind === 'string' && CODE_KINDS.has(m.kind) ? 'code_modification' : undefined
}

function validationOf(m: Rec): { status: ValidationStatus; note: string } {
  const flag = (k: string) => (isRec(m[k]) && typeof (m[k] as Rec).ok === 'boolean' ? ((m[k] as Rec).ok as boolean) : null)
  const parts = { test: flag('testState'), build: flag('buildState'), package: flag('packageState'), install: flag('installState') }
  const vals = Object.values(parts)
  const status: ValidationStatus = vals.includes(false) ? 'FAILED' : parts.test === true || parts.build === true ? 'PASSED' : 'UNKNOWN'
  return { status, note: `validation ${Object.entries(parts).map(([k, v]) => `${k}=${v === null ? 'unknown' : v}`).join(' ')}` }
}

type Journal = { at: string; text: string; kind: string }
function journalOf(m: Rec): Journal[] {
  return (Array.isArray(m.journal) ? m.journal : []).filter(isRec).map((j) => ({ at: String(j.at ?? ''), text: String(j.text ?? ''), kind: String(j.kind ?? '') })).filter((j) => !Number.isNaN(Date.parse(j.at)))
}

/** Pure: raw mission record -> evaluation event inputs. Never invents data; absent facts stay absent (UNKNOWN). */
export function missionToEvents(raw: unknown, opts: MissionAdapterOptions): MissionAdapterResult {
  if (!isRec(raw)) return { events: [], skipped: 'not_an_object' }
  const missionId = str(raw.missionId)
  if (!missionId || !SAFE_ID.test(missionId)) return { events: [], skipped: 'no_mission_id' }
  const status = str(raw.status) ?? ''
  const terminal = TERMINAL[status]
  if (!terminal) return { events: [], skipped: status === 'CANCELLED' ? 'cancelled_not_outcome_evidence' : 'non_terminal' }
  const classification = str(raw.classification) ?? 'UNCLASSIFIED'
  if (!(opts.includeClassifications ?? ['COMMANDER_REAL']).includes(classification)) return { events: [], skipped: `classification_excluded:${classification}` }
  const taskClass = taskClassOf(raw)
  if (!taskClass) return { events: [], skipped: 'no_task_class_mapping' }
  const subjects = subjectsOf(raw)
  if (subjects.length === 0) return { events: [], skipped: 'no_provider_attribution' }

  const journal = journalOf(raw)
  const termEntry = [...journal].reverse().find((j) => j.kind === 'transition' && j.text.includes(`→ ${status}`))
  const occurredAt = termEntry?.at ?? (str(raw.updatedAt) && !Number.isNaN(Date.parse(String(raw.updatedAt))) ? String(raw.updatedAt) : undefined)
  if (!occurredAt) return { events: [], skipped: 'no_timestamp' }
  // elapsed is only meaningful if the mission was never paused/blocked/recovering/waiting
  const interrupted = journal.some((j) => j.kind === 'transition' && INTERRUPTION.test(j.text))
  const start = journal[0]?.at ?? str(raw.createdAt)
  const elapsed = !interrupted && termEntry && start ? Date.parse(termEntry.at) - Date.parse(start) : NaN
  const latencyMs = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined
  const retryObj = isRec(raw.retryCounts) ? raw.retryCounts : undefined
  const retries = retryObj ? Object.values(retryObj).reduce<number>((a, v) => a + (typeof v === 'number' && v >= 0 ? v : 0), 0) : undefined
  const errs = Array.isArray(raw.errors) ? raw.errors.filter(isRec) : []
  const klass = errs.length ? str(errs[errs.length - 1].klass) : undefined
  const errorClass = terminal === 'FAILURE' && klass && /^[A-Z_:]{2,40}$/.test(klass) ? klass : undefined
  const validation = validationOf(raw)

  const sourceRef = `mission:${missionId}`
  const events: EvaluationEventInput[] = []
  const common = { taskClass, occurredAt, sourceKind: 'foundry-mission', sourceRef, sourcePath: opts.sourcePath, backfilled: opts.backfilled }
  for (const subject of subjects) {
    events.push({
      id: stableEventId(ADAPTER, sourceRef, status, 'RUN', subject.kind, subject.id),
      subject,
      taskClass,
      outcome: terminal,
      signal: 'RUN',
      validation: validation.status,
      occurredAt,
      metrics: { ...(latencyMs !== undefined ? { latencyMs } : {}), ...(retries !== undefined ? { retries } : {}) },
      errorClass,
      note: validation.note,
      source: { kind: 'foundry-mission', ref: sourceRef },
      provenance: { adapter: ADAPTER, backfilled: opts.backfilled, sourcePath: opts.sourcePath },
    })
    const install = isRec(raw.installState) && typeof raw.installState.ok === 'boolean' ? raw.installState.ok : undefined
    if (install !== undefined) events.push(installedAcceptanceEvent({ ...common, subject, pass: install }))
    const auth = isRec(raw.authorization) ? raw.authorization : undefined
    const approval = auth ? str(auth.approvalState) : undefined
    const authAt = auth && str(auth.requestedAt) && !Number.isNaN(Date.parse(String(auth.requestedAt))) ? String(auth.requestedAt) : occurredAt
    if (approval === 'approved' || approval === 'rejected' || approval === 'denied')
      events.push(commanderDecisionEvent({ ...common, occurredAt: authAt, subject, decision: approval === 'approved' ? 'approve' : 'reject' }))
    // self-review non-PASS statuses only (a routine PASS adds no information and would inflate evidence)
    for (const tc of (Array.isArray(raw.toolCalls) ? raw.toolCalls : []).filter(isRec)) {
      if (tc.tool !== 'engineering.review' || !str(tc.at) || Number.isNaN(Date.parse(String(tc.at)))) continue
      let reviewStatus: string | undefined
      try {
        const inner = JSON.parse(String(tc.excerpt))
        reviewStatus = str((typeof inner === 'string' ? JSON.parse(inner) : inner)?.status)
      } catch { /* truncated excerpt: not reliably structured, skip */ }
      if (reviewStatus && /^[A-Z_]{2,24}$/.test(reviewStatus) && reviewStatus !== 'PASS')
        events.push(reviewFindingEvent({ ...common, occurredAt: String(tc.at), sourceRef: `${sourceRef}#review@${String(tc.at)}`, subject, reviewer: 'self', status: reviewStatus }))
    }
  }
  if (events.some((e) => valueContainsSecret(e))) return { events: [], skipped: 'secret_detected' }
  return { events }
}
