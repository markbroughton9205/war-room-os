/**
 * Phase 5 Color Wave 1 — ColorPipeline persist/validate. OCIO/ACES not WORKING.
 */
import { HVS_MATRIX_ROWS } from './production-matrix'
import { IDENTITY_COLOR } from './types'
import { emptyColorPipeline, planColorPipelineLowering, validateColorPipeline } from './color-pipeline'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

expect('thin_grade_shipped', HVS_MATRIX_ROWS.find(r => r.id === 'G19-01')?.state === 'SHIPPED', 'G19-01')
expect('wheels_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G19-02')?.state === 'PARTIAL', 'G19-02')
expect('ocio_researched', HVS_MATRIX_ROWS.find(r => r.id === 'G19-06')?.state === 'RESEARCHED', 'G19-06')
const pipeline = emptyColorPipeline()
expect('empty_ok', validateColorPipeline(pipeline).ok, validateColorPipeline(pipeline).errors.join(','))
pipeline.nodes.push({ id: 'c1', type: 'contrast-pivot', enabled: true, params: { contrast: 0.2, pivot: 0.5 } })
expect('node_ok', validateColorPipeline(pipeline).ok, validateColorPipeline(pipeline).errors.join(','))
const plan = planColorPipelineLowering(IDENTITY_COLOR, pipeline)
expect('pipeline_executable', plan.ocio === false && plan.aces === false && plan.hdr === false && plan.executablePipeline === true, JSON.stringify(plan.notes))
expect('phase1_intact', plan.executablePhase1Grade === true, 'phase1')

const failed = results.filter(r => !r.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
if (failed.length) { console.error(JSON.stringify({ ok: false, suite: 'p5-color', failed: failed.length })); process.exit(1) }
console.log(JSON.stringify({ ok: true, suite: 'p5-color', total: results.length }))
