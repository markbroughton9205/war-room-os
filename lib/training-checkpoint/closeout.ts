import { createHash } from 'node:crypto'
import type { Wave4DatasetManifest } from './types'

export type CloseoutReadiness = 'READY' | 'READY_WITH_CONDITIONS' | 'NOT_READY'
export type AuditLifecycleSummary = { totalEvents: number; totalRepairs: number; commanderResolvedRepairs: number; hashChainBreaks: number; wave3CandidateManifestCount: number; wave3LearningEvidenceCount: number }
export type RealAdmissionDecision = { admissible: boolean; readiness: CloseoutReadiness; eligibleRecordCount: number; rejectedRecordCount: number; blockers: string[] }
export type HeldOutProbe = { id: string; capabilityKey: string; prompt: string; objectiveChecks: string[]; baselineEvidenceRef: string; baselineObserved: Record<string, string | number | boolean>; candidateStatus: 'not_run' }
export type HeldOutReadinessManifest = {
  manifestId: string; policyVersion: 'wave4-closeout-v1'; parentCheckpointId: 'WRIM-0:checkpoint-final'; parentCheckpointHash: string
  probes: HeldOutProbe[]; excludedProbeIds: { id: string; reason: 'training_corpus_overlap' }[]
  candidateCheckpointId: null; candidateScores: null; recommendation: 'not_evaluable'; commanderAuthorization: 'not_requested'; promotionExecuted: false; contentHash: string
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`
  return JSON.stringify(value)
}
const sha256 = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')

/** An empty deterministic hash is diagnostic evidence, not an admitted dataset. Closeout also
 * requires non-empty leakage-safe train, validation, and test splits. */
export function decideRealAdmission(manifest: Wave4DatasetManifest, evidence: AuditLifecycleSummary): RealAdmissionDecision {
  const blockers: string[] = []
  if (manifest.records.length === 0) blockers.push('no_wave4_eligible_records')
  if (manifest.splitCounts.train === 0) blockers.push('empty_train_split')
  if (manifest.splitCounts.validation === 0) blockers.push('empty_validation_split')
  if (manifest.splitCounts.test === 0) blockers.push('empty_test_split')
  if (evidence.wave3CandidateManifestCount === 0) blockers.push('no_persisted_wave3_candidate_manifest')
  if (evidence.wave3LearningEvidenceCount === 0) blockers.push('no_persisted_wave3_learning_evidence')
  if (evidence.hashChainBreaks > 0) blockers.push('code_operator_audit_hash_chain_discontinuous')
  return { admissible: blockers.length === 0, readiness: blockers.length === 0 ? 'READY_WITH_CONDITIONS' : 'NOT_READY', eligibleRecordCount: manifest.records.length, rejectedRecordCount: manifest.exclusions.length + evidence.totalRepairs, blockers }
}

export function buildHeldOutReadinessManifest(input: { parentCheckpointHash: string; probes: HeldOutProbe[]; excludedProbeIds: HeldOutReadinessManifest['excludedProbeIds'] }): HeldOutReadinessManifest {
  if (!/^[a-f0-9]{64}$/.test(input.parentCheckpointHash)) throw new Error('WRIM-0 checkpoint hash is required')
  if (input.probes.length === 0) throw new Error('At least one real held-out baseline probe is required')
  const payload = {
    policyVersion: 'wave4-closeout-v1' as const, parentCheckpointId: 'WRIM-0:checkpoint-final' as const, parentCheckpointHash: input.parentCheckpointHash,
    probes: [...input.probes].sort((a, b) => a.id.localeCompare(b.id)), excludedProbeIds: [...input.excludedProbeIds].sort((a, b) => a.id.localeCompare(b.id)),
    candidateCheckpointId: null, candidateScores: null, recommendation: 'not_evaluable' as const, commanderAuthorization: 'not_requested' as const, promotionExecuted: false as const,
  }
  const contentHash = sha256(payload)
  return { ...payload, manifestId: `w4closeout_eval_${contentHash.slice(0, 24)}`, contentHash }
}
