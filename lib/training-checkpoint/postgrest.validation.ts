import assert from 'node:assert/strict'
import http from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { buildDatasetManifest, buildEvalManifest, contentHash, evaluateRegressionGates, registerCheckpointCandidate } from './engine'
import { persistCheckpointCandidate, persistDatasetManifest, persistEvalManifest } from './store'
import type { Wave4DatasetRecord } from './types'

const upstream = process.env.WAVE4_POSTGREST_UPSTREAM
const proxyPort = Number(process.env.WAVE4_PROXY_PORT ?? '33110')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!upstream || !serviceKey) throw new Error('local Wave 4 PostgREST validation environment is incomplete')
const proxy = http.createServer((request, response) => {
  const target = new URL((request.url ?? '/').replace(/^\/rest\/v1(?=\/|$)/, '') || '/', upstream)
  const forwarded = http.request(target, { method: request.method, headers: request.headers }, upstreamResponse => { response.writeHead(upstreamResponse.statusCode ?? 500, upstreamResponse.headers); upstreamResponse.pipe(response) })
  forwarded.on('error', error => response.destroy(error)); request.pipe(forwarded)
})
await new Promise<void>(resolve => proxy.listen(proxyPort, '127.0.0.1', resolve))

let count = 0
const pass = (label: string) => { count += 1; console.log(`PASS ${label}`) }
try {
  const baseUrl = `http://127.0.0.1:${proxyPort}`
  const service = createClient(baseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const anon = await fetch(`${baseUrl}/rest/v1/war_room_training_dataset_manifests?select=id`, { headers: { Authorization: `Bearer ${process.env.WAVE4_ANON_JWT}`, apikey: process.env.WAVE4_ANON_JWT ?? '' } })
  assert.ok(anon.status === 401 || anon.status === 403); pass('anon_blocked')
  const tables = ['war_room_training_dataset_manifests','war_room_checkpoint_candidates','war_room_checkpoint_eval_manifests']
  for (const table of tables) { const { error } = await service.from(table).select('id').limit(1); assert.equal(error, null); pass(`schema_cache_${table}`) }
  const projectId = '30000000-0000-4000-8000-000000000001'
  assert.equal((await service.from('war_room_projects').insert({ id: projectId, name: 'Wave 4 isolated validation' })).error, null)
  const record: Wave4DatasetRecord = { recordId: 'live-record', recordType: 'experience', content: 'Verified local outcome', verificationState: 'verified', wave3Eligible: true, observedAt: '2026-08-30T10:00:00Z', validUntil: null, provenanceRefs: ['local:source-version'], sourceLineageIds: ['local:lineage'], evidenceIds: ['v1','e1'], poisoned: false, containsHiddenCot: false, containsSecret: false, commanderCorrection: null, curriculumTags: ['local'], capabilityTags: ['verification'] }
  const dataset = buildDatasetManifest([record], ['wave3-live'], new Date('2026-08-30T12:00:00Z'))
  assert.equal(await persistDatasetManifest(dataset, projectId, null), true); pass('dataset_manifest_persisted')
  const checkpoint = registerCheckpointCandidate({ parentCheckpointId: 'WRIM-0:checkpoint-final', parentCheckpointHash: contentHash('local-parent'), datasetManifestId: dataset.manifestId, datasetHash: dataset.datasetHash, tokenizerArtifactHash: contentHash('local-tokenizer') }, new Date('2026-08-30T12:00:00Z'))
  assert.equal(await persistCheckpointCandidate(checkpoint, projectId, null), true); pass('checkpoint_lineage_persisted')
  const evaluation = buildEvalManifest(checkpoint.checkpointCandidateId, ['local:held-out'], [{ capabilityKey: 'verification', baselineScore: 0.8, candidateScore: 0.79, minimumScore: 0.75, maximumRegression: 0.02 }])
  const recommendation = evaluateRegressionGates(evaluation)
  assert.equal(await persistEvalManifest(evaluation, recommendation), true); pass('eval_scorecard_persisted')
  assert.equal(recommendation.commanderAuthorization, 'not_requested'); assert.equal(recommendation.promotionExecuted, false); pass('no_auto_promotion')
  const immutable = await service.from('war_room_training_dataset_manifests').update({ dataset_hash: contentHash('changed') }).eq('id', dataset.manifestId)
  assert.ok(immutable.error); pass('dataset_immutable')
  const badTraining = await service.from('war_room_checkpoint_candidates').insert({ id: 'bad-training', project_id: projectId, model_id: 'WRIM-1-candidate', parent_checkpoint_id: 'WRIM-0:x', parent_checkpoint_hash: contentHash('x'), dataset_manifest_id: dataset.manifestId, dataset_hash: dataset.datasetHash, tokenizer_artifact_hash: contentHash('t'), status: 'registered', rollback_checkpoint_id: 'WRIM-0:x', training_started: true, created_at: new Date().toISOString() })
  assert.ok(badTraining.error); pass('no_training_start_persistable')
  const badParent = await service.from('war_room_checkpoint_candidates').insert({ id: 'bad-parent', project_id: projectId, model_id: 'WRIM-1-candidate', parent_checkpoint_id: 'IMPORTED:x', parent_checkpoint_hash: contentHash('x'), dataset_manifest_id: dataset.manifestId, dataset_hash: dataset.datasetHash, tokenizer_artifact_hash: contentHash('t'), status: 'registered', rollback_checkpoint_id: 'IMPORTED:x', training_started: false, created_at: new Date().toISOString() })
  assert.ok(badParent.error); pass('wrim0_parent_enforced')
  const badPromotion = await service.from('war_room_checkpoint_eval_manifests').insert({ id: 'bad-promotion', checkpoint_candidate_id: checkpoint.checkpointCandidateId, benchmark_refs: ['local:x'], metrics: [{ capabilityKey: 'x' }], content_hash: contentHash('bad-eval'), recommendation: 'recommend', commander_authorization: 'authorized', promotion_executed: true })
  assert.ok(badPromotion.error); pass('promotion_authorization_separated')
  assert.equal(count, 12)
  console.log('Wave 4 live PostgREST validation: 12/12 PASS')
} finally { await new Promise<void>(resolve => proxy.close(() => resolve())) }
