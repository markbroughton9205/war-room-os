import assert from 'node:assert/strict'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { containsHiddenCot } from '@/lib/real-evidence/engine'
import { aggregateCapabilities, buildIncrementalDatasetManifest, deduplicateEvidence, evaluateContinuousEvidence, prioritizeCurriculum } from './engine'
import type { ContinuousEvidenceInput, PriorDatasetRoot } from './types'

const EXPECTED = 34
const { check, finish } = createValidationHarness('Wave 5 deterministic validation', EXPECTED)
const now = new Date('2026-08-30T15:00:00.000Z')
const valid = (key: string, overrides: Partial<ContinuousEvidenceInput> = {}) => evaluateContinuousEvidence({
  source: 'code_operator', subjectRef: `mission:${key}`, outcome: 'pass', observedAt: '2026-08-30T14:00:00.000Z', validUntil: null,
  provenanceRefs: [`audit:${key}`, `artifact:${key}`], sourceLineageIds: [`task:${key}`], capabilityTags: [key], curriculumTags: ['wave5'],
  validatorTypes: ['test'], verifierId: 'validator', evaluatorId: 'evaluator', objectiveVerified: true, ...overrides,
}, now)
const records = ['one', 'two', 'three'].map(key => valid(key).record!)

check('A eligible objective evidence admitted', () => assert.ok(records[0]))
check('B unsupported research excluded', () => assert.deepEqual(valid('research-unsupported', { source: 'research_engine', claimStatus: 'candidate' }).rejection?.reasons, ['claim_status:candidate']))
check('B2 verified research admitted', () => assert.ok(valid('research-verified', { source: 'research_engine', claimStatus: 'verified' }).record))
check('C contested world claim excluded', () => assert.ok(valid('world-contested', { source: 'world_learning', claimStatus: 'contested' }).rejection?.reasons.includes('claim_status:contested')))
check('C2 verified world claim admitted', () => assert.ok(valid('world-verified', { source: 'world_learning', claimStatus: 'verified' }).record))
check('D provenance-poor evidence excluded', () => assert.ok(valid('poor', { provenanceRefs: [] }).rejection?.reasons.includes('missing_provenance')))
check('E secrets excluded', () => assert.ok(valid('secret', { containsSecret: true }).rejection?.reasons.includes('secret_detected')))
check('F hidden reasoning excluded', () => assert.ok(valid('cot', { containsHiddenCot: true }).rejection?.reasons.includes('hidden_cot_detected')))
check('F2 validator log discussing the filter is not a hidden-CoT dump', () => {
  assert.equal(containsHiddenCot('PASS F hidden reasoning excluded\nWave 5 deterministic validation: 25/25 PASS'), false)
})
check('F3 labeled hidden_reasoning dump is rejected by the detector', () => {
  assert.equal(containsHiddenCot('hidden_reasoning: step 1 consider the private plan'), true)
})
check('F4 think-tag dump is rejected by the detector', () => {
  assert.equal(containsHiddenCot('<think>private scratch</think>'), true)
})
check('G Terra requires temporal bound', () => assert.ok(valid('terra', { source: 'terra', predictionRef: 'p', observationRef: 'o', location: { latitude: 1, longitude: 2 } }).rejection?.reasons.includes('terra_missing_valid_until')))
check('H verified Terra admitted', () => assert.ok(valid('terra-ok', { source: 'terra', validUntil: '2026-08-31T15:00:00.000Z', predictionRef: 'p', observationRef: 'o', location: { latitude: 1, longitude: 2 } }).record))
check('I stale Terra excluded', () => assert.ok(valid('terra-stale', { source: 'terra', validUntil: '2026-08-29T15:00:00.000Z', predictionRef: 'p', observationRef: 'o', location: { latitude: 1, longitude: 2 } }).rejection?.reasons.includes('stale')))

const retryDedup = deduplicateEvidence([...records, valid('retry', { retryOfEvidenceId: records[0].evidence.id, sourceLineageIds: records[0].sourceLineageIds }).record!])
check('J retry lineage suppressed', () => assert.equal(retryDedup.records.length, 3))
check('J2 retry suppression records a rejection', () => assert.ok(retryDedup.rejected.some(item => item.reasons.includes('duplicate_retry_lineage'))))

const metrics = aggregateCapabilities([...records, valid('one-fail', { outcome: 'fail', sourceLineageIds: ['task:one-fail'], capabilityTags: ['one'] }).record!])
check('K capability successes aggregate', () => assert.equal(metrics.find(item => item.capabilityKey === 'one')?.successes, 1))
check('L capability failures preserved', () => assert.equal(metrics.find(item => item.capabilityKey === 'one')?.failures, 1))
check('M single success remains isolated', () => assert.equal(metrics.find(item => item.capabilityKey === 'two')?.strength, 'isolated'))
check('M2 one success is not treated as general capability', () => {
  const isolated = metrics.find(item => item.capabilityKey === 'two')
  assert.ok(isolated)
  assert.ok((isolated.confidence ?? 1) < 0.5)
  assert.equal(isolated.evidenceDensity, 1)
})
check('N evidence quality is numeric', () => assert.ok((metrics[0]?.averageEvidenceQuality ?? 0) > 0))

const priorities = prioritizeCurriculum(metrics, [{ id: 's1', kind: 'regression', capabilityKey: 'one', severity: 8, observedAt: now.toISOString(), sourceRef: 'regression:1' }])
check('O regression drives curriculum', () => assert.equal(priorities[0].capabilityKey, 'one'))
check('P curriculum produces bounded verifier', () => assert.equal(priorities[0].nextMission.requiredValidator, 'deterministic_objective_validator'))
check('P2 repeated high-confidence capability does not mint a chore', () => {
  const strong = ['a', 'b', 'c', 'd', 'e'].map(key => valid(`strong-${key}`, { capabilityTags: ['strong-cap'], sourceLineageIds: [`task:strong-${key}`] }).record!)
  const chores = prioritizeCurriculum(aggregateCapabilities(strong), [])
  assert.equal(chores.some(item => item.capabilityKey === 'strong-cap'), false)
})

const prior: PriorDatasetRoot = {
  datasetId: 'w42', manifestHash: 'a'.repeat(64),
  sourceEvidenceIds: ['old-train', 'old-val', 'old-test'],
  trainIds: ['old-train'], validationIds: ['old-val'], testIds: ['old-test'],
  evidenceLineages: { 'old-train': ['task:old-train'], 'old-val': ['task:held'], 'old-test': ['task:test'] },
}
const priorSnapshot = JSON.stringify(prior)
Object.freeze(prior.trainIds)
Object.freeze(prior.validationIds)
Object.freeze(prior.testIds)
Object.freeze(prior.sourceEvidenceIds)
const manifest = buildIncrementalDatasetManifest({ version: 'wave5-v1', prior, priorRecords: [], additions: records, lineage: { parentCheckpointHash: 'b'.repeat(64), tokenizerHash: 'c'.repeat(64) }, now })
check('Q predecessor referenced', () => assert.equal(manifest.predecessor.datasetId, 'w42'))
check('R old split ids retained', () => assert.ok(manifest.validationIds.includes('old-val') && manifest.testIds.includes('old-test')))
check('S additions recorded', () => assert.equal(manifest.addedEvidenceIds.length, 3))
check('T predecessor input is not mutated', () => {
  assert.equal(JSON.stringify(prior), priorSnapshot)
  assert.equal(prior.trainIds.includes(records[0].evidence.id), false)
  const mutatedReturn = [...manifest.trainIds, 'injected']
  assert.equal(prior.trainIds.includes('injected'), false)
  assert.ok(!mutatedReturn.every(id => prior.trainIds.includes(id)))
})
check('U content hash is stable for identical inputs', () => {
  const rebuilt = buildIncrementalDatasetManifest({ version: 'wave5-v1', prior, priorRecords: [], additions: records, lineage: { parentCheckpointHash: 'b'.repeat(64), tokenizerHash: 'c'.repeat(64) }, now })
  assert.match(manifest.contentHash, /^[a-f0-9]{64}$/)
  assert.equal(rebuilt.contentHash, manifest.contentHash)
  assert.equal(rebuilt.datasetId, manifest.datasetId)
})
check('V training remains not started', () => assert.equal(manifest.trainingStarted, false))

const collision = valid('collision', { sourceLineageIds: ['task:held'] }).record!
const leaky = buildIncrementalDatasetManifest({ version: 'wave5-v2', prior, priorRecords: [], additions: [collision], lineage: { parentCheckpointHash: 'b'.repeat(64), tokenizerHash: 'c'.repeat(64) }, now })
check('W cross-generation held-out collision fails proof', () => assert.equal(leaky.heldOutIsolationProof.passed, false))
check('X colliding addition not admitted', () => assert.equal(leaky.addedEvidenceIds.length, 0))
check('Y rejection reason persisted', () => assert.ok(leaky.rejectedEvidence.some(item => item.reasons.includes('cross_generation_heldout_lineage_collision'))))
check('Z later generation cannot rewrite the predecessor snapshot', () => {
  const firstJson = JSON.stringify(manifest)
  const next = buildIncrementalDatasetManifest({
    version: 'wave5-v2',
    prior: {
      datasetId: manifest.datasetId, manifestHash: manifest.contentHash,
      sourceEvidenceIds: manifest.sourceEvidenceIds, trainIds: manifest.trainIds,
      validationIds: manifest.validationIds, testIds: manifest.testIds, evidenceLineages: manifest.lineageGroups,
    },
    priorRecords: records, additions: [valid('later', { sourceLineageIds: ['task:later'] }).record!],
    lineage: { parentCheckpointHash: 'b'.repeat(64), tokenizerHash: 'c'.repeat(64) }, now,
  })
  assert.equal(JSON.stringify(manifest), firstJson)
  assert.equal(next.predecessor.datasetId, manifest.datasetId)
  assert.equal(next.predecessor.manifestHash, manifest.contentHash)
  assert.notEqual(next.contentHash, manifest.contentHash)
})

finish()
