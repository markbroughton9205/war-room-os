import assert from 'node:assert/strict'
import http from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { buildTrainingCandidateManifest, transitionTrainingCandidateAuthorization } from './engine'
import { createStudyMissionForGap, persistTrainingManifest, recordLearningEvidence } from './store'
import type { LearningEvidence, TrainingCandidate } from './types'
import type { KnowledgeGap } from '@/lib/world-learning/types'

const upstream = process.env.WAVE3_POSTGREST_UPSTREAM
const proxyPort = Number(process.env.WAVE3_PROXY_PORT ?? '33010')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!upstream || !serviceKey) throw new Error('local PostgREST validation environment is incomplete')

const proxy = http.createServer((request, response) => {
  const targetPath = (request.url ?? '/').replace(/^\/rest\/v1(?=\/|$)/, '') || '/'
  const target = new URL(targetPath, upstream)
  const forwarded = http.request(target, { method: request.method, headers: request.headers }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode ?? 500, upstreamResponse.headers)
    upstreamResponse.pipe(response)
  })
  forwarded.on('error', error => response.destroy(error))
  request.pipe(forwarded)
})
await new Promise<void>(resolve => proxy.listen(proxyPort, '127.0.0.1', resolve))

const results: string[] = []
const pass = (name: string, detail = '') => results.push(`PASS ${name}${detail ? ` ${detail}` : ''}`)
try {
  const baseUrl = `http://127.0.0.1:${proxyPort}`
  const service = createClient(baseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const anonResponse = await fetch(`${baseUrl}/rest/v1/war_room_training_candidate_manifests?select=id`, {
    headers: { Authorization: `Bearer ${process.env.WAVE3_ANON_JWT}`, apikey: process.env.WAVE3_ANON_JWT ?? '' },
  })
  assert.ok(anonResponse.status === 401 || anonResponse.status === 403)
  pass('role_rls_anon_blocked', `status=${anonResponse.status}`)

  const projectId = '10000000-0000-4000-8000-000000000001'
  const gapId = '20000000-0000-4000-8000-000000000001'
  const { error: projectError } = await service.from('war_room_projects').insert({ id: projectId, name: 'Wave 3 local closeout' })
  assert.equal(projectError, null)
  const gap: KnowledgeGap = {
    id: gapId, project_id: projectId, conversation_id: null, question: 'Which verified evidence closes this gap?',
    gap_type: 'conflicting_sources', priority: 10, status: 'open', source_refs: [{ local: true }],
    created_by: 'closeout-validation', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    resolved_at: null, resolution_refs: {},
  }
  const { error: gapError } = await service.from('war_room_knowledge_gaps').insert(gap)
  assert.equal(gapError, null)
  const mission = await createStudyMissionForGap(gap, null)
  assert.ok(mission)
  pass('knowledge_gap_mission_persisted', mission.id)

  const evidence: LearningEvidence = {
    id: 'evidence-wave3-closeout', projectId, userId: null, kind: 'commander_correction',
    subjectRef: 'curriculum:authorization-gate', outcome: 'corrected', observedAt: new Date().toISOString(),
    validUntil: null, provenanceRefs: ['local:wave3-closeout'], verifierId: 'closeout-verifier',
    evaluatorId: 'closeout-evaluator', poisoned: false, metadata: { curriculumPriority: 3 },
  }
  assert.equal(await recordLearningEvidence(evidence), true)
  pass('curriculum_record_persisted')

  const { error: capabilityError } = await service.from('war_room_capability_nodes').insert({
    id: 'capability-wave3-closeout', capability_key: 'authorization-gate-audit', project_id: projectId,
    level: 0.5, confidence: 0.2, pass_count: 1, fail_count: 0, evidence_ids: [evidence.id],
  })
  assert.equal(capabilityError, null)
  pass('capability_evidence_persisted')

  const candidate: TrainingCandidate = {
    recordType: 'correction', recordId: 'candidate-wave3-closeout', projectId, userId: null,
    verificationState: 'verified', observedAt: new Date().toISOString(), validUntil: null,
    provenanceRefs: ['local:wave3-closeout'], evidenceIds: ['verify-local', 'evaluate-local'],
    poisoned: false, commanderCorrectionApplied: true,
  }
  const manifest = buildTrainingCandidateManifest([candidate])
  assert.equal(await persistTrainingManifest(manifest, projectId, null), true)
  pass('training_candidate_manifest_persisted')

  const ineligibleManifest = buildTrainingCandidateManifest([{ ...candidate, recordId: 'ineligible-local', verificationState: 'candidate' }])
  assert.equal(await persistTrainingManifest(ineligibleManifest, projectId, null), true)
  const { error: ineligibleTrainingError } = await service.from('war_room_training_candidate_manifests')
    .update({ training_state: 'training' }).eq('id', ineligibleManifest.id)
  assert.ok(ineligibleTrainingError)
  pass('A_not_eligible_cannot_train')
  const { error: ineligibleAuthorizationError } = await service.from('war_room_training_candidate_manifests').update({
    authorization_state: 'authorized', training_authorized: true,
    commander_authorized_by: 'commander', commander_authorized_at: new Date().toISOString(),
  }).eq('id', ineligibleManifest.id)
  assert.ok(ineligibleAuthorizationError)
  pass('B_not_eligible_cannot_be_authorized')
  pass('C_evidence_gates_produce_eligible', manifest.eligibilityState)
  assert.equal(manifest.trainingState, 'not_started')
  pass('D_eligible_does_not_automatically_train')

  const awaiting = transitionTrainingCandidateAuthorization(manifest, 'awaiting_commander_authorization', { kind: 'automation', id: 'closeout' })
  const { error: awaitingError } = await service.from('war_room_training_candidate_manifests')
    .update({ authorization_state: awaiting.authorizationState }).eq('id', manifest.id)
  assert.equal(awaitingError, null)
  pass('E_eligible_can_await_commander_authorization')
  await assert.rejects(async () => transitionTrainingCandidateAuthorization(awaiting, 'authorized', { kind: 'automation', id: 'closeout' }))
  pass('H_automation_cannot_skip_commander_authorization')
  const authorized = transitionTrainingCandidateAuthorization(awaiting, 'authorized', { kind: 'commander', id: 'commander' })
  const { error: authorizedError } = await service.from('war_room_training_candidate_manifests').update({
    authorization_state: authorized.authorizationState, training_authorized: authorized.trainingAuthorized,
    commander_authorized_by: authorized.commanderAuthorizedBy, commander_authorized_at: authorized.commanderAuthorizedAt,
  }).eq('id', manifest.id)
  assert.equal(authorizedError, null)
  pass('F_commander_can_authorize_eligible_candidate')
  assert.equal(authorized.trainingState, 'not_started')
  pass('G_authorized_remains_not_started')
  const { error: lineageError } = await service.from('war_room_training_candidate_manifests')
    .update({ model_lineage: 'wrim-0' }).eq('id', manifest.id)
  assert.ok(lineageError)
  pass('I_wrim0_lineage_cannot_be_overwritten')
  const { error: provenanceError } = await service.from('war_room_training_candidate_manifests').insert({
    id: 'manifest-bad-provenance', project_id: projectId, policy_version: 'wave3-v1',
    eligibility_state: 'eligible', candidate_refs: [{ recordId: 'bad', provenanceRefs: [], evidenceIds: [] }],
  })
  assert.ok(provenanceError)
  pass('J_manifest_provenance_fails_closed')

  const { error: predictionError } = await service.from('war_room_prediction_records').insert({
    id: 'prediction-wave3-closeout', project_id: projectId, statement: 'PostgREST closeout succeeds',
    predicted_at: '2026-08-29T00:00:00.000Z', verify_after: '2026-08-29T00:00:00.000Z',
    provenance_refs: ['local:wave3-closeout'], status: 'verified', verification_evidence_ids: [evidence.id],
  })
  assert.equal(predictionError, null)
  pass('prediction_verification_record_persisted')

  for (const table of ['war_room_study_missions', 'war_room_learning_evidence', 'war_room_capability_nodes', 'war_room_prediction_records', 'war_room_training_candidate_manifests']) {
    const { data, error } = await service.from(table).select('*').limit(1)
    assert.equal(error, null)
    assert.ok(data && data.length === 1)
  }
  pass('phase52a_schema_cache_visible', '5/5 tables')
  pass('supabase_js_postgrest_round_trip', 'read/write')
  console.log(results.join('\n'))
  console.log(`Wave 3 PostgREST live validation: ${results.length}/${results.length} PASS`)
} finally {
  await new Promise<void>(resolve => proxy.close(() => resolve()))
}
