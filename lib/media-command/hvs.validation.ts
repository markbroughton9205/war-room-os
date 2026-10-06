/**
 * Higher Vision Studios slice-0 architecture lock.
 * `node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/media-command/hvs.validation.ts`
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { applyEditCommand } from './edit-ops'
import { emptyProject } from './types'
import { proposeDirectorCommands } from './ai-director'
import { LUXURY_BEAUTY_V1_ID, getThemeSpec } from './themes'
import { followFramingCrop } from './tracking'
import { EDIT_COMMAND_KINDS } from './edit-commands'
import { fromSeconds, toSeconds } from './time'
import { HVS_CANONICAL_PATH, HVS_KERNEL_NAMESPACE, HVS_SECTIONS } from './navigation'
import { CAMERA_CONCEPTS } from './camera'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

expect('canonical_path', HVS_CANONICAL_PATH === '/higher-vision-studios', HVS_CANONICAL_PATH)
expect('kernel_namespace', HVS_KERNEL_NAMESPACE === 'media-command', HVS_KERNEL_NAMESPACE)
expect('not_media_player_path', !existsSync(path.join(process.cwd(), 'app/media/page.tsx')), 'app/media exists')
expect('does_not_import_lib_media', !source('lib/media-command/index.ts').includes("from '@/lib/media'"), 'media-command imported lib/media')
expect('luxury_theme', getThemeSpec(LUXURY_BEAUTY_V1_ID)?.version === '1.0.0', 'theme missing')
expect('edit_command_count', EDIT_COMMAND_KINDS.length >= 32, String(EDIT_COMMAND_KINDS.length))
expect('sections_include_video_intelligence', HVS_SECTIONS.some(s => s.id === 'video-intelligence'), 'VI missing')
expect('camera_concepts_separated', CAMERA_CONCEPTS.MULTICAM === 'multicam' && CAMERA_CONCEPTS.VIRTUAL_CAMERA === 'virtual-camera', 'conflated')

const project = emptyProject({ id: 'hvs-test', name: 'Test' })
project.assets.push({
  id: 'a1',
  kind: 'video',
  name: 'model.mp4',
  originalPath: '/tmp/model.mp4',
  proxyPath: null,
  thumbPath: null,
  waveformPath: null,
  checksumSha256: 'x',
  mimeType: 'video/mp4',
  duration: fromSeconds(10),
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
const inserted = applyEditCommand(project, {
  id: 'c1',
  kind: 'insertClip',
  actor: 'human',
  createdAt: new Date().toISOString(),
  trackId: 'V1',
  assetId: 'a1',
  start: fromSeconds(0),
})
expect('insert_clip', inserted.ok && inserted.project.timeline.tracks[0].clips.length === 1, inserted.ok ? 'ok' : inserted.error)

const clipId = inserted.ok ? inserted.project.timeline.tracks[0].clips[0].id : ''
const split = inserted.ok
  ? applyEditCommand(inserted.project, {
      id: 'c2',
      kind: 'splitClip',
      actor: 'human',
      createdAt: new Date().toISOString(),
      clipId,
      at: fromSeconds(4),
    })
  : inserted
expect('split_clip', split.ok && split.project.timeline.tracks[0].clips.length === 2, split.ok ? 'ok' : split.error)

const themed = split.ok
  ? applyEditCommand(split.project, {
      id: 'c3',
      kind: 'applyTheme',
      actor: 'ai-director',
      createdAt: new Date().toISOString(),
      themeId: LUXURY_BEAUTY_V1_ID,
    })
  : split
expect('apply_luxury_theme', themed.ok && themed.project.timeline.themeId === LUXURY_BEAUTY_V1_ID, themed.ok ? 'ok' : themed.error)

if (themed.ok) {
  const tracked = applyEditCommand(themed.project, {
    id: 'c4',
    kind: 'trackSubject',
    actor: 'human',
    createdAt: new Date().toISOString(),
    clipId: themed.project.timeline.tracks[0].clips[0].id,
    label: 'Model',
    subjectKind: 'person',
  })
  const reframed = tracked.ok
    ? applyEditCommand(tracked.project, {
        id: 'c5',
        kind: 'autoReframe',
        actor: 'ai-director',
        createdAt: new Date().toISOString(),
        outputAspect: '9:16',
        mode: 'RULE_OF_THIRDS',
      })
    : tracked
  expect('follow_reframe', reframed.ok && (reframed.project.timeline.virtualCameras[0]?.outputAspect === '9:16'), reframed.ok ? 'ok' : reframed.error)
  const crop = followFramingCrop({ x: 0.4, y: 0.1, width: 0.2, height: 0.5 }, 'RULE_OF_THIRDS', '9:16')
  const center = followFramingCrop({ x: 0.4, y: 0.1, width: 0.2, height: 0.5 }, 'CENTER_LOCK', '9:16')
  expect('not_center_crop', crop.left !== center.left || crop.top !== center.top, JSON.stringify({ crop, center }))
  const proposal = proposeDirectorCommands(reframed.ok ? reframed.project : themed.project, 'Make this feel more luxury.')
  expect('director_emits_editops', proposal.commands.some(c => c.kind === 'applyTheme'), proposal.summary)
  const applyThemeUtterance = proposeDirectorCommands(themed.ok ? themed.project : project, 'Apply the selected theme.')
  expect('director_apply_selected_theme', applyThemeUtterance.commands.some(c => c.kind === 'applyTheme') && !applyThemeUtterance.commands.some(c => c.kind === 'createVersion'), applyThemeUtterance.summary)
}

expect('rational_time', toSeconds(fromSeconds(2.5)) === 2.5, String(toSeconds(fromSeconds(2.5))))
expect('page_exists', existsSync(path.join(process.cwd(), 'app/higher-vision-studios/page.tsx')), 'home page')
expect('editor_exists', existsSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/HvsEditorShell.tsx')), 'editor')
expect('starrdom_fixture', existsSync(path.join(process.cwd(), 'lib/media-command/starrdom.ts')), 'fixture')

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, total: results.length }))
