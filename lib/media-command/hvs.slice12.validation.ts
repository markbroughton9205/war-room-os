/**
 * Higher Vision Studios slice-1.2 — live interaction proof locks.
 * `pnpm run validate:hvs` runs slice-0, slice-1, slice-1.1, then this file.
 * Live Commander drag and real-person follow are reported from the operator run, not invented here.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { applyEditCommand } from './edit-ops'
import { EDIT_COMMAND_KINDS, newCommandId, type EditCommand } from './edit-commands'
import { emptyProject } from './types'
import { fromSeconds, toSeconds } from './time'
import { HVS_SLICE } from './navigation'
import { mediaCommandDataHierarchy } from './paths'

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

expect('slice_id', ['HVS-V1-SLICE-1.2', 'HVS-V1-SLICE-1.3', 'HVS-P1-SLICE-A', 'HVS-P1-SLICE-B', 'HVS-P1-UX-SLICE-STUDIO', 'HVS-P1-SLICE-C', 'HVS-P1-SLICE-D', 'HVS-P1-SLICE-E', 'HVS-P1-SLICE-F', 'HVS-P1-SLICE-G'].includes(HVS_SLICE), HVS_SLICE)

const editor = source('components/war-room/higher-vision-studios/HvsEditorShell.tsx')
expect('label_rail_separated', editor.includes('hvs-track-label-rail') && editor.includes('hvs-timeline-scroller'), 'rail/scroller split')
expect('label_pointer_events_none', editor.includes('data-testid="hvs-track-label"') && editor.includes('pointer-events-none flex h-12 items-center'), 'labels ignore pointer')
expect('no_sticky_label_overlay', !editor.includes('sticky left-0 z-20'), 'old sticky V1 overlay gone')
expect('short_clip_hit_target', editor.includes('Math.max(32, toSeconds(clip.duration) * pxPerSec)'), 'min 32px clip hit')
expect('clip_drag_payload', editor.includes("e.dataTransfer.setData('application/hvs-clip'") && editor.includes("e.dataTransfer.setData('text/plain'"), 'HTML5 drag payload')
expect(
  'drop_uses_clip_lane_rect',
  editor.includes('data-testid={`hvs-track-lane-${track.id}`}') && editor.includes('getBoundingClientRect()'),
  'drop coords from lane',
)
expect('move_still_typed_editop', editor.includes("kind: 'moveClip'") && editor.includes('onMove={(clip, startSec, trackId)'), 'onMove → moveClip')
expect('no_second_drag_mutation_path', !/onDrop[\s\S]{0,800}setProject\(/.test(editor) && editor.includes('if (clip) onMove(clip, startSec, track.id)'), 'drop only calls onMove')
expect('undo_still_typed_editop', editor.includes("kind: 'undo'"), 'undo EditOp')
expect('redo_if_present_is_typed', (EDIT_COMMAND_KINDS as readonly string[]).includes('redo') === editor.includes("kind: 'redo'"), 'redo is typed iff UI invokes it')

const project = emptyProject({ id: 'hvs-slice12-move', name: 'Slice 1.2 move kernel' })
project.assets.push({
  id: 'a1',
  kind: 'video',
  name: 'plate.mp4',
  originalPath: '/tmp/plate.mp4',
  proxyPath: null,
  thumbPath: null,
  waveformPath: null,
  checksumSha256: 'x',
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
const inserted = applyEditCommand(project, cmd('insertClip', {
  trackId: 'V1',
  assetId: 'a1',
  start: fromSeconds(0),
}))
const clipId = inserted.ok ? inserted.project.timeline.tracks[0].clips[0].id : ''
const moved = inserted.ok
  ? applyEditCommand(inserted.project, cmd('moveClip', {
      clipId,
      trackId: 'V1',
      start: fromSeconds(1.8),
    }))
  : inserted
expect(
  'kernel_moveclip_still_works',
  Boolean(moved.ok && clipId && toSeconds(moved.project.timeline.tracks[0].clips[0].start) === 1.8),
  moved.ok ? String(toSeconds(moved.project.timeline.tracks[0].clips[0].start)) : moved.error ?? 'fail',
)
const undone = applyEditCommand(moved.ok ? moved.project : project, cmd('undo'))
expect('kernel_undo_rejects_direct', !undone.ok, ('error' in undone ? undone.error : undefined) ?? 'unexpected ok')

const host = source('components/war-room/media/MediaHost.tsx')
expect(
  'hvs_media_host_still_suppressed',
  host.includes('media-host-hvs-suppressed') && host.includes('isHigherVisionStudiosPath'),
  'MediaHost isolation remains',
)

const dirs = mediaCommandDataHierarchy()
const originalNames = existsSync(dirs.originals) ? readdirSync(dirs.originals) : []
const fixtureNames = existsSync(dirs.fixtures) ? readdirSync(dirs.fixtures) : []
const authorizedPerson = [...originalNames, ...fixtureNames].filter(name =>
  /person|talent|face|human|selfie|webcam/i.test(name) && !/hvs-demo-person|person-shaped|demo-plate|starrdom/i.test(name),
)
expect(
  'real_person_not_substituted',
  authorizedPerson.length === 0,
  authorizedPerson.length
    ? `unexpected person-named files: ${authorizedPerson.slice(0, 8).join(', ')}`
    : 'No authorized real-person clip under media-command originals/fixtures. Slice-1.2 must not claim REAL_PERSON_FOLLOW from synthetic plates.',
)

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-V1-SLICE-1.2', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-V1-SLICE-1.2', total: results.length }))
