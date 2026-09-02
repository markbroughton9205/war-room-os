import assert from 'node:assert/strict'
import http from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { evidenceHash } from './engine'

import { createValidationHarness } from '@/lib/agi-program/validationHarness'

const upstream = process.env.WAVE5_POSTGREST_UPSTREAM; const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; const port = Number(process.env.WAVE5_PROXY_PORT ?? '33310')
if (!upstream || !serviceKey) throw new Error('Wave 5 local PostgREST environment missing')
const proxy = http.createServer((request, response) => { const target = new URL((request.url ?? '/').replace(/^\/rest\/v1(?=\/|$)/, '') || '/', upstream); const forwarded = http.request(target, { method: request.method, headers: request.headers }, incoming => { response.writeHead(incoming.statusCode ?? 500, incoming.headers); incoming.pipe(response) }); forwarded.on('error', error => response.destroy(error)); request.pipe(forwarded) })
await new Promise<void>(resolve => proxy.listen(port, '127.0.0.1', resolve))
const { check, finish } = createValidationHarness('Wave 5 live PostgreSQL/PostgREST validation', 12)
try {
  const baseUrl = `http://127.0.0.1:${port}`; const service = createClient(baseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  await (async () => {
    const anon = await fetch(`${baseUrl}/rest/v1/war_room_continuous_evidence?select=id`, { headers: { Authorization: `Bearer ${process.env.WAVE5_ANON_JWT}`, apikey: process.env.WAVE5_ANON_JWT ?? '' } })
    check('anon_blocked', () => assert.ok([401, 403].includes(anon.status)))
  })()
  for (const table of ['war_room_continuous_evidence','war_room_capability_evidence_metrics','war_room_training_dataset_manifests']) {
    const response = await service.from(table).select('*').limit(1)
    check(`schema_${table}`, () => assert.equal(response.error, null))
  }
  const createdAt = new Date().toISOString()
  const oldId = 'live-wave42-root'; const oldHash = evidenceHash('wave42-root'); let result = await service.from('war_room_training_dataset_manifests').insert({ id: oldId, policy_version: 'wave4-v1', parent_candidate_manifest_ids: ['old'], dataset_hash: oldHash, records: [], exclusions: [], split_counts: { train: 1, validation: 1, test: 1 }, immutable: true, training_started: false, created_at: createdAt })
  check('predecessor_persisted', () => assert.equal(result.error, null))
  const evidenceId = 'live-wave5-evidence'; const contentHash = evidenceHash('live-wave5-evidence'); result = await service.from('war_room_continuous_evidence').insert({ id: evidenceId, evidence_kind: 'code_operator_result', source_type: 'code_operator', subject_ref: 'mission:live', outcome: 'pass', observed_at: createdAt, provenance_refs: ['audit:live','artifact:live'], source_lineage_ids: ['task:live'], capability_tags: ['validation'], curriculum_tags: ['wave5'], validator_types: ['test'], verifier_id: 'validator', evaluator_id: 'evaluator', content_hash: contentHash, quality_metrics: { qualityScore: .8 }, metadata: {} })
  check('evidence_persisted', () => assert.equal(result.error, null))
  result = await service.from('war_room_capability_evidence_metrics').insert({ capability_key: 'validation', successes: 1, failures: 0, validator_types: ['test'], distinct_mission_lineages: 1, last_observed_at: createdAt, evidence_density: 1, average_evidence_quality: .8, confidence: .16, strength: 'isolated', evidence_ids: [evidenceId] })
  check('capability_metrics_persisted', () => assert.equal(result.error, null))
  result = await service.from('war_room_training_dataset_manifests').insert({ id: 'live-wave5-dataset', policy_version: 'wave5-real-v1', parent_candidate_manifest_ids: [evidenceId], dataset_hash: evidenceHash('wave5-dataset'), records: [{ recordId: evidenceId, split: 'train' }], exclusions: [], split_counts: { train: 2, validation: 1, test: 1 }, predecessor_manifest_id: oldId, predecessor_manifest_hash: oldHash, added_evidence_ids: [evidenceId], removed_evidence_ids: [], rejected_evidence: [], lineage_groups: { [evidenceId]: ['task:live'] }, capability_distribution: { validation: { total: 1, successes: 1, failures: 0 } }, evidence_quality: { average: .8 }, held_out_isolation_proof: { passed: true }, immutable: true, training_started: false, created_at: createdAt })
  check('incremental_manifest_persisted', () => assert.equal(result.error, null))
  result = await service.from('war_room_continuous_evidence').insert({ id: 'bad-identity', evidence_kind: 'verification', source_type: 'research_engine', subject_ref: 'claim:bad', outcome: 'pass', observed_at: new Date().toISOString(), provenance_refs: ['source:x'], source_lineage_ids: ['claim:x'], capability_tags: ['research'], validator_types: ['source'], verifier_id: 'same', evaluator_id: 'same', content_hash: evidenceHash('bad'), quality_metrics: {} })
  check('identity_separation_enforced', () => assert.ok(result.error))
  result = await service.from('war_room_continuous_evidence').insert({ id: 'bad-provenance', evidence_kind: 'verification', source_type: 'world_learning', subject_ref: 'claim:bad2', outcome: 'pass', observed_at: new Date().toISOString(), provenance_refs: [], source_lineage_ids: [], capability_tags: ['research'], validator_types: ['source'], verifier_id: 'v', evaluator_id: 'e', content_hash: evidenceHash('bad2'), quality_metrics: {} })
  check('provenance_enforced', () => assert.ok(result.error))
  result = await service.from('war_room_training_dataset_manifests').update({ dataset_hash: evidenceHash('mutated') }).eq('id', 'live-wave5-dataset')
  check('manifest_immutable', () => assert.ok(result.error))
  const rows = await service.from('war_room_continuous_evidence').select('id')
  check('rejected_rows_absent', () => assert.equal(rows.data?.length, 1))
} finally { await new Promise<void>(resolve => proxy.close(() => resolve())) }
finish()
