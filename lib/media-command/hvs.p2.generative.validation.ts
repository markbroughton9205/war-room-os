/**
 * Phase 2 generative Wave 1 — contract only. Fixture is not generation WORKING.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { GENERATION_CONTRACT_NOTE, normalizeProviderArtifact, provenanceFromNormalized } from './generation-requests'
import { mediaCommandDataHierarchy } from './paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

expect('contract_note', GENERATION_CONTRACT_NOTE.includes('does not mean generation is WORKING'), GENERATION_CONTRACT_NOTE)
expect('video_gen_shell', HVS_MATRIX_ROWS.find(r => r.id === 'G22-02')?.state === 'SHELL', 'G22-02')
expect('image_gen_shell', HVS_MATRIX_ROWS.find(r => r.id === 'G23-01')?.state === 'SHELL', 'G23-01')
expect('voice_shell', HVS_MATRIX_ROWS.find(r => r.id === 'G33-02')?.state === 'SHELL', 'G33-02')
expect('music_shell', HVS_MATRIX_ROWS.find(r => r.id === 'G34-02')?.state === 'SHELL', 'G34-02')

const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-p2-gen-contract')
mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'fixture.png')
writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X89QAAAAASUVORK5CYII=', 'base64'))
let threw = false
try { normalizeProviderArtifact({ artifactPath: path.join(dir, 'missing.bin'), mimeType: 'image/png', kind: 'image', provider: 'x', model: null, prompt: null, promptHash: null, seed: null, parameters: {}, providerJobId: 'j', referenceAssetIds: [], parentAssetIds: [], license: null, externalTransfer: null, fixture: true }) } catch { threw = true }
expect('missing_artifact_rejected', threw, 'missing')
const art = normalizeProviderArtifact({ artifactPath: file, mimeType: 'image/png', kind: 'image', provider: 'contract-fixture', model: null, prompt: 'x', promptHash: null, seed: 1, parameters: {}, providerJobId: 'j1', referenceAssetIds: [], parentAssetIds: [], license: null, externalTransfer: null, fixture: true })
expect('fixture_exists', art.fixture && existsSync(art.artifactPath), art.artifactPath)
const prov = provenanceFromNormalized('p', art)
expect('provenance_origin', prov.origin === 'generated', String(prov.origin))

const failed = results.filter(r => !r.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
if (failed.length) { console.error(JSON.stringify({ ok: false, suite: 'p2-generative', failed: failed.length })); process.exit(1) }
console.log(JSON.stringify({ ok: true, suite: 'p2-generative', total: results.length }))
