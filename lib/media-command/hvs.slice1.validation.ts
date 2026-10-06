/**
 * Higher Vision Studios slice-1 — luxury-beauty production loop.
 * `pnpm run validate:hvs` runs slice-0 then this file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'
import { applyEditCommand } from './edit-ops'
import { emptyProject } from './types'
import { proposeDirectorCommands } from './ai-director'
import { LUXURY_BEAUTY_V1_ID } from './themes'
import { followFramingCrop } from './tracking'
import { fromSeconds, toSeconds } from './time'
import { chooseEncoder, overrideFfmpegTools, resetFfmpegCache, resolveFfmpegTools, bundledToolPath, reportNvenc } from './ffmpeg'
import { generateStarrdomTestClip, generateStarrdomTone } from './test-media'
import { ingestFile } from './ingest'
import { createProject, saveProject } from './store'
import { processRenderQueue } from './render-engine'
import { trackPersonInClip } from './track-subject'
import { newCommandId, type EditCommand } from './edit-commands'
import { probeMediaFile } from './probe'
import { hvsDemoLogoSvg } from './graphics'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
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

const tools = await resolveFfmpegTools()
const bundledFfmpeg = bundledToolPath('ffmpeg')
const bundledFfprobe = bundledToolPath('ffprobe')
expect('ffmpeg_present', Boolean(tools.ffmpeg && existsSync(tools.ffmpeg)), tools.ffmpeg ?? 'unresolved')
expect('ffprobe_present', Boolean(tools.ffprobe && existsSync(tools.ffprobe)), tools.ffprobe ?? 'unresolved')
expect('bundled_ffmpeg_canonical', tools.ffmpeg === bundledFfmpeg, `${tools.ffmpeg} vs ${bundledFfmpeg}`)
expect('bundled_ffprobe_canonical', tools.ffprobe === bundledFfprobe, `${tools.ffprobe} vs ${bundledFfprobe}`)

const encoder = await chooseEncoder()
const nvenc = await reportNvenc()
expect('encoder_policy', encoder.videoCodec === 'libx264' || encoder.videoCodec === 'h264_nvenc', encoder.label)
if (nvenc.status === 'PASS') {
  expect('nvenc_status', encoder.videoCodec === 'h264_nvenc', nvenc.detail)
} else if (nvenc.status === 'PRESENT_RUNTIME_FAILED') {
  expect('nvenc_status', encoder.videoCodec === 'libx264', `PRESENT / RUNTIME FAILED — CPU fallback. ${nvenc.detail}`)
} else {
  expect('nvenc_status', encoder.videoCodec === 'libx264' && !nvenc.h264NvencListed, `ABSENT — ${nvenc.detail}`)
}

if (!tools.ffmpeg || !tools.ffprobe) {
  overrideFfmpegTools({ ffmpeg: null, ffprobe: null })
  const blockedProject = emptyProject({ id: 'hvs-no-ff', name: 'No ffmpeg' })
  blockedProject.renderJobs.push({
    id: 'rjob-block',
    projectId: blockedProject.id,
    versionId: blockedProject.currentVersionId,
    status: 'queued',
    target: { aspect: '16:9', width: 1920, height: 1080, format: 'mp4', videoCodec: 'h264', audioCodec: 'aac' },
    outputPath: null,
    outputAssetId: null,
    encoder: null,
    probe: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    blockedReason: null,
  })
  await saveProject(blockedProject)
  const processed = await processRenderQueue(blockedProject.id)
  expect(
    'render_blocked_without_ffmpeg',
    processed?.renderJobs[0]?.status === 'blocked',
    processed?.renderJobs[0]?.status ?? 'missing',
  )
  resetFfmpegCache()
  overrideFfmpegTools(null)
  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  console.log(JSON.stringify({ ok: failed.length === 0, slice: 'HVS-V1-SLICE-1', total: results.length, failed: failed.length, note: 'Bundled HVS ffmpeg/ffprobe was not resolved — media loop not executed' }))
  process.exit(failed.length ? 1 : 0)
}

const plate = await generateStarrdomTestClip()
expect('test_plate_generated', plate.ok && existsSync(plate.path), plate.error ?? plate.path)
const tone = await generateStarrdomTone()
expect('test_tone_generated', tone.ok && existsSync(tone.path), tone.error ?? tone.path)

const project = await createProject({
  name: 'HIGHER VISION DEMO COMMERCIAL',
  productionMode: 'COMMERCIAL',
  starrdom: true,
})

const ingested = await ingestFile({
  project,
  sourcePath: plate.path,
  originalName: 'hvs-demo-plate.mp4',
  mimeType: 'video/mp4',
})
const asset = ingested.asset
expect('ingest_checksum', /^[a-f0-9]{64}$/.test(asset.checksumSha256), asset.checksumSha256)
expect('ingest_probe_dims', asset.width === 1920 && asset.height === 1080, `${asset.width}x${asset.height}`)
expect('ingest_codec', Boolean(asset.codec && asset.container), `${asset.codec}/${asset.container}`)
expect('ingest_duration', toSeconds(asset.duration) > 1, String(toSeconds(asset.duration)))
expect('ingest_original_immutable', existsSync(asset.originalPath) && asset.immutableOriginal === true, asset.originalPath)
expect('ingest_thumbnail', Boolean(asset.thumbPath && existsSync(asset.thumbPath)), asset.thumbPath ?? 'none')
expect('ingest_proxy', Boolean(asset.proxyPath && existsSync(asset.proxyPath)), asset.proxyPath ?? 'none')
expect('ingest_proxy_not_original', asset.proxyPath !== asset.originalPath, 'proxy overwrote original')
expect('ingest_waveform', Boolean(asset.waveformPath && existsSync(asset.waveformPath)), asset.waveformPath ?? 'none')
if (asset.waveformPath && existsSync(asset.waveformPath)) {
  const wave = JSON.parse(readFileSync(asset.waveformPath, 'utf8')) as { samples?: number[] }
  expect('waveform_samples', Array.isArray(wave.samples) && (wave.samples?.length ?? 0) > 10, String(wave.samples?.length))
}

const musicIn = await ingestFile({
  project: ingested.project,
  sourcePath: tone.path,
  originalName: 'hvs-demo-music.wav',
  mimeType: 'audio/wav',
})

let current = musicIn.project
const insert = applyEditCommand(current, cmd('insertClip', {
  trackId: 'V1',
  assetId: asset.id,
  start: fromSeconds(0),
}))
expect('editop_insert', insert.ok, insert.ok ? 'ok' : insert.error)
current = insert.ok ? insert.project : current
const clipId = current.timeline.tracks[0].clips[0]?.id ?? ''

const split = applyEditCommand(current, cmd('splitClip', { clipId, at: fromSeconds(1.2) }))
expect('editop_split', split.ok && split.project.timeline.tracks[0].clips.length === 2, split.ok ? 'ok' : split.error)
current = split.ok ? split.project : current
const leftId = current.timeline.tracks[0].clips[0].id
const rightId = current.timeline.tracks[0].clips[1].id

const trim = applyEditCommand(current, cmd('trimClip', { clipId: leftId, edge: 'out', to: fromSeconds(1.0) }))
expect('editop_trim', trim.ok, trim.ok ? 'ok' : trim.error)
current = trim.ok ? trim.project : current

const moved = applyEditCommand(current, cmd('moveClip', { clipId: rightId, trackId: 'V1', start: fromSeconds(1.05) }))
expect('editop_move', moved.ok, moved.ok ? 'ok' : moved.error)
current = moved.ok ? moved.project : current

const rippled = applyEditCommand(current, cmd('rippleDelete', { clipId: current.timeline.tracks[0].clips[1].id }))
expect('editop_rippleDelete', rippled.ok && rippled.project.timeline.tracks[0].clips.length === 1, rippled.ok ? 'ok' : rippled.error)
current = rippled.ok ? rippled.project : current
const liveClip = current.timeline.tracks[0].clips[0]

const xform = applyEditCommand(current, cmd('setTransform', { clipId: liveClip.id, transform: { scaleX: 1.05, scaleY: 1.05 } }))
expect('editop_setTransform', xform.ok, xform.ok ? 'ok' : xform.error)
current = xform.ok ? xform.project : current

const cap = applyEditCommand(current, cmd('addCaption', {
  start: fromSeconds(0.4),
  end: fromSeconds(2.4),
  text: 'Luxury Beauty Demo',
  position: 'bottom',
  fontSize: 38,
}))
expect('editop_addCaption', cap.ok && cap.project.timeline.captionTracks[0].cues.length >= 1, cap.ok ? 'ok' : cap.error)
current = cap.ok ? cap.project : current

const logoSvg = path.join(mediaCommandDataHierarchy().tmp, `hvs-slice1-logo-${Date.now()}.svg`)
writeFileSync(logoSvg, hvsDemoLogoSvg())
const logoIn = await ingestFile({
  project: current,
  sourcePath: logoSvg,
  originalName: 'hvs-demo-logo.svg',
  mimeType: 'image/svg+xml',
})
expect('ingest_svg_logo', logoIn.asset.kind === 'logo' && logoIn.asset.originalPath.endsWith('.svg'), logoIn.asset.originalPath)
expect(
  'ingest_svg_derived_png',
  logoIn.project.assets.some(a => a.provenance?.parentAssetId === logoIn.asset.id && a.mimeType === 'image/png' && Boolean(a.originalPath)),
  logoIn.project.assets.filter(a => a.kind === 'logo').map(a => a.mimeType).join(','),
)
current = logoIn.project
const logo = applyEditCommand(current, cmd('addLogo', {
  assetId: logoIn.asset.id,
  start: fromSeconds(2.0),
  duration: fromSeconds(1.5),
  x: 0.84,
  y: 0.08,
  scale: 0.16,
}))
expect('editop_addLogo', logo.ok, logo.ok ? 'ok' : logo.error)
current = logo.ok ? logo.project : current

const themed = applyEditCommand(current, cmd('applyTheme', { actor: 'ai-director', themeId: LUXURY_BEAUTY_V1_ID }))
expect('editop_applyTheme', themed.ok && themed.project.timeline.themeId === LUXURY_BEAUTY_V1_ID, themed.ok ? 'ok' : themed.error)
current = themed.ok ? themed.project : current

const music = applyEditCommand(current, cmd('addMusic', { assetId: musicIn.asset.id, trackId: 'A2' }))
expect('editop_addMusic', music.ok, music.ok ? 'ok' : music.error)
current = music.ok ? music.project : current
const musicClip = current.timeline.tracks.find(t => t.id === 'A2')?.clips[0]
const vol = musicClip
  ? applyEditCommand(current, cmd('setVolume', { clipId: musicClip.id, volume: 0.4 }))
  : music
expect('editop_setVolume', vol.ok, vol.ok ? 'ok' : vol.error)
current = vol.ok ? vol.project : current
const ducked = applyEditCommand(current, cmd('duckMusic', { duckDb: -8 }))
expect('editop_duck', ducked.ok, ducked.ok ? 'ok' : ducked.error)
current = ducked.ok ? ducked.project : current

current = await saveProject(current)
const tracked = await trackPersonInClip(current, { clipId: current.timeline.tracks[0].clips[0].id, seedBox: { x: 0.22, y: 0.14, width: 0.18, height: 0.58 } })
expect('track_keyframes', tracked.keyframes.length >= 4, String(tracked.keyframes.length))
expect('track_confidence_visible', tracked.confidence >= 0, String(tracked.confidence))
expect('track_status', tracked.status === 'tracking' || tracked.status === 'lost' || tracked.status === 'reacquired', tracked.status)
const subjectCmd = applyEditCommand(current, cmd('trackSubject', {
  clipId: current.timeline.tracks[0].clips[0].id,
  label: 'Primary talent',
  subjectKind: 'person',
  seedBox: { x: 0.22, y: 0.14, width: 0.18, height: 0.58 },
  keyframes: tracked.keyframes,
  status: tracked.status,
  confidence: tracked.confidence,
}))
expect('tracksubject_stored', subjectCmd.ok && subjectCmd.project.timeline.subjects[0]?.keyframes.length >= 2, subjectCmd.ok ? 'ok' : subjectCmd.error)
current = subjectCmd.ok ? subjectCmd.project : current

const follow = applyEditCommand(current, cmd('setVirtualCamera', { mode: 'FACE_LOCK', outputAspect: '9:16', subjectId: current.timeline.subjects[0]?.id }))
expect('virtualcamera_9_16', follow.ok && follow.project.timeline.virtualCameras.some(c => c.outputAspect === '9:16'), follow.ok ? 'ok' : follow.error)
current = follow.ok ? follow.project : current
const crop = followFramingCrop(tracked.keyframes[0], 'FACE_LOCK', '9:16')
const staticCenter = followFramingCrop({ x: 0.4, y: 0.25, width: 0.2, height: 0.5 }, 'CENTER_LOCK', '9:16')
expect('not_static_center_crop', Math.abs(crop.left - staticCenter.left) > 0.02 || Math.abs(crop.top - staticCenter.top) > 0.02, JSON.stringify({ crop, staticCenter }))

const vertical = applyEditCommand(current, cmd('deriveVerticalVersion', {
  versionLabel: 'HIGHER VISION DEMO — 9:16 VERTICAL',
  mode: 'FACE_LOCK',
}))
expect(
  'vertical_version_provenance',
  vertical.ok
    && vertical.project.timeline.aspect === '9:16'
    && vertical.project.versions.some(v => v.role === 'derived' && v.derivedFromVersionId),
  vertical.ok ? vertical.project.versions.map(v => v.label).join(' | ') : vertical.error,
)
current = vertical.ok ? vertical.project : current

const proposal = proposeDirectorCommands(current, 'Split this clip at the playhead.', 'AI_DIRECTOR', { playheadSeconds: 0.6 })
expect('director_split_playhead', proposal.commands.some(c => c.kind === 'splitClip'), proposal.commands.map(c => c.kind).join(','))
const committed = applyEditCommand(current, proposal.commands.find(c => c.kind === 'splitClip') ?? proposal.commands[0])
expect('director_commit_live', committed.ok, committed.ok ? 'ok' : committed.error)
current = committed.ok ? committed.project : current

current.timeline.aspect = '16:9'
current.timeline.width = 1920
current.timeline.height = 1080
const r16 = applyEditCommand(current, cmd('render', { aspect: '16:9' }))
current = r16.ok ? r16.project : current
current = await saveProject(current)
current = (await processRenderQueue(current.id)) ?? current
const job16 = current.renderJobs.find(j => j.target.aspect === '16:9')
expect('render_16x9_file', Boolean(job16?.status === 'completed' && job16.outputPath && existsSync(job16.outputPath)), `${job16?.status} ${job16?.error ?? job16?.outputPath}`)
if (job16?.outputPath && existsSync(job16.outputPath)) {
  const p = await probeMediaFile(job16.outputPath)
  expect('render_16x9_probe', p.hasVideo && p.width === 1920 && p.height === 1080 && p.durationSec > 0.2, JSON.stringify({ w: p.width, h: p.height, d: p.durationSec, a: p.hasAudio }))
} else {
  expect('render_16x9_probe', false, 'no file')
}

const r9 = applyEditCommand(current, cmd('render', { aspect: '9:16' }))
current = r9.ok ? r9.project : current
current = await saveProject(current)
current = (await processRenderQueue(current.id)) ?? current
const job9 = current.renderJobs.find(j => j.target.aspect === '9:16')
expect('render_9x16_file', Boolean(job9?.status === 'completed' && job9.outputPath && existsSync(job9.outputPath)), `${job9?.status} ${job9?.error ?? job9?.outputPath}`)
if (job9?.outputPath && existsSync(job9.outputPath)) {
  const p = await probeMediaFile(job9.outputPath)
  expect('render_9x16_probe', p.hasVideo && p.width === 1080 && p.height === 1920 && p.durationSec > 0.2, JSON.stringify({ w: p.width, h: p.height, d: p.durationSec, a: p.hasAudio }))
} else {
  expect('render_9x16_probe', false, 'no file')
}
expect('render_assets_linked', current.assets.some(a => a.outputOfRenderJobId === job16?.id) && current.assets.some(a => a.outputOfRenderJobId === job9?.id), String(current.assets.filter(a => a.outputOfRenderJobId).length))
expect('render_encoder_recorded', job16?.encoder === 'libx264' || job16?.encoder === 'h264_nvenc', String(job16?.encoder))

overrideFfmpegTools({ ffmpeg: null, ffprobe: null })
const failJob = applyEditCommand(current, cmd('render', { aspect: '16:9' }))
current = failJob.ok ? failJob.project : current
current = await saveProject(current)
current = (await processRenderQueue(current.id)) ?? current
const blocked = [...current.renderJobs].reverse().find(j => j.status === 'blocked')
expect('ffmpeg_missing_does_not_succeed', blocked?.status === 'blocked' && !blocked.outputPath, blocked?.status ?? 'none')
overrideFfmpegTools(null)
resetFfmpegCache()

expect('shell_not_rebuilt', existsSync(path.join(process.cwd(), 'app/higher-vision-studios/page.tsx')), 'route')
expect('video_intelligence_boundary', existsSync(path.join(process.cwd(), 'app/higher-vision-studios/video-intelligence/page.tsx')), 'VI')

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-V1-SLICE-1', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-V1-SLICE-1', total: results.length }))
