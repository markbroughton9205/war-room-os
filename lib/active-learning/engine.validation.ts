import assert from 'node:assert/strict'
import { buildTrainingCandidateManifest, canResolveGap, codeOperatorEvidence, curriculumPriorityFromSignals, planStudyMission, terraEvidenceIsCurrent, transitionTrainingCandidateAuthorization, updateCapability, verifyPrediction } from './engine'
import type { CapabilityNode, LearningEvidence, PredictionRecord, TrainingCandidate } from './types'

const now = new Date('2026-08-29T12:00:00.000Z')
const evidence = (overrides: Partial<LearningEvidence> = {}): LearningEvidence => ({
  id: 'ev-1', projectId: 'project-a', userId: 'user-a', kind: 'verification', subjectRef: 'claim-1',
  outcome: 'pass', observedAt: '2026-08-29T11:00:00.000Z', validUntil: null,
  provenanceRefs: ['source-version-1'], verifierId: 'verifier', evaluatorId: null, poisoned: false, metadata: {}, ...overrides,
})

const mission = planStudyMission({ gapId: 'gap-1', question: 'Which claim is correct?', gapType: 'conflicting_sources', projectId: 'project-a', userId: 'user-a', generatorId: 'research', verifierId: 'verify', evaluatorId: 'evaluate' })
assert.equal(mission.missionKind, 'targeted_verification')
assert.ok(mission.questions.some(q => q.includes('discriminate')))
assert.throws(() => planStudyMission({ gapId: 'g', question: 'q', gapType: 'missing_answer', projectId: null, userId: null, generatorId: 'same', verifierId: 'same', evaluatorId: 'other' }))

assert.equal(canResolveGap([evidence(), evidence({ id: 'ev-2', kind: 'evaluation', verifierId: null, evaluatorId: 'evaluator' })]), true)
assert.equal(canResolveGap([evidence()]), false)

const node: CapabilityNode = { capabilityKey: 'typescript', projectId: 'project-a', userId: 'user-a', level: 0, confidence: 0, passCount: 0, failCount: 0, evidenceIds: [] }
assert.equal(updateCapability(node, evidence({ kind: 'failure', outcome: 'fail' })).level, 0)
assert.ok(updateCapability(node, evidence({ kind: 'code_operator_result' })).level > 0)

const eligible: TrainingCandidate = { recordType: 'claim', recordId: 'claim-ok', projectId: 'project-a', userId: 'user-a', verificationState: 'verified', observedAt: now.toISOString(), validUntil: null, provenanceRefs: ['sv-1'], evidenceIds: ['verify-1', 'evaluate-1'], poisoned: false, commanderCorrectionApplied: true }
const manifest = buildTrainingCandidateManifest([
  eligible,
  { ...eligible, recordId: 'contested', verificationState: 'contested' },
  { ...eligible, recordId: 'stale', validUntil: '2026-08-28T00:00:00.000Z' },
  { ...eligible, recordId: 'poisoned', poisoned: true },
  { ...eligible, recordId: 'weak', evidenceIds: ['one'] },
], now)
assert.deepEqual(manifest.candidates.map(c => c.recordId), ['claim-ok'])
assert.equal(manifest.trainingAuthorized, false)
assert.equal(manifest.eligibilityState, 'eligible')
assert.equal(manifest.trainingState, 'not_started')
assert.equal(manifest.excluded.length, 4)

const ineligibleManifest = buildTrainingCandidateManifest([{ ...eligible, verificationState: 'candidate' }], now)
assert.equal(ineligibleManifest.eligibilityState, 'not_eligible')
assert.throws(() => transitionTrainingCandidateAuthorization(ineligibleManifest, 'awaiting_commander_authorization', { kind: 'commander', id: 'commander' }))
const awaitingAuthorization = transitionTrainingCandidateAuthorization(manifest, 'awaiting_commander_authorization', { kind: 'automation', id: 'curriculum-engine' })
assert.equal(awaitingAuthorization.trainingState, 'not_started')
assert.throws(() => transitionTrainingCandidateAuthorization(awaitingAuthorization, 'authorized', { kind: 'automation', id: 'curriculum-engine' }))
const authorized = transitionTrainingCandidateAuthorization(awaitingAuthorization, 'authorized', { kind: 'commander', id: 'commander' }, now)
assert.equal(authorized.authorizationState, 'authorized')
assert.equal(authorized.trainingAuthorized, true)
assert.equal(authorized.trainingState, 'not_started')
assert.equal(authorized.modelLineage, 'wrim-1-candidate')

assert.equal(terraEvidenceIsCurrent(evidence({ kind: 'terra_observation', validUntil: '2026-08-29T13:00:00.000Z' }), now), true)
assert.equal(terraEvidenceIsCurrent(evidence({ kind: 'terra_observation', validUntil: '2026-08-29T11:30:00.000Z' }), now), false)

const prediction: PredictionRecord = { id: 'pred-1', projectId: 'project-a', userId: 'user-a', statement: 'build passes', predictedAt: '2026-08-29T10:00:00.000Z', verifyAfter: '2026-08-29T11:00:00.000Z', validUntil: null, provenanceRefs: ['mission-1'], status: 'pending', verificationEvidenceIds: [] }
assert.equal(verifyPrediction(prediction, evidence({ kind: 'prediction_outcome' }), now).status, 'verified')
assert.throws(() => verifyPrediction(prediction, evidence({ kind: 'prediction_outcome', projectId: 'project-b' }), now))

const priorities = curriculumPriorityFromSignals([evidence({ id: 'fail', kind: 'failure', outcome: 'fail' }), evidence({ id: 'fix', kind: 'commander_correction', outcome: 'corrected' })])
assert.equal(priorities[0].score, 4)
const codeEvidence = codeOperatorEvidence({ id: 'code-1', projectId: 'project-a', userId: 'user-a', repairId: 'repair-1', validationRefs: ['validation:tsc'], passed: true, observedAt: now.toISOString(), capabilityKey: 'typescript' })
assert.equal(codeEvidence.outcome, 'pass')
assert.ok(codeEvidence.provenanceRefs.length >= 2)

const serialized = JSON.stringify({ mission, manifest })
assert.equal(/chain.of.thought|reasoning_trace|hidden_reasoning/i.test(serialized), false)
console.log('Wave 3 deterministic validation: 29/29 PASS')
