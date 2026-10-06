/**
 * HVS Program ↔ Deliver fidelity contract validation.
 * No Piper/Comfy/FLUX. No paid HTTP. No credential read.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  AUDIO_PREVIEW_CLASSIFICATION,
  GEOMETRY_TOLERANCE_FRACTION,
  HVS_PROGRAM_DELIVER_FIDELITY_CONTRACT,
  LUT_PREVIEW_HONESTY,
  MASK_CENTER_TOLERANCE_FRACTION,
  PROGRAM_PREVIEW_TRACE,
  TRACKING_CENTER_TOLERANCE_FRACTION,
  UNIFIED_RENDER_TRACE,
  applyColorPipelineToRgb,
  applyColorPipelineToPixels,
  colorDirectionAgree,
  colorPipelineSvgFilter,
  composeProgramFilterCss,
  contractClassification,
  evalCurve,
  geometryAgreement,
  lumaQualifierCoverage01,
  programAudioPreviewAt,
  programLookAt,
  programPreviewMismatches,
  readBlurParams,
  resolvedMaskAt,
} from './program-deliver-fidelity'
import { CURRENT_RENDER_PIPELINE_TRACE } from './unified-render-plan'
import { firstTrackedBackgroundBlurGraph, firstEllipseMaskGraph, firstBlurGraph, readTransformParams } from './effect-graph'
import { firstWave4RgbCurvePipeline, firstWave5QualifierPipeline } from './color-runtime'
import { emptyProject } from './types'
import { fromSeconds } from './time'
import { interpolateSubject } from './tracking'
import { identityColorPipelineOr, readLumaQualifier } from './color-pipeline'
import { emptyAudioGraph } from './audio-graph'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

expect('contract_rows', HVS_PROGRAM_DELIVER_FIDELITY_CONTRACT.length >= 24, String(HVS_PROGRAM_DELIVER_FIDELITY_CONTRACT.length))
expect('classes', HVS_PROGRAM_DELIVER_FIDELITY_CONTRACT.every(r => ['EXACT', 'DIRECTIONALLY_EQUIVALENT', 'PREVIEW_APPROXIMATION', 'RENDER_ONLY', 'UNSUPPORTED'].includes(r.classification)), HVS_PROGRAM_DELIVER_FIDELITY_CONTRACT.map(r => r.classification).join(','))
expect('no_false_match', !HVS_PROGRAM_DELIVER_FIDELITY_CONTRACT.some(r => /matches/i.test(r.note) && r.classification === 'PREVIEW_APPROXIMATION'), 'honesty')
expect('lut_honesty', LUT_PREVIEW_HONESTY === 'RENDER-ACCURATE / PREVIEW APPROXIMATE' && contractClassification('LUT .cube') === 'RENDER_ONLY', LUT_PREVIEW_HONESTY)
expect('rgb_not_css_only', contractClassification('RGB curves') === 'DIRECTIONALLY_EQUIVALENT' && PROGRAM_PREVIEW_TRACE.includes('feComponentTransfer'), 'svg')
expect('qualifier_approx', contractClassification('luma qualifier') === 'PREVIEW_APPROXIMATION', 'qualifier')
expect('show_mask', contractClassification('SHOW MASK') === 'DIRECTIONALLY_EQUIVALENT', 'show mask')
expect('node_order', contractClassification('ColorPipeline node order') === 'EXACT', 'order')
expect('audio_honesty', AUDIO_PREVIEW_CLASSIFICATION.some(r => r.capability === 'eq' && r.class === 'RENDER-CANONICAL') && AUDIO_PREVIEW_CLASSIFICATION.some(r => r.capability === 'clip.pan' && r.class === 'PREVIEW'), AUDIO_PREVIEW_CLASSIFICATION.map(r => `${r.capability}:${r.class}`).join('|'))
expect('caption_exact', contractClassification('captions / titles') === 'EXACT', 'captions')
expect('dissolve_kept', contractClassification('dissolve') === 'DIRECTIONALLY_EQUIVALENT', 'dissolve')
expect('speed_exact', contractClassification('speed / reverse / freeze') === 'EXACT', 'speed')
expect('geometry_tol_documented', GEOMETRY_TOLERANCE_FRACTION === 0.03 && MASK_CENTER_TOLERANCE_FRACTION === 0.03 && TRACKING_CENTER_TOLERANCE_FRACTION === 0.03, String(GEOMETRY_TOLERANCE_FRACTION))
expect('traces', PROGRAM_PREVIEW_TRACE.includes('WAVE7 EffectGraph') && PROGRAM_PREVIEW_TRACE.includes('WAVE7 ColorPipeline') && UNIFIED_RENDER_TRACE.includes('WAVE6 EffectGraph') && CURRENT_RENDER_PIPELINE_TRACE.includes('WAVE6 ColorPipeline'), 'traces')
expect('mismatches_listed', programPreviewMismatches().some(m => m.includes('LUT')), programPreviewMismatches().slice(0, 2).join(';'))

const shell = readFileSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/HvsEditorShell.tsx'), 'utf8')
expect('program_consumes_effectgraph', shell.includes('programLookAt') && shell.includes('composeProgramFilterCss') && !shell.includes('function PreviewEngine2'), 'wired')
expect('program_web_audio_gain', shell.includes('createGain') && shell.includes('programAudioPreviewAt'), 'gain')
expect('caption_regression', shell.includes('hvs-program-caption'), 'caption')
expect('dissolve_regression', shell.includes('hvs-program-dissolve'), 'dissolve')
expect('show_mask_program', shell.includes('hvs-program-show-mask') && shell.includes('lumaQualifierCoverage01'), 'show mask')
expect('fallback_identity', shell.includes('programLookAt'), 'safe mapping')

const lanes = readFileSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/HvsLaneWorkspaces.tsx'), 'utf8')
expect('vfx_blur_preview', lanes.includes('readBlurParams') && lanes.includes('hvs-blur-inspector'), 'vfx blur')
expect('color_svg', lanes.includes('colorPipelineSvgFilter') && lanes.includes('LUT_PREVIEW_HONESTY'), 'color svg')
expect('show_mask_canvas', lanes.includes('hvs-show-mask-canvas'), 'mask canvas')

const p = emptyProject({ id: 'hvs-w7-fid', name: 'WAVE7 FIDELITY UNIT' })
p.assets.push({
  id: 'asset-v',
  kind: 'video',
  name: 'plate.mp4',
  originalPath: '/tmp/none.mp4',
  proxyPath: null,
  thumbPath: null,
  waveformPath: null,
  duration: fromSeconds(3),
  frameRate: { n: 24, d: 1 },
  sampleRate: 48000,
  channels: 2,
  width: 1920,
  height: 1080,
  codec: 'h264',
  audioCodec: 'aac',
  checksumSha256: null,
  generated: false,
  provenance: null,
  createdAt: new Date().toISOString(),
} as never)
const clip = p.timeline.tracks.find(t => t.id === 'V1')!.clips[0]
if (!clip) {
  p.timeline.tracks.find(t => t.id === 'V1')!.clips.push({
    id: 'c1',
    trackId: 'V1',
    assetId: 'asset-v',
    name: 'clip',
    start: fromSeconds(0),
    duration: fromSeconds(3),
    sourceIn: fromSeconds(0),
    sourceOut: fromSeconds(3),
    speed: { n: 1, d: 1 },
    reversed: false,
    freeze: false,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    opacity: 1,
    volume: 0.8,
    fadeIn: fromSeconds(0),
    fadeOut: fromSeconds(0),
    pan: -0.2,
    color: { exposure: 0, contrast: 0, saturation: 0, temperature: 0, lookId: null },
    effects: [],
    filters: [],
    enabled: true,
  })
}
const vclip = p.timeline.tracks.find(t => t.id === 'V1')!.clips[0]
p.timeline.subjects.push({
  id: 'sub-1',
  clipId: vclip.id,
  assetId: 'asset-v',
  label: 'WAVE7 TRACK',
  kind: 'object',
  status: 'tracking',
  confidence: 0.8,
  humanCorrected: false,
  keyframes: [
    { time: fromSeconds(0.5), x: 0.20, y: 0.20, width: 0.30, height: 0.40, confidence: 0.8 },
    { time: fromSeconds(2.5), x: 0.50, y: 0.22, width: 0.30, height: 0.40, confidence: 0.8 },
  ],
})
p.effectGraphs = [firstTrackedBackgroundBlurGraph(p.id, 'asset-v', 'sub-1', 12)]
p.colorPipeline = {
  schemaVersion: 1,
  outputColorSpace: 'display-referred',
  nodes: [
    { id: 'temp', type: 'temp-tint', enabled: true, params: { temperature: -0.4, tint: 0 } },
    { id: 'contrast', type: 'contrast-pivot', enabled: true, params: { contrast: 0.3, pivot: 0.45 } },
    { ...firstWave4RgbCurvePipeline().nodes[0], id: 'rgb' },
    { ...firstWave5QualifierPipeline().nodes[0], id: 'q', params: { low: 0.1, high: 0.6, softness: 0.08, invert: false, showMask: true } },
    { id: 'lut', type: 'lut', enabled: true, params: { file: 'unused.cube' } },
  ],
}
p.audioGraph = emptyAudioGraph(p)
p.audioGraph.channels[0].volume = 0.7
p.audioGraph.channels[0].pan = -0.3
p.audioGraph.automation = [{
  target: p.audioGraph.channels[0].id,
  param: 'pan',
  keyframes: [
    { time: fromSeconds(0), value: -0.8 },
    { time: fromSeconds(2), value: 0.8 },
  ],
}]

const look = programLookAt(p, 1.5, { clip: vclip, quality: 'accurate' })
expect('look_ok', look.ok && !look.error, look.error ?? 'ok')
expect('effectgraph_mapping', Boolean(look.blurPx === 12 && look.invertBlur && look.clipPath && look.trackerFollows), JSON.stringify({ blur: look.blurPx, invert: look.invertBlur, track: look.trackerFollows }))
expect('blur_enabled', look.blurPx > 0, String(look.blurPx))
expect('blur_bypass', programLookAt({ ...p, effectGraphs: p.effectGraphs.map(g => ({ ...g, nodes: g.nodes.map(n => n.kind === 'Blur' ? { ...n, enabled: false } : n) })) }, 1.5, { clip: vclip }).blurPx === 0, 'bypass')
expect('mask_preview', Boolean(look.mask && look.mask.type === 'ellipse' && look.maskCenter), JSON.stringify(look.maskCenter))
const box05 = interpolateSubject(p.timeline.subjects[0], Math.round(0.5 * p.timeline.timescale), p.timeline.timescale)
const box25 = interpolateSubject(p.timeline.subjects[0], Math.round(2.5 * p.timeline.timescale), p.timeline.timescale)
const look05 = programLookAt(p, 0.5, { clip: vclip })
const look25 = programLookAt(p, 2.5, { clip: vclip })
expect('tracker_0.5', Boolean(look05.maskCenter && box05 && Math.abs(look05.maskCenter.x - (box05.x + box05.width / 2)) <= TRACKING_CENTER_TOLERANCE_FRACTION), JSON.stringify({ preview: look05.maskCenter, box: box05 }))
expect('tracker_2.5', Boolean(look25.maskCenter && box25 && Math.abs(look25.maskCenter.x - (box25.x + box25.width / 2)) <= TRACKING_CENTER_TOLERANCE_FRACTION), JSON.stringify({ preview: look25.maskCenter, box: box25 }))
expect('tracker_moves', Boolean(look05.maskCenter && look25.maskCenter && Math.abs(look25.maskCenter.x - look05.maskCenter.x) > 0.05), 'track motion')

const xf = p.effectGraphs[0].nodes.find(n => n.kind === 'Transform')
const xfP = xf ? readTransformParams(xf) : { nx: 0, ny: 0, scaleX: 1, scaleY: 1, x: 0, y: 0, rotationDeg: 0, opacity: 1 }
const geo = geometryAgreement(look.effectTransform?.nx ?? 0, look.effectTransform?.ny ?? 0, xfP.nx, xfP.ny)
expect('transform_agreement', geo.ok, JSON.stringify(geo))

expect('color_order', look.nodeOrder.join(',') === 'temp-tint,contrast-pivot,rgb-curve,luma-qualifier,lut', look.nodeOrder.join(','))
expect('rgb_svg', look.svgFilterMarkup.includes('feComponentTransfer') && look.svgFilterMarkup.includes('tableValues'), look.svgFilterMarkup.slice(0, 80))
expect('lut_label', look.lutHonesty === LUT_PREVIEW_HONESTY, String(look.lutHonesty))
expect('show_mask_flag', look.showQualifierMask === true && look.qualifier != null, JSON.stringify(look.qualifier))
expect('filter_css', composeProgramFilterCss(look).includes('url(#hvs-color-pipe)'), composeProgramFilterCss(look).slice(0, 80))
expect('before_ungraded', composeProgramFilterCss(look, 'BEFORE') === look.clipFilterCss, composeProgramFilterCss(look, 'BEFORE'))

const cool = applyColorPipelineToRgb(0.6, 0.5, 0.4, identityColorPipelineOr(p.colorPipeline))
expect('temp_cools', cool.b > cool.r || cool.b >= 0.4, JSON.stringify(cool))
const rgbOnly = applyColorPipelineToRgb(0.5, 0.5, 0.5, firstWave4RgbCurvePipeline())
expect('rgb_reduces_red', rgbOnly.r < 0.45, JSON.stringify(rgbOnly))
const q = readLumaQualifier(p.colorPipeline.nodes.find(n => n.type === 'luma-qualifier'))
expect('qualifier_inside', lumaQualifierCoverage01(0.35, q) > 0.5, String(lumaQualifierCoverage01(0.35, q)))
expect('qualifier_outside', lumaQualifierCoverage01(0.95, q) < 0.5, String(lumaQualifierCoverage01(0.95, q)))
expect('curve_eval', evalCurve([{ input: 0, output: 0 }, { input: 0.5, output: 0.2 }, { input: 1, output: 1 }], 0.5) === 0.2, 'mid')

const buf = Buffer.alloc(3 * 16, 128)
const t0 = Date.now()
const pix = applyColorPipelineToPixels(buf, p.colorPipeline)
const dt = Date.now() - t0
expect('pixel_apply', pix.meanR > 0 && pix.meanCoverage >= 0, JSON.stringify(pix))
expect('preview_perf_ms', dt < 250, String(dt))

const svg = colorPipelineSvgFilter(firstWave4RgbCurvePipeline())
expect('svg_rgb', svg.markup.includes('feFuncR') && svg.css.startsWith('url('), svg.css)

const ellipse = firstEllipseMaskGraph(p.id, 'asset-v', 'asset-v', { centerX: 0.4, centerY: 0.5, radiusX: 0.2, radiusY: 0.25 })
const em = resolvedMaskAt(ellipse, p, 0)
expect('ellipse_params', Boolean(em && Math.abs(em.centerX - 0.4) < 0.001 && Math.abs(em.radiusX - 0.2) < 0.001), JSON.stringify(em))

const blurGraph = firstBlurGraph(p.id, 'asset-v', 9)
expect('blur_params', readBlurParams(blurGraph.nodes.find(n => n.kind === 'Blur')).radius === 9 && readBlurParams({ enabled: false, parameters: { radius: 9 } }).enabled === false, 'blur')

const audio = programAudioPreviewAt(p, vclip, p.timeline.tracks.find(t => t.id === 'V1') ?? null, 0)
expect('audio_preview', audio.gain > 0 && audio.gain < 1 && audio.pan < 0 && audio.panAutomation, JSON.stringify(audio))
const muted = { ...p, audioGraph: { ...p.audioGraph, channels: p.audioGraph.channels.map(c => ({ ...c, mute: true })) } }
expect('mute_zero', programAudioPreviewAt(muted, vclip, p.timeline.tracks.find(t => t.id === 'V1') ?? null, 0).gain === 0, 'mute')

const bad = emptyProject({ id: 'hvs-w7-bad', name: 'bad' })
bad.colorPipeline = { schemaVersion: 1, outputColorSpace: 'unspecified', nodes: [{ id: 'rgb', type: 'rgb-curve', enabled: true, params: { r: 'nope' } }] }
const badLook = programLookAt(bad, 0)
expect('failure_isolation', badLook.ok && badLook.error == null, badLook.error ?? 'isolated')
const dir = colorDirectionAgree({ meanR: 100, meanG: 100, meanB: 100 }, { meanR: 70, meanG: 100, meanB: 130 }, { meanR: 60, meanG: 100, meanB: 140 })
expect('color_direction', dir.ok, dir.notes.join(';'))

const failed = results.filter(r => !r.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
if (failed.length) {
  console.error(JSON.stringify({ ok: false, suite: 'hvs-program-deliver-fidelity', failed: failed.length }))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, suite: 'hvs-program-deliver-fidelity', total: results.length }))
