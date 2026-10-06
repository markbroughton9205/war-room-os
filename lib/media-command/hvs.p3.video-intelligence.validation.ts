/**
 * Phase 3 Video Intelligence Wave 1 — persistence/schema. Not real analysis WORKING.
 */
import { HVS_MATRIX_ROWS } from './production-matrix'
import { VI_IDENTITY_POLICY, videoIntelligence, validateObservationDocument, VIDEO_OBSERVATION_SCHEMA } from './video-intelligence'
import { fromSeconds } from './time'
import { emptyProject } from './types'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

expect('vi_shipped_local_subset', HVS_MATRIX_ROWS.find(r => r.id === 'G27-01')?.state === 'SHIPPED', 'G27-01')
expect('no_scrape', HVS_MATRIX_ROWS.find(r => r.id === 'G27-03')?.state === 'SHIPPED', 'G27-03')
expect('identity_lock', VI_IDENTITY_POLICY.personObservationIsNotIdentity, 'identity')
const project = emptyProject({ id: 'hvs-p3-w1', name: 'VI foundation' })
const job = videoIntelligence.startWatch({ projectId: project.id, assetId: 'a1' })
expect('job_not_completed', job.status !== 'completed', job.status)
expect('schema_constant', VIDEO_OBSERVATION_SCHEMA === 1, String(VIDEO_OBSERVATION_SCHEMA))
const invalid = validateObservationDocument({
  schemaVersion: 1,
  projectId: 'p',
  assetId: 'a',
  assetChecksumSha256: null,
  backend: 'x',
  createdAt: new Date().toISOString(),
  observationCount: 0,
  observations: [{ timestamp: fromSeconds(0), scene: null, people: [], objects: [], actions: [], transcript: null, camera: null, effects: [], transition: null, color: null, audio_event: null, confidence: 2 }],
})
expect('confidence_range', !invalid.ok, invalid.errors.join(','))

const failed = results.filter(r => !r.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
if (failed.length) { console.error(JSON.stringify({ ok: false, suite: 'p3-vi', failed: failed.length })); process.exit(1) }
console.log(JSON.stringify({ ok: true, suite: 'p3-vi', total: results.length }))
