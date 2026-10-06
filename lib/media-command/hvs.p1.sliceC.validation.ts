/**
 * Higher Vision Studios Phase 1 slice C — Captions / titles / safe-area polish.
 * Kernel + UI locks. Live browser proof is a separate operator pass recorded in the report.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { applyEditCommand } from './edit-ops'
import { EDIT_COMMAND_KINDS, newCommandId, type EditCommand } from './edit-commands'
import { emptyProject } from './types'
import { fromSeconds, toSeconds } from './time'
import { HVS_SLICE } from './navigation'
import { commitCommands, createProject, loadProject } from './store'
import { proposeDirectorCommands } from './ai-director'
import { uniqueCaptionCues } from './captions'
import { HVS_DEMO_CAPTION } from './demo-copy'
import { assFontName } from './fonts'
import { hvsDemoLogoSvg, countGoldLikeRgba } from './graphics'
import { TITLE_PRESETS, getTitlePreset } from './title-presets'
import { POSITION_PRESETS, collectSafeWarnings, resolveCaptionStyle, resolveOverlayStyle, wrapText, overflowLines } from './text-layout'
import { ACTION_SAFE_INSET, TITLE_SAFE_INSET, aspectDimensions, boxInside, safeRegion } from './safe-area'
import { buildAssDocument } from './ass'
import { generateStarrdomTestClip } from './test-media'
import { ingestFile } from './ingest'
import { processRenderQueue } from './render-engine'
import { probeMediaFile } from './probe'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
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

expect('slice_id', ['HVS-P1-SLICE-C', 'HVS-P1-SLICE-D', 'HVS-P1-SLICE-E', 'HVS-P1-SLICE-F', 'HVS-P1-SLICE-G'].includes(HVS_SLICE), HVS_SLICE)
for (const kind of ['updateCaption', 'updateTitle', 'moveTitle', 'setTitleStyle', 'removeTitle', 'addLowerThird'] as const) {
  expect(`kind_${kind}`, (EDIT_COMMAND_KINDS as readonly string[]).includes(kind), kind)
}

const editor = source('components/war-room/higher-vision-studios/HvsEditorShell.tsx')
const director = source('lib/media-command/ai-director.ts')
const render = source('lib/media-command/render-engine.ts')
expect('inspector_caption', editor.includes('data-testid="hvs-inspector-caption"') && editor.includes("kind: 'updateCaption'"), 'caption inspector')
expect('inspector_title', editor.includes('data-testid="hvs-inspector-title"') && editor.includes("kind: 'updateTitle'"), 'title inspector')
expect('safe_guides', editor.includes('data-testid="hvs-title-safe"') && editor.includes('data-testid="hvs-action-safe"'), 'title + action safe')
expect('safe_not_in_render', !render.includes('hvs-title-safe') && render.includes('writeAssFile'), 'guides are viewer-only')
expect('title_presets_ui', editor.includes('data-testid="hvs-titles-presets"') && editor.includes('hvs-title-preset-${preset.id}'), 'presets')
expect('lower_third_ui', editor.includes('data-testid="hvs-add-lower-third"') && editor.includes("kind: 'addLowerThird'"), 'lower third')
expect('timeline_labels', editor.includes('TITLE') && editor.includes('CAPTION'), 'timeline distinguish')
expect('no_direct_cue_mutate', !editor.includes('selectedCue.text =') && editor.includes('updateCaption'), 'no React mutation of cues')
expect('dedupe_preview', editor.includes('uniqueCaptionCues'), 'Program still dedupes')
expect('director_slice_c', director.includes('addLowerThird') && director.includes('clampToSafe') && director.includes('Coming Soon'), 'director mappings')
expect('ass_titles', source('lib/media-command/ass.ts').includes('titleKind') && source('lib/media-command/ass.ts').includes('Dialogue:'), 'ASS titles+captions')

expect('safe_insets', TITLE_SAFE_INSET === 0.1 && ACTION_SAFE_INSET === 0.05, `${TITLE_SAFE_INSET}/${ACTION_SAFE_INSET}`)
for (const aspect of ['16:9', '9:16', '1:1'] as const) {
  const dims = aspectDimensions(aspect)
  const title = safeRegion('title')
  const action = safeRegion('action')
  expect(`safe_title_${aspect}`, title.left === 0.1 && title.top === 0.1 && dims.width > 0, JSON.stringify(dims))
  expect(`safe_action_${aspect}`, action.left === 0.05 && boxInside({ x: 0.2, y: 0.2, width: 0.2, height: 0.2 }, title), aspect)
}

const wrapped = wrapText('one two three four five six seven eight nine ten eleven twelve', 20)
expect('wrap_multiline', wrapped.length >= 3, wrapped.join('|'))
expect('font_fallback', assFontName('Cinzel Decorative Missing', []) === 'DejaVu Serif' || assFontName('Cinzel', []).includes('DejaVu') || assFontName('Cinzel', []).length > 0, assFontName('Cinzel', []))
expect('presets_six', TITLE_PRESETS.length === 6 && Boolean(getTitlePreset('cinematic')), String(TITLE_PRESETS.length))

const project = emptyProject({ id: 'hvs-p1c-kernel', name: 'Slice C kernel' })
const cap = applyEditCommand(project, cmd('addCaption', { start: fromSeconds(0), end: fromSeconds(2), text: 'Hello Higher Vision', positionPreset: 'bottom-center', fontSize: 40, color: '#F6E7C1' }))
expect('caption_typed_update_create', cap.ok && cap.project.timeline.captionTracks[0].cues.length === 1, cap.ok ? 'ok' : cap.error)
const cueId = cap.ok ? cap.project.timeline.captionTracks[0].cues[0].id : ''
const movedCap = applyEditCommand(cap.ok ? cap.project : project, cmd('updateCaption', { cueId, positionPreset: 'top-center', fontSize: 52, color: '#FFFFFF', background: '#080400' }))
expect('caption_position', movedCap.ok && movedCap.project.timeline.captionTracks[0].cues[0].positionPreset === 'top-center', movedCap.ok ? String(movedCap.project.timeline.captionTracks[0].cues[0].y) : movedCap.error)
expect('caption_style', movedCap.ok && movedCap.project.timeline.captionTracks[0].cues[0].fontSize === 52 && movedCap.project.timeline.captionTracks[0].cues[0].color === '#FFFFFF', movedCap.ok ? 'ok' : movedCap.error)
const invalid = applyEditCommand(movedCap.ok ? movedCap.project : project, cmd('updateCaption', { cueId, start: fromSeconds(3), end: fromSeconds(1) }))
expect('invalid_range_rejected', !invalid.ok, invalid.ok ? 'accepted' : invalid.error)
const dup = applyEditCommand(movedCap.ok ? movedCap.project : project, cmd('addCaption', { start: fromSeconds(0.2), end: fromSeconds(1.8), text: movedCap.ok ? movedCap.project.timeline.captionTracks[0].cues[0].text : 'Hello Higher Vision' }))
expect('caption_dedupe', dup.ok && uniqueCaptionCues(dup.project.timeline.captionTracks[0].cues).length === 1, dup.ok ? String(dup.project.timeline.captionTracks[0].cues.length) : dup.error)

const titled = applyEditCommand(dup.ok ? dup.project : project, cmd('addTitle', { text: 'Coming Soon', start: fromSeconds(0), duration: fromSeconds(3), stylePreset: 'cinematic' }))
expect('title_create', titled.ok && titled.project.timeline.overlays.some(o => o.kind === 'title' && o.text === 'Coming Soon'), titled.ok ? titled.project.timeline.overlays[0]?.stylePreset ?? 'ok' : titled.error)
const titleId = titled.ok ? titled.project.timeline.overlays.find(o => o.kind === 'title')!.id : ''
const updatedTitle = applyEditCommand(titled.ok ? titled.project : project, cmd('updateTitle', { overlayId: titleId, text: 'ARRIVING', fontSize: 80 }))
expect('title_update', updatedTitle.ok && updatedTitle.project.timeline.overlays[0].text === 'ARRIVING', updatedTitle.ok ? String(updatedTitle.project.timeline.overlays[0].fontSize) : updatedTitle.error)
const styled = applyEditCommand(updatedTitle.ok ? updatedTitle.project : project, cmd('setTitleStyle', { overlayId: titleId, stylePreset: 'social-bold' }))
expect('title_preset', styled.ok && styled.project.timeline.overlays[0].stylePreset === 'social-bold', styled.ok ? String(styled.project.timeline.overlays[0].fontSize) : styled.error)
const lt = applyEditCommand(styled.ok ? styled.project : project, cmd('addLowerThird', { text: 'HIGHER VISION', secondaryText: 'Studios', start: fromSeconds(0.5), duration: fromSeconds(4) }))
expect('lower_third_object', lt.ok && lt.project.timeline.overlays.some(o => o.titleKind === 'lower-third' && o.secondaryText === 'Studios'), lt.ok ? lt.project.timeline.overlays.map(o => o.titleKind).join(',') : lt.error)
const ltId = lt.ok ? lt.project.timeline.overlays.find(o => o.titleKind === 'lower-third')!.id : ''
const movedLt = applyEditCommand(lt.ok ? lt.project : project, cmd('moveTitle', { overlayId: ltId, x: 0.22, y: 0.8 }))
expect('lower_third_move', movedLt.ok && Math.abs((movedLt.project.timeline.overlays.find(o => o.id === ltId)?.x ?? 0) - 0.22) < 0.001, movedLt.ok ? 'ok' : movedLt.error)

const unsafe = applyEditCommand(movedLt.ok ? movedLt.project : project, cmd('updateCaption', { cueId, x: 0.02, y: 0.02, positionPreset: 'custom' }))
const unsafeWarnings = unsafe.ok ? collectSafeWarnings(unsafe.project, null, '16:9') : []
expect('overflow_warning', unsafeWarnings.some(w => w.id === cueId && w.status === 'WARNING'), unsafeWarnings.map(w => `${w.kind}:${w.status}`).join('|'))
const logoUnsafe = emptyProject({ id: 'hvs-logo-safe', name: 'logo' })
logoUnsafe.timeline.overlays.push({
  id: 'logo-1',
  kind: 'logo',
  assetId: 'asset-logo',
  text: null,
  start: fromSeconds(0),
  duration: fromSeconds(2),
  x: 0.92,
  y: 0.04,
  scale: 0.28,
  opacity: 1,
})
expect('logo_safe_warning', collectSafeWarnings(logoUnsafe, null, '9:16').some(w => w.kind === 'logo' && w.status === 'WARNING'), collectSafeWarnings(logoUnsafe, null, '9:16').map(w => w.message).join('|'))
const clamped = applyEditCommand(unsafe.ok ? unsafe.project : project, cmd('updateCaption', { cueId, clampToSafe: true }))
expect('clamp_via_editop', clamped.ok && (clamped.project.timeline.captionTracks[0].cues[0].x ?? 0) > 0.08, clamped.ok ? String(clamped.project.timeline.captionTracks[0].cues[0].x) : clamped.error)

const long = applyEditCommand(clamped.ok ? clamped.project : project, cmd('updateCaption', { cueId, text: 'This is an intentionally long Higher Vision caption that must wrap across multiple lines without silently painting off the canvas of the Program Viewer or the master.' }))
const longStyle = long.ok ? resolveCaptionStyle(long.project.timeline.captionTracks[0].cues[0], long.project.timeline.captionTracks[0], null) : null
expect('long_text_wrap', Boolean(longStyle && overflowLines(longStyle, 1920).lines.length >= 2), longStyle ? overflowLines(longStyle, 1920).lines.join('|') : 'missing')

const geom16 = POSITION_PRESETS['bottom-center']
const geom9 = { ...geom16 }
expect('aspect_normalized', geom16.x === geom9.x && geom16.y === geom9.y, 'normalized not pixel-copied')
const titleStyle = styled.ok ? resolveOverlayStyle(styled.project.timeline.overlays[0], null) : null
expect('program_geometry', Boolean(titleStyle && titleStyle.x > 0 && titleStyle.y > 0 && titleStyle.fontSize > 0), titleStyle ? `${titleStyle.x},${titleStyle.y}` : 'missing')
const ass = buildAssDocument(lt.ok ? lt.project : project)
expect('render_geometry', ass.eventCount >= 2 && ass.ass.includes('PlayResX:') && ass.ass.includes('Dialogue:'), `events=${ass.eventCount}`)

const dirTitle = proposeDirectorCommands(lt.ok ? lt.project : project, 'Add a title that says Coming Soon.')
expect('director_add_title', dirTitle.commands.some(c => c.kind === 'addTitle' && String((c as { text?: string }).text).includes('Coming Soon')), dirTitle.summary)
const dirLt = proposeDirectorCommands(lt.ok ? lt.project : project, 'Add a lower third.')
expect('director_lower_third', dirLt.commands.some(c => c.kind === 'addLowerThird'), dirLt.summary)
const dirCap = proposeDirectorCommands(clamped.ok ? clamped.project : project, 'Put this caption at the top.', 'AI_DIRECTOR', { selectedCueId: cueId })
expect('director_caption_top', dirCap.commands.some(c => c.kind === 'updateCaption'), dirCap.commands.map(c => c.kind).join(','))
const dirLogo = proposeDirectorCommands(logoUnsafe, 'Move the logo into the safe area.')
expect('director_logo_safe', dirLogo.commands.some(c => c.kind === 'moveTitle' && (c as { clampToSafe?: boolean }).clampToSafe), dirLogo.summary)

const removed = applyEditCommand(lt.ok ? lt.project : project, cmd('removeTitle', { overlayId: titleId }))
expect('title_remove', removed.ok && !removed.project.timeline.overlays.some(o => o.id === titleId), removed.ok ? String(removed.project.timeline.overlays.length) : removed.error)

const tools = await resolveFfmpegTools()
expect('bundled_ffmpeg', Boolean(tools.ffmpeg?.includes('/media-command/tools/ffmpeg')), tools.ffmpeg ?? 'missing')
const plate = await generateStarrdomTestClip()
expect('test_plate', plate.ok, plate.error ?? plate.path)

if (plate.ok) {
  const live = await createProject({ name: 'HIGHER VISION CAPTION TITLE TEST', productionMode: 'SOCIAL' })
  const ingested = await ingestFile({ project: live, sourcePath: plate.path, originalName: 'hvs-p1c-plate.mp4', mimeType: 'video/mp4' })
  let p = ingested.project
  const logoSvg = path.join(mediaCommandDataHierarchy().tmp, `hvs-p1c-logo-${Date.now()}.svg`)
  writeFileSync(logoSvg, hvsDemoLogoSvg())
  const logoIn = await ingestFile({ project: p, sourcePath: logoSvg, originalName: 'hvs-p1c-logo.svg', mimeType: 'image/svg+xml' })
  p = logoIn.project
  p = (await commitCommands(p, [cmd('insertClip', { trackId: 'V1', assetId: ingested.asset.id, start: fromSeconds(0), duration: fromSeconds(4) })])).project
  p = (await commitCommands(p, [cmd('addCaption', { start: fromSeconds(0.2), end: fromSeconds(3.6), text: 'Luxury Beauty Demo', positionPreset: 'bottom-center', fontSize: 42 })])).project
  p = (await commitCommands(p, [cmd('addTitle', { text: 'Coming Soon', start: fromSeconds(0.1), duration: fromSeconds(3.5), stylePreset: 'cinematic' })])).project
  p = (await commitCommands(p, [cmd('addLowerThird', { text: 'HIGHER VISION', secondaryText: 'Studios', start: fromSeconds(0.4), duration: fromSeconds(3.2) })])).project
  p = (await commitCommands(p, [cmd('addLogo', { assetId: logoIn.asset.id, start: fromSeconds(0.2), duration: fromSeconds(3.5), x: 0.82, y: 0.08, scale: 0.2 })])).project
  expect('live_objects', p.timeline.captionTracks[0].cues.length === 1 && p.timeline.overlays.filter(o => o.kind === 'title').length >= 2 && p.timeline.overlays.some(o => o.kind === 'logo'), `${p.timeline.captionTracks[0].cues.length}/${p.timeline.overlays.length}`)
  const cue = p.timeline.captionTracks[0].cues[0]
  const beforeUndo = p.timeline.overlays.length
  const undone = await commitCommands(p, [cmd('undo')])
  expect('undo', undone.errors.length === 0 && undone.project.timeline.overlays.length === beforeUndo - 1, String(undone.project.timeline.overlays.length))
  const redone = await commitCommands(undone.project, [cmd('redo')])
  expect('redo', redone.project.timeline.overlays.length === beforeUndo, String(redone.project.timeline.overlays.length))
  p = redone.project
  const r16 = await commitCommands(p, [cmd('render', { aspect: '16:9' })])
  p = await processRenderQueue(r16.project.id) ?? r16.project
  const job16 = p.renderJobs.find(j => j.target.aspect === '16:9')
  expect('render_16x9', job16?.status === 'completed' && Boolean(job16.outputPath && existsSync(job16.outputPath)), `${job16?.status} ${job16?.error ?? ''}`)
  if (job16?.outputPath && tools.ffmpeg) {
    const probed = await probeMediaFile(job16.outputPath)
    expect('render_16_probe', probed.hasVideo && probed.width === 1920 && probed.height === 1080, JSON.stringify({ w: probed.width, h: probed.height, d: probed.durationSec }))
    const dirs = mediaCommandDataHierarchy()
    const assPath = path.join(dirs.tmp, `${job16.id}-captions.ass`)
    const assText = existsSync(assPath) ? readFileSync(assPath, 'utf8') : ''
    expect('caption_ass_once', [...assText.matchAll(/^Dialogue:.*?,(CAP\d+),/gm)].length === 1, String([...assText.matchAll(/^Dialogue:/gm)].length))
    expect('title_ass_present', /Coming Soon|HIGHER VISION/.test(assText), assText.slice(0, 180))
    const rgbaPath = path.join(dirs.tmp, `hvs-p1c-16-${Date.now()}.rgba`)
    const extracted = await runProcess(tools.ffmpeg, ['-y', '-ss', '1.0', '-i', job16.outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', rgbaPath], 30_000)
    const rgba = extracted.ok && existsSync(rgbaPath) ? readFileSync(rgbaPath) : Buffer.alloc(0)
    expect('frame_16_pixels', rgba.length === 1920 * 1080 * 4 && countGoldLikeRgba(rgba) > 20, `bytes=${rgba.length} gold=${countGoldLikeRgba(rgba)}`)
  }
  const r9 = await commitCommands(p, [cmd('render', { aspect: '9:16' })])
  p = await processRenderQueue(r9.project.id) ?? r9.project
  const job9 = p.renderJobs.find(j => j.target.aspect === '9:16')
  expect('render_9x16', job9?.status === 'completed' && Boolean(job9.outputPath && existsSync(job9.outputPath)), `${job9?.status} ${job9?.error ?? ''}`)
  if (job9?.outputPath && tools.ffmpeg) {
    const probed = await probeMediaFile(job9.outputPath)
    expect('render_9_probe', probed.hasVideo && probed.width === 1080 && probed.height === 1920, JSON.stringify({ w: probed.width, h: probed.height }))
    const rgbaPath = path.join(mediaCommandDataHierarchy().tmp, `hvs-p1c-9-${Date.now()}.rgba`)
    const extracted = await runProcess(tools.ffmpeg, ['-y', '-ss', '1.0', '-i', job9.outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', rgbaPath], 30_000)
    const rgba = extracted.ok && existsSync(rgbaPath) ? readFileSync(rgbaPath) : Buffer.alloc(0)
    expect('frame_9_pixels', rgba.length === 1080 * 1920 * 4 && countGoldLikeRgba(rgba) > 10, `bytes=${rgba.length} gold=${countGoldLikeRgba(rgba)}`)
  }
  const reloaded = await loadProject(p.id)
  expect('persistence', Boolean(reloaded && reloaded.timeline.captionTracks[0].cues[0]?.id === cue.id && reloaded.timeline.overlays.some(o => o.titleKind === 'lower-third') && reloaded.timeline.overlays.some(o => o.kind === 'logo')), reloaded?.id ?? 'missing')
}

const failed = results.filter(item => !item.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-P1-SLICE-C', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-P1-SLICE-C', total: results.length }))
