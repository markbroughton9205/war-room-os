/**
 * Truthful provenance + status derivation. A turn is COMPLETED only when every required step
 * has recorded evidence; acceptance of a request or a plausible answer never counts.
 */
import type { ProvenanceActor, ProvenanceEntry, Stage1Status } from './types'

export type ProvenanceLedger = {
  turnId: string
  entries: ProvenanceEntry[]
  localKnowledge: Array<{ claimId: string; source: string; status: string }>
  externalSources: Array<{ url: string; accepted: boolean; reason: string }>
  toolsInvoked: Array<{ tool: string; ok: boolean; detail: string }>
  failures: Array<{ stage: string; detail: string }>
}

export function createLedger(turnId: string): ProvenanceLedger {
  return { turnId, entries: [], localKnowledge: [], externalSources: [], toolsInvoked: [], failures: [] }
}

export function record(
  ledger: ProvenanceLedger,
  actor: ProvenanceActor,
  action: string,
  detail: string,
  status: Stage1Status,
  now: () => string = () => new Date().toISOString(),
): ProvenanceEntry {
  const entry: ProvenanceEntry = { seq: ledger.entries.length + 1, at: now(), actor, action, detail, status }
  ledger.entries.push(entry)
  if (status === 'FAILED' || status === 'INTERRUPTED') ledger.failures.push({ stage: action, detail })
  return entry
}

export const COORDINATOR_ACTOR: ProvenanceActor = {
  id: 'coordinator', kind: 'coordinator', label: 'Council coordinator (deterministic)', model: null, provider: null,
}

export function deterministicActor(id: string, label: string): ProvenanceActor {
  return { id, kind: 'deterministic', label, model: null, provider: null }
}

export function modelActor(memberId: string, model: string, provider: string): ProvenanceActor {
  return { id: memberId, kind: 'model', label: memberId, model, provider }
}

export type TurnStatusInput = {
  /** Steps the coordinator required (member ids, or deterministic process ids). */
  required: string[]
  /** Steps with a recorded successful result. */
  succeeded: string[]
  failed: string[]
  cancelled: boolean
  interrupted: boolean
  /** Some required step has not produced a result yet. */
  inFlight: boolean
  waitingOnCommander: boolean
  accepted: boolean
}

export function deriveTurnStatus(i: TurnStatusInput): Stage1Status {
  if (i.cancelled) return 'CANCELLED'
  if (i.interrupted) return 'INTERRUPTED'
  if (i.waitingOnCommander) return 'WAITING'
  if (!i.accepted) return 'QUEUED'
  const done = i.required.filter(r => i.succeeded.includes(r)).length
  if (i.inFlight && done < i.required.length) return 'RUNNING'
  if (i.required.length === 0) return 'FAILED' // nothing was required => nothing was proven
  if (done === i.required.length && i.failed.length === 0) return 'COMPLETED'
  if (done === 0) return 'FAILED'
  return 'PARTIAL'
}

export function summarizeLedger(l: ProvenanceLedger) {
  const members = Array.from(new Set(l.entries.filter(e => e.actor.kind === 'model').map(e => e.actor.id)))
  const models = Array.from(new Set(l.entries.filter(e => e.actor.model).map(e => `${e.actor.provider ?? 'unknown'}:${e.actor.model}`)))
  return {
    turnId: l.turnId,
    members,
    models,
    toolCount: l.toolsInvoked.length,
    localKnowledgeCount: l.localKnowledge.length,
    acceptedSources: l.externalSources.filter(s => s.accepted).length,
    rejectedSources: l.externalSources.filter(s => !s.accepted).length,
    failureCount: l.failures.length,
  }
}
