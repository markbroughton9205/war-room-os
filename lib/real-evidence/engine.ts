import { createHash } from 'node:crypto'
import type { EngineeringActionRecord, EngineeringMissionRecord, EvidenceArtifactRecord, MaterializedRealEvidence, ObjectiveValidatorRecord, RealDatasetManifest } from './types'

const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}` : JSON.stringify(value)
export const sha256 = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')
export const containsSecret = (value: string) => /(?:api[_-]?key|token|secret|password|authorization|cookie)\s*[=:]\s*[^\s,;]+|Bearer\s+[A-Za-z0-9._~+\/-]+/i.test(value)
/** Detects stored hidden-reasoning traces. Discussion of the filter (for example
 * "hidden reasoning excluded") is not a trace; labeled dumps and think/scratchpad tags are. */
export const containsHiddenCot = (value: string) =>
  /<\/?(?:think|scratchpad|hidden_cot)\b/i.test(value)
  || /(?:chain[-_ ]of[-_ ]thought|hidden[_-]reasoning|reasoning[_-]trace)\s*[:=]/i.test(value)
  || /"(?:hiddenReasoning|hidden_reasoning|chain_of_thought|reasoning_trace)"\s*:/i.test(value)
  || /(?:^|[\n\r])\s*chain[-_ ]of[-_ ]thought\b/im.test(value)

export function materializeEngineeringMission(input: { mission: EngineeringMissionRecord; actions: EngineeringActionRecord[]; validators: ObjectiveValidatorRecord[]; artifacts: EvidenceArtifactRecord[]; auditValid: boolean; commanderResolved?: boolean }): MaterializedRealEvidence | null {
  const { mission, actions, validators, artifacts } = input
  if (mission.terminalStatus !== 'completed_verified' || !mission.completedAt || !mission.repoPath || !mission.worktreePath || !mission.branch || !mission.baseCommit) return null
  if (!actions.length || actions.some(action => action.missionId !== mission.missionId) || !validators.some(validator => validator.passed && validator.exitCode === 0)) return null
  if (validators.some(validator => !validator.passed) || artifacts.some(artifact => !artifact.secretScanPassed || !artifact.hiddenCotScanPassed) || !input.auditValid || !mission.auditEventIds.length) return null
  if (input.commanderResolved && (!actions.some(action => action.resultStatus === 'passed') || validators.length === 0)) return null
  const provenanceRefs = [...mission.auditEventIds.map(id => `audit:${id}`), ...artifacts.map(artifact => `artifact:${artifact.artifactId}:${artifact.contentHash}`), `repo:${mission.baseCommit}`, `mission:${mission.missionId}`]
  const evidenceId = `real_ev_${sha256({ mission: mission.missionId, validators: validators.map(v => v.contentHash), provenanceRefs }).slice(0, 24)}`
  const evidence = { id: evidenceId, projectId: mission.projectId, userId: null, kind: 'code_operator_result' as const, subjectRef: `engineering-mission:${mission.missionId}`, outcome: 'pass' as const, observedAt: mission.completedAt, validUntil: null, provenanceRefs, verifierId: 'wave4.2-objective-validator', evaluatorId: 'wave4.2-admission-evaluator', poisoned: false, metadata: { missionId: mission.missionId, actionIds: mission.actionIds, validatorIds: mission.validatorIds, artifactIds: mission.artifactIds, capabilityTags: mission.capabilityTags, curriculumTags: mission.curriculumTags, sourceTaskLineageId: mission.sourceTaskLineageId, patchLineageId: mission.patchLineageId } }
  const candidate = { recordType: 'code_operator_evidence' as const, recordId: evidenceId, projectId: mission.projectId, userId: null, verificationState: 'verified' as const, observedAt: mission.completedAt, validUntil: null, provenanceRefs, evidenceIds: [validators[0].validatorId, evidenceId], poisoned: false, commanderCorrectionApplied: true }
  const datasetRecord = { recordId: evidenceId, recordType: 'code_operator_evidence' as const, content: `Objective: ${mission.objective}\nResult: completed_verified\nValidators: ${validators.map(v => v.validatorType).sort().join(', ')}\nArtifacts: ${artifacts.map(a => a.contentHash).sort().join(', ')}`, verificationState: 'verified' as const, wave3Eligible: true, observedAt: mission.completedAt, validUntil: null, provenanceRefs, sourceLineageIds: [mission.sourceTaskLineageId, mission.patchLineageId], evidenceIds: candidate.evidenceIds, poisoned: false, containsHiddenCot: false, containsSecret: false, commanderCorrection: null, curriculumTags: mission.curriculumTags, capabilityTags: mission.capabilityTags }
  return { mission, evidence, candidate, datasetRecord }
}

export function buildRealDatasetManifest(records: MaterializedRealEvidence[], lineage: { parentCheckpointHash: string; tokenizerHash: string }, now = new Date(), splitSeed = 4202): RealDatasetManifest {
  if (records.length < 3) throw new Error('at least three genuine task lineages are required')
  const seen = new Set<string>(); const collisions: string[] = []
  for (const record of records) for (const id of record.datasetRecord.sourceLineageIds) { if (seen.has(id)) collisions.push(id); seen.add(id) }
  const ordered = [...records].sort((a, b) => sha256(`${splitSeed}:${a.mission.sourceTaskLineageId}`).localeCompare(sha256(`${splitSeed}:${b.mission.sourceTaskLineageId}`)))
  const test = ordered.at(-1)!; const validation = ordered.at(-2)!; const train = ordered.slice(0, -2)
  const payload = { version: 'wave4.2-v1', evidence: ordered.map(r => ({ id: r.evidence.id, hash: sha256(r.datasetRecord), lineage: r.datasetRecord.sourceLineageIds })), splitSeed, trainIds: train.map(r => r.evidence.id), validationIds: [validation.evidence.id], testIds: [test.evidence.id], parentCheckpointHash: lineage.parentCheckpointHash, tokenizerHash: lineage.tokenizerHash }
  const datasetManifestHash = sha256(payload)
  return { datasetId: `w42ds_${datasetManifestHash.slice(0, 24)}`, version: 'wave4.2-v1', createdAt: now.toISOString(), sourceEvidenceIds: ordered.map(r => r.evidence.id), contentHashes: ordered.map(r => sha256(r.datasetRecord)), curriculumTags: [...new Set(ordered.flatMap(r => r.mission.curriculumTags))].sort(), capabilityTags: [...new Set(ordered.flatMap(r => r.mission.capabilityTags))].sort(), parentCheckpoint: 'WRIM-0:checkpoint-final', parentCheckpointHash: lineage.parentCheckpointHash, tokenizerId: 'WR-TOKENIZER-0', tokenizerHash: lineage.tokenizerHash, corpusLineage: ordered.map(r => r.mission.sourceTaskLineageId), splitSeed, trainIds: train.map(r => r.evidence.id), validationIds: [validation.evidence.id], testIds: [test.evidence.id], datasetManifestHash, leakageCheck: { passed: collisions.length === 0, collisions }, admissionRuleVersion: 'wave4.2-real-v1', trainingStarted: false }
}
