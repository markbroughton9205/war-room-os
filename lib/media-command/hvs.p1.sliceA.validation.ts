/**
 * Higher Vision Studios Phase 1 slice A — timeline operations + history completion.
 * Kernel + UI integration locks. Browser proof is a separate live operator pass.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { applyEditCommand } from './edit-ops'
import { EDIT_COMMAND_KINDS, newCommandId, type EditCommand } from './edit-commands'
import { emptyProject } from './types'
import { fromSeconds, toSeconds } from './time'
import { HVS_SLICE } from './navigation'
import { commitCommands, createProject, loadProject, saveProject } from './store'
import { proposeDirectorCommands } from './ai-director'

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

function fixtureAsset(id = 'a1', seconds = 8) {
  return {
    id,
    kind: 'video' as const,
    name: `${id}.mp4`,
    originalPath: `/tmp/${id}.mp4`,
    proxyPath: null,
    thumbPath: null,
    waveformPath: null,
    checksumSha256: 'x',
    mimeType: 'video/mp4',
    duration: fromSeconds(seconds),
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
    immutableOriginal: true as const,
    generated: false,
    provenance: null,
    createdAt: new Date().toISOString(),
  }
}

function seededProject() {
  const project = emptyProject({ id: 'hvs-p1a', name: 'P1-A kernel' })
  project.assets.push(fixtureAsset('a1', 8), fixtureAsset('a2', 8))
  return project
}

function insertAt(project: ReturnType<typeof seededProject>, start: number, duration = 2, assetId = 'a1') {
  return applyEditCommand(project, cmd('insertClip', {
    trackId: 'V1',
    assetId,
    start: fromSeconds(start),
    duration: fromSeconds(duration),
  }))
}

expect('slice_id', ['HVS-P1-SLICE-A', 'HVS-P1-SLICE-B', 'HVS-P1-UX-SLICE-STUDIO', 'HVS-P1-SLICE-C', 'HVS-P1-SLICE-D', 'HVS-P1-SLICE-E', 'HVS-P1-SLICE-F', 'HVS-P1-SLICE-G'].includes(HVS_SLICE), HVS_SLICE)

const requiredKinds = [
  'redo',
  'appendClip',
  'liftClip',
  'extractClip',
  'rippleTrim',
  'rollEdit',
  'slipClip',
  'slideClip',
  'extendEdit',
  'duplicateClip',
  'addMarker',
] as const
for (const kind of requiredKinds) {
  expect(`kind_${kind}`, (EDIT_COMMAND_KINDS as readonly string[]).includes(kind), kind)
}

const editor = source('components/war-room/higher-vision-studios/HvsEditorShell.tsx')
expect('ui_redo_editop', editor.includes("kind: 'redo'") && editor.includes('data-testid="hvs-redo"'), 'redo button → redo EditOp')
expect('ui_append_editop', editor.includes("kind: 'appendClip'") && editor.includes('data-testid="hvs-append"'), 'append')
expect('ui_overwrite_editop', editor.includes("kind: 'overwriteClip'") && editor.includes('data-testid="hvs-overwrite"'), 'overwrite')
expect('ui_lift_editop', editor.includes("kind: 'liftClip'") && editor.includes('data-testid="hvs-lift"'), 'lift')
expect('ui_extract_editop', editor.includes("kind: 'extractClip'") && editor.includes('data-testid="hvs-extract"'), 'extract')
expect('ui_ripple_trim_editop', editor.includes("kind: 'rippleTrim'") && editor.includes('data-testid="hvs-ripple-trim"'), 'ripple trim')
expect('ui_roll_editop', editor.includes("kind: 'rollEdit'") && editor.includes('data-testid="hvs-roll"'), 'roll')
expect('ui_slip_editop', editor.includes("kind: 'slipClip'") && editor.includes('data-testid="hvs-slip"'), 'slip')
expect('ui_slide_editop', editor.includes("kind: 'slideClip'") && editor.includes('data-testid="hvs-slide"'), 'slide')
expect('ui_extend_editop', editor.includes("kind: 'extendEdit'") && editor.includes('data-testid="hvs-extend"'), 'extend')
expect('ui_duplicate_editop', editor.includes("kind: 'duplicateClip'") && editor.includes('data-testid="hvs-duplicate"'), 'duplicate')
expect('ui_marker_editop', editor.includes("kind: 'addMarker'") && editor.includes('data-testid="hvs-add-marker"'), 'marker')
expect('ui_snap_toggle', editor.includes('data-testid="hvs-snap-toggle"') && editor.includes('snapEnabled'), 'snap toggle')
expect('ui_snap_playhead_markers', editor.includes('playheadSec') && editor.includes('project.timeline.markers'), 'snap candidates include playhead/markers')
expect('ui_no_direct_nle_setproject', !/onClick=\{[^}]*setProject\(/.test(editor), 'toolbar still goes through commit()')
expect('move_still_typed', editor.includes("kind: 'moveClip'"), '1.2 move remains')
expect('undo_still_typed', editor.includes("kind: 'undo'"), '1.2 undo remains')

const store = source('lib/media-command/store.ts')
expect('store_redo_snapshot', store.includes("kind === 'redo'") && store.includes('projectRedoDir'), 'redo loads redo snapshot')
expect('store_undo_writes_redo', store.includes('projectRedoDir(current.id)') && store.includes('undid: lastId'), 'undo writes current to redo dir')

let project = seededProject()
const first = insertAt(project, 0, 2)
expect('setup_first_clip', first.ok && first.project.timeline.tracks[0].clips.length === 1, first.ok ? 'ok' : first.error ?? 'fail')
project = first.ok ? first.project : project
const second = insertAt(project, 2, 2)
expect('setup_second_clip', second.ok && second.project.timeline.tracks[0].clips.length === 2, second.ok ? 'ok' : second.error ?? 'fail')
project = second.ok ? second.project : project
const clips = () => project.timeline.tracks[0].clips
const aId = clips()[0]?.id
const bId = clips()[1]?.id

const overwritten = applyEditCommand(project, cmd('overwriteClip', {
  trackId: 'V1',
  assetId: 'a2',
  start: fromSeconds(1),
  duration: fromSeconds(1),
}))
expect(
  'kernel_overwrite_carves',
  Boolean(overwritten.ok && overwritten.project.timeline.tracks[0].clips.length === 3
    && toSeconds(overwritten.project.timeline.tracks[0].clips[1].start) === 1
    && overwritten.project.timeline.tracks[0].clips[1].assetId === 'a2'),
  overwritten.ok ? `clips=${overwritten.project.timeline.tracks[0].clips.length}` : overwritten.error ?? 'fail',
)

const appended = applyEditCommand(project, cmd('appendClip', { trackId: 'V1', assetId: 'a2' }))
expect(
  'kernel_append_at_end',
  Boolean(appended.ok && toSeconds(appended.project.timeline.tracks[0].clips.at(-1)!.start) === 4),
  appended.ok ? String(toSeconds(appended.project.timeline.tracks[0].clips.at(-1)!.start)) : appended.error ?? 'fail',
)

const lifted = applyEditCommand(project, cmd('liftClip', { clipId: bId }))
expect(
  'kernel_lift_leaves_gap',
  Boolean(lifted.ok && lifted.project.timeline.tracks[0].clips.length === 1
    && toSeconds(lifted.project.timeline.tracks[0].clips[0].start) === 0
    && toSeconds(lifted.project.timeline.tracks[0].clips[0].duration) === 2),
  lifted.ok ? `n=${lifted.project.timeline.tracks[0].clips.length}` : lifted.error ?? 'fail',
)

const extracted = applyEditCommand(project, cmd('extractClip', { clipId: aId }))
expect(
  'kernel_extract_closes_gap',
  Boolean(extracted.ok && extracted.project.timeline.tracks[0].clips.length === 1
    && toSeconds(extracted.project.timeline.tracks[0].clips[0].start) === 0
    && extracted.project.timeline.tracks[0].clips[0].id === bId),
  extracted.ok ? String(toSeconds(extracted.project.timeline.tracks[0].clips[0].start)) : extracted.error ?? 'fail',
)

const rippled = applyEditCommand(project, cmd('rippleTrim', { clipId: aId, edge: 'out', to: fromSeconds(1) }))
expect(
  'kernel_ripple_trim_shifts_later',
  Boolean(rippled.ok
    && toSeconds(rippled.project.timeline.tracks[0].clips[0].duration) === 1
    && toSeconds(rippled.project.timeline.tracks[0].clips[1].start) === 1),
  rippled.ok
    ? `dur=${toSeconds(rippled.project.timeline.tracks[0].clips[0].duration)} next=${toSeconds(rippled.project.timeline.tracks[0].clips[1].start)}`
    : rippled.error ?? 'fail',
)

const rolled = applyEditCommand(project, cmd('rollEdit', { outgoingClipId: aId, incomingClipId: bId, to: fromSeconds(1.5) }))
expect(
  'kernel_roll_preserves_span',
  Boolean(rolled.ok
    && toSeconds(rolled.project.timeline.tracks[0].clips[0].duration) === 1.5
    && toSeconds(rolled.project.timeline.tracks[0].clips[1].start) === 1.5
    && toSeconds(rolled.project.timeline.tracks[0].clips[1].duration) === 2.5),
  rolled.ok
    ? `a=${toSeconds(rolled.project.timeline.tracks[0].clips[0].duration)} b=${toSeconds(rolled.project.timeline.tracks[0].clips[1].duration)}`
    : rolled.error ?? 'fail',
)

const slipped = applyEditCommand(project, cmd('slipClip', { clipId: aId, delta: fromSeconds(0.25) }))
expect(
  'kernel_slip_keeps_timeline',
  Boolean(slipped.ok
    && toSeconds(slipped.project.timeline.tracks[0].clips[0].start) === 0
    && toSeconds(slipped.project.timeline.tracks[0].clips[0].duration) === 2
    && toSeconds(slipped.project.timeline.tracks[0].clips[0].sourceIn) === 0.25),
  slipped.ok ? String(toSeconds(slipped.project.timeline.tracks[0].clips[0].sourceIn)) : slipped.error ?? 'fail',
)

let three = seededProject()
const t0 = insertAt(three, 0, 1)
three = t0.ok ? t0.project : three
const t1 = insertAt(three, 1, 1)
three = t1.ok ? t1.project : three
const t2 = insertAt(three, 2, 1)
three = t2.ok ? t2.project : three
const midId = three.timeline.tracks[0].clips[1]?.id
const slid = applyEditCommand(three, cmd('slideClip', { clipId: midId, start: fromSeconds(1.25) }))
expect(
  'kernel_slide_preserves_middle_duration',
  Boolean(slid.ok
    && toSeconds(slid.project.timeline.tracks[0].clips[1].duration) === 1
    && toSeconds(slid.project.timeline.tracks[0].clips[0].duration) === 1.25
    && toSeconds(slid.project.timeline.tracks[0].clips[2].duration) === 0.75),
  slid.ok
    ? `dur=${slid.project.timeline.tracks[0].clips.map(c => toSeconds(c.duration)).join(',')}`
    : slid.error ?? 'fail',
)

const extended = applyEditCommand(project, cmd('extendEdit', { clipId: bId, to: fromSeconds(5) }))
expect(
  'kernel_extend_grows_out',
  Boolean(extended.ok && toSeconds(extended.project.timeline.tracks[0].clips[1].duration) === 3),
  extended.ok ? String(toSeconds(extended.project.timeline.tracks[0].clips[1].duration)) : extended.error ?? 'fail',
)

const duplicated = applyEditCommand(project, cmd('duplicateClip', { clipId: aId }))
expect(
  'kernel_duplicate_command',
  Boolean(duplicated.ok && duplicated.project.timeline.tracks[0].clips.length === 3),
  duplicated.ok ? `n=${duplicated.project.timeline.tracks[0].clips.length}` : duplicated.error ?? 'fail',
)

const marked = applyEditCommand(project, cmd('addMarker', { time: fromSeconds(1), label: 'Beat window', duration: fromSeconds(0.5) }))
expect(
  'kernel_add_marker_range',
  Boolean(marked.ok && marked.project.timeline.markers.length === 1 && toSeconds(marked.project.timeline.markers[0].duration) === 0.5),
  marked.ok ? marked.project.timeline.markers[0].label : marked.error ?? 'fail',
)

const directRedo = applyEditCommand(project, cmd('redo'))
expect('kernel_redo_rejects_direct', !directRedo.ok, ('error' in directRedo ? directRedo.error : undefined) ?? 'unexpected ok')

const directorSrc = source('lib/media-command/ai-director.ts')
expect('director_emits_new_ops', ['liftClip', 'extractClip', 'duplicateClip', 'appendClip', 'addMarker', 'redo'].every(kind => directorSrc.includes(`kind: '${kind}'`)), 'director mapper')

const director = proposeDirectorCommands(project, 'Duplicate this clip', 'AI_DIRECTOR', { selectedClipId: aId })
expect('director_duplicate_proposal', director.commands.some(c => c.kind === 'duplicateClip'), director.commands.map(c => c.kind).join(','))

async function runHistoryProof() {
  const created = await createProject({ name: 'HVS-P1-SLICE-A history' })
  created.assets.push(fixtureAsset('hist-a', 6))
  await saveProject(created)
  const loaded = await loadProject(created.id)
  expect('history_project_saved', Boolean(loaded && loaded.assets.some(a => a.id === 'hist-a')), loaded ? loaded.id : 'missing')
  if (!loaded) return
  const insertedLive = await commitCommands(loaded, [cmd('insertClip', {
    trackId: 'V1',
    assetId: 'hist-a',
    start: fromSeconds(0),
    duration: fromSeconds(2),
  })])
  const liveClip = insertedLive.project.timeline.tracks[0].clips[0]
  expect('history_insert_committed', insertedLive.errors.length === 0 && Boolean(liveClip), insertedLive.errors.join('; ') || 'ok')
  if (!liveClip) return
  const movedLive = await commitCommands(insertedLive.project, [cmd('moveClip', {
    clipId: liveClip.id,
    trackId: 'V1',
    start: fromSeconds(1.5),
  })])
  expect('history_move_committed', movedLive.errors.length === 0 && toSeconds(movedLive.project.timeline.tracks[0].clips[0].start) === 1.5, movedLive.errors.join('; ') || String(toSeconds(movedLive.project.timeline.tracks[0].clips[0]?.start ?? { ticks: 0, timescale: 1 })))
  const undoneLive = await commitCommands(movedLive.project, [cmd('undo')])
  expect(
    'history_undo_restores',
    undoneLive.errors.length === 0 && toSeconds(undoneLive.project.timeline.tracks[0].clips[0].start) === 0 && undoneLive.project.redoStack.length > 0,
    undoneLive.errors.join('; ') || `start=${toSeconds(undoneLive.project.timeline.tracks[0].clips[0]?.start ?? { ticks: -1, timescale: 1 })} redo=${undoneLive.project.redoStack.length}`,
  )
  const redoneLive = await commitCommands(undoneLive.project, [cmd('redo')])
  expect(
    'history_redo_restores',
    redoneLive.errors.length === 0 && toSeconds(redoneLive.project.timeline.tracks[0].clips[0].start) === 1.5,
    redoneLive.errors.join('; ') || String(toSeconds(redoneLive.project.timeline.tracks[0].clips[0]?.start ?? { ticks: -1, timescale: 1 })),
  )
}

expect('browser_not_claimed_from_kernel', true, 'Kernel/UI locks only. Live browser proof is a separate HVS-P1-SLICE-A operator pass.')

await runHistoryProof()

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-P1-SLICE-A', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-P1-SLICE-A', total: results.length }))
