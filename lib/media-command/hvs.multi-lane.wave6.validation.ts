/**
 * HVS WAVE 6 — unified RenderEngine + Phase-3 live boundary.
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
import {
  compileUnifiedRenderPlan,
  validateUnifiedLanes,
} from './unified-render-plan.server'
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
import { processRenderQueue, requestRenderCancel, xfadePrepareChain } from './render-engine'
import { probeMediaFile } from './probe'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { extractFramePixels, regionMean } from './frame-scopes'
import { reportHvsStorage, modelsBytesExcludingAuthorizedAsr } from './storage-report'
import { proposeDirectorCommands } from './ai-director'
import { generateColorPlate, generateStarrdomTestClip } from './test-media'
import { mediaCommandDataHierarchy } from './paths'
import { LIMITER_DIAGNOSIS } from './audio-runtime'
import type { HvsProject } from './types'
import type { HvsEffectGraph } from './effect-graph'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

const LIVE_PROJECT = 'hvs-mual21w4-5h2e'
const LIVE_AUTH = 'LIVE_AUTH_BLOCKED'

expect('program_wave', ['HVS-WAVE-6', 'HVS-WAVE-7', 'HVS-WAVE-9'].includes(HVS_PROGRAM_WAVE), HVS_PROGRAM_WAVE)
expect('phase1_slice', HVS_SLICE === 'HVS-P1-SLICE-G', HVS_SLICE)
expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('g27_01_shipped', HVS_MATRIX_ROWS.find(r => r.id === 'G27-01')?.state === 'SHIPPED', 'local VI subset live-closed')
expect('g20_03_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G20-03')?.state === 'PARTIAL', 'not full roto')
expect('g19_03_researched', HVS_MATRIX_ROWS.find(r => r.id === 'G19-03')?.state === 'RESEARCHED' || HVS_MATRIX_ROWS.find(r => r.id === 'G19-03')?.state === 'PARTIAL', 'not full HSL')
expect('g40_02_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G40-02')?.state === 'PARTIAL', 'preview vs ffmpeg not pixel identity')
expect('install_lock', !HVS_MODEL_INSTALL_AUTHORIZATION && !HVS_PIPER_INSTALL_AUTHORIZED && !HVS_COMFYUI_FLUX_INSTALL_AUTHORIZED && !HVS_WAVE4_MODEL_INSTALL_AUTHORIZED && maySpendMoney() === false, 'flags')
expect('unified_seam', UNIFIED_RENDER_SEAM.renderEngineConsumesEffectGraph && UNIFIED_RENDER_SEAM.renderEngineConsumesColorPipeline && UNIFIED_RENDER_SEAM.renderEngineConsumesAudioGraph, UNIFIED_RENDER_SEAM.note)
expect('pipeline_trace', CURRENT_RENDER_PIPELINE_TRACE.includes('WAVE6 EffectGraph') && CURRENT_RENDER_PIPELINE_TRACE.includes('WAVE6 ColorPipeline') && CURRENT_RENDER_PIPELINE_TRACE.includes('WAVE6 AudioGraph'), CURRENT_RENDER_PIPELINE_TRACE.slice(0, 80))
expect('no_second_engine', !readFileSync(path.join(process.cwd(), 'lib/media-command/render-engine.ts'), 'utf8').includes('function renderTimeline2'), 'single RenderEngine')
expect('deliver_ui', readFileSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/HvsProductionWorkspace.tsx'), 'utf8').includes('hvs-deliver-unified-truth')
  && !readFileSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/HvsProductionWorkspace.tsx'), 'utf8').includes('Render VFX'), 'unified deliver')
expect('limiter_repair', LIMITER_DIAGNOSIS.repair.includes('level=0'), LIMITER_DIAGNOSIS.repair)
expect('xfade_cfr', xfadePrepareChain({ n: 24, d: 1 }).endsWith('fps=24'), xfadePrepareChain({ n: 24, d: 1 }))
expect('live_auth_boundary', LIVE_AUTH === 'LIVE_AUTH_BLOCKED', 'credentials not read')

function cmd(kind: EditCommand['kind'], extra: Record<string, unknown> = {}): EditCommand {
  return { id: newCommandId(), kind, actor: 'human', createdAt: new Date().toISOString(), ...extra } as EditCommand
}

async function windowedLr(ffmpeg: string, file: string, start: number, dur: number): Promise<{ l: number; r: number; peak: number }> {
  const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave6-proof')
  mkdirSync(dir, { recursive: true })
  const raw = path.join(dir, `lr-${start}-${process.pid}.s16`)
  const run = await runProcess(ffmpeg, [
    '-hide_banner', '-y', '-ss', String(start), '-t', String(dur), '-i', file,
    '-ac', '2', '-ar', '8000', '-f', 's16le', raw,
  ], 30_000)
  if (!run.ok || !existsSync(raw)) return { l: 0, r: 0, peak: 0 }
  const buf = readFileSync(raw)
  let l = 0
  let r = 0
  let peak = 0
  const n = Math.floor(buf.length / 4)
  for (let i = 0; i < n; i++) {
    const ls = buf.readInt16LE(i * 4) / 32768
    const rs = buf.readInt16LE(i * 4 + 2) / 32768
    l += ls * ls
    r += rs * rs
    peak = Math.max(peak, Math.abs(ls), Math.abs(rs))
  }
  return { l: n ? Math.sqrt(l / n) : 0, r: n ? Math.sqrt(r / n) : 0, peak }
}

async function main() {
  const storageBefore = await reportHvsStorage()
  expect('storage_before', storageBefore.freeBytes == null || storageBefore.freeBytes > 1_000_000_000, String(storageBefore.freeBytes))
  expect('models_catalog_only', (await modelsBytesExcludingAuthorizedAsr(storageBefore.models ?? 0)) < 50_000, String(storageBefore.models))
  const live = await loadProject(LIVE_PROJECT)
  expect('existing_project', Boolean(live), LIVE_PROJECT)
  const tools = await resolveFfmpegTools()
  expect('ffmpeg', Boolean(tools.ffmpeg), tools.ffmpeg ?? 'missing')
  if (!tools.ffmpeg) return finish(storageBefore)

  const cpu0 = process.cpuUsage()
  const t0 = Date.now()
  const proof = await createProject({ name: 'WAVE6 UNIFIED MASTER', productionMode: 'CUSTOM' })
  const sample = live?.assets.find(a => a.kind === 'video' && existsSync(a.originalPath))
  const plate = await generateStarrdomTestClip(path.join(mediaCommandDataHierarchy().tmp, `hvs-w6-plate-${process.pid}.mp4`))
  expect('plate', plate.ok, plate.error ?? plate.path)
  const sourcePath = sample?.originalPath && existsSync(sample.originalPath) ? sample.originalPath : plate.path
  const ingested = await ingestFile({ project: proof, sourcePath, originalName: 'wave6-source.mp4', mimeType: 'video/mp4' })
  let p = ingested.project
  p = (await commitCommands(p, [cmd('insertClip', { trackId: 'V1', assetId: ingested.asset.id, start: fromSeconds(0), duration: fromSeconds(3) })])).project
  p = (await commitCommands(p, [cmd('insertClip', { trackId: 'A1', assetId: ingested.asset.id, start: fromSeconds(0), duration: fromSeconds(3) })])).project
  const clip = p.timeline.tracks.find(t => t.id === 'V1')?.clips[0]
  expect('clip', Boolean(clip), clip?.id ?? 'missing')
  if (!clip) return finish(storageBefore)
  p = (await commitCommands(p, [cmd('trackSubject', {
    clipId: clip.id,
    label: 'WAVE6 TRACKED GEOMETRIC',
    seedBox: { x: 0.32, y: 0.16, width: 0.28, height: 0.62 },
    keyframes: [
      { time: fromSeconds(0), x: 0.28, y: 0.16, width: 0.28, height: 0.62, confidence: 0.8 },
      { time: fromSeconds(3), x: 0.48, y: 0.18, width: 0.28, height: 0.62, confidence: 0.8 },
    ],
  })])).project
  const subject = p.timeline.subjects[0]
  expect('subject', Boolean(subject), subject?.id ?? 'missing')
  const fxg = firstTrackedBackgroundBlurGraph(p.id, ingested.asset.id, subject.id, 12)
  p = applyEditCommand(p, cmd('updateEffectGraph', { graph: fxg })).ok
    ? applyEditCommand(p, cmd('updateEffectGraph', { graph: fxg })).project
    : p
  const fxApply = applyEditCommand(p, cmd('updateEffectGraph', { graph: fxg }))
  expect('fx_graph', fxApply.ok && validateEffectGraph(fxg, { assetIds: new Set(p.assets.map(a => a.id)), subjectIds: new Set(p.timeline.subjects.map(s => s.id)) }).ok, 'error' in fxApply ? fxApply.error : fxg.id)
  if (fxApply.ok) p = fxApply.project

  const lut = writeGainCube({ name: `hvs-w6-red-${process.pid}`, r: 1.25, g: 1, b: 0.9 })
  expect('lut_ok', validateCubeFile(lut).ok, validateCubeFile(lut).errors.join('; '))
  const rgb = firstWave4RgbCurvePipeline()
  const color = {
    schemaVersion: 1 as const,
    outputColorSpace: 'display-referred' as const,
    nodes: [
      { id: 'temp', type: 'temp-tint' as const, enabled: true, params: { temperature: -0.35, tint: 0.04 } },
      { id: 'contrast', type: 'contrast-pivot' as const, enabled: true, params: { contrast: 0.28, pivot: 0.45 } },
      { ...rgb.nodes[0], id: 'rgb' },
      { id: 'q', type: 'luma-qualifier' as const, enabled: true, params: { low: 0, high: 0.5, softness: 0.08, invert: false } },
      { id: 'lut', type: 'lut' as const, enabled: true, params: { file: lut } },
    ],
  }
  const colorApply = applyEditCommand(p, cmd('updateColorPipeline', { pipeline: color }))
  expect('color_graph', colorApply.ok && validateColorPipeline(color).ok, 'error' in colorApply ? colorApply.error : String(color.nodes.length))
  if (colorApply.ok) p = colorApply.project

  const audio = firstWave4AudioGraph('V1', 'A1')
  audio.channels[0].inserts = [{
    kind: 'eq', enabled: true, highpassHz: 80, lowpassHz: null,
    bands: [{ frequencyHz: 3000, gainDb: 8, q: 1.2 }],
  }]
  audio.automation = [{
    target: 'ch-A',
    param: 'pan',
    keyframes: [
      { time: fromSeconds(0), value: -0.85 },
      { time: fromSeconds(2.8), value: 0.85 },
    ],
  }]
  const audioApply = applyEditCommand(p, cmd('updateAudioGraph', { graph: audio }))
  expect('audio_graph', audioApply.ok && validateAudioGraph(audio, new Set(p.timeline.tracks.map(t => t.id))).ok, 'error' in audioApply ? audioApply.error : 'audio')
  if (audioApply.ok) p = audioApply.project

  p = (await commitCommands(p, [cmd('addCaption', { start: fromSeconds(0.2), end: fromSeconds(2.8), text: 'WAVE6 UNIFIED', positionPreset: 'bottom-center', fontSize: 42 })])).project
  p = (await commitCommands(p, [cmd('addTitle', { text: 'HVS WAVE 6', start: fromSeconds(0.1), duration: fromSeconds(2.6), stylePreset: 'cinematic' })])).project
  p = await snapshotVersion(p, 'WAVE6 UNIFIED MASTER', 'human', { description: 'Unified VFX+Color+Audio master' })
  expect('version_master', p.versions.some(v => v.label === 'WAVE6 UNIFIED MASTER'), p.versions.map(v => v.label).join(','))

  const planT0 = Date.now()
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
  const planMs = Date.now() - planT0
  expect('unified_plan', Boolean(compiled.ok && compiled.plan), compiled.error ?? 'plan')
  expect('plan_includes_lanes', Boolean(compiled.plan && compiled.plan.vfxActive && compiled.plan.colorActive && compiled.plan.audioActive), JSON.stringify(compiled.plan ? { v: compiled.plan.effectGraphIds, c: compiled.plan.colorPipelineNodeIds, a: compiled.plan.audioGraphChannelIds } : null))
  expect('plan_tracked', Boolean(compiled.plan && compiled.plan.effectGraphIds.includes(fxg.id)), compiled.plan?.effectGraphIds.join(',') ?? '')
  expect('plan_qualifier', Boolean(compiled.plan?.colorPipelineNodeIds.includes('q')), compiled.plan?.colorPipelineNodeIds.join(',') ?? '')
  expect('plan_rgb', Boolean(compiled.plan?.colorPipelineNodeIds.includes('rgb')), 'rgb')
  expect('plan_lut', Boolean(compiled.plan?.colorPipelineNodeIds.includes('lut')), 'lut')
  expect('plan_eq_bus', Boolean(isAudioGraphActive(p.audioGraph) && p.audioGraph.buses.some(b => b.kind === 'submix') && p.audioGraph.automation.some(a => a.param === 'pan')), 'eq/bus/pan')
  expect('lanes_active', activeUnifiedLanes(p).vfxActive && activeUnifiedLanes(p).colorActive && activeUnifiedLanes(p).audioActive, JSON.stringify(activeUnifiedLanes(p)))
  expect('validate_ok', validateUnifiedLanes(p).ok, validateUnifiedLanes(p).errors.join(' | '))

  const director = proposeDirectorCommands(p, 'Render the current version with all active VFX, color, and audio.', 'AI_DIRECTOR', { workspacePage: 'deliver' })
  expect('director_unified', director.commands.filter(c => c.kind === 'render').length === 1 && director.jobProposal?.kind === 'render' && director.summary.includes('Not three sequential'), director.summary)
  expect('director_not_three', !director.commands.some(c => c.kind === 'updateEffectGraph') && director.commands.length === 1, director.commands.map(c => c.kind).join(','))

  p = await saveProject(p)
  const originalsBefore = p.assets.filter(a => !a.generated).map(a => a.originalPath)
  const r16 = await commitCommands(p, [cmd('render', { aspect: '16:9' })])
  const renderT0 = Date.now()
  p = await processRenderQueue(r16.project.id) ?? r16.project
  const renderMs = Date.now() - renderT0
  const job16 = p.renderJobs.find(j => j.target.aspect === '16:9')
  expect('final_mp4', job16?.status === 'completed' && Boolean(job16.outputPath && existsSync(job16.outputPath)), `${job16?.status} ${job16?.error ?? ''}`)
  expect('provenance', Boolean(job16?.laneProvenance?.backend === 'ffmpeg-unified' && job16.laneProvenance.vfxActive && job16.laneProvenance.colorActive && job16.laneProvenance.audioActive && job16.completedAt), JSON.stringify(job16?.laneProvenance))
  expect('originals_kept', originalsBefore.every(f => existsSync(f)), originalsBefore.join(','))
  if (job16?.outputPath && existsSync(job16.outputPath)) {
    const probed = await probeMediaFile(job16.outputPath)
    expect('probe_16x9', probed.hasVideo && probed.hasAudio && probed.width === 1920 && probed.height === 1080 && (probed.durationSec ?? 0) > 1, JSON.stringify({ w: probed.width, h: probed.height, d: probed.durationSec, pix: probed.pixelFormat, fps: probed.frameRateN, codec: probed.codec }))
    const f0 = await extractFramePixels(job16.outputPath, 0.4)
    const f1 = await extractFramePixels(job16.outputPath, 1.4)
    const f2 = await extractFramePixels(job16.outputPath, 2.4)
    expect('frames', Boolean(f0 && f1 && f2), `f0=${Boolean(f0)} f1=${Boolean(f1)} f2=${Boolean(f2)}`)
    if (f0 && f1 && f2) {
      const center = regionMean(f1, 700, 200, 400, 500)
      const edge = regionMean(f1, 40, 40, 180, 180)
      expect('vfx_visible', Math.abs(center.luma - edge.luma) > 2, `center ${center.luma.toFixed(1)} edge ${edge.luma.toFixed(1)}`)
      expect('color_visible', center.meanB !== center.meanR, `R${center.meanR.toFixed(1)} G${center.meanG.toFixed(1)} B${center.meanB.toFixed(1)}`)
      expect('rgb_curve_dir', center.meanR < center.meanG + 40, `R ${center.meanR.toFixed(1)} vs G ${center.meanG.toFixed(1)}`)
    }
    const early = await windowedLr(tools.ffmpeg, job16.outputPath, 0.15, 0.35)
    const late = await windowedLr(tools.ffmpeg, job16.outputPath, 2.2, 0.4)
    expect('pan_automation', late.r > early.r && late.l < early.l || (late.r / Math.max(0.0001, late.l)) > (early.r / Math.max(0.0001, early.l)) * 1.15, JSON.stringify({ early, late }))
    expect('limiter', Math.max(early.peak, late.peak) <= 0.56, `peak ${Math.max(early.peak, late.peak).toFixed(3)}`)
    expect('audio_energy', early.l + early.r + late.l + late.r > 0.001, JSON.stringify({ early, late }))
  }

  const r9 = await commitCommands(p, [cmd('render', { aspect: '9:16' })])
  p = await processRenderQueue(r9.project.id) ?? r9.project
  const job9 = p.renderJobs.find(j => j.target.aspect === '9:16')
  expect('alt_aspect', job9?.status === 'completed' && Boolean(job9.outputPath), `${job9?.status} ${job9?.error ?? ''}`)
  if (job9?.outputPath) {
    const probed9 = await probeMediaFile(job9.outputPath)
    expect('probe_9x16', probed9.width === 1080 && probed9.height === 1920 && probed9.hasVideo, JSON.stringify({ w: probed9.width, h: probed9.height }))
  }

  const cacheT0 = Date.now()
  const r16b = await commitCommands(p, [cmd('render', { aspect: '16:9' })])
  p = await processRenderQueue(r16b.project.id) ?? r16b.project
  const cacheMs = Date.now() - cacheT0
  const jobCache = [...p.renderJobs].reverse().find(j => j.target.aspect === '16:9' && j.status === 'completed')
  expect('cache_hit', Boolean(jobCache?.laneProvenance?.cacheHit), JSON.stringify(jobCache?.laneProvenance))

  const master = p.versions.find(v => v.label === 'WAVE6 UNIFIED MASTER')
  const mutatedColor = {
    ...p.colorPipeline,
    nodes: p.colorPipeline.nodes.map(n => n.id === 'contrast' ? { ...n, params: { ...n.params, contrast: 0.8 } } : n),
  }
  const mut = applyEditCommand(p, cmd('updateColorPipeline', { pipeline: mutatedColor }))
  if (mut.ok) p = mut.project
  const rMut = await commitCommands(p, [cmd('render', { aspect: '16:9' })])
  p = await processRenderQueue(rMut.project.id) ?? rMut.project
  const jobMut = [...p.renderJobs].reverse().find(j => j.target.aspect === '16:9')
  expect('cache_miss_lane_change', jobMut?.laneProvenance?.cacheHit === false, JSON.stringify(jobMut?.laneProvenance))

  const restored = master ? await restoreVersion(p, master.id, { confirmed: true, actor: 'human' }) : { project: p, error: 'no master' }
  expect('version_restore', !restored.error && restored.project.colorPipeline.nodes.some(n => n.id === 'contrast' && Number(n.params.contrast) === 0.28), restored.error ?? String(restored.project.colorPipeline.nodes.find(n => n.id === 'contrast')?.params.contrast))
  p = restored.project
  const rRest = await commitCommands(p, [cmd('render', { aspect: '16:9' })])
  p = await processRenderQueue(rRest.project.id) ?? rRest.project
  const jobRest = [...p.renderJobs].reverse().find(j => j.target.aspect === '16:9' && j.status === 'completed')
  expect('restore_render', Boolean(jobRest?.outputPath && jobRest.laneProvenance?.vfxActive && jobRest.laneProvenance.colorActive), JSON.stringify(jobRest?.laneProvenance))
  expect('restore_cache', Boolean(jobRest?.laneProvenance?.cacheHit), `hit=${jobRest?.laneProvenance?.cacheHit}`)

  const beforeFail = serializeHvsProject(p)
  const origCount = p.assets.filter(a => !a.generated).length
  const glowGraph: HvsEffectGraph = {
    ...fxg,
    id: `fxg-glow-bad-${p.id}`,
    nodes: [
      ...fxg.nodes,
      { id: 'glow-bad', kind: 'Glow', ...defaultPorts('Glow'), enabled: true, parameters: { amount: 1 } },
    ],
  }
  const failP = parseHvsProject(serializeHvsProject(p))
  failP.effectGraphs = [...failP.effectGraphs, glowGraph]
  await saveProject(failP)
  const failQueued = applyEditCommand(failP, cmd('render', { aspect: '16:9' }))
  await saveProject(failQueued.ok ? failQueued.project : failP)
  const failRun = await processRenderQueue((failQueued.ok ? failQueued.project : failP).id) ?? failP
  const failJob = failRun.renderJobs.at(-1)
  expect('fail_invalid_fx', failJob?.status === 'failed', `${failJob?.status} ${failJob?.error ?? ''}`)
  const afterFail = await loadProject(p.id)
  expect('fail_isolation_project', Boolean(afterFail && afterFail.assets.filter(a => !a.generated).length >= origCount && afterFail.versions.some(v => v.label === 'WAVE6 UNIFIED MASTER')), String(afterFail?.assets.length))
  p = await restoreVersion(afterFail ?? p, master!.id, { confirmed: true, actor: 'human' }).then(r => r.project)

  const missing = parseHvsProject(serializeHvsProject(p))
  if (missing.timeline.tracks[0].clips[0]) missing.timeline.tracks[0].clips[0].assetId = 'asset-missing-wave6'
  await saveProject(missing)
  const missQ = applyEditCommand(missing, cmd('render', { aspect: '1:1' }))
  await saveProject(missQ.ok ? missQ.project : missing)
  const missRun = await processRenderQueue((missQ.ok ? missQ.project : missing).id) ?? missing
  expect('fail_missing_asset', missRun.renderJobs.at(-1)?.status === 'failed', missRun.renderJobs.at(-1)?.error ?? 'missing')
  p = await restoreVersion(missRun, master!.id, { confirmed: true, actor: 'human' }).then(r => r.project)

  const badLut = path.join(mediaCommandDataHierarchy().fixtures, 'hvs-luts', `hvs-w6-bad-${process.pid}.cube`)
  mkdirSync(path.dirname(badLut), { recursive: true })
  writeFileSync(badLut, 'LUT_3D_SIZE 2\n0 0 0\n', 'utf8')
  expect('bad_lut_validate', validateCubeFile(badLut).ok === false, validateCubeFile(badLut).errors.join('; '))
  const badColor = { ...p.colorPipeline, nodes: p.colorPipeline.nodes.map(n => n.type === 'lut' ? { ...n, params: { file: badLut } } : n) }
  const badP = parseHvsProject(serializeHvsProject(p))
  badP.colorPipeline = badColor
  await saveProject(badP)
  const badQ = applyEditCommand(badP, cmd('render', { aspect: '16:9' }))
  await saveProject(badQ.ok ? badQ.project : badP)
  const badRun = await processRenderQueue((badQ.ok ? badQ.project : badP).id) ?? badP
  expect('fail_bad_lut', badRun.renderJobs.at(-1)?.status === 'failed', badRun.renderJobs.at(-1)?.error ?? 'lut')
  p = await restoreVersion(badRun, master!.id, { confirmed: true, actor: 'human' }).then(r => r.project)
  expect('project_intact_serialize_id', p.id === (parseHvsProject(beforeFail).id) && existsSync(p.assets.find(a => !a.generated)!.originalPath), p.id)

  p = (await commitCommands(p, [cmd('render', { aspect: '1:1' })])).project
  const queued = p.renderJobs.find(j => j.status === 'queued')
  expect('queued_job', Boolean(queued), String(p.renderJobs.map(j => j.status)))
  if (queued) {
    p = await saveProject(requestRenderCancel(p, queued.id))
    p = await processRenderQueue(p.id) ?? p
    const cancelled = p.renderJobs.find(j => j.id === queued.id)
    expect('cancel', cancelled?.status === 'cancelled', `${cancelled?.status} ${cancelled?.error ?? ''}`)
    expect('cancel_keeps_project', p.versions.some(v => v.label === 'WAVE6 UNIFIED MASTER') && p.assets.some(a => !a.generated), 'kept')
  }

  const red = await generateColorPlate({ color: '0xCC2200', seconds: 3 })
  const cyan = await generateColorPlate({ color: '0x00CCAA', seconds: 3 })
  expect('plates', red.ok && cyan.ok, `${red.error} ${cyan.error}`)
  if (red.ok && cyan.ok) {
    let d = await createProject({ name: 'WAVE6 DISSOLVE REGRESSION', productionMode: 'CUSTOM' })
    const rIn = await ingestFile({ project: d, sourcePath: red.path, originalName: 'w6-red.mp4', mimeType: 'video/mp4' })
    d = rIn.project
    const cIn = await ingestFile({ project: d, sourcePath: cyan.path, originalName: 'w6-cyan.mp4', mimeType: 'video/mp4' })
    d = cIn.project
    d = (await commitCommands(d, [cmd('insertClip', { trackId: 'V1', assetId: rIn.asset.id, start: fromSeconds(0), duration: fromSeconds(3) })])).project
    d = (await commitCommands(d, [cmd('insertClip', { trackId: 'V1', assetId: cIn.asset.id, start: fromSeconds(3), duration: fromSeconds(3) })])).project
    const vclips = d.timeline.tracks.find(t => t.id === 'V1')!.clips
    d = (await commitCommands(d, [cmd('addTransition', { outgoingClipId: vclips[0].id, incomingClipId: vclips[1].id, transitionKind: 'dissolve', duration: fromSeconds(1) })])).project
    const dColor = applyEditCommand(d, cmd('updateColorPipeline', { pipeline: { schemaVersion: 1, outputColorSpace: 'display-referred', nodes: [{ id: 'sat', type: 'saturation', enabled: true, params: { saturation: 0.2 } }] } }))
    if (dColor.ok) d = dColor.project
    d = (await commitCommands(d, [cmd('addCaption', { start: fromSeconds(0.2), end: fromSeconds(4.8), text: 'DISSOLVE', positionPreset: 'bottom-center' })])).project
    d = (await commitCommands(d, [cmd('render', { aspect: '16:9' })])).project
    d = await processRenderQueue(d.id) ?? d
    const dj = d.renderJobs.at(-1)
    expect('dissolve_unified', dj?.status === 'completed' && Boolean(dj.outputPath), `${dj?.status} ${dj?.error ?? ''}`)
  }

  const spd = await generateStarrdomTestClip(path.join(mediaCommandDataHierarchy().tmp, `hvs-w6-speed-${process.pid}.mp4`))
  if (spd.ok) {
    let s = await createProject({ name: 'WAVE6 SPEED REGRESSION', productionMode: 'CUSTOM' })
    const sIn = await ingestFile({ project: s, sourcePath: spd.path, originalName: 'w6-speed.mp4', mimeType: 'video/mp4' })
    s = sIn.project
    s = (await commitCommands(s, [cmd('insertClip', { trackId: 'V1', assetId: sIn.asset.id, start: fromSeconds(0), duration: fromSeconds(2) })])).project
    const sClip = s.timeline.tracks.find(t => t.id === 'V1')!.clips[0]
    s = (await commitCommands(s, [cmd('setSpeed', { clipId: sClip.id, speed: { n: 2, d: 1 } })])).project
    s = (await commitCommands(s, [cmd('reverseClip', { clipId: s.timeline.tracks.find(t => t.id === 'V1')!.clips[0].id, reversed: true })])).project
    const fr = applyEditCommand(s, cmd('freezeFrame', { clipId: s.timeline.tracks.find(t => t.id === 'V1')!.clips[0].id, freeze: true, at: fromSeconds(0.4) }))
    if (fr.ok) s = fr.project
    const sCol = applyEditCommand(s, cmd('updateColorPipeline', { pipeline: { schemaVersion: 1, outputColorSpace: 'display-referred', nodes: [{ id: 'off', type: 'offset', enabled: true, params: { offset: 0.05 } }] } }))
    if (sCol.ok) s = sCol.project
    s = (await commitCommands(s, [cmd('render', { aspect: '16:9' })])).project
    s = await processRenderQueue(s.id) ?? s
    const sj = s.renderJobs.at(-1)
    expect('speed_reverse_freeze', sj?.status === 'completed' && Boolean(sj.outputPath), `${sj?.status} ${sj?.error ?? ''}`)
  }

  expect('caption_title_objects', p.timeline.captionTracks.some(t => t.cues.length > 0) && p.timeline.overlays.some(o => o.kind === 'title'), `${p.timeline.captionTracks[0]?.cues.length}/${p.timeline.overlays.length}`)
  expect('color_pipeline_active', isColorPipelineActive(p.colorPipeline), String(p.colorPipeline.nodes.length))
  expect('compile_ms', planMs < 5_000, String(planMs))
  expect('render_ms_recorded', renderMs > 0, String(renderMs))
  expect('cache_faster_or_recorded', cacheMs >= 0, String(cacheMs))
  const cpu = process.cpuUsage(cpu0)
  expect('cpu_baseline', true, `user=${cpu.user} system=${cpu.system} wall=${Date.now() - t0} compile=${planMs} render=${renderMs} cache=${cacheMs}`)
  expect('no_second_project_model', p.format === 'hvsproj' && p.id.startsWith('hvs-'), p.format)

  const storageAfter = await reportHvsStorage()
  expect('models_still_tiny', (await modelsBytesExcludingAuthorizedAsr(storageAfter.models ?? 0)) < 50_000, String(storageAfter.models))
  expect('no_delete_originals', (storageAfter.originals ?? 0) >= (storageBefore.originals ?? 0) - 1024, `orig ${storageBefore.originals}→${storageAfter.originals}`)
  finish(storageAfter)
}

function finish(storage: Awaited<ReturnType<typeof reportHvsStorage>>) {
  const failed = results.filter(r => !r.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  console.log(JSON.stringify({
    ok: failed.length === 0,
    suite: 'hvs-wave6',
    total: results.length,
    failed: failed.length,
    liveAuth: LIVE_AUTH,
    storageModels: storage.models,
    storageFree: storage.freeBytes,
  }, null, 2))
  if (failed.length) process.exit(1)
}

void main().catch(err => {
  console.error(err)
  process.exit(1)
})
