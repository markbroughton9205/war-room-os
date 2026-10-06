/**
 * Phase 5 VFX Wave 1 — persist/validate. Not a physical composite.
 */
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVS_PRODUCTION_PAGES } from './production-pages'
import { passthroughEffectGraph, validateEffectGraph, planEffectGraphLowering, emptyEffectGraph } from './effect-graph'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

expect('g20_02_shipped', HVS_MATRIX_ROWS.find(r => r.id === 'G20-02')?.state === 'SHIPPED', 'G20-02')
expect('page_partial', HVS_PRODUCTION_PAGES.find(p => p.id === 'vfx')?.status === 'PARTIAL', 'page')
const graph = passthroughEffectGraph('p5vfx', 'asset-1')
expect('valid_passthrough', validateEffectGraph(graph, { assetIds: new Set(['asset-1']) }).ok, validateEffectGraph(graph).errors.join(','))
expect('invalid_ref', !validateEffectGraph(graph, { assetIds: new Set() }).ok, 'ref')
expect('incomplete_empty', !validateEffectGraph(emptyEffectGraph('p5vfx')).ok, 'empty')
expect('passthrough_executable', planEffectGraphLowering(graph).executable === true, 'lowering')

const failed = results.filter(r => !r.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
if (failed.length) { console.error(JSON.stringify({ ok: false, suite: 'p5-vfx', failed: failed.length })); process.exit(1) }
console.log(JSON.stringify({ ok: true, suite: 'p5-vfx', total: results.length }))
