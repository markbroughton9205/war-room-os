/**
 * HVS-P1-SLICE-G — Phase 1 closure / Program-render honesty audit.
 * Does not build GPU compositor, NVENC, VFX, DAW, providers, beat detection, or animated lower thirds.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { applyEditCommand } from './edit-ops'
import { EDIT_COMMAND_KINDS, newCommandId, type EditCommand } from './edit-commands'
import { fromSeconds, toSeconds } from './time'
import { HVS_SLICE } from './navigation'
import { commitCommands, createProject, loadProject } from './store'
import { HVS_MATRIX_ROWS } from './production-matrix'
import {
  HVS_PHASE_1_ACCEPTANCE_CONTRACT,
  PHASE1_BLOCKED_ROWS,
  PHASE1_DEFERRED_ROWS,
  PROGRAM_VIEWER_PHASE1_CONTRACT,
  isPhase1ClosureRow,
  phase1ClosureCounts,
  phase1ClosureRows,
} from './phase1-contract'
import { THEME_LOOK_AUDIT } from './look-lowering'
import { HVS_GPU_RUNTIME_POLICY } from './gpu-runtime'
import { PRODUCTION_MODES, emptyProject } from './types'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

function cmd(kind: EditCommand['kind'], extra: Record<string, unknown> = {}): EditCommand {
  return {
    id: newCommandId(),
    kind,
    actor: 'human',
    createdAt: new Date().toISOString(),
    ...extra,
  } as EditCommand
}

expect('slice_id', HVS_SLICE === 'HVS-P1-SLICE-G', HVS_SLICE)
expect('contract_doc', existsSync(path.join(process.cwd(), 'docs/hvs-waves/HVS_PHASE_1_ACCEPTANCE_CONTRACT.md')), 'contract markdown')
expect('contract_text', HVS_PHASE_1_ACCEPTANCE_CONTRACT.includes('Professional Editor Foundation') && HVS_PHASE_1_ACCEPTANCE_CONTRACT.includes('DOES NOT INCLUDE'), 'contract copy')
expect('program_viewer_contract', PROGRAM_VIEWER_PHASE1_CONTRACT.includes('GPU compositor') && /not required/i.test(PROGRAM_VIEWER_PHASE1_CONTRACT), 'viewer contract')
expect('prior_slice_f_kept', source('package.json').includes('hvs.p1.sliceF.validation.ts') && source('package.json').includes('hvs.studio.uiV31.validation.ts'), 'F + V3.1 remain')
expect('slice_g_wired', source('package.json').includes('hvs.p1.sliceG.validation.ts'), 'slice G wired')
expect('layout_defaults_untouched', source('components/war-room/higher-vision-studios/hvs-studio-v3.css').includes('--hvs-media-w: 336px') && source('components/war-room/higher-vision-studios/hvs-studio-v3.css').includes('--hvs-inspector-w: 336px') && source('components/war-room/higher-vision-studios/hvs-studio-v3.css').includes('--hvs-timeline-h: 248px'), 'V3.1 proportions')
expect('version_browser_untouched', source('components/war-room/higher-vision-studios/HvsVersionBrowser.tsx').includes('data-testid="hvs-version-browser"'), 'Version Browser lock')
expect('no_gpu_compositor_built', !source('lib/media-command/preview-engine.ts').includes('webgpu') && HVS_GPU_RUNTIME_POLICY.nvencNotRequiredForPhase1, 'no GPU compositor')
expect('nvenc_phase_9', HVS_GPU_RUNTIME_POLICY.nvencPhaseOwner === '9', String(HVS_GPU_RUNTIME_POLICY.nvencPhaseOwner))

expect('global_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
const ids = HVS_MATRIX_ROWS.map(r => r.id)
expect('no_duplicate_ids', new Set(ids).size === ids.length, String(ids.length - new Set(ids).size))

const closure = phase1ClosureRows()
const counts = phase1ClosureCounts()
expect('phase1_no_shell', counts.SHELL === 0, String(counts.SHELL))
expect('phase1_no_not_started', counts['NOT STARTED'] === 0, String(counts['NOT STARTED']))
expect('phase1_no_blocked', counts.BLOCKED === 0, String(counts.BLOCKED))
expect('phase1_no_partial', counts.PARTIAL === 0, closure.filter(r => r.state === 'PARTIAL').map(r => r.id).join(','))
expect('phase1_all_shipped', counts.SHIPPED === closure.length && closure.length > 40, JSON.stringify(counts))

for (const row of closure) {
  expect(`p1_accounted_${row.id}`, isPhase1ClosureRow(row) && row.state === 'SHIPPED', `${row.id} ${row.state} ${row.phase}`)
}

for (const deferred of PHASE1_DEFERRED_ROWS) {
  const row = HVS_MATRIX_ROWS.find(r => r.id === deferred.id)
  expect(`deferred_${deferred.id}`, Boolean(row && row.phase === deferred.laterPhase && !isPhase1ClosureRow(row)), `${row?.phase} ${row?.state}`)
}

for (const blocked of PHASE1_BLOCKED_ROWS) {
  const row = HVS_MATRIX_ROWS.find(r => r.id === blocked.id)
  expect(`blocked_not_p1_${blocked.id}`, Boolean(row && row.state === 'BLOCKED' && !isPhase1ClosureRow(row)), `${row?.phase} ${row?.state}`)
}

const editor = source('components/war-room/higher-vision-studios/HvsEditorShell.tsx')
expect('blade_tool_ui', editor.includes('data-testid="hvs-tool-blade"') && editor.includes("timelineTool === 'blade'") && editor.includes('onSplit(clip, atSec)'), 'blade click-to-split')
expect('select_tool_ui', editor.includes('data-testid="hvs-tool-select"'), 'select tool')
expect('marker_commands', (EDIT_COMMAND_KINDS as readonly string[]).includes('updateMarker') && (EDIT_COMMAND_KINDS as readonly string[]).includes('removeMarker'), 'marker kinds')
expect('marker_inspector', editor.includes('data-testid="hvs-inspector-marker"') && editor.includes('data-testid="hvs-remove-marker"'), 'manual marker UX')
expect('preview_commit_reject_ui', editor.includes('data-testid="hvs-director-preview"') && editor.includes('data-testid="hvs-director-commit"') && editor.includes('data-testid="hvs-director-reject"'), 'preview/commit/reject')
expect('preview_flag', source('lib/media-command/store.ts').includes('if (options?.preview) return') && source('app/api/media-command/projects/[id]/commands/route.ts').includes('preview: Boolean(body.preview)'), 'preview API')
expect('production_modes', PRODUCTION_MODES.includes('COMMERCIAL') && PRODUCTION_MODES.includes('FILM_SHOW'), PRODUCTION_MODES.join(','))
expect('ffprobe_gate', source('lib/media-command/render-engine.ts').includes('ffprobe rejected output'), 'ffprobe gate')
expect('static_lower_third', editor.includes("kind: 'addLowerThird'") && source('lib/media-command/edit-ops.ts').includes("titleKind: 'lower-third'"), 'static LT')
expect('generate_not_phase1', HVS_MATRIX_ROWS.filter(r => r.name.toLowerCase().includes('generate') || r.id.startsWith('G22') || r.id.startsWith('G23')).every(r => r.phase !== '1'), 'generate rows not phase 1')

const requiredLooks = THEME_LOOK_AUDIT.filter(a => a.phase1Required)
expect('phase1_looks_lowered', requiredLooks.length > 0 && requiredLooks.every(a => a.fidelity === 'RENDER-LOWERED' && a.phase === '1'), requiredLooks.map(a => a.id).join(','))
const previewOnly = THEME_LOOK_AUDIT.filter(a => a.fidelity === 'PREVIEW-ONLY')
expect('preview_only_not_phase1_required', previewOnly.every(a => !a.phase1Required && a.phase !== '1'), previewOnly.map(a => a.id).join(','))

let p = await createProject({ name: 'HVS slice G phase1 closure', productionMode: 'CUSTOM' })
expect('project_created', Boolean(p.id), p.id)

p = (await commitCommands(p, [cmd('addMarker', { time: fromSeconds(1), label: 'Hold' })])).project
expect('marker_add', p.timeline.markers.length === 1 && p.timeline.markers[0].label === 'Hold', String(p.timeline.markers.length))
const markerId = p.timeline.markers[0].id
const diskAfterAdd = await loadProject(p.id)
expect('marker_persist', diskAfterAdd?.timeline.markers[0]?.id === markerId, diskAfterAdd?.timeline.markers[0]?.id ?? 'missing')

const preview = await commitCommands(p, [cmd('updateMarker', { markerId, label: 'Preview ghost' })], { preview: true })
expect('preview_returns_ghost', preview.preview === true && preview.project.timeline.markers[0].label === 'Preview ghost', preview.project.timeline.markers[0].label)
const diskAfterPreview = await loadProject(p.id)
expect('preview_no_hvsproj_mutate', diskAfterPreview?.timeline.markers[0]?.label === 'Hold', diskAfterPreview?.timeline.markers[0]?.label ?? 'missing')
expect('preview_transaction_uncommitted', preview.project.transactions.at(-1)?.committed === false, String(preview.project.transactions.at(-1)?.committed))

p = (await commitCommands(p, [cmd('updateMarker', { markerId, label: 'Committed mark', time: fromSeconds(2.5) })])).project
expect('marker_edit_move', p.timeline.markers[0].label === 'Committed mark' && Math.abs(toSeconds(p.timeline.markers[0].time) - 2.5) < 0.05, `${p.timeline.markers[0].label} t=${toSeconds(p.timeline.markers[0].time)}`)

const rejectedState = p.timeline.markers[0].label
const rejectPreview = await commitCommands(p, [cmd('removeMarker', { markerId })], { preview: true })
expect('reject_path_preview_remove', rejectPreview.preview && rejectPreview.project.timeline.markers.length === 0, String(rejectPreview.project.timeline.markers.length))
const diskReject = await loadProject(p.id)
expect('reject_leaves_committed', diskReject?.timeline.markers[0]?.label === rejectedState, diskReject?.timeline.markers[0]?.label ?? 'missing')

p = (await commitCommands(p, [cmd('removeMarker', { markerId })])).project
expect('marker_remove', p.timeline.markers.length === 0, String(p.timeline.markers.length))
const undone = await commitCommands(p, [cmd('undo')])
expect('marker_undo', undone.project.timeline.markers.length === 1, String(undone.project.timeline.markers.length))
const redone = await commitCommands(undone.project, [cmd('redo')])
expect('marker_redo', redone.project.timeline.markers.length === 0, String(redone.project.timeline.markers.length))

const bladeProject = emptyProject({ id: 'hvs-g-blade', name: 'HVS slice G blade' })
bladeProject.assets.push({
  id: 'asset-g-blade',
  kind: 'video',
  name: 'blade.mp4',
  originalPath: '/tmp/blade.mp4',
  proxyPath: null,
  thumbPath: null,
  waveformPath: null,
  checksumSha256: 'g',
  mimeType: 'video/mp4',
  duration: fromSeconds(4),
  width: 1920,
  height: 1080,
  frameRate: { n: 24, d: 1 },
  variableFrameRate: false,
  sampleRate: 48000,
  channels: 2,
  codec: 'h264',
  container: 'mp4',
  pixelFormat: 'yuv420p',
  rotation: null,
  audioStreams: [{ codec: 'aac', sampleRate: 48000, channels: 2 }],
  immutableOriginal: true,
  generated: false,
  provenance: null,
  createdAt: new Date().toISOString(),
})
const inserted = applyEditCommand(bladeProject, cmd('insertClip', { trackId: 'V1', assetId: 'asset-g-blade', start: fromSeconds(0), duration: fromSeconds(4) }))
expect('blade_insert', inserted.ok && inserted.project.timeline.tracks[0].clips.length === 1, inserted.ok ? String(inserted.project.timeline.tracks[0].clips.length) : inserted.error)
if (inserted.ok) {
  const clipId = inserted.project.timeline.tracks[0].clips[0].id
  const split = applyEditCommand(inserted.project, cmd('splitClip', { clipId, at: fromSeconds(1.5) }))
  expect('blade_splitclip', split.ok && split.project.timeline.tracks[0].clips.length === 2, split.ok ? String(split.project.timeline.tracks[0].clips.length) : split.error)
}

const globalStates = HVS_MATRIX_ROWS.reduce((acc, row) => {
  acc[row.state] = (acc[row.state] ?? 0) + 1
  return acc
}, {} as Record<string, number>)
expect('global_still_187', (globalStates.SHIPPED ?? 0) + (globalStates.PARTIAL ?? 0) + (globalStates.SHELL ?? 0) + (globalStates.RESEARCHED ?? 0) + (globalStates['NOT STARTED'] ?? 0) + (globalStates.BLOCKED ?? 0) === 187, JSON.stringify(globalStates))
expect('no_status_inflation_blockers', (globalStates.BLOCKED ?? 0) === 4, String(globalStates.BLOCKED))
expect('shipped_promotions_bounded', (globalStates.SHIPPED ?? 0) === 58 || (globalStates.SHIPPED ?? 0) === 59, String(globalStates.SHIPPED))
expect('partial_after', (globalStates.PARTIAL ?? 0) >= 24, String(globalStates.PARTIAL))

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-P1-SLICE-G', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-P1-SLICE-G', total: results.length, phase1: counts, global: globalStates }))
