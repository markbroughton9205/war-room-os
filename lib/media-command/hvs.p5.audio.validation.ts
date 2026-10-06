/**
 * Phase 5 Audio Wave 1 — AudioGraph persist/validate. Not a DAW.
 */
import { HVS_MATRIX_ROWS } from './production-matrix'
import { emptyProject } from './types'
import { AUDIO_SIGNAL_ORDER, emptyAudioGraph, measuredMeter, validateAudioGraph } from './audio-graph'
import { fromSeconds } from './time'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

expect('clip_audio_shipped', HVS_MATRIX_ROWS.find(r => r.id === 'G31-02')?.state === 'SHIPPED', 'G31-02')
expect('eq_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G31-04')?.state === 'PARTIAL', 'G31-04')
expect('signal_order', AUDIO_SIGNAL_ORDER.includes('clip') && AUDIO_SIGNAL_ORDER.includes('master'), AUDIO_SIGNAL_ORDER)
const project = emptyProject({ id: 'hvs-p5a', name: 'audio' })
const graph = emptyAudioGraph(project)
expect('graph_ok', validateAudioGraph(graph, new Set(project.timeline.tracks.map(t => t.id))).ok, validateAudioGraph(graph).errors.join(','))
expect('meter_requires_samples', measuredMeter(null, 'x', fromSeconds(0), fromSeconds(1)) === null, 'null meter')
const meter = measuredMeter(Float32Array.from([0.5, -0.5]), 'ch', fromSeconds(0), fromSeconds(0.01))
expect('meter_real', Boolean(meter && meter.peak === 0.5), JSON.stringify(meter))

const failed = results.filter(r => !r.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
if (failed.length) { console.error(JSON.stringify({ ok: false, suite: 'p5-audio', failed: failed.length })); process.exit(1) }
console.log(JSON.stringify({ ok: true, suite: 'p5-audio', total: results.length }))
