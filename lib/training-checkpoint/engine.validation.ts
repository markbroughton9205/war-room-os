import assert from 'node:assert/strict'
import { buildDatasetManifest, buildEvalManifest, contentHash, estimateM1TrainingPlan, evaluateRegressionGates, registerCheckpointCandidate } from './engine'
import { tokenizerArtifactNamespaceHash } from '@/lib/sovereign-model-lab/runtime'
import { SOVEREIGN_MODEL_LAB_RECOVERY_TRANSITIONS } from '@/lib/sovereign-model-lab/types'
import type { Wave4DatasetRecord } from './types'

const now = new Date('2026-08-30T12:00:00.000Z')
const base = (overrides: Partial<Wave4DatasetRecord> = {}): Wave4DatasetRecord => ({
  recordId: 'record-1', recordType: 'experience', content: 'Verified observable outcome.',
  verificationState: 'verified', wave3Eligible: true, observedAt: '2026-08-30T10:00:00.000Z', validUntil: null,
  provenanceRefs: ['source-version:1'], sourceLineageIds: ['source-family:1'], evidenceIds: ['verify:1', 'eval:1'],
  poisoned: false, containsHiddenCot: false, containsSecret: false, commanderCorrection: null,
  curriculumTags: ['research'], capabilityTags: ['source-evaluation'], ...overrides,
})

const manifest = buildDatasetManifest([base()], ['wave3-manifest-1'], now)
assert.equal(manifest.records.length, 1)
assert.equal(manifest.trainingStarted, false)
assert.equal(manifest.immutable, true)
assert.match(manifest.datasetHash, /^[a-f0-9]{64}$/)
assert.equal(buildDatasetManifest([base()], ['wave3-manifest-1'], now).datasetHash, manifest.datasetHash)
assert.equal(buildDatasetManifest([base()], ['wave3-manifest-1'], new Date(now.getTime() + 1000)).datasetHash, manifest.datasetHash)
assert.equal(buildDatasetManifest([base({ content: '  VERIFIED   observable outcome. ' })], ['wave3-manifest-1'], now).records[0]?.contentHash, manifest.records[0]?.contentHash)

const exclusions = buildDatasetManifest([
  base({ recordId: 'not-wave3', wave3Eligible: false }),
  base({ recordId: 'no-prov', provenanceRefs: [] }),
  base({ recordId: 'poor-prov', provenanceRefs: ['unknown:import'] }),
  base({ recordId: 'hidden', containsHiddenCot: true }),
  base({ recordId: 'secret', containsSecret: true }),
  base({ recordId: 'stale', validUntil: '2026-08-29T00:00:00.000Z' }),
  base({ recordId: 'retracted', verificationState: 'retracted' }),
  base({ recordId: 'contested', verificationState: 'contested' }),
  base({ recordId: 'poison', poisoned: true }),
  base({ recordId: 'correction', recordType: 'correction', commanderCorrection: { correctionId: 'c1', applied: false, correctedBy: 'commander', correctedAt: now.toISOString(), supersedesRecordId: 'old' } }),
], ['wave3-manifest-1'], now)
assert.equal(exclusions.records.length, 0)
for (const reason of ['wave3_not_eligible','missing_provenance','provenance_poor','hidden_cot','secret_detected','stale','retracted','contested','poisoned','correction_not_applied']) {
  assert.ok(exclusions.exclusions.some(item => item.reasons.includes(reason as never)), reason)
}

const dedup = buildDatasetManifest([base(), base({ recordId: 'record-2', content: ' verified observable   OUTCOME. ' })], ['w3'], now)
assert.equal(dedup.records.length, 1)
assert.ok(dedup.exclusions.some(item => item.reasons.includes('duplicate_content')))

let leakageDetected = false
for (let i = 0; i < 1000 && !leakageDetected; i += 1) {
  const candidate = buildDatasetManifest([base({ sourceLineageIds: ['shared'] }), base({ recordId: `bridge-${i}`, content: `distinct-${i}`, sourceLineageIds: ['shared', `other-${i}`] })], ['w3'], now)
  leakageDetected = candidate.exclusions.some(item => item.reasons.includes('source_lineage_leakage'))
}
assert.equal(leakageDetected, true)
assert.deepEqual(manifest.records[0]?.curriculumTags, ['research'])
assert.deepEqual(manifest.records[0]?.capabilityTags, ['source-evaluation'])

const correction = buildDatasetManifest([base({ recordId: 'corrected', recordType: 'correction', commanderCorrection: { correctionId: 'fix-1', applied: true, correctedBy: 'commander-1', correctedAt: now.toISOString(), supersedesRecordId: 'bad-1' } })], ['w3'], now)
assert.equal(correction.records[0]?.commanderCorrection?.supersedesRecordId, 'bad-1')

const parentHash = contentHash('wrim0-checkpoint-final')
const checkpoint = registerCheckpointCandidate({ parentCheckpointId: 'WRIM-0:checkpoint-final', parentCheckpointHash: parentHash, datasetManifestId: manifest.manifestId, datasetHash: manifest.datasetHash, tokenizerArtifactHash: contentHash('tokenizer') }, now)
assert.equal(checkpoint.rollbackCheckpointId, checkpoint.parentCheckpointId)
assert.equal(checkpoint.trainingStarted, false)
assert.throws(() => registerCheckpointCandidate({ ...checkpoint, parentCheckpointId: 'imported:gpt', parentCheckpointHash: parentHash } as never, now))

const passingEval = buildEvalManifest(checkpoint.checkpointCandidateId, ['benchmark:held-out-v1'], [{ capabilityKey: 'research', baselineScore: 0.7, candidateScore: 0.72, minimumScore: 0.65, maximumRegression: 0.02 }])
assert.equal(evaluateRegressionGates(passingEval).recommendation, 'recommend')
assert.equal(evaluateRegressionGates(passingEval).promotionExecuted, false)
const failingEval = buildEvalManifest(checkpoint.checkpointCandidateId, ['benchmark:held-out-v1'], [{ capabilityKey: 'coding', baselineScore: 0.8, candidateScore: 0.7, minimumScore: 0.72, maximumRegression: 0.03 }])
assert.equal(evaluateRegressionGates(failingEval).recommendation, 'reject')
assert.equal(evaluateRegressionGates(failingEval).commanderAuthorization, 'not_requested')

const estimate = estimateM1TrainingPlan({ chip: 'Apple M1', unifiedMemoryBytes: 16 * 1024 ** 3, availableMemoryBytes: 10 * 1024 ** 3, freeDiskBytes: 100 * 1024 ** 3, parameterCount: 19_000_000, datasetTokens: 1_000_000, epochs: 3, sequenceLength: 512, effectiveBatchSize: 8 })
assert.ok(estimate.estimatedSteps > 0 && estimate.peakMemoryBytes.high > estimate.peakMemoryBytes.low)
assert.equal(estimate.confidence, 'low')
assert.equal(estimate.trainingStarted, false)
assert.ok(estimate.estimatedWallClockHours && estimate.estimatedWallClockHours.high >= estimate.estimatedWallClockHours.low)

const ns1 = tokenizerArtifactNamespaceHash({ corpusRecordChecksum: 'abc', algorithm: 'bpe', requestedVocabSize: 16384, recommendedVocabSize: 15126, minimumFrequency: 2, seed: 42 })
const ns2 = tokenizerArtifactNamespaceHash({ corpusRecordChecksum: 'abc', algorithm: 'bpe', requestedVocabSize: 32768, recommendedVocabSize: 15126, minimumFrequency: 2, seed: 42 })
assert.notEqual(ns1, ns2)
assert.deepEqual(SOVEREIGN_MODEL_LAB_RECOVERY_TRANSITIONS.tokenizer_ready, ['tokenizer_plan_ready', 'tokenizer_not_planned'])
assert.equal(SOVEREIGN_MODEL_LAB_RECOVERY_TRANSITIONS.awaiting_commander_training_approval, undefined)

console.log('Wave 4 deterministic validation: 29/29 PASS')
