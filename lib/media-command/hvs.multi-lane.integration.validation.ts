/**
 * Multi-lane integration: subsystem failure must not break the Phase-1 kernel.
 */
import { emptyProject } from './types'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { applyEditCommand } from './edit-ops'
import { routeCapability } from './provider-router'
import { validateEffectGraph } from './effect-graph'
import { validateColorPipeline } from './color-pipeline'
import { validateAudioGraph } from './audio-graph'
import { fromSeconds } from './time'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

const project = emptyProject({ id: 'hvs-ml-int', name: 'integration' })
const insert = applyEditCommand(project, {
  id: 'c1',
  kind: 'insertClip',
  actor: 'human',
  createdAt: new Date().toISOString(),
  trackId: 'V1',
  assetId: 'missing-asset',
  start: fromSeconds(0),
})
expect('bad_insert_isolated', !insert.ok && project.timeline.tracks[0].clips.length === 0, ('error' in insert ? insert.error : undefined) ?? 'ok')

const routed = routeCapability({ capability: 'VIDEO_GENERATION', projectId: project.id })
expect('router_failure_isolated', routed.ok === false, routed.ok ? 'ok' : routed.status)
expect('project_still_readable', project.format === 'hvsproj', project.format)

expect('invalid_dag_does_not_throw', (() => {
  try {
    return !validateEffectGraph({ id: 'g', projectId: project.id, versionLabel: 'x', nodes: [], connections: [{ fromNode: 'a', fromPort: 'out', toNode: 'b', toPort: 'in' }] }).ok
  } catch {
    return false
  }
})(), 'dag')

expect('invalid_color_does_not_throw', (() => {
  try {
    return !validateColorPipeline({ schemaVersion: 1, nodes: [{ id: 'n', type: 'lut', enabled: true, params: { assetId: 'nope' } }], outputColorSpace: 'unspecified' }, new Set()).ok
  } catch {
    return false
  }
})(), 'color')

expect('invalid_audio_does_not_throw', (() => {
  try {
    return !validateAudioGraph({ schemaVersion: 1, channels: [{ id: 'c', trackId: 'missing', volume: 1, pan: 0, mute: false, solo: false, inserts: [], outputBusId: 'none' }], buses: [], automation: [] }).ok
  } catch {
    return false
  }
})(), 'audio')

const raw = JSON.parse(serializeHvsProject(project)) as Record<string, unknown>
raw.effectGraphs = null
raw.colorPipeline = null
raw.audioGraph = { schemaVersion: 1 }
const parsed = parseHvsProject(JSON.stringify(raw))
expect('parse_survives_null_graphs', parsed.id === project.id && Array.isArray(parsed.effectGraphs) && parsed.audioGraph.buses.length >= 1, parsed.id)

const failed = results.filter(r => !r.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
if (failed.length) { console.error(JSON.stringify({ ok: false, suite: 'multi-lane-integration', failed: failed.length })); process.exit(1) }
console.log(JSON.stringify({ ok: true, suite: 'multi-lane-integration', total: results.length }))
