/**
 * Phase 2 Provider Router Wave 1 — routing/authority only. Generation is not WORKING.
 */
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVS_CAPABILITIES, listCapabilityBackends } from './provider-registry'
import { listProviders, routeCapability } from './provider-router'
import { HVS_WAVE1_PROVIDER_SPEND_AUTHORIZED } from './policy'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

expect('capabilities', HVS_CAPABILITIES.length === 12, String(HVS_CAPABILITIES.length))
expect('stubs_unconfigured', listProviders().every(p => !p.configured), 'stubs')
expect('unconfigured_not_routeable', listCapabilityBackends().filter(b => !b.configured).every(b => !b.routeable), 'routeable')
const video = routeCapability({ capability: 'VIDEO_GENERATION', projectId: 'hvs-p2', prompt: 'x' })
expect('video_not_submitted', !video.ok, video.ok ? 'routed' : video.status)
expect('no_stub_selected', !video.ok && video.backend?.id !== 'stub-video', String(video.backend?.id))
expect('spend_not_authorized', HVS_WAVE1_PROVIDER_SPEND_AUTHORIZED === false, 'spend')
expect('router_shipped', HVS_MATRIX_ROWS.find(r => r.id === 'G22-01')?.state === 'SHIPPED', 'G22-01')
expect('generation_still_shell', HVS_MATRIX_ROWS.find(r => r.id === 'G22-02')?.state === 'SHELL', 'G22-02')

const failed = results.filter(r => !r.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
if (failed.length) { console.error(JSON.stringify({ ok: false, suite: 'p2-router', failed: failed.length })); process.exit(1) }
console.log(JSON.stringify({ ok: true, suite: 'p2-router', total: results.length }))
