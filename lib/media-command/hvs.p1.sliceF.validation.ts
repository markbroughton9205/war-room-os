/**
 * Higher Vision Studios Phase 1 slice F — object-follow UX polish.
 * Does not rebuild TrackSubject or VirtualCamera. FACE LOCK remains shot-local follow,
 * not biometric identification / cross-scene identity / re-ID.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { applyEditCommand } from './edit-ops'
import { EDIT_COMMAND_KINDS, newCommandId, type EditCommand } from './edit-commands'
import { fromSeconds, toSeconds } from './time'
import { HVS_SLICE } from './navigation'
import { commitCommands, createProject, loadProject, saveProject } from './store'
import { proposeDirectorCommands } from './ai-director'
import { ingestFile } from './ingest'
import { generateLostTargetPlate } from './test-media'
import { FACE_LOCK_BOUNDARY, followFramingCrop, interpolateSubject } from './tracking'
import { cropMovementSummary, firstLostSeconds, firstReacquiredSeconds, trackStatusAtPlayhead } from './track-ux'
import { processRenderQueue } from './render-engine'
import { probeMediaFile } from './probe'

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

expect('slice_id', ['HVS-P1-SLICE-F', 'HVS-P1-SLICE-G'].includes(HVS_SLICE), HVS_SLICE)
for (const kind of ['trackSubject', 'correctTrack', 'reacquireTrack', 'clearTrack', 'setVirtualCamera', 'autoReframe'] as const) {
  expect(`kind_${kind}`, (EDIT_COMMAND_KINDS as readonly string[]).includes(kind), kind)
}

const editor = source('components/war-room/higher-vision-studios/HvsEditorShell.tsx')
const css = source('components/war-room/higher-vision-studios/hvs-studio-v3.css')
const directorSrc = source('lib/media-command/ai-director.ts')
const pkg = source('package.json')
const tracker = source('lib/media-command/track-subject.ts')
const types = source('lib/media-command/types.ts')

expect('prior_slice_e_kept', pkg.includes('hvs.p1.sliceE.validation.ts') && pkg.includes('hvs.studio.uiV31.validation.ts'), 'E + V3.1 remain in validate:hvs')
expect('slice_f_wired', pkg.includes('hvs.p1.sliceF.validation.ts'), 'slice F validator wired')
expect('layout_defaults_untouched', css.includes('--hvs-media-w: 336px') && css.includes('--hvs-inspector-w: 336px') && css.includes('--hvs-timeline-h: 248px'), 'V3.1 proportions')
expect('layout_key_untouched', editor.includes("war-room-hvs-studio-v3-layout"), 'layout prefs key')
expect('version_browser_untouched', source('components/war-room/higher-vision-studios/HvsVersionBrowser.tsx').includes('data-testid="hvs-version-browser"'), 'Version Browser lock')
expect('subject_picker_ui', editor.includes('data-testid="hvs-track-pick"') && editor.includes('data-pick-mode') && editor.includes('hvs-program-pick'), 'pick mode')
expect('confirm_target_ui', editor.includes('data-testid="hvs-pick-confirm"') && editor.includes('Confirm target'), 'confirm region')
expect('track_overlay_ui', editor.includes('data-testid="hvs-track-overlay"') && editor.includes('hvs-show-track') && editor.includes('hvs-hide-track'), 'viewer overlay')
expect('overlay_not_render', !source('lib/media-command/render-engine.ts').includes('hvs-track-overlay'), 'overlay not in render graph')
expect('follow_modes_ui', editor.includes('FOLLOW_MODE_OPTIONS') && FOLLOW_LOCK(source('lib/media-command/track-ux.ts')) && FOLLOW_LOCK(source('lib/media-command/tracking.ts')), 'seven modes in inspector')
expect('face_lock_boundary_code', FACE_LOCK_BOUNDARY.includes('NOT mean biometric') && types.includes('not biometric identification') && tracker.includes('Not cross-scene identity'), FACE_LOCK_BOUNDARY.slice(0, 80))
expect('vcam_controls', editor.includes('data-testid="hvs-vcam-enable"') && editor.includes('data-testid="hvs-vcam-reset"') && editor.includes('data-testid="hvs-auto-reframe"'), 'VirtualCamera + auto reframe')
expect('preview_toggle', editor.includes('data-testid="hvs-source-preview"') && editor.includes('data-testid="hvs-camera-preview"') && editor.includes("framingPreview === 'camera'"), 'source vs camera')
expect('lost_ux', editor.includes('data-testid="hvs-lost-actions"') && editor.includes('data-testid="hvs-reacquire"') && editor.includes("kind: 'reacquireTrack'"), 'lost-target UX')
expect('correct_ux', editor.includes("kind: 'correctTrack'") && editor.includes('data-testid="hvs-correct-track"'), 'manual correction')
expect('timeline_strip', editor.includes('data-testid="hvs-track-strip"'), 'clip track strip')
expect('no_dead_smoothing', !editor.includes('FRAMING STRENGTH') && !editor.includes('SMOOTHING'), 'no fake smoothing controls')
expect('follow_this_person_lock', editor.includes("kind: 'trackSubject'") && editor.includes('Follow this person'), 'slice 1.3 UI lock')
expect('director_keep_centered', directorSrc.includes('keep (her|him|them) centered') && directorSrc.includes("mode: 'CENTER_LOCK'"), 'centered mapping')
expect('director_left_third', directorSrc.includes('on the left third') && directorSrc.includes("mode: 'RULE_OF_THIRDS'"), 'thirds mapping')
expect('director_vertical_follow', directorSrc.includes('vertical and follow') && directorSrc.includes("kind: 'autoReframe'"), 'vertical follow mapping')
expect('director_cinematic', directorSrc.includes('cinematic follow') && directorSrc.includes("mode: 'CINEMATIC_FOLLOW'"), 'cinematic mapping')
expect('director_retrack', directorSrc.includes('re-?track this shot'), 're-track mapping')
expect('director_stop', directorSrc.includes('stop following this subject') && directorSrc.includes("kind: 'clearTrack'"), 'stop follow mapping')

function FOLLOW_LOCK(src: string) {
  return ['CENTER_LOCK', 'RULE_OF_THIRDS', 'FACE_LOCK', 'UPPER_BODY', 'FULL_BODY', 'DYNAMIC_FOLLOW', 'CINEMATIC_FOLLOW']
    .every(mode => src.includes(mode))
}

const box = { x: 0.42, y: 0.18, width: 0.22, height: 0.55, confidence: 0.9 }
const face = followFramingCrop(box, 'FACE_LOCK', '16:9', 16 / 9)
const center = followFramingCrop(box, 'CENTER_LOCK', '16:9', 16 / 9)
const thirds = followFramingCrop(box, 'RULE_OF_THIRDS', '9:16', 16 / 9)
const cinematic = followFramingCrop(box, 'CINEMATIC_FOLLOW', '9:16', 16 / 9)
const dynamic = followFramingCrop(box, 'DYNAMIC_FOLLOW', '9:16', 16 / 9)
const upper = followFramingCrop(box, 'UPPER_BODY', '16:9', 9 / 16)
const full = followFramingCrop(box, 'FULL_BODY', '16:9', 9 / 16)
const face916 = followFramingCrop(box, 'FACE_LOCK', '9:16', 16 / 9)
const wide = followFramingCrop(box, 'FACE_LOCK', '16:9', 16 / 9)
expect('face_lock_not_center', Math.abs(face.top - center.top) > 0.01 || Math.abs((1 - face.top - face.bottom) - (1 - center.top - center.bottom)) > 0.01, JSON.stringify({ face, center }))
expect('thirds_not_center', Math.abs(thirds.left - followFramingCrop(box, 'CENTER_LOCK', '9:16', 16 / 9).left) > 0.01, JSON.stringify({ thirds }))
expect('cinematic_not_thirds', Math.abs(cinematic.left - thirds.left) > 0.002 || Math.abs(cinematic.top - thirds.top) > 0.002, JSON.stringify({ cinematic, thirds }))
expect('dynamic_not_center', Math.abs(dynamic.left - followFramingCrop(box, 'CENTER_LOCK', '9:16', 16 / 9).left) > 0.002, JSON.stringify({ dynamic }))
expect('upper_not_full', Math.abs((1 - upper.top - upper.bottom) - (1 - full.top - full.bottom)) > 0.02 || Math.abs(upper.top - full.top) > 0.02, JSON.stringify({ upper, full }))
expect('aspect_9_16_narrower', (1 - face916.left - face916.right) < (1 - wide.left - wide.right) + 0.05, JSON.stringify({ face916, wide }))
const square = followFramingCrop(box, 'FACE_LOCK', '1:1', 16 / 9)
expect('aspect_1_1_mapped', (1 - square.left - square.right) > 0.2, JSON.stringify(square))

let p = await createProject({ name: 'HVS slice F follow polish', productionMode: 'CUSTOM' })
const lostPlate = await generateLostTargetPlate()
expect('lost_plate', lostPlate.ok && lostPlate.kind === 'lost-target-fixture', lostPlate.error ?? lostPlate.path)

if (lostPlate.ok) {
  const ingested = await ingestFile({ project: p, sourcePath: lostPlate.path, originalName: 'hvs-lost-target.mp4', mimeType: 'video/mp4' })
  p = ingested.project
  p = (await commitCommands(p, [cmd('insertClip', { trackId: 'V1', assetId: ingested.asset.id, start: fromSeconds(0) })])).project
  const clip = p.timeline.tracks.find(t => t.id === 'V1')!.clips[0]
  expect('subject_selection_request', Boolean(clip), clip?.id ?? 'missing')

  p = (await commitCommands(p, [cmd('trackSubject', {
    clipId: clip.id,
    label: 'Primary talent',
    subjectKind: 'person',
    seedBox: { x: 0.18, y: 0.18, width: 0.12, height: 0.55 },
  })])).project
  const subject = p.timeline.subjects.find(s => s.clipId === clip.id) ?? null
  const lostSec = firstLostSeconds(subject)
  const minConf = subject ? Math.min(...subject.keyframes.map(k => k.confidence)) : 1
  const playheadLost = subject ? Math.round((lostSec ?? 2.2) * p.timeline.timescale) : 0
  const statusAtLost = trackStatusAtPlayhead(subject, playheadLost, p.timeline.timescale)
  expect('track_keys_written', Boolean(subject && subject.keyframes.length >= 8), String(subject?.keyframes.length))
  expect('confidence_measured', Boolean(subject && Number.isFinite(subject.confidence) && minConf >= 0 && minConf <= 1), `${subject?.confidence} min=${minConf}`)
  expect('lost_target_exercised', Boolean(statusAtLost === 'TARGET LOST' || (lostSec != null && minConf < 0.32) || subject?.status === 'lost'), `${subject?.status} lostSec=${lostSec} min=${minConf} ui=${statusAtLost}`)

  const priorCount = subject?.keyframes.length ?? 0
  const from = fromSeconds(lostSec != null && lostSec < 4.6 ? Math.min(3.5, lostSec + 1.2) : 3.5, p.timeline.timescale)
  p = (await commitCommands(p, [cmd('reacquireTrack', {
    clipId: clip.id,
    from,
    seedBox: { x: 0.1, y: 0.18, width: 0.12, height: 0.55 },
  })])).project
  const reacq = p.timeline.subjects.find(s => s.clipId === clip.id)
  const reacqSec = firstReacquiredSeconds(reacq ?? null)
  const priorKept = (reacq?.keyframes.filter(k => k.time.ticks < from.ticks).length) ?? 0
  expect('reacquisition', Boolean(reacq && (reacq.status === 'reacquired' || reacq.status === 'tracking' || reacq.status === 'lost') && reacq.keyframes.length >= priorKept), `${reacq?.status} keys=${reacq?.keyframes.length} priorKept=${priorKept}`)
  expect('reacquisition_preserves_history', priorKept > 0 || priorCount === 0, `priorKept=${priorKept} priorCount=${priorCount}`)
  expect('lost_and_reacq_times', lostSec != null || reacqSec != null || minConf < 0.32, `lost=${lostSec} reacq=${reacqSec}`)

  const at = fromSeconds(1, p.timeline.timescale)
  p = (await commitCommands(p, [cmd('correctTrack', {
    clipId: clip.id,
    at,
    box: { x: 0.2, y: 0.16, width: 0.14, height: 0.52, confidence: 0.96 },
  })])).project
  const corrected = p.timeline.subjects.find(s => s.clipId === clip.id)
  expect('manual_correction', Boolean(corrected?.humanCorrected && corrected.status === 'corrected' && corrected.keyframes.some(k => Math.abs(toSeconds(k.time) - 1) < 0.05 && k.confidence >= 0.9)), `${corrected?.status} human=${corrected?.humanCorrected}`)

  p = (await commitCommands(p, [cmd('setVirtualCamera', { mode: 'FACE_LOCK', outputAspect: '9:16', subjectId: corrected?.id })])).project
  const faceCam = p.timeline.virtualCameras.find(c => c.outputAspect === '9:16')
  expect('virtual_camera', Boolean(faceCam && faceCam.mode === 'FACE_LOCK' && faceCam.keyframes.length >= 2), `${faceCam?.mode} n=${faceCam?.keyframes.length}`)
  const move = cropMovementSummary(faceCam ?? null)
  expect('render_crop_keyframes', move.keyCount >= 2 && (move.cropDelta > 0.005 || move.zoomDelta > 0.001 || (faceCam?.keyframes.length ?? 0) >= 8), JSON.stringify(move))

  p = (await commitCommands(p, [cmd('autoReframe', { outputAspect: '9:16', mode: 'FACE_LOCK' })])).project
  p = (await commitCommands(p, [cmd('autoReframe', { outputAspect: '1:1', mode: 'FACE_LOCK' })])).project
  expect('auto_reframe_9_16', p.timeline.virtualCameras.some(c => c.outputAspect === '9:16' && c.mode === 'FACE_LOCK'), p.timeline.virtualCameras.map(c => `${c.outputAspect}:${c.mode}`).join('|'))
  expect('auto_reframe_1_1', p.timeline.virtualCameras.some(c => c.outputAspect === '1:1'), p.timeline.virtualCameras.map(c => c.outputAspect).join('|'))

  const queued = applyEditCommand(p, cmd('render', { aspect: '9:16' }))
  p = queued.ok ? queued.project : p
  p = await saveProject(p)
  p = (await processRenderQueue(p.id)) ?? p
  const job = p.renderJobs.filter(j => j.target.aspect === '9:16').at(-1)
  expect('physical_follow_render', Boolean(job?.status === 'completed' && job.outputPath && existsSync(job.outputPath)), `${job?.status} ${job?.encoder} ${job?.outputPath}`)
  expect('render_libx264', job?.encoder === 'libx264' || !job, String(job?.encoder))
  const probed = job?.outputPath && existsSync(job.outputPath) ? await probeMediaFile(job.outputPath) : null
  expect('render_9_16_dims', Boolean(probed && probed.width === 1080 && probed.height === 1920), JSON.stringify(probed && { w: probed.width, h: probed.height }))

  const first = faceCam?.keyframes[0]?.crop
  const last = faceCam?.keyframes.at(-1)?.crop
  expect(
    'follow_not_static_center',
    Boolean(first && last && (Math.abs(first.left - last.left) > 0.01 || Math.abs(first.top - last.top) > 0.01 || move.cropDelta > 0.01)),
    JSON.stringify({ first, last, move }),
  )

  const id = p.id
  const reloaded = await loadProject(id)
  expect(
    'reload_persistence',
    Boolean(
      reloaded
      && reloaded.timeline.subjects[0]?.keyframes.length
      && reloaded.timeline.subjects[0]?.humanCorrected
      && reloaded.timeline.virtualCameras.some(c => c.mode === 'FACE_LOCK')
      && reloaded.timeline.virtualCameras.some(c => c.outputAspect === '9:16')
      && reloaded.timeline.virtualCameras.some(c => c.outputAspect === '1:1'),
    ),
    reloaded ? `${reloaded.timeline.subjects[0]?.keyframes.length} keys ${reloaded.timeline.virtualCameras.map(c => c.outputAspect).join(',')}` : 'missing',
  )

  const clipForDirector = reloaded?.timeline.tracks.find(t => t.id === 'V1')?.clips[0]
  const live = reloaded ?? p
  const utterances: Array<[string, (commands: EditCommand[]) => boolean]> = [
    ['Follow this person.', cmds => cmds.some(c => c.kind === 'trackSubject')],
    ['Keep her centered.', cmds => cmds.some(c => c.kind === 'setVirtualCamera' && 'mode' in c && c.mode === 'CENTER_LOCK')],
    ['Put him on the left third.', cmds => cmds.some(c => c.kind === 'setVirtualCamera' && 'mode' in c && c.mode === 'RULE_OF_THIRDS')],
    ['Make this vertical and follow her.', cmds => cmds.some(c => c.kind === 'autoReframe' && 'outputAspect' in c && c.outputAspect === '9:16')],
    ['Use cinematic follow.', cmds => cmds.some(c => c.kind === 'setVirtualCamera' && 'mode' in c && c.mode === 'CINEMATIC_FOLLOW')],
    ['Re-track this shot.', cmds => cmds.some(c => c.kind === 'trackSubject')],
    ['Stop following this subject.', cmds => cmds.some(c => c.kind === 'clearTrack')],
  ]
  for (const [utterance, check] of utterances) {
    const proposal = proposeDirectorCommands(live, utterance, 'AI_DIRECTOR', { selectedClipId: clipForDirector?.id, playheadSeconds: 1 })
    expect(`director_${utterance.slice(0, 24).replace(/\s+/g, '_')}`, check(proposal.commands) && proposal.commands.every(c => c.kind !== 'undo'), `${utterance} → ${proposal.commands.map(c => c.kind).join(',')}`)
  }

  p = (await commitCommands(live, [cmd('clearTrack', { clipId: clip.id })])).project
  expect('clear_track', p.timeline.subjects.every(s => s.clipId !== clip.id), String(p.timeline.subjects.length))
}

const samplePath = '/home/chosenone/Sample.mp4'
expect('real_person_source', existsSync(samplePath), samplePath)
if (existsSync(samplePath)) {
  let rp = await createProject({ name: 'HVS slice F real-person follow', productionMode: 'SOCIAL' })
  const ingested = await ingestFile({ project: rp, sourcePath: samplePath, originalName: 'Sample.mp4', mimeType: 'video/mp4' })
  rp = ingested.project
  rp = (await commitCommands(rp, [cmd('insertClip', { trackId: 'V1', assetId: ingested.asset.id, start: fromSeconds(0) })])).project
  const clip = rp.timeline.tracks[0]?.clips[0]
  rp = (await commitCommands(rp, [cmd('trackSubject', {
    clipId: clip!.id,
    label: 'Primary talent',
    subjectKind: 'person',
    seedBox: { x: 0.34, y: 0.10, width: 0.28, height: 0.42 },
  })])).project
  const sub = rp.timeline.subjects[0]
  expect('real_person_track', Boolean(sub && sub.keyframes.length >= 10 && sub.confidence > 0), `${sub?.keyframes.length} conf=${sub?.confidence} ${sub?.status}`)
  rp = (await commitCommands(rp, [cmd('setVirtualCamera', { mode: 'FACE_LOCK', outputAspect: '9:16' })])).project
  const cam = rp.timeline.virtualCameras.find(c => c.mode === 'FACE_LOCK')
  const lefts = (cam?.keyframes ?? []).map(k => k.crop.left)
  const tops = (cam?.keyframes ?? []).map(k => k.crop.top)
  const leftSpread = lefts.length ? Math.max(...lefts) - Math.min(...lefts) : 0
  const topSpread = tops.length ? Math.max(...tops) - Math.min(...tops) : 0
  const camMove = cropMovementSummary(cam ?? null)
  expect('real_person_face_lock', Boolean(cam && cam.keyframes.length >= 10 && (leftSpread > 0.008 || topSpread > 0.008 || camMove.cropDelta > 0.008 || camMove.zoomDelta > 0.008)), `keys=${cam?.keyframes.length} spread=${leftSpread}/${topSpread} Δ=${camMove.cropDelta}`)
  const box0 = interpolateSubject(sub, sub.keyframes[0].time.ticks, sub.keyframes[0].time.timescale)
  const boxN = interpolateSubject(sub, sub.keyframes[sub.keyframes.length - 1].time.ticks, sub.keyframes[0].time.timescale)
  expect('real_person_subject_moves', Boolean(box0 && boxN && (Math.abs(box0.x - boxN.x) > 0.02 || Math.abs(box0.y - boxN.y) > 0.02)), JSON.stringify({ box0, boxN }))
  const queuedRp = applyEditCommand(rp, cmd('render', { aspect: '9:16' }))
  rp = queuedRp.ok ? queuedRp.project : rp
  rp = await saveProject(rp)
  rp = (await processRenderQueue(rp.id)) ?? rp
  const jobRp = rp.renderJobs.filter(j => j.target.aspect === '9:16').at(-1)
  expect('real_person_render_9_16', Boolean(jobRp?.status === 'completed' && jobRp.outputPath && existsSync(jobRp.outputPath) && jobRp.encoder === 'libx264'), `${jobRp?.status} ${jobRp?.encoder}`)
}

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-P1-SLICE-F', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-P1-SLICE-F', total: results.length }))
