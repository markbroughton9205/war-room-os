import { createHash } from 'node:crypto'
import { EVIDENCE_KIND_BY_SOURCE, type CapabilityEvidenceMetrics, type ContinuousEvidenceInput, type ContinuousEvidenceRecord, type CurriculumPriority, type CurriculumSignal, type EvidenceRejection, type IncrementalDatasetManifest, type PriorDatasetRoot } from './types'

const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}` : JSON.stringify(value)
export const evidenceHash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort()
const clamp = (value: number) => Math.max(0, Math.min(1, value))

export function resolveObjectiveSemantics(input: Pick<ContinuousEvidenceInput, 'outcome' | 'objectiveEvaluated' | 'objectiveSatisfied' | 'objectiveVerified'>): {
  objectiveEvaluated: boolean
  objectiveSatisfied: boolean
  objectiveVerified: boolean
} {
  const objectiveEvaluated = input.objectiveEvaluated ?? input.objectiveVerified ?? false
  const objectiveSatisfied = input.objectiveSatisfied ?? (input.outcome === 'pass' && input.objectiveVerified === true)
  return { objectiveEvaluated, objectiveSatisfied, objectiveVerified: objectiveSatisfied }
}

export function evaluateContinuousEvidence(input: ContinuousEvidenceInput, now = new Date()): { record: ContinuousEvidenceRecord | null; rejection: EvidenceRejection | null } {
  const objective = resolveObjectiveSemantics(input)
  const stable = { ...input, ...objective, provenanceRefs: unique(input.provenanceRefs), sourceLineageIds: unique(input.sourceLineageIds), capabilityTags: unique(input.capabilityTags), curriculumTags: unique(input.curriculumTags), validatorTypes: unique(input.validatorTypes), metadata: input.metadata ?? {} }
  const evidenceId = `w5ev_${evidenceHash(stable).slice(0, 24)}`
  const reasons: string[] = []
  if (!stable.objectiveEvaluated) reasons.push('not_objectively_evaluated')
  if (!stable.provenanceRefs.length) reasons.push('missing_provenance')
  if (!stable.sourceLineageIds.length) reasons.push('missing_source_lineage')
  if (!stable.capabilityTags.length) reasons.push('missing_capability')
  if (!stable.validatorTypes.length || !stable.verifierId || !stable.evaluatorId) reasons.push('missing_independent_validation')
  if (stable.verifierId && stable.evaluatorId && stable.verifierId === stable.evaluatorId) reasons.push('verifier_evaluator_not_separate')
  if (stable.containsSecret) reasons.push('secret_detected')
  if (stable.containsHiddenCot) reasons.push('hidden_cot_detected')
  if (stable.validUntil && new Date(stable.validUntil) <= now) reasons.push('stale')
  if ((stable.source === 'research_engine' || stable.source === 'world_learning') && stable.claimStatus !== 'verified') reasons.push(`claim_status:${stable.claimStatus ?? 'missing'}`)
  if (stable.source === 'terra') {
    if (!stable.validUntil) reasons.push('terra_missing_valid_until')
    if (!stable.predictionRef || !stable.observationRef) reasons.push('terra_missing_prediction_observation_lineage')
    if (!stable.location) reasons.push('terra_missing_location')
  }
  if (stable.source === 'commander_correction' && !['corrected', 'pass', 'fail'].includes(stable.outcome)) reasons.push('correction_missing_objective_outcome')
  if (reasons.length) return { record: null, rejection: { subjectRef: stable.subjectRef, evidenceId, reasons: unique(reasons) } }
  const quality = {
    objectiveValidatorCount: stable.validatorTypes.length, provenanceCount: stable.provenanceRefs.length,
    distinctLineageCount: stable.sourceLineageIds.length, sourceDiversity: new Set(stable.provenanceRefs.map(ref => ref.split(':', 1)[0])).size,
    temporalBoundedness: stable.source !== 'terra' || Boolean(stable.validUntil),
    qualityScore: clamp(0.25 + Math.min(0.25, stable.validatorTypes.length * 0.1) + Math.min(0.2, stable.provenanceRefs.length * 0.05) + Math.min(0.2, stable.sourceLineageIds.length * 0.1) + (stable.source === 'terra' && stable.validUntil ? 0.1 : 0)),
  }
  const evidence = { id: evidenceId, projectId: null, userId: null, kind: EVIDENCE_KIND_BY_SOURCE[stable.source], subjectRef: stable.subjectRef, outcome: stable.outcome, observedAt: stable.observedAt, validUntil: stable.validUntil, provenanceRefs: stable.provenanceRefs, verifierId: stable.verifierId, evaluatorId: stable.evaluatorId, poisoned: false, metadata: { ...stable.metadata, source: stable.source, sourceLineageIds: stable.sourceLineageIds, capabilityTags: stable.capabilityTags, curriculumTags: stable.curriculumTags, validatorTypes: stable.validatorTypes, location: stable.location ?? null, predictionRef: stable.predictionRef ?? null, observationRef: stable.observationRef ?? null, validFrom: stable.validFrom ?? null, verificationAt: stable.verificationAt ?? stable.observedAt, sourceRef: stable.sourceRef ?? null, sourceVersion: stable.sourceVersion ?? null, objectiveEvaluated: stable.objectiveEvaluated, objectiveSatisfied: stable.objectiveSatisfied, objectiveVerified: stable.objectiveVerified, claimStatus: stable.claimStatus ?? null } }
  return { record: { evidence, source: stable.source, sourceLineageIds: stable.sourceLineageIds, capabilityTags: stable.capabilityTags, curriculumTags: stable.curriculumTags, validatorTypes: stable.validatorTypes, quality, contentHash: evidenceHash(evidence), retryOfEvidenceId: stable.retryOfEvidenceId ?? null }, rejection: null }
}

export function deduplicateEvidence(records: ContinuousEvidenceRecord[]): { records: ContinuousEvidenceRecord[]; rejected: EvidenceRejection[] } {
  const kept: ContinuousEvidenceRecord[] = []; const seenHash = new Set<string>(); const seenLineage = new Set<string>(); const rejected: EvidenceRejection[] = []
  for (const record of [...records].sort((a, b) => a.evidence.observedAt.localeCompare(b.evidence.observedAt) || a.evidence.id.localeCompare(b.evidence.id))) {
    const retry = Boolean(record.retryOfEvidenceId); const lineageKey = record.sourceLineageIds.join('|')
    const reasons = seenHash.has(record.contentHash) ? ['duplicate_content'] : retry || seenLineage.has(lineageKey) ? ['duplicate_retry_lineage'] : []
    if (reasons.length) rejected.push({ subjectRef: record.evidence.subjectRef, evidenceId: record.evidence.id, reasons })
    else { kept.push(record); seenHash.add(record.contentHash); seenLineage.add(lineageKey) }
  }
  return { records: kept, rejected }
}

export function aggregateCapabilities(records: ContinuousEvidenceRecord[], heldOutIds = new Set<string>()): CapabilityEvidenceMetrics[] {
  const keys = unique(records.flatMap(record => record.capabilityTags))
  return keys.map(capabilityKey => {
    const evidence = records.filter(record => record.capabilityTags.includes(capabilityKey)); const pass = evidence.filter(record => record.evidence.outcome === 'pass').length; const fail = evidence.filter(record => record.evidence.outcome === 'fail').length
    const lineages = new Set(evidence.flatMap(record => record.sourceLineageIds)).size; const held = evidence.filter(record => heldOutIds.has(record.evidence.id)); const density = evidence.length
    const averageQuality = density ? evidence.reduce((sum, record) => sum + record.quality.qualityScore, 0) / density : 0
    const confidence = clamp((density / 5) * averageQuality * (pass + fail ? Math.max(pass, fail) / (pass + fail) : 0))
    return { capabilityKey, successes: pass, failures: fail, validatorTypes: unique(evidence.flatMap(record => record.validatorTypes)), distinctMissionLineages: lineages, lastObservedAt: evidence.map(record => record.evidence.observedAt).sort().at(-1) ?? null, heldOutPasses: held.filter(record => record.evidence.outcome === 'pass').length, heldOutFailures: held.filter(record => record.evidence.outcome === 'fail').length, evidenceDensity: density, averageEvidenceQuality: averageQuality, confidence, strength: density === 0 ? 'unobserved' : lineages === 1 ? 'isolated' : lineages < 4 ? 'emerging' : 'repeated', evidenceIds: evidence.map(record => record.evidence.id).sort() }
  })
}

export function prioritizeCurriculum(metrics: CapabilityEvidenceMetrics[], signals: CurriculumSignal[]): CurriculumPriority[] {
  const keys = unique([...metrics.map(metric => metric.capabilityKey), ...signals.map(signal => signal.capabilityKey)])
  return keys.flatMap(capabilityKey => {
    const metric = metrics.find(item => item.capabilityKey === capabilityKey); const scoped = signals.filter(signal => signal.capabilityKey === capabilityKey)
    const justified = scoped.length > 0 || (metric?.failures ?? 0) > 0 || !metric || metric.strength !== 'repeated' || metric.confidence < 0.4
    if (!justified) return []
    const failureWeight = (metric?.failures ?? 0) * 15; const confidenceGap = (1 - (metric?.confidence ?? 0)) * 40; const signalWeight = scoped.reduce((sum, signal) => sum + Math.max(0, Math.min(10, signal.severity)) * ({ regression: 5, commander_correction: 4, observed_failure: 3, knowledge_gap: 2, low_confidence: 1 }[signal.kind]), 0)
    const reasons = unique([...scoped.map(signal => `${signal.kind}:${signal.sourceRef}`), ...(metric && metric.strength !== 'repeated' ? [`evidence_strength:${metric.strength}`] : []), ...(metric?.failures ? [`observed_failures:${metric.failures}`] : [])])
    const kind = scoped.some(signal => signal.kind === 'knowledge_gap') ? 'research' as const : scoped.some(signal => signal.kind === 'regression') ? 'targeted_verification' as const : 'code_skill' as const
    return [{ capabilityKey, priority: Math.round((failureWeight + confidenceGap + signalWeight) * 100) / 100, reasons, nextMission: { kind, objective: `Produce a bounded real task that tests ${capabilityKey} and addresses: ${reasons.join(', ') || 'low evidence density'}.`, requiredValidator: kind === 'research' ? 'independent_source_verification' : 'deterministic_objective_validator' } }]
  }).sort((a, b) => b.priority - a.priority || a.capabilityKey.localeCompare(b.capabilityKey))
}

export function buildIncrementalDatasetManifest(input: { version: string; prior: PriorDatasetRoot; priorRecords: ContinuousEvidenceRecord[]; additions: ContinuousEvidenceRecord[]; rejected?: EvidenceRejection[]; lineage: { parentCheckpointHash: string; tokenizerHash: string }; splitSeed?: number; now?: Date }): IncrementalDatasetManifest {
  const splitSeed = input.splitSeed ?? 5001; const deduped = deduplicateEvidence([...input.priorRecords, ...input.additions]); const priorIds = new Set(input.prior.sourceEvidenceIds); const records = deduped.records
  const inheritedHeldOut = unique([...input.prior.validationIds, ...input.prior.testIds]); const inheritedLineages = new Map<string, string>()
  for (const id of inheritedHeldOut) for (const lineage of input.prior.evidenceLineages[id] ?? []) inheritedLineages.set(lineage, id)
  const trainIds = [...input.prior.trainIds]; const validationIds = [...input.prior.validationIds]; const testIds = [...input.prior.testIds]; const collisions: string[] = []
  for (const record of records.filter(record => !priorIds.has(record.evidence.id))) {
    const heldCollision = record.sourceLineageIds.filter(lineage => inheritedLineages.has(lineage)); if (heldCollision.length) { collisions.push(...heldCollision.map(lineage => `${record.evidence.id}:${lineage}`)); continue }
    const bucket = parseInt(evidenceHash(`${splitSeed}:${record.sourceLineageIds.join('|')}`).slice(0, 8), 16) % 10
    if (bucket === 0) testIds.push(record.evidence.id); else if (bucket === 1) validationIds.push(record.evidence.id); else trainIds.push(record.evidence.id)
  }
  const admitted = records.filter(record => !collisions.some(collision => collision.startsWith(`${record.evidence.id}:`))); const addedEvidenceIds = admitted.map(record => record.evidence.id).filter(id => !priorIds.has(id)).sort(); const sourceEvidenceIds = unique([...input.prior.sourceEvidenceIds, ...addedEvidenceIds])
  const lineageGroups = Object.fromEntries(admitted.map(record => [record.evidence.id, record.sourceLineageIds])); const capabilities = aggregateCapabilities(admitted, new Set([...validationIds, ...testIds])); const qualityById = Object.fromEntries(admitted.map(record => [record.evidence.id, record.quality])); const scores = admitted.map(record => record.quality.qualityScore)
  const payload = { version: input.version, predecessor: input.prior, addedEvidenceIds, rejected: [...(input.rejected ?? []), ...deduped.rejected], splits: { trainIds: unique(trainIds), validationIds: unique(validationIds), testIds: unique(testIds) }, lineageGroups, capabilities, hashes: admitted.map(record => record.contentHash), splitSeed, lineage: input.lineage }
  const contentHash = evidenceHash(payload)
  return { datasetId: `w5ds_${contentHash.slice(0, 24)}`, version: input.version, createdAt: (input.now ?? new Date()).toISOString(), predecessor: { datasetId: input.prior.datasetId, manifestHash: input.prior.manifestHash }, admissionRuleVersion: 'wave5-real-v1', splitSeed, splitVersion: 'lineage-stable-v1', sourceEvidenceIds, addedEvidenceIds, removedEvidenceIds: [], rejectedEvidence: [...(input.rejected ?? []), ...deduped.rejected, ...collisions.map(value => ({ subjectRef: value.split(':', 1)[0], evidenceId: value.split(':', 1)[0], reasons: ['cross_generation_heldout_lineage_collision'] }))], trainIds: unique(trainIds), validationIds: unique(validationIds), testIds: unique(testIds), lineageGroups, capabilityDistribution: Object.fromEntries(capabilities.map(metric => [metric.capabilityKey, { total: metric.evidenceDensity, successes: metric.successes, failures: metric.failures }])), evidenceQuality: { average: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0, minimum: scores.length ? Math.min(...scores) : 0, byEvidenceId: qualityById }, heldOutIsolationProof: { passed: collisions.length === 0, collisions: unique(collisions), inheritedHeldOutIds: inheritedHeldOut, checkedGenerations: [input.prior.datasetId, `w5ds_${contentHash.slice(0, 24)}`] }, parentCheckpoint: 'WRIM-0:checkpoint-final', parentCheckpointHash: input.lineage.parentCheckpointHash, tokenizerId: 'WR-TOKENIZER-0', tokenizerHash: input.lineage.tokenizerHash, contentHash, trainingStarted: false }
}
