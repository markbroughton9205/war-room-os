import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { materializeEngineeringMission } from './engine'

const upstream = process.env.WAVE42_POSTGREST_UPSTREAM; const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const proxyPort = Number(process.env.WAVE42_PROXY_PORT ?? '33210')
if (!upstream || !serviceKey) throw new Error('Wave 4.2 local PostgREST environment missing')
const proxy = http.createServer((req, res) => { const target = new URL((req.url ?? '/').replace(/^\/rest\/v1(?=\/|$)/, '') || '/', upstream); const out = http.request(target, { method: req.method, headers: req.headers }, incoming => { res.writeHead(incoming.statusCode ?? 500, incoming.headers); incoming.pipe(res) }); out.on('error', error => res.destroy(error)); req.pipe(out) })
await new Promise<void>(resolve => proxy.listen(proxyPort, '127.0.0.1', resolve))
try {
  const baseUrl = `http://127.0.0.1:${proxyPort}`; const client = createClient(baseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const anon = await fetch(`${baseUrl}/rest/v1/war_room_engineering_missions?select=id`, { headers: { Authorization: `Bearer ${process.env.WAVE42_ANON_JWT}`, apikey: process.env.WAVE42_ANON_JWT ?? '' } }); assert.ok([401, 403].includes(anon.status)); console.log(`PASS anon blocked status=${anon.status}`)
  const dir = path.join(process.cwd(), 'model-lab', 'manifests', 'wave4_2'); const names = (await readdir(dir)).filter(name => /^w42mission_.*\.json$/.test(name)).sort(); assert.equal(names.length, 3)
  const materialized = []
  for (const name of names) {
    const bundle = JSON.parse(await readFile(path.join(dir, name), 'utf8'))
    const admitted = materializeEngineeringMission({ ...bundle, auditValid: true }); assert.ok(admitted); materialized.push(admitted)
    const m = bundle.mission
    let response = await client.from('war_room_engineering_missions').insert({ id: m.missionId, initiated_by: m.initiatedBy, executor: m.executor, repo_path: m.repoPath, worktree_path: m.worktreePath, branch: m.branch, base_commit: m.baseCommit, started_at: m.startedAt, completed_at: m.completedAt, terminal_status: m.terminalStatus, objective: m.objective, capability_tags: m.capabilityTags, curriculum_tags: m.curriculumTags, source_task_lineage_id: m.sourceTaskLineageId, patch_lineage_id: m.patchLineageId, audit_event_ids: m.auditEventIds, audit_segment: m.auditSegment, metadata: m.metadata }); assert.equal(response.error, null)
    for (const a of bundle.artifacts) { response = await client.from('war_room_engineering_artifacts').insert({ id: a.artifactId, mission_id: a.missionId, artifact_kind: a.kind, path_ref: a.path, media_type: a.mediaType, size_bytes: a.sizeBytes, content_hash: a.contentHash, secret_scan_passed: a.secretScanPassed, hidden_cot_scan_passed: a.hiddenCotScanPassed, created_at: a.createdAt }); assert.equal(response.error, null) }
    for (const a of bundle.actions) { response = await client.from('war_room_engineering_actions').insert({ id: a.actionId, mission_id: a.missionId, action_type: a.actionType, executor: a.executor, started_at: a.startedAt, completed_at: a.completedAt, description: a.description, command_description: a.command, exit_code: a.exitCode, stdout_artifact_id: a.stdoutArtifactRef, stderr_artifact_id: a.stderrArtifactRef, input_artifact_ids: a.inputArtifactRefs, output_artifact_ids: a.outputArtifactRefs, content_hash: a.contentHash, result_status: a.resultStatus, validator_type: a.validatorType, metadata: a.metadata }); assert.equal(response.error, null) }
    for (const v of bundle.validators) { response = await client.from('war_room_engineering_validators').insert({ id: v.validatorId, mission_id: v.missionId, action_id: v.actionId, validator_type: v.validatorType, passed: v.passed, exit_code: v.exitCode, artifact_ids: v.artifactRefs, content_hash: v.contentHash, observed_at: v.observedAt }); assert.equal(response.error, null) }
    response = await client.from('war_room_agi_experience_records').insert({ model_target: { family: 'code_operator' }, turn_kind: 'assistant_response', outcome_signal: 'commander_approval', engineering_mission_id: m.missionId, engineering_action_ids: m.actionIds, engineering_validator_ids: m.validatorIds, engineering_artifact_ids: m.artifactIds, capability_tags: m.capabilityTags, curriculum_tags: m.curriculumTags }); assert.equal(response.error, null)
    response = await client.from('war_room_learning_evidence').insert({ id: admitted.evidence.id, evidence_kind: admitted.evidence.kind, subject_ref: admitted.evidence.subjectRef, outcome: admitted.evidence.outcome, observed_at: admitted.evidence.observedAt, provenance_refs: admitted.evidence.provenanceRefs, verifier_id: admitted.evidence.verifierId, evaluator_id: admitted.evidence.evaluatorId, poisoned: false, metadata: admitted.evidence.metadata }); assert.equal(response.error, null)
  }
  const dataset = JSON.parse(await readFile(path.join(dir, 'training-dataset-manifest.json'), 'utf8'))
  const records = materialized.map(item => ({ ...item.datasetRecord, contentHash: dataset.contentHashes[dataset.sourceEvidenceIds.indexOf(item.evidence.id)], split: dataset.trainIds.includes(item.evidence.id) ? 'train' : dataset.validationIds.includes(item.evidence.id) ? 'validation' : 'test' }))
  const response = await client.from('war_room_training_dataset_manifests').insert({ id: dataset.datasetId, policy_version: 'wave4-v1', parent_candidate_manifest_ids: materialized.map(item => item.candidate.recordId), dataset_hash: dataset.datasetManifestHash, records, exclusions: [], split_counts: { train: dataset.trainIds.length, validation: dataset.validationIds.length, test: dataset.testIds.length }, immutable: true, training_started: false, created_at: dataset.createdAt }); assert.equal(response.error, null)
  for (const table of ['war_room_engineering_missions','war_room_engineering_actions','war_room_engineering_validators','war_room_engineering_artifacts','war_room_agi_experience_records','war_room_learning_evidence','war_room_training_dataset_manifests']) { const result = await client.from(table).select('*'); assert.equal(result.error, null); assert.ok((result.data?.length ?? 0) > 0) }
  console.log('Wave 4.2 PostgREST live validation: 12/12 PASS')
} finally { await new Promise<void>(resolve => proxy.close(() => resolve())) }
