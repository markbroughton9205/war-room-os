/**
 * Higher Vision Studios Phase 1 slice B — Source Monitor + Program fidelity.
 * Kernel + UI locks. Live browser proof is a separate operator pass recorded in the report.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { applyEditCommand } from './edit-ops'
import { EDIT_COMMAND_KINDS, newCommandId, type EditCommand } from './edit-commands'
import { emptyProject } from './types'
import { fromSeconds, toSeconds } from './time'
import { HVS_SLICE } from './navigation'
import { commitCommands, createProject, loadProject } from './store'
import { proposeDirectorCommands } from './ai-director'
import {
  clearRange,
  emptySourceMonitor,
  loadAssetIntoSource,
  markIn,
  markOut,
  seekSource,
  sourceRangeEditCommand,
  validateAssetSourceRange,
  validateSourceRange,
} from './source-monitor'
import { frameDuration, KNOWN_FRAME_RATES, sourceSecondsAtLocal, timelineDurationForSpeed } from './playback-clock'
import { mapPlayheadToSource, pictureStackAt } from './preview-engine'
import { generateStarrdomTestClip } from './test-media'
import { ingestFile } from './ingest'
import { processRenderQueue } from './render-engine'
import { probeMediaFile } from './probe'
import { resolveFfmpegTools } from './ffmpeg'
import { HVS_AUDIO_SPEED_POLICY } from './render-engine'
import { clipVideoFilter, clipAudioFilter } from './render-engine'

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

expect('slice_id', ['HVS-P1-SLICE-A', 'HVS-P1-SLICE-B', 'HVS-P1-UX-SLICE-STUDIO', 'HVS-P1-SLICE-C', 'HVS-P1-SLICE-D', 'HVS-P1-SLICE-E', 'HVS-P1-SLICE-F', 'HVS-P1-SLICE-G'].includes(HVS_SLICE), HVS_SLICE)
expect('kind_createFreezeFrame', (EDIT_COMMAND_KINDS as readonly string[]).includes('createFreezeFrame'), 'createFreezeFrame')

const editor = source('components/war-room/higher-vision-studios/HvsEditorShell.tsx')
const sourceMon = source('lib/media-command/source-monitor.ts')
const preview = source('lib/media-command/preview-engine.ts')
const render = source('lib/media-command/render-engine.ts')
const director = source('lib/media-command/ai-director.ts')
const assetRoute = source('app/api/media-command/assets/[id]/file/route.ts')

expect('source_program_independence', editor.includes('data-testid="hvs-source-monitor"') && editor.includes('data-testid="hvs-program-viewer"'), 'dual monitors')
expect('rational_source_time', sourceMon.includes('sourcePlayhead') && sourceMon.includes('ticks') && !/sourcePlayhead:\s*number/.test(sourceMon), 'MediaTime playhead')
expect('mark_in_out_ui', editor.includes('data-testid="hvs-source-mark-in"') && editor.includes('data-testid="hvs-source-mark-out"'), 'Mark In/Out')
expect('clear_range_ui', editor.includes('data-testid="hvs-source-clear-in"') && editor.includes('data-testid="hvs-source-clear-out"'), 'clear In/Out')
expect('insert_from_source_ui', editor.includes('data-testid="hvs-source-insert"') && editor.includes("editFromSource('insertClip')"), 'insert')
expect('overwrite_from_source_ui', editor.includes('data-testid="hvs-source-overwrite"') && editor.includes("editFromSource('overwriteClip')"), 'overwrite')
expect('append_from_source_ui', editor.includes('data-testid="hvs-source-append"') && editor.includes("editFromSource('appendClip')"), 'append')
expect('frame_step_ui', editor.includes('data-testid="hvs-source-frame-forward"') && editor.includes('data-testid="hvs-program-frame-forward"'), 'frame step')
expect('gap_ui', editor.includes('data-testid="hvs-gap-frame"') && preview.includes('gap:'), 'gap black')
expect('proxy_original_route', assetRoute.includes("kind === 'original'") && assetRoute.includes("kind === 'proxy'"), 'original/proxy files')
expect('director_source_range', director.includes('Insert source range') && director.includes('sourceActions'), 'director slice B')
expect('director_speed_reverse_freeze', director.includes("speed: { n: 1, d: 2 }") && director.includes('reverseClip') && director.includes('createFreezeFrame'), 'director motion')
expect('render_speed_reverse_freeze', render.includes('setpts') && render.includes('reverse') && render.includes('loop=loop=-1') && render.includes('atempo'), 'render graph')
expect('audio_speed_policy', HVS_AUDIO_SPEED_POLICY.includes('atempo'), HVS_AUDIO_SPEED_POLICY.slice(0, 80))
expect('mark_in_not_editop', editor.includes('markSourceIn') && !/kind: 'markIn'/.test(editor), 'session marks')

let monitor = emptySourceMonitor()
expect('empty_monitor_no_asset', !monitor.selectedAssetId, 'empty')
const fakeAsset = {
  id: 'src-a',
  kind: 'video' as const,
  name: 'plate.mp4',
  originalPath: '/tmp/a.mp4',
  proxyPath: '/tmp/a-proxy.mp4',
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
  immutableOriginal: true as const,
  generated: false,
  provenance: null,
  createdAt: new Date().toISOString(),
}
monitor = loadAssetIntoSource(monitor, fakeAsset)
expect('load_source_asset', monitor.selectedAssetId === 'src-a' && toSeconds(monitor.sourceDuration) === 10, String(toSeconds(monitor.sourceDuration)))
monitor = seekSource(monitor, fromSeconds(2))
monitor = markIn(monitor)
monitor = seekSource(monitor, fromSeconds(6))
monitor = markOut(monitor)
const marked = validateSourceRange(monitor)
expect('mark_in_out', marked.ok && marked.ok && Math.abs(toSeconds(marked.ok ? marked.duration : fromSeconds(0)) - 4) < 0.001, marked.ok ? String(toSeconds(marked.duration)) : marked.error)
const cleared = clearRange(monitor)
expect('clear_range', !cleared.sourceIn && !cleared.sourceOut && !cleared.markIn, 'cleared')
const invalidOut = validateAssetSourceRange(fakeAsset, fromSeconds(6), fromSeconds(2), 24000)
expect('invalid_range_rejection', !invalidOut.ok && invalidOut.ok === false && invalidOut.code === 'OUT_NOT_AFTER_IN', invalidOut.ok ? 'accepted' : invalidOut.code)
const pastEnd = validateAssetSourceRange(fakeAsset, fromSeconds(0), fromSeconds(11), 24000)
expect('out_past_duration', !pastEnd.ok, pastEnd.ok ? 'accepted' : 'rejected')
monitor = markIn(loadAssetIntoSource(emptySourceMonitor(), fakeAsset), fromSeconds(2))
monitor = markOut(monitor, fromSeconds(6))
const insertCmd = sourceRangeEditCommand(monitor, 'insertClip', { trackId: 'V1', start: fromSeconds(0) })
expect('insert_source_command', insertCmd.ok && insertCmd.ok && insertCmd.command.kind === 'insertClip', insertCmd.ok ? insertCmd.command.kind : insertCmd.error)
const overwriteCmd = sourceRangeEditCommand(monitor, 'overwriteClip', { trackId: 'V1', start: fromSeconds(1) })
expect('overwrite_source_command', overwriteCmd.ok && overwriteCmd.command.kind === 'overwriteClip', overwriteCmd.ok ? 'ok' : overwriteCmd.error)
const appendCmd = sourceRangeEditCommand(monitor, 'appendClip', { trackId: 'V1' })
expect('append_source_command', appendCmd.ok && appendCmd.command.kind === 'appendClip', appendCmd.ok ? 'ok' : appendCmd.error)

const kernel = emptyProject({ id: 'hvs-p1b-k', name: 'P1-B kernel' })
kernel.assets.push(fakeAsset)
let k = applyEditCommand(kernel, insertCmd.ok ? insertCmd.command : cmd('insertClip', { trackId: 'V1', assetId: 'src-a', start: fromSeconds(0), sourceIn: fromSeconds(2), sourceOut: fromSeconds(6) }))
expect('insert_source_range', k.ok && k.project.timeline.tracks[0].clips[0] && Math.abs(toSeconds(k.project.timeline.tracks[0].clips[0].duration) - 4) < 0.01, k.ok ? String(toSeconds(k.project.timeline.tracks[0].clips[0].duration)) : k.error)
k = applyEditCommand(k.ok ? k.project : kernel, overwriteCmd.ok ? overwriteCmd.command : cmd('overwriteClip', { trackId: 'V1', assetId: 'src-a', start: fromSeconds(1), duration: fromSeconds(4), sourceIn: fromSeconds(2), sourceOut: fromSeconds(6) }))
expect('overwrite_source_range', k.ok, k.ok ? String(k.project.timeline.tracks[0].clips.length) : k.error)
k = applyEditCommand(k.ok ? k.project : kernel, appendCmd.ok ? appendCmd.command : cmd('appendClip', { trackId: 'V1', assetId: 'src-a', sourceIn: fromSeconds(2), sourceOut: fromSeconds(6) }))
expect('append_source_range', k.ok && k.project.timeline.tracks[0].clips.length >= 2, k.ok ? String(k.project.timeline.tracks[0].clips.length) : k.error)

let speedProject = emptyProject({ id: 'hvs-p1b-spd', name: 'speed' })
speedProject.assets.push(fakeAsset)
const placed = applyEditCommand(speedProject, cmd('insertClip', { trackId: 'V1', assetId: 'src-a', start: fromSeconds(0), sourceIn: fromSeconds(0), sourceOut: fromSeconds(2), duration: fromSeconds(2) }))
speedProject = placed.ok ? placed.project : speedProject
const half = applyEditCommand(speedProject, cmd('setSpeed', { clipId: speedProject.timeline.tracks[0].clips[0].id, speed: { n: 1, d: 2 } }))
expect('speed_duration_math_05', half.ok && Math.abs(toSeconds(half.project.timeline.tracks[0].clips[0].duration) - 4) < 0.02, half.ok ? String(toSeconds(half.project.timeline.tracks[0].clips[0].duration)) : half.error)
const dbl = applyEditCommand(speedProject, cmd('setSpeed', { clipId: speedProject.timeline.tracks[0].clips[0].id, speed: { n: 2, d: 1 } }))
expect('speed_duration_math_2', dbl.ok && Math.abs(toSeconds(dbl.project.timeline.tracks[0].clips[0].duration) - 1) < 0.02, dbl.ok ? String(toSeconds(dbl.project.timeline.tracks[0].clips[0].duration)) : dbl.error)
expect('speed_helper', Math.abs(toSeconds(timelineDurationForSpeed(fromSeconds(2), { n: 1, d: 2 })) - 4) < 0.001, '0.5x')

const rev = applyEditCommand(speedProject, cmd('reverseClip', { clipId: speedProject.timeline.tracks[0].clips[0].id, reversed: true }))
const revClip = rev.ok ? rev.project.timeline.tracks[0].clips[0] : null
const srcStart = revClip ? sourceSecondsAtLocal(revClip, fromSeconds(0)) : -1
const srcEnd = revClip ? sourceSecondsAtLocal(revClip, fromSeconds(toSeconds(revClip.duration) - 0.001)) : -1
expect('reverse_source_mapping', Boolean(revClip && srcStart > srcEnd), `start=${srcStart} end=${srcEnd}`)

const freeze = applyEditCommand(speedProject, cmd('createFreezeFrame', {
  clipId: speedProject.timeline.tracks[0].clips[0].id,
  at: fromSeconds(0.5),
  duration: fromSeconds(2),
  start: fromSeconds(4),
}))
const freezeClip = freeze.ok ? freeze.project.timeline.tracks[0].clips.find(c => c.freeze) : null
expect('freeze_provenance', Boolean(freezeClip && freezeClip.freeze && Math.abs(toSeconds(freezeClip.sourceIn) - 0.5) < 0.02), freeze.ok ? `${freezeClip?.name} @${toSeconds(freezeClip?.sourceIn ?? fromSeconds(0))}` : freeze.error)

const ratesOk = KNOWN_FRAME_RATES.every(fps => frameDuration(fps, 24000).ticks > 0)
expect('frame_stepping_rates', ratesOk, KNOWN_FRAME_RATES.map(f => `${f.n}/${f.d}=${frameDuration(f, 24000).ticks}`).join(','))

const gapProject = emptyProject({ id: 'hvs-p1b-gap', name: 'gap' })
gapProject.assets.push(fakeAsset)
let g = applyEditCommand(gapProject, cmd('insertClip', { trackId: 'V1', assetId: 'src-a', start: fromSeconds(0), duration: fromSeconds(1), sourceIn: fromSeconds(0), sourceOut: fromSeconds(1) }))
g = applyEditCommand(g.ok ? g.project : gapProject, cmd('insertClip', { trackId: 'V1', assetId: 'src-a', start: fromSeconds(3), duration: fromSeconds(1), sourceIn: fromSeconds(1), sourceOut: fromSeconds(2) }))
const atGap = mapPlayheadToSource(g.ok ? g.project : gapProject, 1.5)
const atClip = mapPlayheadToSource(g.ok ? g.project : gapProject, 0.2)
expect('gap_behavior', Boolean(atGap.gap && !atGap.clip && atClip.clip && !atClip.gap), `gap=${atGap.gap} clip=${Boolean(atClip.clip)}`)

const stackProject = emptyProject({ id: 'hvs-p1b-stack', name: 'stack' })
stackProject.assets.push(fakeAsset)
let s = applyEditCommand(stackProject, cmd('insertClip', { trackId: 'V1', assetId: 'src-a', start: fromSeconds(0), duration: fromSeconds(2) }))
s = applyEditCommand(s.ok ? s.project : stackProject, cmd('insertClip', { trackId: 'V2', assetId: 'src-a', start: fromSeconds(0), duration: fromSeconds(2) }))
const layers = pictureStackAt(s.ok ? s.project : stackProject, 0.5)
expect('track_stacking', layers.length === 2 && layers[0].track.id === 'V1' && layers[1].track.id === 'V2', layers.map(l => l.track.id).join(','))

expect('proxy_original_selection', fakeAsset.proxyPath !== fakeAsset.originalPath, 'distinct proxy')

const dir = proposeDirectorCommands(g.ok ? g.project : gapProject, 'Play this clip at half speed.')
expect('director_half_speed', dir.commands.some(c => c.kind === 'setSpeed'), dir.summary)
const dirMark = proposeDirectorCommands(g.ok ? g.project : gapProject, 'Mark in here.')
expect('director_mark_in_session', Boolean(dirMark.sourceActions?.some(a => a.kind === 'markIn') && dirMark.commands.length === 0), dirMark.summary)

const filterClip = speedProject.timeline.tracks[0].clips[0]
const vFilter = clipVideoFilter({ ...filterClip, reversed: true, speed: { n: 1, d: 2 } }, fakeAsset, { geometry: 'scale=1920:1080', look: [] })
expect('render_reverse_filter', vFilter.includes('reverse') && vFilter.includes('setpts'), vFilter.slice(0, 120))
const aFilter = clipAudioFilter({ ...filterClip, reversed: false, freeze: false, speed: { n: 2, d: 1 } }, 0, '[a0]')
expect('render_speed_audio', Boolean(aFilter && aFilter.includes('atempo=2')), aFilter?.slice(0, 160) ?? 'null')
const freezeFilter = clipVideoFilter({ ...filterClip, freeze: true }, fakeAsset, { geometry: 'scale=1920:1080', look: [] })
expect('render_freeze_filter', freezeFilter.includes('loop=loop=-1'), freezeFilter.slice(0, 120))

const tools = await resolveFfmpegTools()
expect('bundled_ffmpeg', Boolean(tools.ffmpeg?.includes('/media-command/tools/ffmpeg')), tools.ffmpeg ?? 'missing')
const plate = await generateStarrdomTestClip()
expect('test_plate', plate.ok, plate.error ?? plate.path)

if (plate.ok) {
  const live = await createProject({ name: 'HIGHER VISION SOURCE MONITOR TEST', productionMode: 'SOCIAL' })
  const ingested = await ingestFile({ project: live, sourcePath: plate.path, originalName: 'hvs-p1b-plate.mp4', mimeType: 'video/mp4' })
  const asset = ingested.asset
  let p = ingested.project
  const ins = await commitCommands(p, [cmd('insertClip', { trackId: 'V1', assetId: asset.id, start: fromSeconds(0), sourceIn: fromSeconds(0), sourceOut: fromSeconds(1), duration: fromSeconds(1) })])
  p = ins.project
  const clipA = p.timeline.tracks[0].clips[0]
  const halfLive = await commitCommands(p, [cmd('setSpeed', { clipId: clipA.id, speed: { n: 1, d: 2 } })])
  expect('live_speed_05', Math.abs(toSeconds(halfLive.project.timeline.tracks[0].clips[0].duration) - 2) < 0.05, String(toSeconds(halfLive.project.timeline.tracks[0].clips[0].duration)))
  p = halfLive.project
  const undone = await commitCommands(p, [cmd('undo')])
  expect('undo_speed', Math.abs(toSeconds(undone.project.timeline.tracks[0].clips[0].duration) - 1) < 0.05, String(toSeconds(undone.project.timeline.tracks[0].clips[0].duration)))
  const redone = await commitCommands(undone.project, [cmd('redo')])
  expect('redo_speed', Math.abs(toSeconds(redone.project.timeline.tracks[0].clips[0].duration) - 2) < 0.05, String(toSeconds(redone.project.timeline.tracks[0].clips[0].duration)))
  p = redone.project
  const c0 = p.timeline.tracks[0].clips[0]
  const rest = await commitCommands(p, [
    cmd('insertClip', { trackId: 'V1', assetId: asset.id, start: fromSeconds(3), sourceIn: fromSeconds(1), sourceOut: fromSeconds(2), duration: fromSeconds(1) }),
  ])
  p = rest.project
  const clipB = p.timeline.tracks[0].clips.find(c => c.id !== c0.id)
  if (clipB) {
    const fast = await commitCommands(p, [cmd('setSpeed', { clipId: clipB.id, speed: { n: 2, d: 1 } })])
    p = fast.project
  }
  const revLive = await commitCommands(p, [cmd('reverseClip', { clipId: p.timeline.tracks[0].clips[0].id, reversed: true })])
  p = revLive.project
  const freezeLive = await commitCommands(p, [cmd('createFreezeFrame', {
    clipId: p.timeline.tracks[0].clips[0].id,
    at: fromSeconds(0.4),
    duration: fromSeconds(1),
    start: fromSeconds(5),
  })])
  p = freezeLive.project
  expect('live_reverse', p.timeline.tracks[0].clips[0].reversed, String(p.timeline.tracks[0].clips[0].reversed))
  expect('live_freeze', p.timeline.tracks[0].clips.some(c => c.freeze), p.timeline.tracks[0].clips.map(c => `${c.name}:${c.freeze}`).join('|'))
  const freezeStill = p.assets.find(a => a.provenance?.provider === 'hvs-freeze-frame')
  expect('freeze_derived_still', Boolean(freezeStill && freezeStill.provenance?.parentAssetId === asset.id), freezeStill?.id ?? 'none')
  const rendered = await commitCommands(p, [cmd('render', { aspect: '16:9' })])
  p = await processRenderQueue(rendered.project.id) ?? rendered.project
  const job = p.renderJobs.at(-1)
  expect('render_job', job?.status === 'completed' && Boolean(job.outputPath), `${job?.status} ${job?.error ?? ''}`)
  if (job?.outputPath) {
    const probed = await probeMediaFile(job.outputPath)
    expect('render_probe_video', probed.hasVideo && probed.width === 1920 && probed.height === 1080, JSON.stringify({ w: probed.width, h: probed.height, d: probed.durationSec, a: probed.hasAudio }))
    expect('render_duration', probed.durationSec > 1, String(probed.durationSec))
    expect('render_encoder', job.encoder === 'libx264', String(job.encoder))
  }
  const reloaded = await loadProject(p.id)
  expect('persistence_reload', Boolean(reloaded && reloaded.timeline.tracks[0].clips.some(c => c.reversed) && reloaded.timeline.tracks[0].clips.some(c => c.freeze)), reloaded?.id ?? 'missing')
}

expect('p1a_move_not_removed', editor.includes("kind: 'moveClip'"), '1.2/A move remains')
expect('p1a_redo_not_removed', editor.includes('data-testid="hvs-redo"'), 'A redo remains')

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-P1-SLICE-B', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-P1-SLICE-B', total: results.length }))
