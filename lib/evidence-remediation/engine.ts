import { createHash } from 'node:crypto'
import type { NativeRepairRecord } from '@/lib/native-builder/types'
import type { AuditBoundary, AuditEvent, AuditVerification, LifecycleClass, LifecycleClassification, MaterializedCodeOperatorRecord } from './types'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const eventPayload = (event: AuditEvent) => ({ at: event.at, actor: event.actor, category: event.category, message: event.message, metadata: event.metadata, previousHash: event.previousHash })
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
    : JSON.stringify(value)

export function verifySegmentedAudit(events: AuditEvent[]): AuditVerification {
  const seen = new Set<string>()
  const boundaries: AuditBoundary[] = []
  let corruptEvents = 0
  let intactSequentialLinks = 0
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    const calculated = sha256(JSON.stringify(eventPayload(event)))
    if (calculated !== event.hash) corruptEvents += 1
    const sequentialPreviousHash = index === 0 ? 'GENESIS' : events[index - 1].hash
    if (event.previousHash === sequentialPreviousHash) intactSequentialLinks += 1
    else {
      const cause = event.previousHash === 'GENESIS' ? 'genesis_midstream'
        : seen.has(event.previousHash) ? 'concurrent_append_fork' : 'missing_predecessor'
      boundaries.push({ eventIndex: index, eventHash: event.hash, declaredPreviousHash: event.previousHash, sequentialPreviousHash, cause })
    }
    seen.add(event.hash)
  }
  const originalLedgerHash = sha256(events.map(event => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''))
  const segmentManifestHash = sha256(canonical({ originalLedgerHash, boundaries }))
  return {
    eventCount: events.length, intactSequentialLinks, legitimateSegmentBoundaries: boundaries.filter(boundary => boundary.cause === 'concurrent_append_fork').length,
    corruptEvents, missingPredecessors: boundaries.filter(boundary => boundary.cause === 'missing_predecessor').length,
    boundaries, originalLedgerHash, segmentManifestHash,
  }
}

const lifecyclePriority: [LifecycleClass, RegExp][] = [
  ['commander_resolved', /commander accepted, marked resolved/],
  ['verification_failed', /verification failed/],
  ['awaiting_review', /awaiting Commander review|partially verified/],
  ['planning_blocked', /planning blocked/],
  ['patch_application_failed', /patch application failed/],
]

export function classifyCodeOperatorLifecycles(events: AuditEvent[]): LifecycleClassification[] {
  const grouped = new Map<string, AuditEvent[]>()
  for (const event of events) {
    const repairId = event.metadata.repairId
    if (typeof repairId !== 'string') continue
    grouped.set(repairId, [...(grouped.get(repairId) ?? []), event])
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([repairId, lifecycle]) => {
    const matched = lifecyclePriority.find(([, pattern]) => lifecycle.some(event => pattern.test(event.message)))
    const lifecycleClass = matched?.[0] ?? 'no_terminal_outcome'
    const reasons = lifecycleClass === 'commander_resolved'
      ? ['durable_native_repair_record_required', 'objective_validation_payload_required', 'separate_evaluator_evidence_required']
      : ['final_accepted_outcome_missing', 'not_positive_capability_evidence']
    return { repairId, class: lifecycleClass, eventHashes: lifecycle.map(event => event.hash), reasons }
  })
}

export function materializeVerifiedCodeOperatorRepair(repair: NativeRepairRecord, lifecycle: LifecycleClassification, sourceLedgerHash: string): MaterializedCodeOperatorRecord | null {
  const objective = repair.validationResults.filter(result => result.ok && result.exitCode === 0)
  if (repair.state !== 'resolved' || repair.verification?.status !== 'resolved' || objective.length === 0 || !repair.diffEvidence?.diffHash || lifecycle.class !== 'commander_resolved') return null
  const observedAt = repair.updatedAt
  const validationRefs = objective.map(result => `validation:${result.operation.id}:${sha256(canonical({ exitCode: result.exitCode, ranAt: result.ranAt, stdout: result.stdout, stderr: result.stderr }))}`)
  const sourceLineageIds = [`native-repair:${repair.id}`, `issue:${repair.issueId}`]
  const evidenceId = `w41e_${sha256(canonical({ repairId: repair.id, validationRefs, diffHash: repair.diffEvidence.diffHash, sourceLedgerHash })).slice(0, 24)}`
  const evidence = { id: evidenceId, projectId: null, userId: null, kind: 'code_operator_result' as const, subjectRef: 'capability:code-repair', outcome: 'pass' as const, observedAt, validUntil: null, provenanceRefs: [...sourceLineageIds, `audit-ledger:${sourceLedgerHash}`, `diff:${repair.diffEvidence.diffHash}`, ...validationRefs], verifierId: 'native-builder-repair-verifier', evaluatorId: 'wave4.1-objective-evaluator', poisoned: false, metadata: { repairId: repair.id, issueId: repair.issueId, changedFiles: repair.diffEvidence.changedFiles } }
  const candidate = { recordId: evidenceId, projectId: null, userId: null, recordType: 'code_operator_evidence' as const, contentRef: `native-repair-outcome:${repair.id}`, verificationState: 'verified' as const, observedAt, validUntil: null, provenanceRefs: evidence.provenanceRefs, evidenceIds: [evidenceId, ...validationRefs], poisoned: false, commanderCorrectionApplied: false }
  const datasetRecord = { recordId: evidenceId, recordType: 'code_operator_evidence' as const, content: `Objectively verified native repair ${repair.id}; validations ${objective.map(result => result.operation.id).sort().join(', ')}; diff ${repair.diffEvidence.diffHash}.`, verificationState: 'verified' as const, wave3Eligible: true, observedAt, validUntil: null, provenanceRefs: evidence.provenanceRefs, sourceLineageIds, evidenceIds: candidate.evidenceIds, poisoned: false, containsHiddenCot: false, containsSecret: false, commanderCorrection: null, curriculumTags: ['code-repair', 'objective-verification'], capabilityTags: ['code-operator', ...objective.map(result => result.operation.id)] }
  return { evidence, candidate, datasetRecord }
}
