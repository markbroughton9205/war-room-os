/**
 * Higher Vision Studios Phase 1 slice D — audio pan + render-graph leftovers.
 * Kernel + UI locks. Live browser proof is a separate operator pass recorded in the report.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'
import { applyEditCommand } from './edit-ops'
import { EDIT_COMMAND_KINDS, newCommandId, type EditCommand } from './edit-commands'
import { emptyProject } from './types'
import { fromSeconds, toSeconds } from './time'
import { HVS_SLICE } from './navigation'
import { commitCommands, createProject, loadProject, saveProject } from './store'
import { proposeDirectorCommands } from './ai-director'
import { clampPan, ffmpegPanFilter, panGains, rms } from './pan'
import { DISSOLVE_KIND, HVS_AUDIO_CROSSFADE_POLICY, dissolveWindowFor } from './transitions'
import { THEME_LOOK_AUDIT, clipLooksToFfmpeg, cssLookToFfmpeg, previewOnlyIds, renderLoweredIds } from './look-lowering'
import { generateColorPlate, generateColorStill, generateStarrdomTestClip } from './test-media'
import { ingestFile } from './ingest'
import { clipAudioFilter, clipVideoFilter, ffmpegFpsExpr, processRenderQueue, xfadePrepareChain } from './render-engine'
import { probeMediaFile } from './probe'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { mapPlayheadToSource } from './preview-engine'

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

function meanRgb(rgba: Buffer): { r: number; g: number; b: number } {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    r += rgba[i]
    g += rgba[i + 1]
    b += rgba[i + 2]
    n++
  }
  return n ? { r: r / n, g: g / n, b: b / n } : { r: 0, g: 0, b: 0 }
}

function countClass(rgba: Buffer, test: (r: number, g: number, b: number) => boolean): number {
  let n = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (test(rgba[i], rgba[i + 1], rgba[i + 2])) n++
  }
  return n
}

expect('slice_id', ['HVS-P1-SLICE-D', 'HVS-P1-SLICE-E', 'HVS-P1-SLICE-F', 'HVS-P1-SLICE-G'].includes(HVS_SLICE), HVS_SLICE)
for (const kind of ['setPan', 'addTransition', 'updateTransition', 'removeTransition'] as const) {
  expect(`kind_${kind}`, (EDIT_COMMAND_KINDS as readonly string[]).includes(kind), kind)
}

const editor = source('components/war-room/higher-vision-studios/HvsEditorShell.tsx')
const director = source('lib/media-command/ai-director.ts')
const render = source('lib/media-command/render-engine.ts')
expect('pan_inspector', editor.includes('testId="hvs-pan"') && editor.includes("kind: 'setPan'") && editor.includes('hvs-pan-control'), 'pan inspector')
expect('pan_lr_buttons', editor.includes('data-testid="hvs-pan-left"') && editor.includes('data-testid="hvs-pan-right"'), 'L/C/R')
expect('web_audio_panner', editor.includes('createStereoPanner') && editor.includes('createMediaElementSource'), 'program pan')
expect('dissolve_ui', editor.includes('data-testid="hvs-add-dissolve"') && editor.includes("kind: 'addTransition'"), 'dissolve ui')
expect('dissolve_program', editor.includes('data-testid="hvs-program-dissolve"') && editor.includes('hvs-program-dissolve'), 'program mix layer')
expect('no_react_pan_mutate', !editor.includes('selected.clip.pan =') && editor.includes('setPan'), 'typed pan')
expect('director_pan', director.includes("kind: 'setPan'") && director.includes('pan this left'), 'director pan')
expect('director_dissolve', director.includes("kind: 'addTransition'") && director.includes('Add a dissolve'), 'director dissolve')
expect('render_pan', render.includes('ffmpegPanFilter') || render.includes('pan=stereo'), 'render pan')
expect('render_dissolve', render.includes('xfade=transition=fade') && render.includes('afade'), 'render dissolve')
expect('xfade_fps_last', xfadePrepareChain({ n: 24, d: 1 }) === 'format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS,fps=24', xfadePrepareChain({ n: 24, d: 1 }))
expect('xfade_ntsc_fps', xfadePrepareChain({ n: 24000, d: 1001 }).includes('fps=24000/1001'), xfadePrepareChain({ n: 24000, d: 1001 }))
expect('no_hardcoded_xfade_24', !render.includes('fps=24,format=yuv420p,settb=AVTB'), 'old fps-then-settb xfade prep removed')
expect('clip_filter_stamps_fps', render.includes('ffmpegFpsExpr(opts.fps)') && render.includes('fps: timelineFps'), 'clip branches inherit timeline fps')
expect('timeline_fps_on_base', render.includes('ffmpegFpsExpr(timelineFps)'), 'color base uses timeline fps')
expect('audio_crossfade_policy', HVS_AUDIO_CROSSFADE_POLICY.includes('afade'), HVS_AUDIO_CROSSFADE_POLICY.slice(0, 80))
expect('preview_only_honest', previewOnlyIds().includes('typography.letterSpacing') && previewOnlyIds().includes('captionStyle.animation'), previewOnlyIds().join(','))
expect('render_lowered_eq', renderLoweredIds().includes('color.exposure') && renderLoweredIds().includes('filter.sepia'), renderLoweredIds().join(','))
expect('look_audit_count', THEME_LOOK_AUDIT.length >= 16, String(THEME_LOOK_AUDIT.length))
expect('prior_slice_c_lock', source('lib/media-command/hvs.p1.sliceC.validation.ts').includes('updateCaption') && editor.includes('hvs-inspector-caption'), 'slice C not weakened')

const project = emptyProject({ id: 'hvs-p1d', name: 'P1-D kernel' })
const inserted = applyEditCommand(project, cmd('insertClip', {
  trackId: 'V1',
  assetId: (project.assets[0] ? project.assets[0].id : 'missing'),
  start: fromSeconds(0),
  duration: fromSeconds(2),
}))
expect('empty_insert_without_asset', !inserted.ok, inserted.ok ? 'should fail' : inserted.error)

const panBad = applyEditCommand(emptyProject({ id: 'hvs-p1d-pan', name: 'x' }), cmd('setPan', { clipId: 'nope', pan: 0 }))
expect('pan_missing_clip', !panBad.ok, panBad.ok ? 'ok' : panBad.error)

const gainsL = panGains(-1)
const gainsC = panGains(0)
const gainsR = panGains(1)
expect('pan_gains_left', gainsL.left > 0.9 && gainsL.right < 0.1, JSON.stringify(gainsL))
expect('pan_gains_right', gainsR.right > 0.9 && gainsR.left < 0.1, JSON.stringify(gainsR))
expect('pan_gains_center', Math.abs(gainsC.left - gainsC.right) < 0.05, JSON.stringify(gainsC))
expect('pan_clamp', clampPan(4) === 1 && clampPan(-3) === -1, `${clampPan(4)}/${clampPan(-3)}`)
expect('ffmpeg_pan_string', ffmpegPanFilter(-1).includes('pan=stereo'), ffmpegPanFilter(-1))
expect('css_look_eq', cssLookToFfmpeg('contrast(1.12) saturate(0.9) brightness(0.96)', 1).some(p => p.startsWith('eq=')), cssLookToFfmpeg('contrast(1.12) saturate(0.9) brightness(0.96)', 1).join(';'))
expect('sepia_lowered', cssLookToFfmpeg('sepia(0.45)', 1).some(p => p.includes('colorchannelmixer')), 'sepia')

const tools = await resolveFfmpegTools()
expect('bundled_ffmpeg', Boolean(tools.ffmpeg?.includes('/media-command/tools/ffmpeg')), tools.ffmpeg ?? 'missing')
const hvsTmp = mediaCommandDataHierarchy().tmp

if (tools.ffmpeg) {
  const tone = await generateStarrdomTestClip()
  expect('tone_plate', tone.ok, tone.error ?? tone.path)
  const red = await generateColorPlate({ color: '0xC41E3A', seconds: 3 })
  const cyan = await generateColorPlate({ color: '0x1EC4B8', seconds: 3 })
  expect('red_plate', red.ok, red.error ?? red.path)
  expect('cyan_plate', cyan.ok, cyan.error ?? cyan.path)

  if (tone.ok) {
    const live = await createProject({ name: 'HIGHER VISION PAN DISSOLVE TEST', productionMode: 'SOCIAL' })
    const aIn = await ingestFile({ project: live, sourcePath: tone.path, originalName: 'hvs-p1d-tone.mp4', mimeType: 'video/mp4' })
    let p = aIn.project
    p = (await commitCommands(p, [cmd('insertClip', { trackId: 'V1', assetId: aIn.asset.id, start: fromSeconds(0), duration: fromSeconds(2) })])).project
    const clipA = p.timeline.tracks.find(t => t.id === 'V1')!.clips[0]
    const ranged = applyEditCommand(p, cmd('setPan', { clipId: clipA.id, pan: 2 }))
    expect('pan_range_reject', !ranged.ok, ranged.ok ? 'accepted illegal pan' : ranged.error)
    p = (await commitCommands(p, [cmd('setPan', { clipId: clipA.id, pan: -1 })])).project
    expect('set_pan_left', p.timeline.tracks.find(t => t.id === 'V1')!.clips[0].pan === -1, String(p.timeline.tracks.find(t => t.id === 'V1')!.clips[0].pan))
    p = (await commitCommands(p, [cmd('insertClip', { trackId: 'V1', assetId: aIn.asset.id, start: fromSeconds(2), duration: fromSeconds(2) })])).project
    p = (await commitCommands(p, [cmd('insertClip', { trackId: 'V1', assetId: aIn.asset.id, start: fromSeconds(4), duration: fromSeconds(2) })])).project
    const clips = [...p.timeline.tracks.find(t => t.id === 'V1')!.clips].sort((a, b) => a.start.ticks - b.start.ticks)
    expect('three_clips', clips.length >= 3, String(clips.length))
    p = (await commitCommands(p, [cmd('setPan', { clipId: clips[1].id, pan: 0 })])).project
    p = (await commitCommands(p, [cmd('setPan', { clipId: clips[2].id, pan: 1 })])).project
    const undone = await commitCommands(p, [cmd('undo')])
    const undoneClips = [...undone.project.timeline.tracks.find(t => t.id === 'V1')!.clips].sort((a, b) => a.start.ticks - b.start.ticks)
    expect('pan_undo', undoneClips[2].pan === 0, String(undoneClips[2].pan))
    const redone = await commitCommands(undone.project, [cmd('redo')])
    const redoneClips = [...redone.project.timeline.tracks.find(t => t.id === 'V1')!.clips].sort((a, b) => a.start.ticks - b.start.ticks)
    expect('pan_redo', redoneClips[2].pan === 1, String(redoneClips[2].pan))
    p = redone.project
    const previewPan = mapPlayheadToSource(p, 0.5)
    expect('preview_pan_mapping', (previewPan.clip?.pan ?? 0) === -1, String(previewPan.clip?.pan))
    const audioFilter = clipAudioFilter(p.timeline.tracks.find(t => t.id === 'V1')!.clips[0], 0, '[a0]')
    expect('render_pan_mapping', Boolean(audioFilter && audioFilter.includes('pan=stereo')), audioFilter?.slice(0, 180) ?? 'missing')

    const rPan = await commitCommands(p, [cmd('render', { aspect: '16:9' })])
    p = await processRenderQueue(rPan.project.id) ?? rPan.project
    const jobPan = p.renderJobs.find(j => j.target.aspect === '16:9')
    expect('pan_render', jobPan?.status === 'completed' && Boolean(jobPan.outputPath && existsSync(jobPan.outputPath)), `${jobPan?.status} ${jobPan?.error ?? ''}`)
    if (jobPan?.outputPath && tools.ffmpeg) {
      const ordered = [...p.timeline.tracks.find(t => t.id === 'V1')!.clips].sort((a, b) => a.start.ticks - b.start.ticks)
      async function energyAt(sec: number): Promise<{ l: number; r: number }> {
        const pcm = path.join(hvsTmp, `hvs-p1d-pcm-${sec}-${Date.now()}.s16le`)
        const extracted = await runProcess(tools.ffmpeg!, ['-y', '-ss', String(sec), '-t', '0.6', '-i', jobPan!.outputPath!, '-vn', '-ac', '2', '-ar', '48000', '-f', 's16le', pcm], 20_000)
        const buf = extracted.ok && existsSync(pcm) ? readFileSync(pcm) : Buffer.alloc(0)
        const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2))
        const left = new Int16Array(Math.floor(samples.length / 2))
        const right = new Int16Array(Math.floor(samples.length / 2))
        for (let i = 0; i < left.length; i++) {
          left[i] = samples[i * 2]
          right[i] = samples[i * 2 + 1]
        }
        return { l: rms(left), r: rms(right) }
      }
      const leftE = await energyAt(toSeconds(ordered[0].start) + 0.6)
      const centerE = await energyAt(toSeconds(ordered[1].start) + 0.6)
      const rightE = await energyAt(toSeconds(ordered[2].start) + 0.6)
      expect('pan_left_measure', leftE.l > leftE.r * 1.6, JSON.stringify(leftE))
      expect('pan_center_measure', Math.abs(centerE.l - centerE.r) / Math.max(0.0001, centerE.l + centerE.r) < 0.35, JSON.stringify(centerE))
      expect('pan_right_measure', rightE.r > rightE.l * 1.6, JSON.stringify(rightE))
    }
    const reloadedPan = await loadProject(p.id)
    expect('pan_persist', Boolean(reloadedPan && reloadedPan.timeline.tracks.find(t => t.id === 'V1')?.clips[0]?.pan === -1), String(reloadedPan?.timeline.tracks.find(t => t.id === 'V1')?.clips[0]?.pan))
    const dirPan = proposeDirectorCommands(p, 'Pan this left.', 'AI_DIRECTOR', { selectedClipId: p.timeline.tracks.find(t => t.id === 'V1')!.clips[0].id })
    expect('director_pan_cmd', dirPan.commands.some(c => c.kind === 'setPan' && 'pan' in c && c.pan === -1), dirPan.commands.map(c => c.kind).join(','))
  }

  if (red.ok && cyan.ok) {
    const live = await createProject({ name: 'HIGHER VISION DISSOLVE LOOK TEST', productionMode: 'SOCIAL' })
    const redIn = await ingestFile({ project: live, sourcePath: red.path, originalName: 'hvs-p1d-red.mp4', mimeType: 'video/mp4' })
    let p = redIn.project
    const cyanIn = await ingestFile({ project: p, sourcePath: cyan.path, originalName: 'hvs-p1d-cyan.mp4', mimeType: 'video/mp4' })
    p = cyanIn.project
    p = (await commitCommands(p, [cmd('insertClip', { trackId: 'V1', assetId: redIn.asset.id, start: fromSeconds(0), duration: fromSeconds(3) })])).project
    p = (await commitCommands(p, [cmd('appendClip', { trackId: 'V1', assetId: cyanIn.asset.id })])).project
    const v1 = p.timeline.tracks.find(t => t.id === 'V1')!
    const outId = v1.clips[0].id
    const inId = v1.clips[1].id
    const tooLong = applyEditCommand(p, cmd('addTransition', {
      outgoingClipId: outId,
      incomingClipId: inId,
      transitionKind: 'dissolve',
      duration: fromSeconds(9),
    }))
    expect('transition_duration_reject', !tooLong.ok, tooLong.ok ? 'accepted 9s dissolve' : tooLong.error)
    p = (await commitCommands(p, [cmd('addTransition', {
      outgoingClipId: outId,
      incomingClipId: inId,
      transitionKind: 'dissolve',
      duration: fromSeconds(1),
    })])).project
    const track = p.timeline.tracks.find(t => t.id === 'V1')!
    expect('transition_create', track.transitions.length === 1 && track.transitions[0].kind === DISSOLVE_KIND, String(track.transitions.length))
    const win = dissolveWindowFor(track, track.transitions[0])
    expect('dissolve_window', Boolean(win && win.durationSec > 0.5), JSON.stringify(win ? { s: win.startSec, e: win.endSec, d: win.durationSec } : null))
    const mid = mapPlayheadToSource(p, (win?.startSec ?? 2) + 0.4)
    expect('dissolve_program_mapping', Boolean(mid.dissolve), JSON.stringify({ dissolve: Boolean(mid.dissolve), layers: mid.layers.length }))
    p = (await commitCommands(p, [cmd('updateTransition', { transitionId: track.transitions[0].id, duration: fromSeconds(1) })])).project
    const clip0 = p.timeline.tracks.find(t => t.id === 'V1')!.clips[0]
    p = (await commitCommands(p, [cmd('applyFilter', { clipId: clip0.id, filterId: 'cinematic', amount: 0.85 })])).project
    expect('look_ffmpeg', clipLooksToFfmpeg(p.timeline.tracks.find(t => t.id === 'V1')!.clips[0].color, p.timeline.tracks.find(t => t.id === 'V1')!.clips[0].filters).length > 0, 'look filters')
    const vFilter = clipVideoFilter(p.timeline.tracks.find(t => t.id === 'V1')!.clips[0], { kind: 'video' }, {
      geometry: 'scale=1280:720',
      look: clipLooksToFfmpeg(p.timeline.tracks.find(t => t.id === 'V1')!.clips[0].color, p.timeline.tracks.find(t => t.id === 'V1')!.clips[0].filters),
      dissolve: { role: 'out', localStart: 2, duration: 1 },
      timelineStart: 0,
    })
    expect('look_render_filter', vFilter.includes('eq=') && vFilter.includes('fade=t=out'), vFilter.slice(0, 220))
    const dirD = proposeDirectorCommands(p, 'Add a dissolve here.', 'AI_DIRECTOR', { playheadSeconds: 2.5 })
    expect('director_dissolve_cmd', dirD.commands.some(c => c.kind === 'addTransition') || p.timeline.tracks.find(t => t.id === 'V1')!.transitions.length > 0, dirD.commands.map(c => c.kind).join(','))

    const rD = await commitCommands(p, [cmd('render', { aspect: '16:9' })])
    p = await processRenderQueue(rD.project.id) ?? rD.project
    const jobD = p.renderJobs.find(j => j.target.aspect === '16:9')
    expect('dissolve_render', jobD?.status === 'completed' && Boolean(jobD.outputPath && existsSync(jobD.outputPath)), `${jobD?.status} ${jobD?.error ?? ''}`)
    if (jobD?.outputPath && tools.ffmpeg && win) {
      async function frameAt(sec: number): Promise<Buffer> {
        const dest = path.join(hvsTmp, `hvs-p1d-fr-${sec}-${Date.now()}.rgba`)
        const extracted = await runProcess(tools.ffmpeg!, ['-y', '-i', jobD!.outputPath!, '-ss', String(sec), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', dest], 20_000)
        return extracted.ok && existsSync(dest) ? readFileSync(dest) : Buffer.alloc(0)
      }
      const before = await frameAt(Math.max(0.4, win.startSec - 0.8))
      const midF = await frameAt(win.startSec + win.durationSec / 2)
      const after = await frameAt(win.endSec + 0.8)
      const redOf = (buf: Buffer) => countClass(buf, (r, g, b) => r > 140 && g < 90 && b < 90)
      const cyanOf = (buf: Buffer) => countClass(buf, (r, g, b) => r < 90 && g > 90 && b > 90)
      const beforeRgb = meanRgb(before)
      const midRgb = meanRgb(midF)
      const afterRgb = meanRgb(after)
      expect('dissolve_before', before.length > 1000 && redOf(before) > cyanOf(before) * 2, `red=${redOf(before)} cyan=${cyanOf(before)} bytes=${before.length}`)
      expect('dissolve_mid', midF.length > 1000 && midRgb.r < beforeRgb.r - 12 && midRgb.r > afterRgb.r + 12 && midRgb.g > beforeRgb.g + 12 && midRgb.g < afterRgb.g - 12, JSON.stringify({ before: beforeRgb, mid: midRgb, after: afterRgb }))
      expect('dissolve_after', after.length > 1000 && cyanOf(after) > redOf(after) * 2, `red=${redOf(after)} cyan=${cyanOf(after)}`)
      expect('look_frame', meanRgb(before).r + meanRgb(before).g + meanRgb(before).b > 15, `rgb=${JSON.stringify(beforeRgb)}`)
      const q1 = await frameAt(win.startSec + win.durationSec * 0.25)
      const q3 = await frameAt(win.startSec + win.durationSec * 0.75)
      const q1Rgb = meanRgb(q1)
      const q3Rgb = meanRgb(q3)
      expect('dissolve_q25', q1.length > 1000 && q1Rgb.r < beforeRgb.r - 4 && q1Rgb.r > midRgb.r && q1Rgb.g > beforeRgb.g, JSON.stringify({ before: beforeRgb, q25: q1Rgb, mid: midRgb }))
      expect('dissolve_q75', q3.length > 1000 && q3Rgb.r < midRgb.r && q3Rgb.g > midRgb.g && cyanOf(q3) > redOf(q3), JSON.stringify({ mid: midRgb, q75: q3Rgb, after: afterRgb }))
      expect('xfade_offset_timeline', Math.abs(win.startSec - 2) < 0.05 && Math.abs(win.durationSec - 1) < 0.05, JSON.stringify(win))
    }
    const removed = applyEditCommand(p, cmd('removeTransition', { transitionId: p.timeline.tracks.find(t => t.id === 'V1')!.transitions[0].id }))
    expect('transition_remove', removed.ok && removed.project.timeline.tracks.find(t => t.id === 'V1')!.transitions.length === 0, removed.ok ? String(removed.project.timeline.tracks.find(t => t.id === 'V1')!.transitions.length) : removed.error)
    const persisted = await loadProject(p.id)
    expect('dissolve_persist_before_remove', Boolean(persisted && persisted.timeline.tracks.find(t => t.id === 'V1')?.transitions.length === 1), String(persisted?.timeline.tracks.find(t => t.id === 'V1')?.transitions.length))

    const freezeLive = await createProject({ name: 'HVS FREEZE DISSOLVE TEST', productionMode: 'SOCIAL' })
    const fRed = await ingestFile({ project: freezeLive, sourcePath: red.path, originalName: 'hvs-p1d-freeze-red.mp4', mimeType: 'video/mp4' })
    let pF = fRed.project
    const fCyan = await ingestFile({ project: pF, sourcePath: cyan.path, originalName: 'hvs-p1d-freeze-cyan.mp4', mimeType: 'video/mp4' })
    pF = fCyan.project
    pF = (await commitCommands(pF, [cmd('insertClip', { trackId: 'V1', assetId: fRed.asset.id, start: fromSeconds(0), duration: fromSeconds(3) })])).project
    pF = (await commitCommands(pF, [cmd('appendClip', { trackId: 'V1', assetId: fCyan.asset.id })])).project
    const fClips = [...pF.timeline.tracks.find(t => t.id === 'V1')!.clips].sort((a, b) => a.start.ticks - b.start.ticks)
    pF = (await commitCommands(pF, [cmd('freezeFrame', { clipId: fClips[0].id, freeze: true, at: fromSeconds(0.4) })])).project
    pF = (await commitCommands(pF, [cmd('addTransition', { outgoingClipId: fClips[0].id, incomingClipId: fClips[1].id, transitionKind: 'dissolve', duration: fromSeconds(1) })])).project
    expect('freeze_clip_flag', Boolean(pF.timeline.tracks.find(t => t.id === 'V1')!.clips.find(c => c.id === fClips[0].id)?.freeze), 'outgoing freeze')
    const rF = await commitCommands(pF, [cmd('render', { aspect: '16:9' })])
    pF = await processRenderQueue(rF.project.id) ?? rF.project
    const jobF = pF.renderJobs.find(j => j.target.aspect === '16:9')
    expect('freeze_dissolve_render', jobF?.status === 'completed' && Boolean(jobF.outputPath && existsSync(jobF.outputPath)), `${jobF?.status} ${jobF?.error ?? ''}`)

    const still = await generateColorStill({ color: '0xC41E3A', outputPath: path.join(hvsTmp, 'hvs-p1d-still.png') })
    expect('still_png', still.ok, still.error ?? still.path)
    if (still.ok) {
      const stillLive = await createProject({ name: 'HVS STILL DISSOLVE TEST', productionMode: 'SOCIAL' })
      const sIn = await ingestFile({ project: stillLive, sourcePath: still.path, originalName: 'hvs-p1d-still.png', mimeType: 'image/png' })
      const stillAsset = sIn.project.assets.find(a => a.id === sIn.asset.id)
      if (stillAsset) stillAsset.duration = fromSeconds(3)
      let pS = await saveProject(sIn.project)
      const sCyan = await ingestFile({ project: pS, sourcePath: cyan.path, originalName: 'hvs-p1d-still-cyan.mp4', mimeType: 'video/mp4' })
      pS = sCyan.project
      const imgInsert = await commitCommands(pS, [cmd('insertClip', { trackId: 'V1', assetId: sIn.asset.id, start: fromSeconds(0), duration: fromSeconds(3) })])
      pS = imgInsert.project
      expect('still_insert', imgInsert.errors.length === 0, imgInsert.errors.join('; ') || 'ok')
      pS = (await commitCommands(pS, [cmd('appendClip', { trackId: 'V1', assetId: sCyan.asset.id })])).project
      const sClips = [...pS.timeline.tracks.find(t => t.id === 'V1')!.clips].sort((a, b) => a.start.ticks - b.start.ticks)
      if (sClips.length >= 2) {
        pS = (await commitCommands(pS, [cmd('addTransition', { outgoingClipId: sClips[0].id, incomingClipId: sClips[1].id, transitionKind: 'dissolve', duration: fromSeconds(1) })])).project
        const rS = await commitCommands(pS, [cmd('render', { aspect: '16:9' })])
        pS = await processRenderQueue(rS.project.id) ?? rS.project
        const jobS = pS.renderJobs.find(j => j.target.aspect === '16:9')
        expect('still_dissolve_render', jobS?.status === 'completed' && Boolean(jobS.outputPath && existsSync(jobS.outputPath)), `${jobS?.status} ${jobS?.error ?? ''}`)
      } else {
        expect('still_dissolve_render', false, `clips=${sClips.length}`)
      }
    }

    const ntscRed = await generateColorPlate({ color: '0xC41E3A', seconds: 3, outputPath: path.join(hvsTmp, 'hvs-ntsc-red.mp4'), frameRate: { n: 24000, d: 1001 } })
    const ntscCyan = await generateColorPlate({ color: '0x1EC4B8', seconds: 3, outputPath: path.join(hvsTmp, 'hvs-ntsc-cyan.mp4'), frameRate: { n: 24000, d: 1001 } })
    expect('ntsc_plates', ntscRed.ok && ntscCyan.ok, `${ntscRed.error ?? ''} ${ntscCyan.error ?? ''}`)
    if (ntscRed.ok && ntscCyan.ok) {
      const ntscLive = await createProject({ name: 'HVS NTSC DISSOLVE TEST', productionMode: 'SOCIAL' })
      ntscLive.timeline.frameRate = { n: 24000, d: 1001 }
      let pN = await saveProject(ntscLive)
      const nRed = await ingestFile({ project: pN, sourcePath: ntscRed.path, originalName: 'hvs-ntsc-red.mp4', mimeType: 'video/mp4' })
      pN = nRed.project
      const nCyan = await ingestFile({ project: pN, sourcePath: ntscCyan.path, originalName: 'hvs-ntsc-cyan.mp4', mimeType: 'video/mp4' })
      pN = nCyan.project
      pN.timeline.frameRate = { n: 24000, d: 1001 }
      pN = await saveProject(pN)
      pN = (await commitCommands(pN, [cmd('insertClip', { trackId: 'V1', assetId: nRed.asset.id, start: fromSeconds(0), duration: fromSeconds(3) })])).project
      pN = (await commitCommands(pN, [cmd('appendClip', { trackId: 'V1', assetId: nCyan.asset.id })])).project
      pN.timeline.frameRate = { n: 24000, d: 1001 }
      pN = await saveProject(pN)
      const nClips = [...pN.timeline.tracks.find(t => t.id === 'V1')!.clips].sort((a, b) => a.start.ticks - b.start.ticks)
      pN = (await commitCommands(pN, [cmd('addTransition', { outgoingClipId: nClips[0].id, incomingClipId: nClips[1].id, transitionKind: 'dissolve', duration: fromSeconds(1) })])).project
      pN.timeline.frameRate = { n: 24000, d: 1001 }
      pN = await saveProject(pN)
      expect('ntsc_timeline_fps', pN.timeline.frameRate.n === 24000 && pN.timeline.frameRate.d === 1001, JSON.stringify(pN.timeline.frameRate))
      const rN = await commitCommands(pN, [cmd('render', { aspect: '16:9' })])
      pN = await processRenderQueue(rN.project.id) ?? rN.project
      const jobN = pN.renderJobs.find(j => j.target.aspect === '16:9')
      expect('ntsc_dissolve_render', jobN?.status === 'completed' && Boolean(jobN.outputPath && existsSync(jobN.outputPath)), `${jobN?.status} ${jobN?.error ?? ''}`)
      if (jobN?.outputPath) {
        const probedN = await probeMediaFile(jobN.outputPath)
        const fps = (probedN.frameRateN ?? 0) / Math.max(1, probedN.frameRateD ?? 1)
        expect('ntsc_output_fps', Math.abs(fps - 24000 / 1001) < 0.05, JSON.stringify({ n: probedN.frameRateN, d: probedN.frameRateD, fps }))
      }
    }
    expect('fps_expr_ntsc', ffmpegFpsExpr({ n: 24000, d: 1001 }) === '24000/1001', ffmpegFpsExpr({ n: 24000, d: 1001 }))

    const nzLive = await createProject({ name: 'HVS DISSOLVE OFFSET TEST', productionMode: 'SOCIAL' })
    const nzRed = await ingestFile({ project: nzLive, sourcePath: red.path, originalName: 'hvs-nz-red.mp4', mimeType: 'video/mp4' })
    let pZ = nzRed.project
    const nzCyan = await ingestFile({ project: pZ, sourcePath: cyan.path, originalName: 'hvs-nz-cyan.mp4', mimeType: 'video/mp4' })
    pZ = nzCyan.project
    pZ = (await commitCommands(pZ, [cmd('insertClip', { trackId: 'V1', assetId: nzRed.asset.id, start: fromSeconds(1), duration: fromSeconds(3) })])).project
    pZ = (await commitCommands(pZ, [cmd('appendClip', { trackId: 'V1', assetId: nzCyan.asset.id })])).project
    const zClips = [...pZ.timeline.tracks.find(t => t.id === 'V1')!.clips].sort((a, b) => a.start.ticks - b.start.ticks)
    pZ = (await commitCommands(pZ, [cmd('addTransition', { outgoingClipId: zClips[0].id, incomingClipId: zClips[1].id, transitionKind: 'dissolve', duration: fromSeconds(1) })])).project
    const zWin = dissolveWindowFor(pZ.timeline.tracks.find(t => t.id === 'V1')!, pZ.timeline.tracks.find(t => t.id === 'V1')!.transitions[0])
    expect('dissolve_nonzero_offset', Boolean(zWin && zWin.startSec >= 2.9), JSON.stringify(zWin ? { s: zWin.startSec, d: zWin.durationSec } : null))
    const rZ = await commitCommands(pZ, [cmd('render', { aspect: '16:9' })])
    pZ = await processRenderQueue(rZ.project.id) ?? rZ.project
    const jobZ = pZ.renderJobs.find(j => j.target.aspect === '16:9')
    expect('dissolve_nonzero_render', jobZ?.status === 'completed' && Boolean(jobZ.outputPath && existsSync(jobZ.outputPath)), `${jobZ?.status} ${jobZ?.error ?? ''}`)
  }
}

const failed = results.filter(item => !item.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-P1-SLICE-D', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-P1-SLICE-D', total: results.length }))
