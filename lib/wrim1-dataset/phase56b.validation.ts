import assert from 'node:assert/strict'
import http from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'

const upstream = process.env.WAVE81_POSTGREST_UPSTREAM
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const port = Number(process.env.WAVE81_PROXY_PORT ?? '33312')
if (!upstream || !serviceKey) throw new Error('Wave 8.1 local PostgREST environment missing')

const proxy = http.createServer((request, response) => {
  const target = new URL((request.url ?? '/').replace(/^\/rest\/v1(?=\/|$)/, '') || '/', upstream)
  const forwarded = http.request(target, { method: request.method, headers: request.headers }, incoming => {
    response.writeHead(incoming.statusCode ?? 500, incoming.headers)
    incoming.pipe(response)
  })
  forwarded.on('error', error => response.destroy(error))
  request.pipe(forwarded)
})
await new Promise<void>(resolve => proxy.listen(port, '127.0.0.1', resolve))
const { check, finish } = createValidationHarness('Wave 8.1 Phase 56B local PostgreSQL/PostgREST validation', 6)
try {
  const baseUrl = `http://127.0.0.1:${port}`
  const service = createClient(baseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const anon = await fetch(`${baseUrl}/rest/v1/war_room_learning_evidence?select=id`, {
    headers: { Authorization: `Bearer ${process.env.WAVE81_ANON_JWT}`, apikey: process.env.WAVE81_ANON_JWT ?? '' },
  })
  check('anon_blocked', () => assert.ok([401, 403].includes(anon.status)))
  const createdAt = new Date().toISOString()
  let result = await service.from('war_room_learning_evidence').insert({
    id: 'live-w81-code', evidence_kind: 'code_operator_result', subject_ref: 'mission:w81-code',
    outcome: 'pass', observed_at: createdAt, provenance_refs: ['repo:local'], verifier_id: 'v', evaluator_id: 'e',
  })
  check('existing_code_operator_kind_still_works', () => assert.equal(result.error, null))
  result = await service.from('war_room_learning_evidence').insert({
    id: 'live-w81-tool', evidence_kind: 'tool_use_result', subject_ref: 'mission:w81-tool',
    outcome: 'pass', observed_at: createdAt, provenance_refs: ['gym:tool'], verifier_id: 'v', evaluator_id: 'e',
  })
  check('tool_use_result_kind_admitted', () => assert.equal(result.error, null))
  result = await service.from('war_room_agi_gym_runs').insert({
    id: 'live-w81-gym', gym_type: 'tool_use', mission_id: 'w81-tool', objective: 'bounded sha256',
    outcome: 'pass', started_at: createdAt, completed_at: createdAt, trajectory: [], criteria: [],
    objective_evaluated: true, objective_satisfied: true,
  })
  check('gym_objective_columns_present', () => assert.equal(result.error, null))
  const rows = await service.from('war_room_learning_evidence').select('id,evidence_kind')
  check('both_kinds_persisted', () => assert.equal(rows.data?.length, 2))
  const serviceRead = await service.from('war_room_agi_gym_runs').select('id')
  check('service_role_reads_gym', () => assert.equal(serviceRead.error, null))
} finally {
  await new Promise<void>(resolve => proxy.close(() => resolve()))
}
finish()
