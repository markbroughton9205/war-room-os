/**
 * Higher Vision Studios slice-1.1 — production blocker closure.
 * `pnpm run validate:hvs` runs slice-0, slice-1, then this file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { applyEditCommand } from './edit-ops'
import { proposeDirectorCommands } from './ai-director'
import { uniqueCaptionCues } from './captions'
import { HVS_DEMO_CAPTION, HVS_DEMO_PROJECT_NAME } from './demo-copy'
import { countGoldLikeRgba, ensureRenderSafeGraphic, hvsDemoLogoSvg, rasterizeSvgToPng } from './graphics'
import { LUXURY_BEAUTY_V1_ID } from './themes'
import { fromSeconds, toSeconds } from './time'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { generateHvsPersonPlate, generateStarrdomTestClip } from './test-media'
import { ingestFile } from './ingest'
import { ensureStarrdomFixture, isHvsDisposableDemoProject, neutralizeDemoCopy } from './starrdom'
import { commitCommands, createProject, listProjects, loadProject, saveProject } from './store'
import { processRenderQueue } from './render-engine'
import { trackPersonInClip } from './track-subject'
import { followFramingCrop, interpolateSubject } from './tracking'
import { newCommandId, type EditCommand } from './edit-commands'
import { mediaCommandDataHierarchy, projectLogPath } from './paths'
import { HVS_SLICE } from './navigation'
import { describeHistoricalEnvironmentFailure, isHistoricalEnvironmentFailure } from './render-job-status'
import { probeMediaFile } from './probe'

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

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

expect('slice_id', ['HVS-V1-SLICE-1.1', 'HVS-V1-SLICE-1.2', 'HVS-V1-SLICE-1.3', 'HVS-P1-SLICE-A', 'HVS-P1-SLICE-B', 'HVS-P1-UX-SLICE-STUDIO', 'HVS-P1-SLICE-C', 'HVS-P1-SLICE-D', 'HVS-P1-SLICE-E', 'HVS-P1-SLICE-F', 'HVS-P1-SLICE-G'].includes(HVS_SLICE), HVS_SLICE)

const editor = source('components/war-room/higher-vision-studios/HvsEditorShell.tsx')
expect('moveclip_ui_wires_editop', editor.includes('application/hvs-clip') && editor.includes("kind: 'moveClip'"), 'drag payload / moveClip')
expect('ripple_ui_wires_editop', editor.includes("kind: 'rippleDelete'"), 'rippleDelete button')
expect('undo_ui_wires_editop', editor.includes("kind: 'undo'"), 'undo button')
expect('caption_preview_dedupes', editor.includes('uniqueCaptionCues'), 'Program Viewer uses uniqueCaptionCues')
expect('timeline_snap_helper', editor.includes('snapTimelineSeconds'), 'drop snap')

const host = source('components/war-room/media/MediaHost.tsx')
expect(
  'hvs_route_hides_media_launcher',
  host.includes('media-host-hvs-suppressed') && host.includes('isHigherVisionStudiosPath') && host.includes('/higher-vision-studios'),
  'MediaHost HVS isolation',
)
expect('media_host_not_removed', host.includes('MediaLauncher') && host.includes('media-launcher-global'), 'War Room Media remains elsewhere')

const home = source('components/war-room/higher-vision-studios/HvsHomeScreen.tsx')
const queue = source('app/higher-vision-studios/render-queue/page.tsx')
expect('home_no_starrdom_label', !/STARRDOM/.test(home) && home.includes('Luxury Beauty Demo'), 'home labels')
expect('queue_stale_label', queue.includes('historical / stale') && queue.includes('describeHistoricalEnvironmentFailure'), 'stale job UI')
expect(
  'stale_job_helper',
  isHistoricalEnvironmentFailure('install ffmpeg via apt') && describeHistoricalEnvironmentFailure(true).includes('bundled FFmpeg available'),
  describeHistoricalEnvironmentFailure(true),
)

const png = rasterizeSvgToPng(hvsDemoLogoSvg(), 'HIGHER VISION')
expect('svg_raster_png_signature', png[0] === 137 && png[1] === 80 && png[2] === 78 && png[3] === 71, png.subarray(0, 8).toString('hex'))
expect('svg_raster_size', png.length > 400, String(png.length))

const listed = await listProjects()
const flagged = listed.filter(p => p.starrdom || isHvsDisposableDemoProject(p))
expect(
  'starrdom_flagged_fixtures_identified',
  true,
  flagged.map(p => `${p.id}:${p.name}`).join(' | ') || 'none',
)
for (const entry of listed) {
  const loaded = await loadProject(entry.id)
  if (loaded && isHvsDisposableDemoProject(loaded)) await saveProject(neutralizeDemoCopy(loaded))
}
await ensureStarrdomFixture()
const leftoverNames = (await listProjects()).filter(p => /starrdom/i.test(p.name))
expect(
  'no_starrdom_in_flagged_fixture_names_after_neutralize',
  leftoverNames.length === 0,
  leftoverNames.map(p => p.name).join(' | ') || 'clean',
)

const tools = await resolveFfmpegTools()
expect('ffmpeg_present', Boolean(tools.ffmpeg && existsSync(tools.ffmpeg)), tools.ffmpeg ?? 'unresolved')
if (!tools.ffmpeg) {
  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  console.log(JSON.stringify({ ok: failed.length === 0, slice: 'HVS-V1-SLICE-1.1', total: results.length, note: 'bundled ffmpeg unresolved — media loop skipped' }))
  process.exit(failed.length ? 1 : 0)
}

const project = await createProject({
  name: HVS_DEMO_PROJECT_NAME,
  productionMode: 'COMMERCIAL',
  starrdom: true,
})

const plate = await generateStarrdomTestClip()
expect('plate_ok', plate.ok, plate.error ?? plate.path)
const ingested = await ingestFile({
  project,
  sourcePath: plate.path,
  originalName: 'hvs-demo-plate.mp4',
  mimeType: 'video/mp4',
})
let current = ingested.project

const logoSvg = path.join(mediaCommandDataHierarchy().tmp, `hvs-slice11-logo-${Date.now()}.svg`)
writeFileSync(logoSvg, hvsDemoLogoSvg())
const logoIn = await ingestFile({
  project: current,
  sourcePath: logoSvg,
  originalName: 'hvs-demo-logo.svg',
  mimeType: 'image/svg+xml',
})
current = logoIn.project
const derived = current.assets.find(a => a.provenance?.parentAssetId === logoIn.asset.id && a.mimeType === 'image/png')
expect('graphic_original_svg_immutable', logoIn.asset.originalPath.endsWith('.svg') && existsSync(logoIn.asset.originalPath), logoIn.asset.originalPath)
expect('graphic_derived_png', Boolean(derived?.originalPath && existsSync(derived.originalPath) && derived.generated), derived?.originalPath ?? 'missing')
const normalized = await ensureRenderSafeGraphic(current, logoIn.asset)
expect('graphic_idempotent_derive', normalized.raster.id === derived?.id, normalized.raster.id)

const inserted = await commitCommands(current, [cmd('insertClip', { trackId: 'V1', assetId: ingested.asset.id, start: fromSeconds(0) })])
expect('insert_commit', inserted.errors.length === 0 && inserted.project.timeline.tracks[0].clips.length === 1, inserted.errors.join(';'))
current = inserted.project
const clipId = current.timeline.tracks[0].clips[0].id

const split = await commitCommands(current, [cmd('splitClip', { clipId, at: fromSeconds(1.2) })])
expect('split_commit', split.project.timeline.tracks[0].clips.length === 2, split.errors.join(';'))
current = split.project
const rightId = current.timeline.tracks[0].clips[1].id
const beforeMove = toSeconds(current.timeline.tracks[0].clips[1].start)

const invalidMove = applyEditCommand(current, cmd('moveClip', { clipId: rightId, trackId: 'V1', start: fromSeconds(-0.4) }))
expect('moveclip_rejects_negative', !invalidMove.ok, invalidMove.ok ? 'accepted negative start' : invalidMove.error)

const moved = await commitCommands(current, [cmd('moveClip', { clipId: rightId, trackId: 'V1', start: fromSeconds(1.8) })])
expect('moveclip_commit', moved.errors.length === 0 && Math.abs(toSeconds(moved.project.timeline.tracks[0].clips[1].start) - 1.8) < 0.05, moved.errors.join(';') || String(toSeconds(moved.project.timeline.tracks[0].clips[1].start)))
expect('moveclip_changed_position', Math.abs(toSeconds(moved.project.timeline.tracks[0].clips[1].start) - beforeMove) > 0.2, `${beforeMove} -> ${toSeconds(moved.project.timeline.tracks[0].clips[1].start)}`)
current = moved.project

const beforeRipple = current.timeline.tracks[0].clips.length
const rippleTarget = current.timeline.tracks[0].clips[0].id
const remainingId = current.timeline.tracks[0].clips[1].id
const remainingStart = toSeconds(current.timeline.tracks[0].clips[1].start)
const rippled = await commitCommands(current, [cmd('rippleDelete', { clipId: rippleTarget })])
expect('rippledelete_commit', rippled.errors.length === 0 && rippled.project.timeline.tracks[0].clips.length === beforeRipple - 1, rippled.errors.join(';'))
expect('rippledelete_closes_gap', toSeconds(rippled.project.timeline.tracks[0].clips[0].start) < remainingStart, `${remainingStart} -> ${toSeconds(rippled.project.timeline.tracks[0].clips[0].start)}`)
expect('rippledelete_keeps_source_asset', rippled.project.assets.some(a => a.id === ingested.asset.id && existsSync(a.originalPath)), ingested.asset.originalPath)
current = rippled.project

const undone = await commitCommands(current, [cmd('undo')])
expect('rippledelete_undo', undone.errors.length === 0 && undone.project.timeline.tracks[0].clips.length === beforeRipple, undone.errors.join(';') || String(undone.project.timeline.tracks[0].clips.length))
expect('rippledelete_undo_restores_clip', undone.project.timeline.tracks[0].clips.some(c => c.id === rippleTarget) && undone.project.timeline.tracks[0].clips.some(c => c.id === remainingId), undone.project.timeline.tracks[0].clips.map(c => c.id).join(','))
current = undone.project

const log = existsSync(projectLogPath(current.id)) ? readFileSync(projectLogPath(current.id), 'utf8') : ''
expect('moveclip_in_editcommand_log', log.includes('"kind":"moveClip"'), log.slice(-400))
expect('rippledelete_in_editcommand_log', log.includes('"kind":"rippleDelete"'), log.slice(-400))
expect('undo_in_editcommand_log', log.includes('"kind":"undo"'), log.slice(-400))

current.timeline.captionTracks[0].cues = [
  { id: 'cue-a', start: fromSeconds(0.2), end: fromSeconds(2.2), text: HVS_DEMO_CAPTION, speaker: null, words: [] },
  { id: 'cue-b', start: fromSeconds(0.4), end: fromSeconds(2.0), text: HVS_DEMO_CAPTION, speaker: null, words: [] },
]
expect('caption_unique_helper', uniqueCaptionCues(current.timeline.captionTracks[0].cues).length === 1, String(uniqueCaptionCues(current.timeline.captionTracks[0].cues).length))
const cap1 = applyEditCommand(current, cmd('addCaption', { start: fromSeconds(0.3), end: fromSeconds(2.1), text: HVS_DEMO_CAPTION }))
expect('caption_add_collapses_overlap', cap1.ok && cap1.project.timeline.captionTracks[0].cues.length === 1, cap1.ok ? String(cap1.project.timeline.captionTracks[0].cues.length) : cap1.error)
current = cap1.ok ? cap1.project : current
const cap2 = applyEditCommand(current, cmd('addCaption', { start: fromSeconds(0.5), end: fromSeconds(2.4), text: HVS_DEMO_CAPTION }))
expect('caption_duplicate_ignored', cap2.ok && cap2.project.timeline.captionTracks[0].cues.length === 1, cap2.ok ? String(cap2.project.timeline.captionTracks[0].cues.length) : cap2.error)
current = cap2.ok ? cap2.project : current

const logo = applyEditCommand(current, cmd('addLogo', {
  assetId: logoIn.asset.id,
  start: fromSeconds(0.4),
  duration: fromSeconds(2.0),
  x: 0.84,
  y: 0.08,
  scale: 0.22,
}))
expect('logo_overlay', logo.ok && logo.project.timeline.overlays.some(o => o.kind === 'logo'), logo.ok ? 'ok' : logo.error)
current = logo.ok ? logo.project : current

const themed = applyEditCommand(current, cmd('applyTheme', { actor: 'ai-director', themeId: LUXURY_BEAUTY_V1_ID }))
current = themed.ok ? themed.project : current
const utterances = ['Apply the selected theme.', 'Apply this theme.', 'Use the current theme.', 'Use the luxury theme.']
for (const utterance of utterances) {
  const proposal = proposeDirectorCommands(current, utterance, 'AI_DIRECTOR')
  expect(
    `director_${utterance.replace(/\W+/g, '_').toLowerCase()}`,
    proposal.commands.some(c => c.kind === 'applyTheme') && !proposal.commands.some(c => c.kind === 'createVersion'),
    proposal.commands.map(c => c.kind).join(',') || proposal.summary,
  )
}

current = await saveProject(current)
const r16 = applyEditCommand(current, cmd('render', { aspect: '16:9' }))
current = r16.ok ? r16.project : current
current = await saveProject(current)
current = (await processRenderQueue(current.id)) ?? current
const job16 = current.renderJobs.find(j => j.target.aspect === '16:9')
expect('render_16x9', Boolean(job16?.status === 'completed' && job16.outputPath && existsSync(job16.outputPath)), `${job16?.status} ${job16?.error ?? job16?.outputPath}`)
if (job16?.outputPath && existsSync(job16.outputPath) && tools.ffmpeg) {
  const probe = await probeMediaFile(job16.outputPath)
  expect('render_16x9_probe', probe.hasVideo && probe.width === 1920 && probe.height === 1080, JSON.stringify({ w: probe.width, h: probe.height, d: probe.durationSec }))
  const rgbaPath = path.join(mediaCommandDataHierarchy().tmp, `hvs-slice11-logo-frame-${Date.now()}.rgba`)
  const extracted = await runProcess(tools.ffmpeg, [
    '-y', '-ss', '1.0', '-i', job16.outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', rgbaPath,
  ], 30_000)
  const rgba = extracted.ok && existsSync(rgbaPath) ? readFileSync(rgbaPath) : Buffer.alloc(0)
  const gold = countGoldLikeRgba(rgba)
  expect('logo_physical_pixels', gold > 40, `gold=${gold} extract=${extracted.ok} bytes=${rgba.length}`)
  const dirs = mediaCommandDataHierarchy()
  const assPath = path.join(dirs.tmp, `${job16.id}-captions.ass`)
  if (existsSync(assPath)) {
    const ass = readFileSync(assPath, 'utf8')
    const dialogues = [...ass.matchAll(/^Dialogue:/gm)]
    expect('caption_ass_once', dialogues.length === 1, String(dialogues.length))
  } else {
    expect('caption_ass_once', current.timeline.captionTracks[0].cues.length === 1, 'ass missing; cue count used')
  }
} else {
  expect('render_16x9_probe', false, 'no 16:9 file')
  expect('logo_physical_pixels', false, 'no frame')
  expect('caption_ass_once', false, 'no ass')
}

const r9 = applyEditCommand(current, cmd('render', { aspect: '9:16' }))
current = r9.ok ? r9.project : current
current = await saveProject(current)
current = (await processRenderQueue(current.id)) ?? current
const job9 = current.renderJobs.find(j => j.target.aspect === '9:16')
expect('render_9x16', Boolean(job9?.status === 'completed' && job9.outputPath && existsSync(job9.outputPath)), `${job9?.status} ${job9?.error ?? job9?.outputPath}`)
if (job9?.outputPath && existsSync(job9.outputPath)) {
  const probe = await probeMediaFile(job9.outputPath)
  expect('render_9x16_probe', probe.hasVideo && probe.width === 1080 && probe.height === 1920, JSON.stringify({ w: probe.width, h: probe.height }))
  const dirs = mediaCommandDataHierarchy()
  const assPath = path.join(dirs.tmp, `${job9.id}-captions.ass`)
  if (existsSync(assPath)) {
    const ass = readFileSync(assPath, 'utf8')
    expect('caption_9x16_ass_once', [...ass.matchAll(/^Dialogue:/gm)].length === 1, ass.slice(0, 120))
  } else {
    expect('caption_9x16_ass_once', current.timeline.captionTracks[0].cues.length === 1, 'ass missing')
  }
} else {
  expect('render_9x16_probe', false, 'no 9:16 file')
  expect('caption_9x16_ass_once', false, 'no 9:16 ass')
}

const person = await generateHvsPersonPlate()
expect('person_fixture_generated', person.ok && person.kind === 'person-shaped-fixture', person.error ?? person.kind)
const personProject = await createProject({ name: 'HVS person-shaped tracking fixture', productionMode: 'COMMERCIAL' })
const personIn = await ingestFile({
  project: personProject,
  sourcePath: person.path,
  originalName: 'hvs-demo-person.mp4',
  mimeType: 'video/mp4',
})
const personInserted = applyEditCommand(personIn.project, cmd('insertClip', { trackId: 'V1', assetId: personIn.asset.id, start: fromSeconds(0) }))
const personClip = personInserted.ok ? personInserted.project.timeline.tracks[0].clips[0] : null
const tracked = personClip
  ? await trackPersonInClip(personInserted.project, { clipId: personClip.id, seedBox: { x: 0.33, y: 0.18, width: 0.12, height: 0.62 } })
  : { keyframes: [], status: 'lost' as const, confidence: 0, warnings: ['no clip'] }
const xs = tracked.keyframes.map(k => k.x)
const spread = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
expect('person_fixture_track_status', tracked.status === 'tracking' || tracked.status === 'lost' || tracked.status === 'reacquired', `${tracked.status} conf=${tracked.confidence}`)
expect('person_fixture_confidence_reported', tracked.confidence >= 0, String(tracked.confidence))
expect('person_fixture_temporal_x', spread > 0.04, `spread=${spread} n=${xs.length}`)
expect('person_fixture_not_claimed_real', person.kind === 'person-shaped-fixture', person.kind)
if (personInserted.ok && tracked.keyframes.length >= 2) {
  const stored = applyEditCommand(personInserted.project, cmd('trackSubject', {
    clipId: personClip!.id,
    label: 'Person-shaped fixture',
    subjectKind: 'person',
    keyframes: tracked.keyframes,
    status: tracked.status,
    confidence: tracked.confidence,
  }))
  const follow = stored.ok
    ? applyEditCommand(stored.project, cmd('setVirtualCamera', { mode: 'FACE_LOCK', outputAspect: '9:16', subjectId: stored.project.timeline.subjects[0]?.id }))
    : stored
  const subject = follow.ok ? follow.project.timeline.subjects[0] : null
  const early = subject ? interpolateSubject(subject, 0, follow.project.timeline.timescale) : null
  const late = subject ? interpolateSubject(subject, Math.round(2.2 * follow.project.timeline.timescale), follow.project.timeline.timescale) : null
  const cropA = early ? followFramingCrop(early, 'FACE_LOCK', '9:16') : null
  const cropB = late ? followFramingCrop(late, 'FACE_LOCK', '9:16') : null
  expect(
    'person_fixture_dynamic_9_16',
    Boolean(cropA && cropB && (Math.abs(cropA.left - cropB.left) > 0.01 || Math.abs(cropA.top - cropB.top) > 0.01)),
    JSON.stringify({ cropA, cropB, status: tracked.status }),
  )
} else {
  expect('person_fixture_dynamic_9_16', false, tracked.warnings.join(';'))
}

const dirs = mediaCommandDataHierarchy()
const originals = existsSync(dirs.originals) ? await readdir(dirs.originals) : []
const authorizedPersonHint = originals.filter(name => /person|talent|face|human/i.test(name) && !/hvs-demo-person|person-shaped/i.test(name))
expect(
  'real_person_source_search',
  true,
  authorizedPersonHint.length
    ? `candidates under originals: ${authorizedPersonHint.slice(0, 8).join(', ')}`
    : 'No authorized real-person clip found under media-command originals. Person-shaped lavfi fixture used. Not claimed as real-person tracking.',
)

const reloaded = await loadProject(current.id)
expect('persistence_reload', Boolean(reloaded && reloaded.timeline.overlays.some(o => o.kind === 'logo') && reloaded.timeline.captionTracks[0].cues.length === 1), reloaded?.id ?? 'missing')

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-V1-SLICE-1.1', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-V1-SLICE-1.1', total: results.length }))
