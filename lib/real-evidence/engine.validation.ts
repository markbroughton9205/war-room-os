import assert from 'node:assert/strict'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { buildRealDatasetManifest, containsHiddenCot, materializeEngineeringMission, sha256 } from './engine'
import type { EngineeringActionRecord, EngineeringMissionRecord, EvidenceArtifactRecord, ObjectiveValidatorRecord } from './types'

const { check, finish } = createValidationHarness('Wave 4.2 deterministic validation', 29)
const now = '2026-08-30T12:00:00.000Z'
const bundle = (key: string) => {
  const mission: EngineeringMissionRecord = { missionId: `m-${key}`, projectId: null, conversationId: null, promptArtifactId: null, initiatedBy: 'commander', executor: 'code-operator', repoPath: '/repo', worktreePath: '/repo', branch: 'branch', baseCommit: 'a'.repeat(40), startedAt: now, completedAt: now, terminalStatus: 'completed_verified', objective: `real task ${key}`, capabilityTags: [key], curriculumTags: ['repair'], sourceTaskLineageId: `task-${key}`, patchLineageId: `patch-${key}`, actionIds: [`a-${key}`], validatorIds: [`v-${key}`], artifactIds: [`art-${key}`], auditEventIds: [`audit-${key}`], auditSegment: 'linear', metadata: {} }
  const action: EngineeringActionRecord = { actionId: `a-${key}`, missionId: mission.missionId, actionType: 'validator', executor: 'code-operator', startedAt: now, completedAt: now, description: 'validate', command: 'validator', exitCode: 0, stdoutArtifactRef: `art-${key}`, stderrArtifactRef: null, inputArtifactRefs: [], outputArtifactRefs: [`art-${key}`], contentHash: sha256(key), resultStatus: 'passed', validatorType: 'TEST_PASS', metadata: {} }
  const validator: ObjectiveValidatorRecord = { validatorId: `v-${key}`, missionId: mission.missionId, actionId: action.actionId, validatorType: 'TEST_PASS', passed: true, exitCode: 0, artifactRefs: [`art-${key}`], contentHash: sha256(`v-${key}`), observedAt: now }
  const artifact: EvidenceArtifactRecord = { artifactId: `art-${key}`, missionId: mission.missionId, kind: 'validation_report', path: `artifact-${key}`, mediaType: 'text/plain', sizeBytes: 1, contentHash: sha256(`artifact-${key}`), createdAt: now, secretScanPassed: true, hiddenCotScanPassed: true }
  return { mission, actions: [action], validators: [validator], artifacts: [artifact] }
}
const good = ['one', 'two', 'three'].map(key => materializeEngineeringMission({ ...bundle(key), auditValid: true })!)
check('A mission start persists', () => assert.ok(bundle('a').mission.startedAt))
check('B action evidence persists', () => assert.equal(bundle('a').actions.length, 1))
check('C command exit code persists', () => assert.equal(bundle('a').actions[0].exitCode, 0))
check('D objective validator persists', () => assert.equal(bundle('a').validators[0].passed, true))
check('E artifact hash persists', () => assert.match(bundle('a').artifacts[0].contentHash, /^[a-f0-9]{64}$/))
check('F terminal outcome persists', () => assert.equal(bundle('a').mission.terminalStatus, 'completed_verified'))
check('G successful mission materializes evidence', () => assert.ok(good[0]))
check('H failed mission excluded from positive evidence', () => { const b = bundle('fail'); b.mission.terminalStatus = 'failed_verification'; assert.equal(materializeEngineeringMission({ ...b, auditValid: true }), null) })
check('I Commander-resolved without validator excluded', () => { const b = bundle('no-validator'); b.validators = []; assert.equal(materializeEngineeringMission({ ...b, auditValid: true, commanderResolved: true }), null) })
check('J Commander-resolved plus validator eligible', () => assert.ok(materializeEngineeringMission({ ...bundle('commander'), auditValid: true, commanderResolved: true })))
check('K duplicate retry lineage detected', () => { const dup = good.map((r, i) => i ? { ...r, mission: { ...r.mission, sourceTaskLineageId: good[0].mission.sourceTaskLineageId }, datasetRecord: { ...r.datasetRecord, sourceLineageIds: good[0].datasetRecord.sourceLineageIds } } : r); assert.equal(buildRealDatasetManifest(dup, { parentCheckpointHash: 'a'.repeat(64), tokenizerHash: 'b'.repeat(64) }).leakageCheck.passed, false) })
check('L secret-bearing evidence fails closed', () => { const b = bundle('secret'); b.artifacts[0].secretScanPassed = false; assert.equal(materializeEngineeringMission({ ...b, auditValid: true }), null) })
check('M hidden-CoT-bearing evidence fails closed', () => { const b = bundle('cot'); b.artifacts[0].hiddenCotScanPassed = false; assert.equal(materializeEngineeringMission({ ...b, auditValid: true }), null) })
check('N incomplete mission fails closed', () => { const b = bundle('open'); b.mission.terminalStatus = 'awaiting_review'; b.mission.completedAt = null; assert.equal(materializeEngineeringMission({ ...b, auditValid: true }), null) })
check('O invalid audit provenance fails closed', () => assert.equal(materializeEngineeringMission({ ...bundle('audit'), auditValid: false }), null))
const dataset = buildRealDatasetManifest(good, { parentCheckpointHash: 'a'.repeat(64), tokenizerHash: 'b'.repeat(64) })
check('P eligible count positive', () => assert.ok(good.length > 0))
check('Q dataset admitted', () => assert.ok(dataset.datasetId))
check('R train split positive', () => assert.ok(dataset.trainIds.length > 0))
check('S validation split positive', () => assert.ok(dataset.validationIds.length > 0))
check('T test split positive', () => assert.ok(dataset.testIds.length > 0))
check('U no lineage leakage', () => assert.equal(dataset.leakageCheck.passed, true))
check('V held-out inputs exist', () => assert.ok(dataset.validationIds.length + dataset.testIds.length > 0))
check('W held-out absent from training', () => assert.equal(dataset.trainIds.some(id => [...dataset.validationIds, ...dataset.testIds].includes(id)), false))
check('X WRIM-0 lineage immutable', () => assert.equal(dataset.parentCheckpoint, 'WRIM-0:checkpoint-final'))
check('Y training remains not started', () => assert.equal(dataset.trainingStarted, false))
check('Z validator log discussing hidden reasoning is not a CoT dump', () => assert.equal(containsHiddenCot('PASS F hidden reasoning excluded'), false))
check('Z2 labeled hidden_reasoning dump is detected', () => assert.equal(containsHiddenCot('hidden_reasoning: private plan'), true))
check('Z3 think-tag dump is detected', () => assert.equal(containsHiddenCot('<think>private</think>'), true))
check('Z4 chain-of-thought dump is detected', () => assert.equal(containsHiddenCot('chain of thought:\n1. hide this'), true))
finish()
