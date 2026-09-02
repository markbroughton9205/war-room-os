import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { containsHiddenCot } from '@/lib/real-evidence/engine'
import { aggregateCapabilities } from '@/lib/continuous-evidence/engine'
import {
  capabilityGraphFromGym, curriculumFromGymRuns, evaluateGymRun, gymRunToEvidenceInput,
  researchClaimStatusForGym, runCodeOperatorGym, runResearchGym, runTerraGym, runToolUseGym,
} from './engine'
import type { GymMissionSpec } from './types'

const EXPECTED = 30
const { check, finish } = createValidationHarness('Wave 6 deterministic validation', EXPECTED)
const repo = process.cwd()
const wave42Manifest = join(repo, 'model-lab/manifests/wave4_2/training-dataset-manifest.json')
const expectedHash = '187c850b39a8b6255ce5e1b8d0643e29863402676fa685661cc4eb3ba166624c'

const codeSpec: GymMissionSpec = {
  missionId: 'gym-code-hash', gym: 'code_operator',
  objective: 'Verify the immutable Wave 4.2 dataset manifest hash.',
  capabilityTags: ['code-navigation', 'patch-integrity'], curriculumTags: ['code_skill'],
  sourceLineageIds: ['gym:code:wave42-manifest'],
}
const code = runCodeOperatorGym(codeSpec, { filePath: wave42Manifest, expectedHash })
check('A code gym operational', () => assert.equal(code.mission.gym, 'code_operator'))
check('B code gym objective hash match', () => assert.equal(code.outcome, 'pass'))
check('C code gym captures trajectory without hidden CoT', () => {
  assert.ok(code.trajectory.length >= 2)
  assert.equal(code.hiddenCotDetected, false)
  assert.equal(containsHiddenCot(JSON.stringify(code.trajectory)), false)
})
check('A1 passing mission is evaluated and satisfied', () => {
  assert.equal(code.objectiveEvaluated, true)
  assert.equal(code.objectiveSatisfied, true)
})

const researchPass = runResearchGym({
  missionId: 'gym-research-conflict', gym: 'research_engine',
  objective: 'Extract claims and leave a source conflict unresolved.',
  capabilityTags: ['source-verification', 'claim-comparison'], curriculumTags: ['research'],
  sourceLineageIds: ['gym:research:conflict'],
}, {
  documentSummary: 'Station A reports the river crest at 04:00 UTC. Independent gauge B reports the same crest two hours later.',
  comparisonAgreement: 'conflicting',
})
check('D research gym operational', () => assert.equal(researchPass.outcome, 'pass'))
check('E conflicting sources remain unresolved rather than picking a winner', () => {
  assert.ok(researchPass.criteria.find(item => item.id === 'contradiction-policy')?.passed)
  assert.ok(researchPass.trajectory.some(step => step.resultSummary === 'contradiction_unresolved'))
})
check('A2 conflicting research is process-pass and claim not verified', () => {
  assert.equal(researchPass.outcome, 'pass')
  assert.equal(researchPass.claimStatus, 'contested')
  assert.equal(researchClaimStatusForGym('conflicting'), 'contested')
  const converted = evaluateGymRun(researchPass)
  assert.equal(converted.record, null)
  assert.ok(converted.rejection?.reasons.some(reason => reason.includes('claim_status:contested')))
})
const researchSafe = runResearchGym({
  missionId: 'gym-research-single', gym: 'research_engine',
  objective: 'Single-source notes must not invent a contradiction.',
  capabilityTags: ['source-verification'], curriculumTags: ['research'],
  sourceLineageIds: ['gym:research:single'],
}, { documentSummary: 'The archive lists a single primary document for this ordinance.', comparisonAgreement: 'single_source' })
check('F single-source research does not fabricate contradiction', () => assert.equal(researchSafe.outcome, 'pass'))
check('A2b single-source extraction does not auto-verify the claim', () => {
  assert.equal(researchSafe.claimStatus, 'candidate')
  assert.equal(evaluateGymRun(researchSafe).record, null)
})
const researchVerified = runResearchGym({
  missionId: 'gym-research-verified', gym: 'research_engine',
  objective: 'Independent verifier corroboration may mark a claim verified.',
  capabilityTags: ['source-verification'], curriculumTags: ['research'],
  sourceLineageIds: ['gym:research:verified'],
}, {
  documentSummary: 'Primary gauge A and independent gauge B both report the same crest time.',
  comparisonAgreement: 'corroborated',
  verifierConfirmed: true,
})
check('A2c genuinely verified claim requires verifier evidence', () => {
  assert.equal(researchVerified.outcome, 'pass')
  assert.equal(researchVerified.claimStatus, 'verified')
  assert.ok(evaluateGymRun(researchVerified).record)
  assert.equal(researchClaimStatusForGym('corroborated', false), 'supported')
})

const terraNow = new Date('2026-08-30T18:00:00.000Z')
const terraStale = runTerraGym({
  missionId: 'gym-terra-stale', gym: 'terra_world_state',
  objective: 'Reject a stale observation as current world state.',
  capabilityTags: ['temporal-reasoning'], curriculumTags: ['terra'],
  sourceLineageIds: ['gym:terra:stale'],
}, { validUntil: '2026-08-30T17:00:00.000Z', now: terraNow })
const terraFresh = runTerraGym({
  missionId: 'gym-terra-fresh', gym: 'terra_world_state',
  objective: 'Admit an in-window observation with prediction and location.',
  capabilityTags: ['temporal-reasoning', 'spatial-reasoning'], curriculumTags: ['terra'],
  sourceLineageIds: ['gym:terra:fresh'],
}, { validUntil: '2026-08-30T19:00:00.000Z', now: terraNow, observedAt: '2026-08-30T16:00:00.000Z', verificationAt: '2026-08-30T18:00:00.000Z' })
check('G terra gym operational', () => assert.equal(terraStale.outcome, 'pass'))
check('H stale terra is rejected as current', () => assert.ok(terraStale.criteria.find(item => item.id === 'stale-rejected')?.passed))
check('I fresh terra is admitted', () => assert.equal(terraFresh.outcome, 'pass'))
check('A3 original validUntil survives gym to canonical conversion', () => {
  const input = gymRunToEvidenceInput(terraFresh)
  assert.equal(input.validUntil, '2026-08-30T19:00:00.000Z')
  assert.equal(input.observedAt, '2026-08-30T16:00:00.000Z')
  assert.equal(input.verificationAt, '2026-08-30T18:00:00.000Z')
  assert.notEqual(input.validUntil, new Date(Date.parse(terraFresh.completedAt) + 86_400_000).toISOString())
  const admitted = evaluateGymRun(terraFresh, terraNow).record
  assert.equal(admitted?.evidence.validUntil, '2026-08-30T19:00:00.000Z')
  assert.equal(admitted?.evidence.metadata.verificationAt, '2026-08-30T18:00:00.000Z')
})
check('A3b stale observation remains stale after conversion', () => {
  const converted = evaluateGymRun(terraStale, terraNow)
  assert.ok(converted.rejection?.reasons.includes('stale'))
  assert.equal(gymRunToEvidenceInput(terraStale).validUntil, '2026-08-30T17:00:00.000Z')
})

const tool = runToolUseGym({
  missionId: 'gym-tool-sha', gym: 'tool_use',
  objective: 'Select and execute the bounded sha256 tool.',
  capabilityTags: ['tool-use'], curriculumTags: ['tools'],
  sourceLineageIds: ['gym:tool:sha256'],
}, { tool: 'sha256', argument: 'war-room-agi-gym', expectedPrefix: createHash('sha256').update('war-room-agi-gym').digest('hex') })
check('J tool-use gym operational', () => assert.equal(tool.outcome, 'pass'))
check('K uncontrolled tools are not executed', () => {
  const unsafe = runToolUseGym({
    missionId: 'gym-tool-unsafe', gym: 'tool_use', objective: 'Refuse an uncontrolled tool.',
    capabilityTags: ['tool-use'], curriculumTags: ['tools'], sourceLineageIds: ['gym:tool:unsafe'],
  }, { tool: 'curl', argument: 'https://example.invalid', expectedPrefix: 'nope' })
  assert.equal(unsafe.outcome, 'fail')
  assert.equal(unsafe.objectiveEvaluated, true)
  assert.equal(unsafe.objectiveSatisfied, false)
  assert.ok(unsafe.criteria.find(item => item.id === 'safe-tool-only' && item.passed === false))
})
check('A4 tool_use remains distinct from code_operator', () => {
  assert.equal(gymRunToEvidenceInput(code).source, 'code_operator')
  assert.equal(gymRunToEvidenceInput(researchVerified).source, 'research_engine')
  assert.equal(gymRunToEvidenceInput(terraFresh).source, 'terra')
  assert.equal(gymRunToEvidenceInput(tool).source, 'tool_use')
})

const admitted = [code, researchVerified, terraFresh, tool].map(run => evaluateGymRun(run, terraNow).record).filter((record): record is NonNullable<typeof record> => Boolean(record))
check('L gym evidence enters the canonical admission function', () => assert.equal(admitted.length, 4))
const failedGym = evaluateGymRun(runToolUseGym({
  missionId: 'gym-tool-unsafe-2', gym: 'tool_use', objective: 'Record a tool failure as curriculum signal.',
  capabilityTags: ['tool-use'], curriculumTags: ['tools'], sourceLineageIds: ['gym:tool:unsafe-2'],
}, { tool: 'curl', argument: 'x', expectedPrefix: 'nope' }))
check('M failures are preserved and are not positive capability proof', () => {
  assert.equal(failedGym.record?.evidence.outcome, 'fail')
  assert.equal(failedGym.record?.evidence.metadata.objectiveEvaluated, true)
  assert.equal(failedGym.record?.evidence.metadata.objectiveSatisfied, false)
})
check('A1b failing mission is evaluated and not satisfied', () => {
  assert.equal(failedGym.record?.source, 'tool_use')
  const metrics = aggregateCapabilities([failedGym.record!])
  assert.equal(metrics.find(item => item.capabilityKey === 'tool-use')?.successes, 0)
  assert.equal(metrics.find(item => item.capabilityKey === 'tool-use')?.failures, 1)
})
const curriculum = curriculumFromGymRuns([...admitted, failedGym.record!])
check('N failure-driven curriculum ranks tool-use', () => assert.ok(curriculum.some(item => item.capabilityKey === 'tool-use')))
check('O capability graph has no fabricated AGI percentage', () => {
  const graph = capabilityGraphFromGym(admitted)
  assert.ok(graph.every(node => !('agiPercent' in node)))
  assert.ok(graph.some(node => node.demonstrated))
})
check('A4b capability aggregation distinguishes tool-use from coding', () => {
  const mixed = aggregateCapabilities(admitted)
  const toolMetric = mixed.find(item => item.capabilityKey === 'tool-use')
  const codeMetric = mixed.find(item => item.capabilityKey === 'code-navigation')
  assert.ok(toolMetric && codeMetric)
  assert.equal(admitted.find(item => item.capabilityTags.includes('tool-use'))?.source, 'tool_use')
  assert.equal(admitted.find(item => item.capabilityTags.includes('code-navigation'))?.source, 'code_operator')
})
check('P at least three gym types passed', () => {
  const types = new Set([code.mission.gym, researchPass.mission.gym, terraFresh.mission.gym, tool.mission.gym])
  assert.ok(types.size >= 3)
})
check('Q training remains not started by gym execution', () => assert.equal('trainingStarted' in code, false))
check('A2d unresolved contradiction remains explicit', () => {
  assert.equal(researchPass.claimStatus, 'contested')
  assert.ok(researchPass.trajectory.some(step => step.resultSummary === 'contradiction_unresolved'))
})
check('A5 gym paths are labeled as deterministic fixtures not live integrations', () => {
  assert.equal(code.trajectory[0]?.action, 'read_file')
  assert.ok(researchPass.trajectory.some(step => step.arguments.method === 'deterministic_sentence_segmentation_v1'))
  assert.equal(terraFresh.terraTemporal?.sourceVersion, 'terra-gym-fixture-v1')
})
check('A3c current observation does not gain fabricated extra lifetime', () => {
  const input = gymRunToEvidenceInput(terraFresh)
  assert.equal(input.validUntil, terraFresh.terraTemporal?.validUntil)
  assert.ok(Date.parse(input.validUntil!) - Date.parse(input.observedAt!) < 86_400_000)
})
check('A3d prediction and verification timestamps remain distinct', () => {
  const input = gymRunToEvidenceInput(terraFresh)
  assert.equal(input.predictionRef, terraFresh.terraTemporal?.predictionRef)
  assert.equal(input.observationRef, terraFresh.terraTemporal?.observationRef)
  assert.notEqual(input.observedAt, input.verificationAt)
})

finish()
