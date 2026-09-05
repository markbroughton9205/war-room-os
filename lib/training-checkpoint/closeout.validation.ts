import assert from 'node:assert/strict'
import { buildDatasetManifest } from './engine'
import { buildHeldOutReadinessManifest, decideRealAdmission } from './closeout'

const empty = buildDatasetManifest([], [], new Date('2026-08-30T16:00:00Z'))
const evidence = { totalEvents: 1_742, totalRepairs: 305, commanderResolvedRepairs: 14, hashChainBreaks: 79, wave3CandidateManifestCount: 0, wave3LearningEvidenceCount: 0 }
const decision = decideRealAdmission(empty, evidence)
assert.equal(decision.admissible, false)
assert.equal(decision.readiness, 'NOT_READY')
assert.equal(decision.eligibleRecordCount, 0)
assert.equal(decision.rejectedRecordCount, 305)
for (const blocker of ['no_wave4_eligible_records', 'empty_train_split', 'empty_validation_split', 'empty_test_split', 'no_persisted_wave3_candidate_manifest', 'no_persisted_wave3_learning_evidence', 'code_operator_audit_hash_chain_discontinuous']) assert.ok(decision.blockers.includes(blocker), blocker)

const probe = { id: 'json-structure-001', capabilityKey: 'structured_output', prompt: '{"name":', objectiveChecks: ['valid_json'], baselineEvidenceRef: 'model-lab/manifests/wrim0_eval_results.json#json_01', baselineObserved: { validJson: false }, candidateStatus: 'not_run' as const }
const manifest = buildHeldOutReadinessManifest({ parentCheckpointHash: 'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015', probes: [probe], excludedProbeIds: [{ id: 'completion_01', reason: 'training_corpus_overlap' }] })
assert.match(manifest.contentHash, /^[a-f0-9]{64}$/)
assert.equal(manifest.candidateScores, null)
assert.equal(manifest.recommendation, 'not_evaluable')
assert.equal(manifest.commanderAuthorization, 'not_requested')
assert.equal(manifest.promotionExecuted, false)
assert.deepEqual(buildHeldOutReadinessManifest({ parentCheckpointHash: manifest.parentCheckpointHash, probes: [probe], excludedProbeIds: manifest.excludedProbeIds }), manifest)
assert.throws(() => buildHeldOutReadinessManifest({ parentCheckpointHash: 'bad', probes: [probe], excludedProbeIds: [] }))
assert.throws(() => buildHeldOutReadinessManifest({ parentCheckpointHash: manifest.parentCheckpointHash, probes: [], excludedProbeIds: [] }))

console.log('Wave 4 closeout deterministic validation: 20/20 PASS')
