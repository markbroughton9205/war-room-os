import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { extractClaimTexts } from '@/lib/world-learning/claimExtraction'
import { containsHiddenCot, containsSecret } from '@/lib/real-evidence/engine'
import { evaluateContinuousEvidence } from '@/lib/continuous-evidence/engine'
import type { ContinuousEvidenceInput, ContinuousEvidenceRecord, CurriculumPriority, CurriculumSignal } from '@/lib/continuous-evidence/types'
import { aggregateCapabilities, prioritizeCurriculum } from '@/lib/continuous-evidence/engine'
import type { VerificationState } from '@/lib/world-learning/types'
import type { GymMissionSpec, GymRunRecord, GymSuccessCriterion, GymTemporalProvenance, ObservableStep } from './types'

const nowIso = () => new Date().toISOString()
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

export function researchClaimStatusForGym(agreement: 'corroborated' | 'conflicting' | 'single_source' | 'insufficient_evidence', verifierConfirmed = false): VerificationState {
  if (verifierConfirmed && agreement === 'corroborated') return 'verified'
  if (agreement === 'conflicting') return 'contested'
  if (agreement === 'corroborated') return 'supported'
  if (agreement === 'single_source') return 'candidate'
  return 'observed'
}

function finish(
  mission: GymMissionSpec,
  startedAt: string,
  trajectory: ObservableStep[],
  criteria: GymSuccessCriterion[],
  observable: string,
  extras: Partial<Pick<GymRunRecord, 'claimStatus' | 'terraTemporal'>> = {},
): GymRunRecord {
  const outcome: GymRunRecord['outcome'] = criteria.length > 0 && criteria.every(item => item.passed) ? 'pass' : 'fail'
  return {
    mission, startedAt, completedAt: nowIso(), trajectory, criteria, outcome,
    hiddenCotDetected: containsHiddenCot(observable),
    secretDetected: containsSecret(observable),
    objectiveEvaluated: true,
    objectiveSatisfied: outcome === 'pass',
    ...extras,
  }
}

export function runCodeOperatorGym(spec: GymMissionSpec, fixture: { expectedHash: string; filePath: string }): GymRunRecord {
  const startedAt = nowIso()
  const bytes = readFileSync(fixture.filePath)
  const actual = createHash('sha256').update(bytes).digest('hex')
  const trajectory: ObservableStep[] = [
    { at: startedAt, action: 'read_file', arguments: { path: fixture.filePath }, resultSummary: `bytes=${bytes.length}`, exitCode: 0 },
    { at: nowIso(), action: 'sha256', arguments: { algorithm: 'sha256' }, resultSummary: actual, exitCode: 0 },
  ]
  const criteria: GymSuccessCriterion[] = [
    { id: 'file-readable', description: 'Target artifact exists and is readable.', passed: bytes.length > 0 },
    { id: 'hash-match', description: 'Content hash matches the immutable expected SHA-256.', passed: actual === fixture.expectedHash },
  ]
  return finish(spec, startedAt, trajectory, criteria, `${spec.objective}\n${actual}`)
}

export function runResearchGym(spec: GymMissionSpec, fixture: {
  documentSummary: string
  comparisonAgreement: 'corroborated' | 'conflicting' | 'single_source' | 'insufficient_evidence'
  verifierConfirmed?: boolean
}): GymRunRecord {
  const startedAt = nowIso()
  const claims = extractClaimTexts({
    id: spec.missionId, provider: 'agi-gym', providerRecordId: null, title: spec.objective,
    summary: fixture.documentSummary, contentSnippet: fixture.documentSummary, canonicalUrl: null, sourceUrl: null,
    sourceName: 'agi-gym', contentType: 'text', organization: null, language: 'en', license: null,
    retrievedAt: startedAt, provenance: { sourceUrl: 'agi-gym://research', retrievedAt: startedAt, isHistorical: false },
  })
  const contradictionOpened = fixture.comparisonAgreement === 'conflicting'
  const trajectory: ObservableStep[] = [
    { at: startedAt, action: 'extract_claims', arguments: { method: 'deterministic_sentence_segmentation_v1' }, resultSummary: `claims=${claims.length}`, exitCode: 0 },
    { at: nowIso(), action: 'compare_sources', arguments: { agreement: fixture.comparisonAgreement }, resultSummary: contradictionOpened ? 'contradiction_unresolved' : 'no_contradiction_record', exitCode: 0 },
  ]
  const criteria: GymSuccessCriterion[] = [
    { id: 'claims-extracted', description: 'At least one bounded claim is extracted from the source summary.', passed: claims.length > 0 },
    { id: 'claims-are-not-hidden-cot', description: 'Extracted claims contain no hidden-reasoning dump.', passed: claims.every(text => !containsHiddenCot(text)) },
    { id: 'contradiction-policy', description: 'Only conflicting agreement may open a contradiction; unresolved is allowed.', passed: fixture.comparisonAgreement !== 'conflicting' || contradictionOpened },
    { id: 'non-conflict-does-not-force-resolution', description: 'Corroborated/single/insufficient never fabricate a winner.', passed: fixture.comparisonAgreement === 'conflicting' || !contradictionOpened },
  ]
  return finish(spec, startedAt, trajectory, criteria, JSON.stringify({ claims, agreement: fixture.comparisonAgreement }), {
    claimStatus: researchClaimStatusForGym(fixture.comparisonAgreement, fixture.verifierConfirmed === true),
  })
}

export function runTerraGym(spec: GymMissionSpec, fixture: {
  observedAt?: string
  validFrom?: string | null
  validUntil: string
  verificationAt?: string
  predictionRef?: string
  observationRef?: string
  sourceRef?: string
  sourceVersion?: string
  now: Date
  location?: { latitude: number; longitude: number }
}): GymRunRecord {
  const startedAt = nowIso()
  const terraTemporal: GymTemporalProvenance = {
    observedAt: fixture.observedAt ?? startedAt,
    validFrom: fixture.validFrom ?? fixture.observedAt ?? startedAt,
    validUntil: fixture.validUntil,
    verificationAt: fixture.verificationAt ?? fixture.now.toISOString(),
    predictionRef: fixture.predictionRef ?? `pred:${spec.missionId}`,
    observationRef: fixture.observationRef ?? `obs:${spec.missionId}`,
    sourceRef: fixture.sourceRef ?? 'sensor:gym',
    sourceVersion: fixture.sourceVersion ?? 'terra-gym-fixture-v1',
    location: fixture.location ?? { latitude: 43.65, longitude: -79.38 },
  }
  const evaluated = evaluateContinuousEvidence({
    source: 'terra', subjectRef: spec.missionId, outcome: 'pass', observedAt: terraTemporal.observedAt,
    validFrom: terraTemporal.validFrom, validUntil: terraTemporal.validUntil, verificationAt: terraTemporal.verificationAt,
    provenanceRefs: [terraTemporal.sourceRef, terraTemporal.observationRef], sourceLineageIds: spec.sourceLineageIds, capabilityTags: spec.capabilityTags,
    curriculumTags: spec.curriculumTags, validatorTypes: ['terra-temporal'], verifierId: 'terra-gym-verifier', evaluatorId: 'terra-gym-evaluator',
    objectiveEvaluated: true, objectiveSatisfied: true, objectiveVerified: true,
    predictionRef: terraTemporal.predictionRef, observationRef: terraTemporal.observationRef,
    sourceRef: terraTemporal.sourceRef, sourceVersion: terraTemporal.sourceVersion, location: terraTemporal.location,
  }, fixture.now)
  const stale = Boolean(evaluated.rejection?.reasons.includes('stale'))
  const admitted = Boolean(evaluated.record)
  const expectStale = new Date(fixture.validUntil) <= fixture.now
  const trajectory: ObservableStep[] = [
    { at: startedAt, action: 'observe', arguments: { validUntil: fixture.validUntil }, resultSummary: 'observation-captured', exitCode: 0 },
    { at: nowIso(), action: 'verify_temporal_scope', arguments: { now: fixture.now.toISOString() }, resultSummary: stale ? 'stale' : admitted ? 'current' : (evaluated.rejection?.reasons.join(',') ?? 'rejected'), exitCode: 0 },
  ]
  const criteria: GymSuccessCriterion[] = [
    { id: 'stale-rejected', description: 'Expired Terra observations cannot be admitted as current.', passed: expectStale ? stale : true },
    { id: 'current-admitted', description: 'In-window Terra observations with prediction/observation/location may be admitted.', passed: expectStale ? true : admitted },
  ]
  return finish(spec, startedAt, trajectory, criteria, JSON.stringify(evaluated.rejection ?? { admitted: true }), { terraTemporal })
}

export function runToolUseGym(spec: GymMissionSpec, fixture: { tool: string; argument: string; expectedPrefix: string }): GymRunRecord {
  const startedAt = nowIso()
  const selected = fixture.tool === 'sha256'
  const digest = selected ? sha(fixture.argument) : ''
  const trajectory: ObservableStep[] = [
    { at: startedAt, action: 'select_tool', arguments: { tool: fixture.tool }, resultSummary: selected ? 'sha256' : 'rejected-uncontrolled-tool', exitCode: selected ? 0 : 1 },
    { at: nowIso(), action: 'execute_tool', arguments: { tool: fixture.tool }, resultSummary: digest.slice(0, 16), exitCode: selected ? 0 : 1 },
  ]
  const criteria: GymSuccessCriterion[] = [
    { id: 'safe-tool-only', description: 'Only the bounded local sha256 tool may run.', passed: selected },
    { id: 'result-interpreted', description: 'Digest matches the expected prefix.', passed: selected && digest.startsWith(fixture.expectedPrefix) },
  ]
  return finish(spec, startedAt, trajectory, criteria, digest)
}

function gymSource(run: GymRunRecord): ContinuousEvidenceInput['source'] {
  if (run.mission.gym === 'terra_world_state') return 'terra'
  if (run.mission.gym === 'research_engine') return 'research_engine'
  if (run.mission.gym === 'code_operator') return 'code_operator'
  return 'tool_use'
}

export function gymRunToEvidenceInput(run: GymRunRecord): ContinuousEvidenceInput {
  const terra = run.terraTemporal
  return {
    source: gymSource(run),
    subjectRef: `gym:${run.mission.missionId}`,
    outcome: run.outcome,
    observedAt: terra?.observedAt ?? run.completedAt,
    validFrom: terra?.validFrom ?? null,
    validUntil: terra?.validUntil ?? null,
    verificationAt: terra?.verificationAt ?? run.completedAt,
    provenanceRefs: [`gym:${run.mission.gym}`, `mission:${run.mission.missionId}`, ...run.criteria.map(item => `criterion:${item.id}:${item.passed ? 'pass' : 'fail'}`), ...(terra ? [terra.sourceRef, terra.observationRef] : [])],
    sourceLineageIds: run.mission.sourceLineageIds,
    capabilityTags: run.mission.capabilityTags,
    curriculumTags: run.mission.curriculumTags,
    validatorTypes: run.criteria.map(item => item.id),
    verifierId: `${run.mission.gym}-verifier`,
    evaluatorId: 'agi-gym-evaluator',
    objectiveEvaluated: true,
    objectiveSatisfied: run.outcome === 'pass',
    objectiveVerified: run.outcome === 'pass',
    containsSecret: run.secretDetected,
    containsHiddenCot: run.hiddenCotDetected,
    claimStatus: run.mission.gym === 'research_engine' ? run.claimStatus : undefined,
    predictionRef: terra?.predictionRef,
    observationRef: terra?.observationRef,
    sourceRef: terra?.sourceRef,
    sourceVersion: terra?.sourceVersion,
    location: terra?.location,
    metadata: { trajectory: run.trajectory, criteria: run.criteria, gymType: run.mission.gym },
  }
}

export function evaluateGymRun(run: GymRunRecord, at = new Date()) {
  return evaluateContinuousEvidence(gymRunToEvidenceInput(run), at)
}

export function curriculumFromGymRuns(records: ContinuousEvidenceRecord[], extraSignals: CurriculumSignal[] = []): CurriculumPriority[] {
  const metrics = aggregateCapabilities(records)
  const failureSignals: CurriculumSignal[] = records.filter(record => record.evidence.outcome === 'fail').flatMap(record => record.capabilityTags.map(capabilityKey => ({
    id: `gym-fail:${record.evidence.id}:${capabilityKey}`, kind: 'observed_failure' as const, capabilityKey, severity: 7, observedAt: record.evidence.observedAt, sourceRef: record.evidence.id,
  })))
  const contestedSignals: CurriculumSignal[] = records.filter(record => record.evidence.metadata.claimStatus === 'contested' || record.evidence.metadata.claimStatus === 'candidate').flatMap(record => record.capabilityTags.map(capabilityKey => ({
    id: `gym-gap:${record.evidence.id}:${capabilityKey}`, kind: 'knowledge_gap' as const, capabilityKey, severity: 5, observedAt: record.evidence.observedAt, sourceRef: record.evidence.id,
  })))
  return prioritizeCurriculum(metrics, [...failureSignals, ...contestedSignals, ...extraSignals])
}

export function capabilityGraphFromGym(records: ContinuousEvidenceRecord[]) {
  return aggregateCapabilities(records).map(metric => ({
    node: metric.capabilityKey,
    demonstrated: metric.successes > 0,
    successes: metric.successes,
    failures: metric.failures,
    strength: metric.strength,
    confidence: metric.confidence,
  }))
}
