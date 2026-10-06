/**
 * Higher Vision Studios slice-1.3 — real-person FACE LOCK follow.
 * Uses Commander-provided Sample.mp4. Does not substitute the synthetic person fixture.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { applyEditCommand } from './edit-ops'
import { newCommandId, type EditCommand } from './edit-commands'
import { fromSeconds, toSeconds } from './time'
import { ingestFile } from './ingest'
import { createProject, commitCommands, loadProject, saveProject } from './store'
import { trackPersonInClip } from './track-subject'
import { followFramingCrop, sourcePixelRatio } from './tracking'
import { processRenderQueue } from './render-engine'
import { probeMediaFile } from './probe'
import { resolveFfmpegTools } from './ffmpeg'

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

const tracker = source('lib/media-command/track-subject.ts')
const framing = source('lib/media-command/tracking.ts')
expect('portrait_tracking_geometry', tracker.includes('PORTRAIT_W') && tracker.includes('PORTRAIT_H'), 'portrait working size')
expect('framing_uses_source_ratio', framing.includes('sourcePixelRatio') && framing.includes('sourceRatio = 16 / 9'), 'followFramingCrop sourceRatio')
expect('follow_ui_wires_tracksubject', source('components/war-room/higher-vision-studios/HvsEditorShell.tsx').includes("kind: 'trackSubject'") && source('components/war-room/higher-vision-studios/HvsEditorShell.tsx').includes('Follow this person'), 'Follow this person')

const samplePath = '/home/chosenone/Sample.mp4'
expect('sample_mp4_present', existsSync(samplePath), samplePath)
const tools = await resolveFfmpegTools()
expect('bundled_ffmpeg', Boolean(tools.ffmpeg?.includes('/media-command/tools/ffmpeg')), tools.ffmpeg ?? 'missing')
expect('bundled_ffprobe', Boolean(tools.ffprobe?.includes('/media-command/tools/ffprobe')), tools.ffprobe ?? 'missing')

if (existsSync(samplePath)) {
  const project = await createProject({ name: 'HIGHER VISION REAL PERSON FOLLOW TEST', productionMode: 'SOCIAL' })
  const ingested = await ingestFile({
    project,
    sourcePath: samplePath,
    originalName: 'Sample.mp4',
    mimeType: 'video/mp4',
  })
  const asset = ingested.asset
  expect('ingest_name', asset.name === 'Sample.mp4', asset.name)
  expect('ingest_dims', asset.width === 512 && asset.height === 910, `${asset.width}x${asset.height}`)
  expect('ingest_duration', Math.abs(toSeconds(asset.duration) - 9.7) < 0.1, String(toSeconds(asset.duration)))
  expect('ingest_codec', asset.codec === 'h264', String(asset.codec))
  expect('ingest_immutable', asset.immutableOriginal === true && existsSync(asset.originalPath), asset.originalPath)
  expect('ingest_checksum', /^[a-f0-9]{64}$/.test(asset.checksumSha256), asset.checksumSha256)
  expect('ingest_proxy', Boolean(asset.proxyPath && existsSync(asset.proxyPath) && asset.proxyPath !== asset.originalPath), asset.proxyPath ?? 'none')
  expect('ingest_thumb', Boolean(asset.thumbPath && existsSync(asset.thumbPath)), asset.thumbPath ?? 'none')
  expect('ingest_waveform', Boolean(asset.waveformPath && existsSync(asset.waveformPath)), asset.waveformPath ?? 'none')

  const inserted = await commitCommands(ingested.project, [cmd('insertClip', { trackId: 'V1', assetId: asset.id, start: fromSeconds(0) })])
  const clip = inserted.project.timeline.tracks[0]?.clips[0]
  expect('clip_on_timeline', Boolean(clip), clip?.id ?? 'missing')

  const tracked = clip
    ? await trackPersonInClip(inserted.project, { clipId: clip.id, seedBox: { x: 0.38, y: 0.20, width: 0.24, height: 0.5 } })
    : { keyframes: [], status: 'lost' as const, confidence: 0, warnings: ['no clip'] }
  const xs = tracked.keyframes.map(k => k.x)
  const ys = tracked.keyframes.map(k => k.y)
  const cs = tracked.keyframes.map(k => k.confidence)
  const xSpread = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
  const ySpread = ys.length ? Math.max(...ys) - Math.min(...ys) : 0
  expect('track_status', tracked.status === 'tracking', `${tracked.status} ${tracked.warnings.join(';')}`)
  expect('track_keys', tracked.keyframes.length >= 20, String(tracked.keyframes.length))
  expect('track_confidence', cs.length > 0 && Math.min(...cs) > 0.3 && Math.max(...cs) <= 1, cs.length ? `${Math.min(...cs)}-${Math.max(...cs)}` : 'none')
  expect('track_xy_spread', xSpread > 0.04 || ySpread > 0.02, `x=${xSpread} y=${ySpread}`)
  expect('not_synthetic_fixture', asset.name === 'Sample.mp4' && asset.width === 512, asset.name)

  const stored = applyEditCommand(inserted.project, cmd('trackSubject', {
    clipId: clip!.id,
    label: 'Primary talent',
    subjectKind: 'person',
    keyframes: tracked.keyframes,
    status: tracked.status,
    confidence: tracked.confidence,
  }))
  const ratio = sourcePixelRatio(asset.width, asset.height)
  const follow = stored.ok
    ? applyEditCommand(stored.project, cmd('setVirtualCamera', { mode: 'FACE_LOCK', outputAspect: '9:16', subjectId: stored.project.timeline.subjects[0]?.id }))
    : stored
  const cam = follow.ok ? follow.project.timeline.virtualCameras.find(c => c.outputAspect === '9:16') : null
  const lefts = (cam?.keyframes ?? []).map(k => k.crop.left)
  const leftSpread = lefts.length ? Math.max(...lefts) - Math.min(...lefts) : 0
  const firstCrop = cam?.keyframes[0]?.crop
  const lastCrop = cam?.keyframes.at(-1)?.crop
  const center = followFramingCrop({ x: 0.4, y: 0.25, width: 0.2, height: 0.5 }, 'CENTER_LOCK', '9:16', ratio)
  expect('face_lock_camera', Boolean(cam && cam.mode === 'FACE_LOCK' && (cam.keyframes?.length ?? 0) >= 20), `${cam?.mode} n=${cam?.keyframes.length}`)
  expect(
    'dynamic_not_center_crop',
    Boolean(firstCrop && lastCrop && (Math.abs(firstCrop.left - lastCrop.left) > 0.02 || Math.abs(firstCrop.top - lastCrop.top) > 0.02) && leftSpread > 0.02),
    JSON.stringify({ firstCrop, lastCrop, leftSpread, center }),
  )

  const vertical = follow.ok
    ? applyEditCommand(follow.project, cmd('deriveVerticalVersion', { versionLabel: 'HIGHER VISION REAL PERSON FOLLOW TEST — 9:16 VERTICAL', mode: 'FACE_LOCK' }))
    : follow
  expect(
    'derived_9_16_provenance',
    Boolean(vertical.ok && vertical.project.timeline.aspect === '9:16' && vertical.project.versions.some(v => v.role === 'derived' && v.derivedFromVersionId)),
    vertical.ok ? vertical.project.versions.map(v => `${v.role}:${v.aspect}`).join('|') : vertical.error ?? 'fail',
  )

  let current = vertical.ok ? vertical.project : inserted.project
  const queued = applyEditCommand(current, cmd('render', { aspect: '9:16' }))
  current = queued.ok ? queued.project : current
  current = await saveProject(current)
  current = (await processRenderQueue(current.id)) ?? current
  const job = current.renderJobs.filter(j => j.target.aspect === '9:16').at(-1)
  expect('render_9x16_file', Boolean(job?.status === 'completed' && job.outputPath && existsSync(job.outputPath)), `${job?.status} ${job?.encoder} ${job?.outputPath}`)
  expect('render_encoder_libx264', job?.encoder === 'libx264', String(job?.encoder))
  const probed = job?.outputPath && existsSync(job.outputPath) ? await probeMediaFile(job.outputPath) : null
  expect('ffprobe_1080x1920', Boolean(probed && probed.width === 1080 && probed.height === 1920 && probed.durationSec > 0 && probed.hasVideo), JSON.stringify(probed && { w: probed.width, h: probed.height, d: probed.durationSec, a: probed.hasAudio }))
  expect('output_assetrecord', current.assets.some(a => a.generated && a.width === 1080 && a.height === 1920), String(current.assets.filter(a => a.generated).map(a => a.name)))

  const reloaded = await loadProject(current.id)
  expect(
    'persistence_reload',
    Boolean(
      reloaded
      && reloaded.assets.some(a => a.name === 'Sample.mp4')
      && reloaded.timeline.subjects[0]?.keyframes.length
      && reloaded.timeline.virtualCameras.some(c => c.mode === 'FACE_LOCK' && c.keyframes.length >= 2)
      && reloaded.versions.some(v => v.role === 'derived')
      && reloaded.renderJobs.some(j => j.target.aspect === '9:16' && j.status === 'completed'),
    ),
    reloaded?.id ?? 'missing',
  )
} else {
  expect('real_person_follow', false, 'Sample.mp4 missing — REAL_PERSON_FOLLOW not proven')
}

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-V1-SLICE-1.3', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-V1-SLICE-1.3', total: results.length }))
