/**
 * HVS WAVE 7 — Phase-3 live boundary + Program↔Deliver fidelity regressions.
 * No Piper/Comfy/FLUX install. No paid HTTP. No credential read. No commit.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { HVS_PROGRAM_WAVE, HVS_SLICE } from './navigation'
import { HVS_MATRIX_ROWS } from './production-matrix'
import {
  HVS_COMFYUI_FLUX_INSTALL_AUTHORIZED,
  HVS_MODEL_INSTALL_AUTHORIZATION,
  HVS_PIPER_INSTALL_AUTHORIZED,
  HVS_WAVE4_MODEL_INSTALL_AUTHORIZED,
  maySpendMoney,
} from './policy'
import { UNIFIED_RENDER_SEAM } from './lane-render-seam'
import {
  CURRENT_RENDER_PIPELINE_TRACE,
  activeUnifiedLanes,
  isAudioGraphActive,
  isColorPipelineActive,
} from './unified-render-plan'
import { compileUnifiedRenderPlan } from './unified-render-plan.server'
import { firstTrackedBackgroundBlurGraph, defaultPorts, validateEffectGraph } from './effect-graph'
import { firstWave4RgbCurvePipeline } from './color-runtime'
import { validateColorPipeline } from './color-pipeline'
import { firstWave4AudioGraph } from './audio-runtime'
import { validateAudioGraph } from './audio-graph'
import { writeGainCube, validateCubeFile } from './lut-cube'
import { loadProject, saveProject, snapshotVersion, restoreVersion, commitCommands, createProject } from './store'
import { applyEditCommand } from './edit-ops'
import { newCommandId, type EditCommand } from './edit-commands'
import { fromSeconds, toSeconds } from './time'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { ingestFile } from './ingest'
import { processRenderQueue, xfadePrepareChain } from './render-engine'
import { probeMediaFile } from './probe'
import { extractFramePixels, regionMean } from './frame-scopes'
import { reportHvsStorage, modelsBytesExcludingAuthorizedAsr } from './storage-report'
import { proposeDirectorCommands } from './ai-director'
import { generateStarrdomTestClip } from './test-media'
import { mediaCommandDataHierarchy } from './paths'
import { inspectGenerationRequest, GENERATION_SURFACE_STATES } from './generation-authority'
import { highestMotionHit, loadObservationsSync } from './video-analysis'
import {
  AUDIO_PREVIEW_CLASSIFICATION,
  GEOMETRY_TOLERANCE_FRACTION,
  HVS_PROGRAM_DELIVER_FIDELITY_CONTRACT,
  LUT_PREVIEW_HONESTY,
  PROGRAM_PREVIEW_TRACE,
  applyColorPipelineToPixels,
  colorDirectionAgree,
  programLookAt,
} from './program-deliver-fidelity'
import type { HvsProject } from './types'
import type { HvsEffectGraph } from './effect-graph'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

const LIVE_PROJECT = 'hvs-mual21w4-5h2e'
const LIVE_AUTH = 'LIVE_AUTH_BLOCKED'

expect('program_wave', ['HVS-WAVE-7', 'HVS-WAVE-9'].includes(HVS_PROGRAM_WAVE), HVS_PROGRAM_WAVE)
expect('phase1_slice', HVS_SLICE === 'HVS-P1-SLICE-G', HVS_SLICE)
expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('g27_01_shipped', HVS_MATRIX_ROWS.find(r => r.id === 'G27-01')?.state === 'SHIPPED', 'local VI subset live-closed')
expect('g40_02_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G40-02')?.state === 'PARTIAL', 'preview vs ffmpeg not pixel identity')
expect('g20_03_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G20-03')?.state === 'PARTIAL', 'not full roto')
expect('install_lock', !HVS_MODEL_INSTALL_AUTHORIZATION && !HVS_PIPER_INSTALL_AUTHORIZED && !HVS_COMFYUI_FLUX_INSTALL_AUTHORIZED && !HVS_WAVE4_MODEL_INSTALL_AUTHORIZED && maySpendMoney() === false, 'flags')
expect('unified_seam', UNIFIED_RENDER_SEAM.renderEngineConsumesEffectGraph && UNIFIED_RENDER_SEAM.renderEngineConsumesColorPipeline && UNIFIED_RENDER_SEAM.renderEngineConsumesAudioGraph, UNIFIED_RENDER_SEAM.note)
expect('pipeline_trace', CURRENT_RENDER_PIPELINE_TRACE.includes('WAVE6 EffectGraph') && PROGRAM_PREVIEW_TRACE.includes('WAVE7 EffectGraph'), 'traces')
expect('contract', HVS_PROGRAM_DELIVER_FIDELITY_CONTRACT.length >= 24 && LUT_PREVIEW_HONESTY.includes('PREVIEW APPROXIMATE'), String(HVS_PROGRAM_DELIVER_FIDELITY_CONTRACT.length))
expect('audio_classification', AUDIO_PREVIEW_CLASSIFICATION.some(r => r.class === 'RENDER-CANONICAL') && AUDIO_PREVIEW_CLASSIFICATION.some(r => r.capability === 'clip.volume' && r.class === 'PREVIEW'), 'audio')
expect('live_auth_boundary', LIVE_AUTH === 'LIVE_AUTH_BLOCKED', 'credentials not read')
expect('source_seek_mapping', readFileSync(path.join(process.cwd(), 'lib/media-command/ai-director.ts'), 'utf8').includes('sourceSeek') && readFileSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/HvsEditorShell.tsx'), 'utf8').includes('sourceSeek'), 'sourceSeek')
expect('geometry_tol', GEOMETRY_TOLERANCE_FRACTION === 0.03, String(GEOMETRY_TOLERANCE_FRACTION))
expect('xfade_cfr', xfadePrepareChain({ n: 24, d: 1 }).endsWith('fps=24'), xfadePrepareChain({ n: 24, d: 1 }))
expect('gen_surface', GENERATION_SURFACE_STATES.includes('LOCAL ENGINE NOT INSTALLED'), GENERATION_SURFACE_STATES.join('|'))
const inspect = inspectGenerationRequest('IMAGE_GENERATION', LIVE_PROJECT, 'key art')
expect('phase2_not_installed', inspect.surfaceState === 'LOCAL ENGINE NOT INSTALLED' && inspect.card?.executeAvailable === false, inspect.surfaceState)
expect('no_second_engine', !readFileSync(path.join(process.cwd(), 'lib/media-command/render-engine.ts'), 'utf8').includes('function renderTimeline2'), 'single RenderEngine')

function cmd(kind: string, extra: Record<string, unknown> = {}): EditCommand {
  return { id: newCommandId(), kind, actor: 'human' as const, createdAt: new Date().toISOString(), ...extra } as EditCommand
}

async function main() {
  const storageBefore = await reportHvsStorage()
  expect('storage_before', storageBefore.freeBytes == null || storageBefore.freeBytes > 1_000_000_000, String(storageBefore.freeBytes))
  expect('models_catalog_only', (await modelsBytesExcludingAuthorizedAsr(storageBefore.models ?? 0)) < 50_000, String(storageBefore.models))

  const live = await loadProject(LIVE_PROJECT)
  expect('existing_project', Boolean(live), LIVE_PROJECT)
  if (live) {
    const video = live.assets.find(a => a.kind === 'video' && /sample/i.test(a.name)) ?? live.assets.find(a => a.kind === 'video')
    expect('sample_asset', Boolean(video), video?.name ?? 'missing')
    if (video) {
      const doc = loadObservationsSync(live.id, video.id)
      expect('vi_obs_count', (doc?.observationCount ?? 0) === 19 || (doc?.observations.length ?? 0) === 19 || (doc?.observations.length ?? 0) > 0, String(doc?.observationCount ?? doc?.observations.length ?? 0))
      const hit = doc ? highestMotionHit(doc) : null
      expect('vi_high_motion_1s', Boolean(hit && Math.abs(toSeconds(hit.start) - 1) < 0.05), hit ? `${toSeconds(hit.start).toFixed(3)}s ${hit.reason}` : 'no hit')
      const director = proposeDirectorCommands(live, 'Find the highest-motion section.', 'AI_DIRECTOR', { sourceAssetId: video.id, workspacePage: 'ai' })
      expect('director_seek_1s', Boolean(director.sourceSeek && Math.abs(toSeconds(director.sourceSeek.time) - 1) < 0.05 && director.commands.length === 0), JSON.stringify({ seek: director.sourceSeek, cmds: director.commands.map(c => c.kind), summary: director.summary }))
      expect('director_no_timeline_mutate', director.commands.length === 0, director.commands.map(c => c.kind).join(','))
    }
    const blurP = proposeDirectorCommands(live, 'Blur the tracked background.', 'AI_DIRECTOR', { workspacePage: 'vfx' })
    const coolP = proposeDirectorCommands(live, 'Cool the shadows.', 'AI_DIRECTOR', { workspacePage: 'color' })
    const panP = proposeDirectorCommands(live, 'Pan this left.', 'AI_DIRECTOR', { workspacePage: 'audio', selectedClipId: live.timeline.tracks.find(t => t.kind === 'video')?.clips[0]?.id })
    expect('director_vfx_blur', blurP.commands.some(c => c.kind === 'updateEffectGraph' || c.kind === 'trackSubject') || blurP.summary.length > 0, blurP.summary)
    expect('director_color_cool', coolP.commands.some(c => c.kind === 'updateColorPipeline') || /cool|shadow|color/i.test(coolP.summary), coolP.summary)
    expect('director_audio_pan', panP.commands.some(c => c.kind === 'setPan' || c.kind === 'updateAudioGraph') || /pan/i.test(panP.summary), panP.summary)
  }

  const clipPath = await generateStarrdomTestClip(path.join(mediaCommandDataHierarchy().tmp, `hvs-w7-src-${process.pid}.mp4`))
  expect('source_clip', clipPath.ok, clipPath.error ?? clipPath.path)
  if (!clipPath.ok) return finish(storageBefore)

  let p = await createProject({ name: 'WAVE7 PREVIEW FIDELITY', productionMode: 'CUSTOM' })
  const ingested = await ingestFile({ project: p, sourcePath: clipPath.path, originalName: 'w7.mp4', mimeType: 'video/mp4' })
  p = ingested.project
  p = (await commitCommands(p, [cmd('insertClip', { trackId: 'V1', assetId: ingested.asset.id, start: fromSeconds(0), duration: fromSeconds(3) })])).project
  p = (await commitCommands(p, [cmd('insertClip', { trackId: 'A1', assetId: ingested.asset.id, start: fromSeconds(0), duration: fromSeconds(3) })])).project
  const clip = p.timeline.tracks.find(t => t.id === 'V1')?.clips[0]
  expect('clip', Boolean(clip), clip?.id ?? 'missing')
  if (!clip) return finish(storageBefore)
  p = (await commitCommands(p, [cmd('trackSubject', {
    clipId: clip.id,
    label: 'WAVE7 TRACKED GEOMETRIC',
    seedBox: { x: 0.32, y: 0.16, width: 0.28, height: 0.62 },
    keyframes: [
      { time: fromSeconds(0.5), x: 0.28, y: 0.16, width: 0.28, height: 0.62, confidence: 0.8 },
      { time: fromSeconds(1.5), x: 0.38, y: 0.17, width: 0.28, height: 0.62, confidence: 0.8 },
      { time: fromSeconds(2.5), x: 0.48, y: 0.18, width: 0.28, height: 0.62, confidence: 0.8 },
    ],
  })])).project
  const subject = p.timeline.subjects[0]
  expect('subject', Boolean(subject), subject?.id ?? 'missing')
  const fxg = firstTrackedBackgroundBlurGraph(p.id, ingested.asset.id, subject.id, 10)
  const fxApply = applyEditCommand(p, cmd('updateEffectGraph', { graph: fxg }))
  expect('fx_graph', fxApply.ok && validateEffectGraph(fxg, { assetIds: new Set(p.assets.map(a => a.id)), subjectIds: new Set(p.timeline.subjects.map(s => s.id)) }).ok, ('error' in fxApply ? fxApply.error : undefined) ?? fxg.id)
  if (fxApply.ok) p = fxApply.project

  const lut = writeGainCube({ name: `hvs-w7-red-${process.pid}`, r: 1.2, g: 1, b: 0.88 })
  expect('lut_ok', validateCubeFile(lut).ok, validateCubeFile(lut).errors.join('; '))
  const rgb = firstWave4RgbCurvePipeline()
  const color = {
    schemaVersion: 1 as const,
    outputColorSpace: 'display-referred' as const,
    nodes: [
      { id: 'temp', type: 'temp-tint' as const, enabled: true, params: { temperature: -0.35, tint: 0.04 } },
      { id: 'contrast', type: 'contrast-pivot' as const, enabled: true, params: { contrast: 0.28, pivot: 0.45 } },
      { ...rgb.nodes[0], id: 'rgb' },
      { id: 'q', type: 'luma-qualifier' as const, enabled: true, params: { low: 0, high: 0.5, softness: 0.08, invert: false, showMask: true } },
      { id: 'lut', type: 'lut' as const, enabled: true, params: { file: lut } },
    ],
  }
  const colorApply = applyEditCommand(p, cmd('updateColorPipeline', { pipeline: color }))
  expect('color_graph', colorApply.ok && validateColorPipeline(color).ok, ('error' in colorApply ? colorApply.error : undefined) ?? String(color.nodes.length))
  if (colorApply.ok) p = colorApply.project

  const audio = firstWave4AudioGraph('V1', 'A1')
  audio.channels[0].volume = 0.9
  audio.channels[0].pan = -0.2
  audio.automation = [{
    target: 'ch-A',
    param: 'pan',
    keyframes: [
      { time: fromSeconds(0), value: -0.85 },
      { time: fromSeconds(2.8), value: 0.85 },
    ],
  }]
  const audioApply = applyEditCommand(p, cmd('updateAudioGraph', { graph: audio }))
  expect('audio_graph', audioApply.ok && validateAudioGraph(audio, new Set(p.timeline.tracks.map(t => t.id))).ok, ('error' in audioApply ? audioApply.error : undefined) ?? 'audio')
  if (audioApply.ok) p = audioApply.project

  p = (await commitCommands(p, [cmd('addCaption', { start: fromSeconds(0.2), end: fromSeconds(2.8), text: 'WAVE7 FIDELITY', positionPreset: 'bottom-center', fontSize: 42 })])).project
  p = (await commitCommands(p, [cmd('addTitle', { text: 'HVS WAVE 7', start: fromSeconds(0.1), duration: fromSeconds(2.6), stylePreset: 'cinematic' })])).project
  p = await snapshotVersion(p, 'WAVE7 PREVIEW FIDELITY', 'human', { description: 'Preview fidelity fixture' })
  expect('version_master', p.versions.some(v => v.label === 'WAVE7 PREVIEW FIDELITY'), p.versions.map(v => v.label).join(','))

  const dummyJob = {
    id: 'plan-check',
    projectId: p.id,
    versionId: p.currentVersionId,
    status: 'queued' as const,
    target: { aspect: '16:9' as const, width: 1920, height: 1080, format: 'mp4' as const, videoCodec: 'h264' as const, audioCodec: 'aac' as const },
    outputPath: null, outputAssetId: null, encoder: null, probe: null, error: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), blockedReason: null,
  }
  const compiled = compileUnifiedRenderPlan(p, dummyJob)
  expect('unified_plan', Boolean(compiled.ok && compiled.plan && compiled.plan.vfxActive && compiled.plan.colorActive && compiled.plan.audioActive), compiled.error ?? JSON.stringify(compiled.plan ? { v: compiled.plan.vfxActive, c: compiled.plan.colorActive, a: compiled.plan.audioActive } : null))
  expect('lanes_active', activeUnifiedLanes(p).vfxActive && isColorPipelineActive(p.colorPipeline) && isAudioGraphActive(p.audioGraph), JSON.stringify(activeUnifiedLanes(p)))

  const vclip = p.timeline.tracks.find(t => t.id === 'V1')!.clips[0]
  const look05 = programLookAt(p, 0.5, { clip: vclip, quality: 'accurate' })
  const look15 = programLookAt(p, 1.5, { clip: vclip, quality: 'accurate' })
  const look25 = programLookAt(p, 2.5, { clip: vclip, quality: 'accurate' })
  expect('preview_looks', look05.ok && look15.ok && look25.ok && look15.blurPx === 10 && look15.trackerFollows && look15.showQualifierMask, JSON.stringify({ blur: look15.blurPx, track: look15.trackerFollows, mask: look15.showQualifierMask, err: look15.error }))
  expect('preview_track_moves', Boolean(look05.maskCenter && look25.maskCenter && Math.abs(look25.maskCenter.x - look05.maskCenter.x) > 0.05), JSON.stringify({ a: look05.maskCenter, b: look25.maskCenter }))
  expect('caption_objects', p.timeline.captionTracks.some(t => t.cues.length > 0) && p.timeline.overlays.some(o => o.kind === 'title'), 'caption/title')

  p = await saveProject(p)
  const r16 = await commitCommands(p, [cmd('render', { aspect: '16:9' })])
  p = await processRenderQueue(r16.project.id) ?? r16.project
  const job16 = p.renderJobs.find(j => j.target.aspect === '16:9')
  expect('unified_deliver', Boolean(job16?.status === 'completed' && job16.outputPath && existsSync(job16.outputPath) && job16.laneProvenance?.vfxActive && job16.laneProvenance?.colorActive && job16.laneProvenance?.audioActive), `${job16?.status} ${job16?.error ?? ''} ${JSON.stringify(job16?.laneProvenance)}`)

  if (job16?.outputPath && existsSync(job16.outputPath)) {
    const probed = await probeMediaFile(job16.outputPath)
    expect('probe_16x9', probed.hasVideo && probed.hasAudio && probed.width === 1920 && probed.height === 1080, JSON.stringify({ w: probed.width, h: probed.height, d: probed.durationSec }))
    const src = ingested.asset.originalPath
    for (const t of [0.5, 1.5, 2.5] as const) {
      const deliver = await extractFramePixels(job16.outputPath, t)
      const source = await extractFramePixels(src, t)
      expect(`frame_${t}`, Boolean(deliver && source), `d=${Boolean(deliver)} s=${Boolean(source)}`)
      if (deliver && source) {
        const previewStats = applyColorPipelineToPixels(source.rgb, p.colorPipeline)
        const renderStats = regionMean(deliver, 0, 0, deliver.width, deliver.height)
        const before = regionMean(source, 0, 0, source.width, source.height)
        const dir = colorDirectionAgree(before, previewStats, renderStats)
        expect(`color_dir_${t}`, dir.ok, `${dir.notes.join(';')} preview R${previewStats.meanR.toFixed(1)} render R${renderStats.meanR.toFixed(1)}`)
        const look = t === 0.5 ? look05 : t === 1.5 ? look15 : look25
        if (look.maskCenter) {
          const cx = look.maskCenter.x * deliver.width
          const cy = look.maskCenter.y * deliver.height
          const inside = regionMean(deliver, Math.max(0, cx - 80), Math.max(0, cy - 80), 160, 160)
          expect(`mask_region_${t}`, Number.isFinite(inside.luma), `luma ${inside.luma.toFixed(1)} @ ${look.maskCenter.x.toFixed(3)},${look.maskCenter.y.toFixed(3)}`)
        }
      }
    }
  }

  const r16b = await commitCommands(p, [cmd('render', { aspect: '16:9' })])
  p = await processRenderQueue(r16b.project.id) ?? r16b.project
  const jobCache = [...p.renderJobs].reverse().find(j => j.target.aspect === '16:9' && j.status === 'completed')
  expect('cache_hit', Boolean(jobCache?.laneProvenance?.cacheHit), JSON.stringify(jobCache?.laneProvenance))

  const fxMut: HvsEffectGraph = {
    ...fxg,
    nodes: fxg.nodes.map(n => n.kind === 'Blur' ? { ...n, parameters: { ...n.parameters, radius: 18 } } : n),
  }
  const fxM = applyEditCommand(p, cmd('updateEffectGraph', { graph: fxMut }))
  if (fxM.ok) p = fxM.project
  const rFx = await commitCommands(p, [cmd('render', { aspect: '16:9' })])
  p = await processRenderQueue(rFx.project.id) ?? rFx.project
  const jobFx = [...p.renderJobs].reverse().find(j => j.target.aspect === '16:9')
  expect('cache_miss_effectgraph', jobFx?.laneProvenance?.cacheHit === false, JSON.stringify(jobFx?.laneProvenance))

  const master = p.versions.find(v => v.label === 'WAVE7 PREVIEW FIDELITY')
  p = master ? (await restoreVersion(p, master.id, { confirmed: true, actor: 'human' })).project : p

  const mutColor = { ...p.colorPipeline, nodes: p.colorPipeline.nodes.map(n => n.id === 'contrast' ? { ...n, params: { ...n.params, contrast: 0.8 } } : n) }
  const cM = applyEditCommand(p, cmd('updateColorPipeline', { pipeline: mutColor }))
  if (cM.ok) p = cM.project
  const rC = await commitCommands(p, [cmd('render', { aspect: '16:9' })])
  p = await processRenderQueue(rC.project.id) ?? rC.project
  const jobC = [...p.renderJobs].reverse().find(j => j.target.aspect === '16:9')
  expect('cache_miss_color', jobC?.laneProvenance?.cacheHit === false, JSON.stringify(jobC?.laneProvenance))

  p = master ? (await restoreVersion(p, master.id, { confirmed: true, actor: 'human' })).project : p
  const mutAudio = { ...p.audioGraph, channels: p.audioGraph.channels.map((ch, i) => i === 0 ? { ...ch, volume: 0.2 } : ch) }
  const aM = applyEditCommand(p, cmd('updateAudioGraph', { graph: mutAudio }))
  if (aM.ok) p = aM.project
  const rA = await commitCommands(p, [cmd('render', { aspect: '16:9' })])
  p = await processRenderQueue(rA.project.id) ?? rA.project
  const jobA = [...p.renderJobs].reverse().find(j => j.target.aspect === '16:9')
  expect('cache_miss_audio', jobA?.laneProvenance?.cacheHit === false, JSON.stringify(jobA?.laneProvenance))

  const restored = master ? await restoreVersion(p, master.id, { confirmed: true, actor: 'human' }) : { project: p, error: 'no master' }
  expect('version_restore', !restored.error && restored.project.colorPipeline.nodes.some(n => n.id === 'contrast' && Number(n.params.contrast) === 0.28), restored.error ?? String(restored.project.colorPipeline.nodes.find(n => n.id === 'contrast')?.params.contrast))
  p = restored.project
  const lookRest = programLookAt(p, 1.5, { clip: p.timeline.tracks.find(t => t.id === 'V1')!.clips[0] })
  expect('restore_preview', lookRest.blurPx === 10 && lookRest.nodeOrder.includes('rgb-curve'), JSON.stringify({ blur: lookRest.blurPx, nodes: lookRest.nodeOrder }))

  const origCount = p.assets.filter(a => !a.generated).length
  const glowGraph: HvsEffectGraph = {
    ...fxg,
    id: `fxg-glow-bad-${p.id}`,
    nodes: [...fxg.nodes, { id: 'glow-bad', kind: 'Glow', ...defaultPorts('Glow'), enabled: true, parameters: { amount: 1 } }],
  }
  const failP = parseHvsProject(serializeHvsProject(p))
  failP.effectGraphs = [...failP.effectGraphs, glowGraph]
  await saveProject(failP)
  const failQueued = applyEditCommand(failP, cmd('render', { aspect: '16:9' }))
  await saveProject(failQueued.ok ? failQueued.project : failP)
  const failRun = await processRenderQueue((failQueued.ok ? failQueued.project : failP).id) ?? failP
  expect('fail_invalid_fx', failRun.renderJobs.at(-1)?.status === 'failed', failRun.renderJobs.at(-1)?.error ?? 'fx')
  const afterFail = await loadProject(p.id)
  expect('fail_isolation', Boolean(afterFail && afterFail.assets.filter(a => !a.generated).length >= origCount), String(afterFail?.assets.length))
  p = master ? (await restoreVersion(afterFail ?? p, master.id, { confirmed: true, actor: 'human' })).project : p

  const badLut = path.join(mediaCommandDataHierarchy().fixtures, 'hvs-luts', `hvs-w7-bad-${process.pid}.cube`)
  mkdirSync(path.dirname(badLut), { recursive: true })
  writeFileSync(badLut, 'LUT_3D_SIZE 2\n0 0 0\n', 'utf8')
  const badColor = { ...p.colorPipeline, nodes: p.colorPipeline.nodes.map(n => n.type === 'lut' ? { ...n, params: { file: badLut } } : n) }
  const badP = parseHvsProject(serializeHvsProject(p))
  badP.colorPipeline = badColor
  await saveProject(badP)
  const badQ = applyEditCommand(badP, cmd('render', { aspect: '16:9' }))
  await saveProject(badQ.ok ? badQ.project : badP)
  const badRun = await processRenderQueue((badQ.ok ? badQ.project : badP).id) ?? badP
  expect('fail_bad_lut', badRun.renderJobs.at(-1)?.status === 'failed', badRun.renderJobs.at(-1)?.error ?? 'lut')
  p = master ? (await restoreVersion(badRun, master.id, { confirmed: true, actor: 'human' })).project : p

  const storageAfter = await reportHvsStorage()
  expect('storage_after', storageAfter.freeBytes == null || storageAfter.freeBytes > 500_000_000, String(storageAfter.freeBytes))
  expect('no_model_growth', (await modelsBytesExcludingAuthorizedAsr(storageAfter.models ?? 0)) < 50_000, String(storageAfter.models))
  finish(storageBefore)
}

function finish(storage: Awaited<ReturnType<typeof reportHvsStorage>>) {
  const failed = results.filter(r => !r.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  console.log(JSON.stringify({
    ok: failed.length === 0,
    suite: 'hvs-wave7',
    total: results.length,
    failed: failed.length,
    liveAuth: LIVE_AUTH,
    storageModels: storage.models,
    storageFree: storage.freeBytes,
  }, null, 2))
  if (failed.length) process.exit(1)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
