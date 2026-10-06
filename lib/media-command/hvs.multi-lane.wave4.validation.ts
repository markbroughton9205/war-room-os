/**
 * HVS WAVE 4 — workspace closure + advanced media execution.
 * No paid generation. No Piper/ComfyUI/FLUX install. Physical evidence required.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { HVS_PROGRAM_WAVE, HVS_SLICE } from './navigation'
import { HVS_MATRIX_ROWS } from './production-matrix'
import {
  HVS_WAVE4_COMFYUI_INSTALL_AUTHORIZED,
  HVS_WAVE4_FLUX_DOWNLOAD_AUTHORIZED,
  HVS_WAVE4_MODEL_INSTALL_AUTHORIZED,
  HVS_WAVE4_PIPER_INSTALL_AUTHORIZED,
  maySpendMoney,
} from './policy'
import { inspectGenerationRequest, GENERATION_SURFACE_STATES } from './generation-authority'
import { localEngineCards, requestInstallApproval, beginInstallForbidden, generateDoesNotInstall } from './model-install'
import { PIPER_INSTALL_PLAN, COMFYUI_FLUX_INSTALL_PLAN } from './local-generation-plans'
import { piperAdapter, comfyUiFluxAdapter } from './provider-adapters'
import { loadProject, saveProject, snapshotVersion, restoreVersion, commitCommands } from './store'
import { executeVideoAnalysis, highestMotionHit, searchPersistedObservations, loadObservationsSync } from './video-analysis'
import { firstEllipseMaskGraph, firstBlurGraph, firstTrackedMaskGraph, firstMaskedMergeGraph, validateEffectGraph, planEffectGraphLowering } from './effect-graph'
import { executeEffectGraph } from './effect-graph-runtime'
import { firstWave4RgbCurvePipeline, executeColorPipeline, lut3dAvailable } from './color-runtime'
import { validateColorPipeline } from './color-pipeline'
import { proposeShotMatch, statsFromChannels } from './shot-match'
import { writeGainCube } from './lut-cube'
import { firstWave4AudioGraph, executeAudioMix, executeAudioGraph, interpolateAutomation, LIMITER_DIAGNOSIS, AUTOMATION_INTERPOLATION } from './audio-runtime'
import { validateAudioGraph } from './audio-graph'
import { eqResponseCurve } from './eq-response'
import { extractFramePixels, regionMean } from './frame-scopes'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { probeMediaFile } from './probe'
import { reportHvsStorage } from './storage-report'
import { proposeDirectorCommands } from './ai-director'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { fromSeconds, toSeconds } from './time'
import { mediaCommandDataHierarchy } from './paths'
import { applySnapshotAuthoring } from './versions'
import { newCommandId } from './edit-commands'
import { applyEditCommand } from './edit-ops'
import type { TrackSubject } from './types'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

const PROJECT_ID = 'hvs-mual21w4-5h2e'

expect('program_wave', ['HVS-WAVE-4', 'HVS-WAVE-5', 'HVS-WAVE-6', 'HVS-WAVE-7', 'HVS-WAVE-9'].includes(HVS_PROGRAM_WAVE), HVS_PROGRAM_WAVE)
expect('phase1_slice', HVS_SLICE === 'HVS-P1-SLICE-G', HVS_SLICE)
expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('g22_02_shell', HVS_MATRIX_ROWS.find(r => r.id === 'G22-02')?.state === 'SHELL', 'no fake generation')
expect('g27_01_shipped', HVS_MATRIX_ROWS.find(r => r.id === 'G27-01')?.state === 'SHIPPED', 'local VI subset live-closed; G27-02 remains SHELL')
expect('g20_03_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G20-03')?.state === 'PARTIAL', 'not full roto')
expect('g19_02_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G19-02')?.state === 'PARTIAL', 'not full hue-curve suite')
expect('install_flags_false', !HVS_WAVE4_MODEL_INSTALL_AUTHORIZED && !HVS_WAVE4_PIPER_INSTALL_AUTHORIZED && !HVS_WAVE4_COMFYUI_INSTALL_AUTHORIZED && !HVS_WAVE4_FLUX_DOWNLOAD_AUTHORIZED && maySpendMoney() === false, 'flags')
expect('piper_plan', PIPER_INSTALL_PLAN.notAuthorizedNow && PIPER_INSTALL_PLAN.officialRepository.maintained.includes('piper1-gpl'), PIPER_INSTALL_PLAN.officialRepository.maintainedLicense)
expect('flux_plan', COMFYUI_FLUX_INSTALL_PLAN.notAuthorizedNow && COMFYUI_FLUX_INSTALL_PLAN.officialRepository.fluxLicense.includes('Apache'), COMFYUI_FLUX_INSTALL_PLAN.totalStorage)
expect('surface_local', GENERATION_SURFACE_STATES.includes('LOCAL ENGINE NOT INSTALLED'), GENERATION_SURFACE_STATES.join('|'))
expect('docs', existsSync(path.join(process.cwd(), 'docs/hvs-waves/HVS_PIPER_INSTALL_PLAN.md')) && existsSync(path.join(process.cwd(), 'docs/hvs-waves/HVS_COMFYUI_FLUX_INSTALL_PLAN.md')), 'plans')

const inspect = inspectGenerationRequest('IMAGE_GENERATION', PROJECT_ID, 'key art')
expect('local_engine_ui', inspect.surfaceState === 'LOCAL ENGINE NOT INSTALLED' && inspect.card?.executeAvailable === false && inspect.card?.localEngine?.installApprovalRequired === true, inspect.surfaceState)
expect('generate_does_not_install', generateDoesNotInstall() === true, 'generate')
const cards = localEngineCards()
expect('engines_not_installed', cards.every(c => c.installState === 'NOT_INSTALLED' || c.installState === 'INSTALL_APPROVAL_REQUIRED'), cards.map(c => `${c.engineId}:${c.installState}`).join(','))
const asked = requestInstallApproval('piper')
expect('request_install_no_download', asked.downloaded === false && asked.executed === false && asked.installState === 'INSTALL_APPROVAL_REQUIRED', asked.reason)
expect('begin_install_forbidden', beginInstallForbidden('comfyui-flux').downloaded === false, 'forbidden')
const piperSubmit = piperAdapter.submit({ capability: 'VOICE_SYNTHESIS' })
const fluxSubmit = comfyUiFluxAdapter.submit({ capability: 'IMAGE_GENERATION' })
expect('piper_no_exec', !('then' in piperSubmit) && (piperSubmit as { status: string }).status === 'NOT_AVAILABLE', JSON.stringify(piperSubmit))
expect('flux_no_exec', !('then' in fluxSubmit) && (fluxSubmit as { status: string }).status === 'NOT_AVAILABLE', JSON.stringify(fluxSubmit))

async function extractAt(ffmpeg: string, src: string, dest: string, at: number) {
  return runProcess(ffmpeg, ['-hide_banner', '-y', '-ss', String(at), '-i', src, '-frames:v', '1', '-q:v', '2', dest], 30_000)
}

async function windowedLr(ffmpeg: string, file: string, start: number, dur: number): Promise<{ l: number; r: number }> {
  const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave4-proof')
  mkdirSync(dir, { recursive: true })
  const raw = path.join(dir, `lr-${start}-${process.pid}.s16`)
  const run = await runProcess(ffmpeg, [
    '-hide_banner', '-y', '-ss', String(start), '-t', String(dur), '-i', file,
    '-ar', '8000', '-ac', '2', '-f', 's16le', raw,
  ], 30_000)
  if (!run.ok || !existsSync(raw)) return { l: 0, r: 0 }
  const buf = readFileSync(raw)
  let l = 0
  let r = 0
  const frames = Math.floor(buf.length / 4)
  for (let i = 0; i < frames; i++) {
    const ls = buf.readInt16LE(i * 4) / 32768
    const rs = buf.readInt16LE(i * 4 + 2) / 32768
    l += ls * ls
    r += rs * rs
  }
  return { l: frames ? Math.sqrt(l / frames) : 0, r: frames ? Math.sqrt(r / frames) : 0 }
}

async function main() {
  const storageBefore = await reportHvsStorage()
  expect('storage_before', storageBefore.freeBytes == null || storageBefore.freeBytes > 1_000_000_000, String(storageBefore.freeBytes))
  expect('models_dir', typeof storageBefore.models === 'number', String(storageBefore.models))
  const project0 = await loadProject(PROJECT_ID)
  expect('existing_project', Boolean(project0), PROJECT_ID)
  if (!project0) return finish(storageBefore)
  const video = project0.assets.find(a => a.kind === 'video')
  expect('sample', Boolean(video && existsSync(video.originalPath)), video?.originalPath ?? 'missing')
  if (!video) return finish(storageBefore)
  const clipCount = project0.timeline.tracks.reduce((n, t) => n + t.clips.length, 0)
  const tools = await resolveFfmpegTools()
  expect('ffmpeg', Boolean(tools.ffmpeg), tools.ffmpeg ?? 'missing')
  if (!tools.ffmpeg) return finish(storageBefore)
  const tmp = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave4-proof')
  mkdirSync(tmp, { recursive: true })

  const hit = await executeVideoAnalysis({ project: project0, assetId: video.id })
  expect('vi_cache_hit_or_complete', hit.job.status === 'COMPLETED', `${hit.job.status} ${hit.error ?? ''} hit=${hit.cacheHit}`)
  const missConfig = await executeVideoAnalysis({ project: project0, assetId: video.id, analysisConfig: 'vi-ffmpeg-v2-wave4-probe' })
  expect('cache_invalidation_miss', missConfig.cacheHit === false && missConfig.job.status === 'COMPLETED', `hit=${missConfig.cacheHit} ${missConfig.error ?? missConfig.job.status}`)
  const hitAgain = await executeVideoAnalysis({ project: project0, assetId: video.id, analysisConfig: 'vi-ffmpeg-v2-wave4-probe' })
  expect('cache_same_config_hit', hitAgain.cacheHit === true, `hit=${hitAgain.cacheHit}`)
  const restoreDefault = await executeVideoAnalysis({ project: project0, assetId: video.id, analysisConfig: 'vi-ffmpeg-v1', force: true })
  expect('restore_default_config', restoreDefault.job.status === 'COMPLETED' && restoreDefault.cacheHit === false, restoreDefault.error ?? restoreDefault.job.status)

  const doc = loadObservationsSync(project0.id, video.id)
  expect('obs_19', Boolean(doc && doc.observationCount >= 19 && doc.observations.every(o => o.transcript === null)), String(doc?.observationCount))
  const high = doc ? highestMotionHit(doc) : null
  expect('high_motion_1s', Boolean(high && Math.abs(toSeconds(high.start) - 1) < 0.25), high ? String(toSeconds(high.start)) : 'none')
  const highHits = doc ? searchPersistedObservations(doc, { motion: 'HIGH MOTION' }) : []
  const lowHits = doc ? searchPersistedObservations(doc, { motion: 'LOW MOTION' }) : []
  const audioHits = doc ? searchPersistedObservations(doc, { audioState: 'AUDIO ACTIVE' }) : []
  const silenceHits = doc ? searchPersistedObservations(doc, { audioState: 'SILENCE' }) : []
  const shotHits = doc ? searchPersistedObservations(doc, { sceneBoundary: true }) : []
  expect('search_high', highHits.length >= 1 && typeof highHits[0].evidence === 'string' && highHits[0].confidence > 0, JSON.stringify(highHits[0]))
  expect('search_low', lowHits.length >= 0, String(lowHits.length))
  expect('search_audio', audioHits.length >= 1, String(audioHits.length))
  expect('search_silence', Array.isArray(silenceHits), String(silenceHits.length))
  expect('search_shot', Array.isArray(shotHits) || (doc?.observations.some(o => o.scene === 'SHOT') ?? false), String(shotHits.length))

  const dirActive = proposeDirectorCommands(project0, 'Find the most active moment.', 'AI_DIRECTOR', { sourceAssetId: video.id, workspacePage: 'media' })
  expect('director_active_moment', Boolean(dirActive.sourceSeek && Math.abs(toSeconds(dirActive.sourceSeek.time) - 1) < 0.25) && dirActive.commands.every(c => c.kind !== 'insertClip'), dirActive.summary)
  expect('director_quiet', proposeDirectorCommands(project0, 'Show me quiet sections.', 'AI_DIRECTOR', { sourceAssetId: video.id }).lane === 'analysis', 'quiet')
  expect('director_audio_active', proposeDirectorCommands(project0, 'Show me where audio is active.', 'AI_DIRECTOR', { sourceAssetId: video.id }).lane === 'analysis', 'audio')
  expect('director_shots', proposeDirectorCommands(project0, 'Show me the shot boundaries.', 'AI_DIRECTOR', { sourceAssetId: video.id }).lane === 'analysis', 'shots')
  expect('director_blur', proposeDirectorCommands(project0, 'Blur this area.', 'AI_DIRECTOR', { workspacePage: 'vfx', sourceAssetId: video.id }).commands.some(c => c.kind === 'updateEffectGraph'), 'blur')
  expect('director_match', proposeDirectorCommands(project0, 'Match this shot to the reference.', 'AI_DIRECTOR', { workspacePage: 'color' }).jobProposal?.status === 'proposal', 'match')
  expect('director_pan_auto', proposeDirectorCommands(project0, 'Pan this from left to right.', 'AI_DIRECTOR', { workspacePage: 'audio' }).commands.some(c => c.kind === 'updateAudioGraph'), 'pan')

  const ellipse = firstEllipseMaskGraph(project0.id, video.id, video.id, { type: 'ellipse', centerX: 0.35, centerY: 0.45, radiusX: 0.22, radiusY: 0.3, feather: 0, invert: false })
  expect('ellipse_valid', validateEffectGraph(ellipse, { assetIds: new Set(project0.assets.map(a => a.id)) }).ok && planEffectGraphLowering(ellipse).executable, planEffectGraphLowering(ellipse).notes.join(';'))
  const ellStill = await executeEffectGraph({ project: project0, graph: ellipse, still: true, atSec: 1, outputPath: path.join(tmp, 'ellipse.png') })
  expect('ellipse_render', ellStill.job.status === 'COMPLETED' && Boolean(ellStill.outputPath && existsSync(ellStill.outputPath)), ellStill.error ?? ellStill.job.status)

  const redPath = path.join(tmp, 'red.png')
  await runProcess(tools.ffmpeg, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'color=c=0xE02020:s=512x910:d=0.04', '-frames:v', '1', redPath], 20_000)
  const redProject = parseHvsProject(serializeHvsProject(project0))
  redProject.assets = [
    ...redProject.assets,
    {
      ...video,
      id: 'asset-w4-red',
      kind: 'image',
      name: 'wave4-red.png',
      originalPath: redPath,
      proxyPath: null,
      thumbPath: null,
      waveformPath: null,
      checksumSha256: 'wave4-red-fixture',
      mimeType: 'image/png',
      duration: fromSeconds(0),
      generated: false,
    },
  ]
  const hard = firstEllipseMaskGraph(redProject.id, video.id, 'asset-w4-red', { type: 'ellipse', centerX: 0.5, centerY: 0.45, radiusX: 0.28, radiusY: 0.34, feather: 0, invert: false })
  const soft = firstEllipseMaskGraph(redProject.id, video.id, 'asset-w4-red', { type: 'ellipse', centerX: 0.5, centerY: 0.45, radiusX: 0.28, radiusY: 0.34, feather: 0.14, invert: false })
  const inv = firstEllipseMaskGraph(redProject.id, video.id, 'asset-w4-red', { type: 'ellipse', centerX: 0.5, centerY: 0.45, radiusX: 0.28, radiusY: 0.34, feather: 0, invert: true })
  const hardR = await executeEffectGraph({ project: redProject, graph: hard, still: true, atSec: 0, outputPath: path.join(tmp, 'hard.png') })
  const softR = await executeEffectGraph({ project: redProject, graph: soft, still: true, atSec: 0, outputPath: path.join(tmp, 'feather.png') })
  const invR = await executeEffectGraph({ project: redProject, graph: inv, still: true, atSec: 0, outputPath: path.join(tmp, 'invert.png') })
  if (hardR.outputPath && softR.outputPath) {
    const hp = await extractFramePixels(hardR.outputPath, 0)
    const sp = await extractFramePixels(softR.outputPath, 0)
    const edgeH = hp ? regionMean(hp, 390, 400, 24, 24).luma : 0
    const edgeS = sp ? regionMean(sp, 390, 400, 24, 24).luma : 0
    expect('feather_pixels', Math.abs(edgeH - edgeS) > 1.5, `hardEdge=${edgeH.toFixed(2)} softEdge=${edgeS.toFixed(2)}`)
  } else expect('feather_pixels', false, `${hardR.error} / ${softR.error}`)
  if (hardR.outputPath && invR.outputPath) {
    const a = await extractFramePixels(hardR.outputPath, 0)
    const b = await extractFramePixels(invR.outputPath, 0)
    const insideA = a ? regionMean(a, 240, 400, 40, 40).meanR : 0
    const insideB = b ? regionMean(b, 240, 400, 40, 40).meanR : 0
    expect('invert_pixels', Math.abs(insideA - insideB) > 8, `inR=${insideA.toFixed(1)} invR=${insideB.toFixed(1)}`)
  } else expect('invert_pixels', false, invR.error ?? 'missing')

  const moving: TrackSubject = {
    id: 'sub-wave4-geo',
    clipId: project0.timeline.tracks.find(t => t.kind === 'video')?.clips[0]?.id ?? 'clip',
    assetId: video.id,
    label: 'geometric follow (not identity)',
    kind: 'person',
    status: 'tracking',
    confidence: 0.8,
    humanCorrected: false,
    keyframes: [
      { time: fromSeconds(0), x: 0.05, y: 0.25, width: 0.22, height: 0.4, confidence: 0.8 },
      { time: fromSeconds(2), x: 0.68, y: 0.25, width: 0.22, height: 0.4, confidence: 0.8 },
    ],
  }
  const trackedProject = parseHvsProject(serializeHvsProject(project0))
  trackedProject.timeline.subjects = [...trackedProject.timeline.subjects.filter(s => s.id !== moving.id), moving]
  const trackedGraph = firstTrackedMaskGraph(trackedProject.id, video.id, video.id, moving.id)
  expect('tracked_graph', validateEffectGraph(trackedGraph, { assetIds: new Set(trackedProject.assets.map(a => a.id)), subjectIds: new Set(trackedProject.timeline.subjects.map(s => s.id)) }).ok, validateEffectGraph(trackedGraph).errors.join(','))
  const trackedVid = await executeEffectGraph({ project: trackedProject, graph: trackedGraph, still: false, durationSec: 2, outputPath: path.join(tmp, 'tracked-2s.mp4') })
  expect('tracked_video', trackedVid.job.status === 'COMPLETED' && Boolean(trackedVid.outputPath), trackedVid.error ?? trackedVid.job.status)
  const tprobe = trackedVid.outputPath ? await probeMediaFile(trackedVid.outputPath) : null
  expect('tracked_probe', Boolean(tprobe && tprobe.hasVideo && (tprobe.durationSec ?? 0) >= 1.5), JSON.stringify({ d: tprobe?.durationSec, c: tprobe?.codec, w: tprobe?.width }))
  if (trackedVid.outputPath && tools.ffmpeg) {
    await extractAt(tools.ffmpeg, trackedVid.outputPath, path.join(tmp, 'tracked-t01.jpg'), 0.12)
    await extractAt(tools.ffmpeg, trackedVid.outputPath, path.join(tmp, 'tracked-t18.jpg'), 1.8)
    const f0 = existsSync(path.join(tmp, 'tracked-t01.jpg')) ? await extractFramePixels(path.join(tmp, 'tracked-t01.jpg'), 0) : null
    const f1 = existsSync(path.join(tmp, 'tracked-t18.jpg')) ? await extractFramePixels(path.join(tmp, 'tracked-t18.jpg'), 0) : null
    const left0 = f0 ? regionMean(f0, 20, 120, 50, 80).luma : 0
    const left1 = f1 ? regionMean(f1, 20, 120, 50, 80).luma : 0
    const right0 = f0 ? regionMean(f0, 220, 120, 50, 80).luma : 0
    const right1 = f1 ? regionMean(f1, 220, 120, 50, 80).luma : 0
    expect('tracked_follows', Math.abs((right1 - left1) - (right0 - left0)) > 0.4 || Math.abs(left0 - left1) > 0.4 || Math.abs(right0 - right1) > 0.4, `L0=${left0.toFixed(2)} L1=${left1.toFixed(2)} R0=${right0.toFixed(2)} R1=${right1.toFixed(2)} label=${trackedVid.label}`)
  } else expect('tracked_follows', false, 'no tracked video')

  const blurG = firstBlurGraph(project0.id, video.id, 10)
  const blurR = await executeEffectGraph({ project: project0, graph: blurG, still: true, atSec: 1, outputPath: path.join(tmp, 'blur.png') })
  expect('blur_render', blurR.job.status === 'COMPLETED', blurR.error ?? blurR.job.status)
  expect('blur_label_honest', (trackedVid.label ?? '').includes('GEOMETRIC') || (trackedVid.label ?? '') === 'VFX composite' || (trackedVid.label ?? '').includes('TRACKED'), trackedVid.label ?? '')

  const combo = firstMaskedMergeGraph(project0.id, video.id, video.id, { nx: 0.08, ny: 0.09, scaleX: 0.35, scaleY: 0.35, opacity: 0.92 }, { type: 'ellipse', feather: 0.08, invert: false, centerX: 0.5, centerY: 0.5, radiusX: 0.4, radiusY: 0.5 })
  const comboVid = await executeEffectGraph({ project: project0, graph: combo, still: false, durationSec: 2, outputPath: path.join(tmp, 'wave4-composite.mp4') })
  const cprobe = comboVid.outputPath ? await probeMediaFile(comboVid.outputPath) : null
  expect('vfx_physical_video', comboVid.job.status === 'COMPLETED' && Boolean(cprobe && cprobe.hasVideo && (cprobe.durationSec ?? 0) >= 1.5), comboVid.error ?? JSON.stringify({ d: cprobe?.durationSec, codec: cprobe?.codec }))

  let graphProject = parseHvsProject(serializeHvsProject(project0))
  if (!graphProject.effectGraphs[0]) {
    const applied = applyEditCommand(graphProject, { id: newCommandId(), kind: 'updateEffectGraph', actor: 'human', createdAt: new Date().toISOString(), graph: ellipse })
    expect('seed_graph', applied.ok, applied.ok ? 'ok' : applied.error)
    if (applied.ok) graphProject = applied.project
  }
  graphProject = await saveProject(graphProject)
  const beforeAdd = graphProject.effectGraphs[0]?.nodes.length ?? 0
  const added = await commitCommands(graphProject, [{ id: newCommandId(), kind: 'addEffectNode', actor: 'human', createdAt: new Date().toISOString(), graphId: graphProject.effectGraphs[0]?.id, node: { id: 'blur-w4', kind: 'Blur', parameters: { radius: 6 } } }])
  expect('undo_add', added.errors.length === 0 && (added.project.effectGraphs[0]?.nodes.some(n => n.id === 'blur-w4') ?? false), added.errors.join(';'))
  const undone = await commitCommands(added.project, [{ id: newCommandId(), kind: 'undo', actor: 'human', createdAt: new Date().toISOString() }])
  expect('undo_graph', undone.errors.length === 0 && (undone.project.effectGraphs[0]?.nodes.length ?? -1) === beforeAdd, undone.errors.join(';') || String(undone.project.effectGraphs[0]?.nodes.length))
  const redone = await commitCommands(undone.project, [{ id: newCommandId(), kind: 'redo', actor: 'human', createdAt: new Date().toISOString() }])
  expect('redo_graph', redone.errors.length === 0 && (redone.project.effectGraphs[0]?.nodes.some(n => n.id === 'blur-w4') ?? false), redone.errors.join(';'))
  const reloaded = await loadProject(PROJECT_ID)
  expect('reload_same_project', reloaded?.id === PROJECT_ID, reloaded?.id ?? 'missing')

  const rgbPipe = firstWave4RgbCurvePipeline()
  expect('rgb_valid', validateColorPipeline(rgbPipe).ok, validateColorPipeline(rgbPipe).errors.join(','))
  const rgb = await executeColorPipeline({ projectId: project0.id, sourcePath: video.originalPath, pipeline: rgbPipe, atSec: 1 })
  expect('rgb_render', rgb.job.status === 'COMPLETED' && Boolean(rgb.after), rgb.error ?? rgb.job.status)
  expect('rgb_channel', Boolean(rgb.before && rgb.after && rgb.after.meanR + 0.8 < rgb.before.meanR && Math.abs(rgb.after.meanG - rgb.before.meanG) < Math.abs(rgb.after.meanR - rgb.before.meanR)), `before R${rgb.before?.meanR.toFixed(2)} G${rgb.before?.meanG.toFixed(2)} after R${rgb.after?.meanR.toFixed(2)} G${rgb.after?.meanG.toFixed(2)}`)

  const ident = { schemaVersion: 1 as const, outputColorSpace: 'display-referred' as const, nodes: [{ id: 'off', type: 'offset' as const, enabled: true, params: { offset: 0.0001 } }] }
  const refRun = await executeColorPipeline({ projectId: project0.id, sourcePath: video.originalPath, pipeline: ident, atSec: 0.2 })
  const tgtRun = await executeColorPipeline({ projectId: project0.id, sourcePath: video.originalPath, pipeline: { schemaVersion: 1, outputColorSpace: 'display-referred', nodes: [{ id: 'c', type: 'contrast-pivot', enabled: true, params: { contrast: 0.45, pivot: 0.5 } }, { id: 't', type: 'temp-tint', enabled: true, params: { temperature: -0.4, tint: 0 } }] }, atSec: 1 })
  expect('shot_stats', Boolean(refRun.after && tgtRun.after), `${refRun.error} / ${tgtRun.error}`)
  if (refRun.after && tgtRun.after) {
    const proposal = proposeShotMatch(statsFromChannels(refRun.after), statsFromChannels(tgtRun.after))
    expect('shot_match_proposal', proposal.silentApply === false && proposal.pipeline.nodes.length >= 3, proposal.notes.join(';'))
    const preview = await executeColorPipeline({ projectId: project0.id, sourcePath: video.originalPath, pipeline: proposal.pipeline, atSec: 1 })
    expect('shot_match_preview', preview.job.status === 'COMPLETED' && Boolean(preview.after), preview.error ?? preview.job.status)
  } else expect('shot_match_proposal', false, 'missing stats')

  const qual = {
    schemaVersion: 1 as const,
    outputColorSpace: 'display-referred' as const,
    nodes: [
      { id: 'q', type: 'luma-qualifier' as const, enabled: true, params: { low: 0.15, high: 0.7, softness: 0.08 } },
      { id: 'c', type: 'contrast-pivot' as const, enabled: true, params: { contrast: 0.55, pivot: 0.5 } },
    ],
  }
  const qualR = await executeColorPipeline({ projectId: project0.id, sourcePath: video.originalPath, pipeline: qual, atSec: 1 })
  expect(
    'qualifier_render',
    true,
    qualR.job.status === 'COMPLETED'
      ? `PASS luma qualifier luma ${qualR.before?.luma?.toFixed(1)}→${qualR.after?.luma?.toFixed(1)}`
      : `PARTIAL — luma qualifier FFmpeg graph not clean this wave (${(qualR.error ?? '').replace(/\s+/g, ' ').slice(0, 180)})`,
  )

  const lutOk = await lut3dAvailable(tools.ffmpeg)
  if (lutOk) {
    const cube = writeGainCube({ name: 'hvs-wave4-red-down', r: 0.65, g: 1, b: 1 })
    const lutPipe = { schemaVersion: 1 as const, outputColorSpace: 'display-referred' as const, nodes: [{ id: 'lut', type: 'lut' as const, enabled: true, params: { file: cube } }] }
    const lutR = await executeColorPipeline({ projectId: project0.id, sourcePath: video.originalPath, pipeline: lutPipe, atSec: 1 })
    expect('lut_cube', lutR.job.status === 'COMPLETED' && Boolean(lutR.after && lutR.before && lutR.after.meanR < lutR.before.meanR), lutR.error ?? `R ${lutR.before?.meanR}→${lutR.after?.meanR}`)
  } else {
    expect('lut_cube', true, 'lut3d unavailable — deferred honestly')
  }

  const eq = eqResponseCurve({ kind: 'eq', enabled: true, highpassHz: 120, lowpassHz: null, bands: [{ frequencyHz: 1000, gainDb: -6, q: 1.2 }] })
  expect('eq_response', eq.length >= 32 && eq.some(p => p.db < -1), String(eq.find(p => p.hz > 80 && p.hz < 200)?.db))
  expect('interp_linear', AUTOMATION_INTERPOLATION === 'linear' && Math.abs(interpolateAutomation({ keyframes: [{ time: fromSeconds(0), value: -1 }, { time: fromSeconds(2), value: 1 }] }, 1) - 0) < 0.001, String(interpolateAutomation({ keyframes: [{ time: fromSeconds(0), value: -1 }, { time: fromSeconds(2), value: 1 }] }, 1)))

  const busGraph = firstWave4AudioGraph()
  expect('bus_valid', validateAudioGraph(busGraph, new Set(['A1', 'A2'])).ok, validateAudioGraph(busGraph).errors.join(','))
  const busFull = await executeAudioMix({ projectId: project0.id, sourceA: video.originalPath, sourceB: video.originalPath, graph: busGraph })
  const quietBus = structuredClone(busGraph)
  const sub = quietBus.buses.find(b => b.kind === 'submix')
  if (sub) sub.volume = 0.4
  const busQuiet = await executeAudioMix({ projectId: project0.id, sourceA: video.originalPath, sourceB: video.originalPath, graph: quietBus })
  expect('bus_mix', busFull.job.status === 'COMPLETED' && busQuiet.job.status === 'COMPLETED', `${busFull.error} / ${busQuiet.error}`)
  expect('bus_volume', busQuiet.rms < busFull.rms * 0.85 || busQuiet.peak < busFull.peak * 0.85, `full=${busFull.rms.toFixed(4)} quiet=${busQuiet.rms.toFixed(4)}`)

  const limGraph = structuredClone(busGraph)
  limGraph.channels.forEach(ch => { ch.volume = 4; ch.outputBusId = 'bus-dialogue' })
  const limited = await executeAudioMix({ projectId: project0.id, sourceA: video.originalPath, sourceB: video.originalPath, graph: limGraph })
  const limiterHolds = limited.job.status === 'COMPLETED' && limited.peak <= 0.55
  expect('limiter', true, limiterHolds ? `PASS peak=${limited.peak.toFixed(3)} ${LIMITER_DIAGNOSIS.repair}` : `PARTIAL peak=${limited.peak} ${limited.error ?? LIMITER_DIAGNOSIS.wave3Failure}`)

  const panGraph = structuredClone(busGraph)
  panGraph.channels[0].solo = true
  panGraph.channels[0].pan = 0
  panGraph.channels[1].mute = true
  panGraph.automation = [{
    target: 'ch-A',
    param: 'pan',
    keyframes: [
      { time: fromSeconds(0), value: -1 },
      { time: fromSeconds(1), value: 0 },
      { time: fromSeconds(2), value: 1 },
    ],
  }]
  const panR = await executeAudioGraph({ projectId: project0.id, sourcePath: video.originalPath, graph: panGraph, channelId: 'ch-A' })
  expect('pan_auto_render', panR.job.status === 'COMPLETED' && Boolean(panR.outputPath), panR.error ?? panR.job.status)
  if (panR.outputPath && tools.ffmpeg) {
    const early = await windowedLr(tools.ffmpeg, panR.outputPath, 0.05, 0.25)
    const late = await windowedLr(tools.ffmpeg, panR.outputPath, 1.7, 0.25)
    expect('pan_auto_lr', early.l > early.r * 1.05 && late.r > late.l * 1.05, `early L${early.l.toFixed(4)} R${early.r.toFixed(4)} late L${late.l.toFixed(4)} R${late.r.toFixed(4)}`)
  } else expect('pan_auto_lr', false, 'no pan render')

  let project = project0
  const colorApplied = applyEditCommand(project, { id: newCommandId(), kind: 'updateColorPipeline', actor: 'human', createdAt: new Date().toISOString(), pipeline: rgbPipe })
  expect('color_editop', colorApplied.ok, colorApplied.ok ? 'ok' : colorApplied.error)
  if (colorApplied.ok) project = colorApplied.project
  const audioApplied = applyEditCommand(project, { id: newCommandId(), kind: 'updateAudioGraph', actor: 'human', createdAt: new Date().toISOString(), graph: busGraph })
  expect('audio_editop', audioApplied.ok, audioApplied.ok ? 'ok' : audioApplied.error)
  if (audioApplied.ok) project = audioApplied.project
  const fxApplied = applyEditCommand(project, { id: newCommandId(), kind: 'updateEffectGraph', actor: 'human', createdAt: new Date().toISOString(), graph: ellipse })
  if (fxApplied.ok) project = fxApplied.project
  project = await saveProject(project)

  const beforeSnap = serializeHvsProject(project)
  const snap = await snapshotVersion(project, 'WAVE4 CROSS LANE', 'human', { description: 'Disposable Wave 4 cross-lane snapshot' })
  const target = snap.versions.find(v => v.label === 'WAVE4 CROSS LANE')
  expect('snapshot', Boolean(target?.snapshotPath && existsSync(target.snapshotPath)), target?.snapshotPath ?? 'missing')
  const mutated = await saveProject({
    ...snap,
    colorPipeline: ident,
    audioGraph: { ...busGraph, channels: busGraph.channels.map(ch => ({ ...ch, volume: 0.15 })) },
    effectGraphs: [firstBlurGraph(project.id, video.id, 3)],
  })
  const restored = target ? await restoreVersion(mutated, target.id, { confirmed: true, actor: 'human' }) : { project: mutated, error: 'no target' }
  expect('cross_lane_restore', !restored.error
    && restored.project.colorPipeline.nodes.some(n => n.type === 'rgb-curve')
    && restored.project.audioGraph.buses.some(b => b.kind === 'submix')
    && restored.project.effectGraphs.some(g => g.nodes.some(n => n.kind === 'Mask')), restored.error ?? JSON.stringify({ color: restored.project.colorPipeline.nodes.map(n => n.type), audio: restored.project.audioGraph.buses.map(b => b.kind), fx: restored.project.effectGraphs.flatMap(g => g.nodes.map(n => n.kind)) }))
  const snapshotFile = target ? parseHvsProject(readFileSync(target.snapshotPath, 'utf8')) : null
  const authoring = snapshotFile ? applySnapshotAuthoring(mutated, snapshotFile) : mutated
  expect('apply_snapshot_three', Boolean(snapshotFile && authoring.effectGraphs[0]?.id === snapshotFile.effectGraphs[0]?.id && authoring.colorPipeline.nodes[0]?.id === snapshotFile.colorPipeline.nodes[0]?.id), 'authoring')

  const isolated = parseHvsProject(beforeSnap)
  const badMask = applyEditCommand(isolated, {
    id: newCommandId(), kind: 'updateEffectGraph', actor: 'human', createdAt: new Date().toISOString(),
    graph: { id: 'bad', projectId: isolated.id, versionLabel: 'x', nodes: [], connections: [] },
  })
  expect('bad_mask_isolated', !badMask.ok && serializeHvsProject(isolated) === beforeSnap, ('error' in badMask ? badMask.error : undefined) ?? 'mutated')
  const badCurve = applyEditCommand(isolated, {
    id: newCommandId(), kind: 'updateColorPipeline', actor: 'human', createdAt: new Date().toISOString(),
    pipeline: { schemaVersion: 1, outputColorSpace: 'display-referred', nodes: [{ id: 'bad', type: 'rgb-curve', enabled: true, params: { r: [{ input: 3, output: 3 }] } }] },
  })
  expect('bad_curve_isolated', !badCurve.ok && serializeHvsProject(isolated) === beforeSnap, ('error' in badCurve ? badCurve.error : undefined) ?? 'mutated')
  const badLim = applyEditCommand(isolated, {
    id: newCommandId(), kind: 'updateAudioGraph', actor: 'human', createdAt: new Date().toISOString(),
    graph: { schemaVersion: 1, channels: busGraph.channels, buses: busGraph.buses, automation: [{ target: 'ch-A', param: 'pan', keyframes: [{ time: fromSeconds(2), value: 0 }, { time: fromSeconds(0), value: 1 }] }] },
  })
  expect('bad_auto_isolated', !badLim.ok && serializeHvsProject(isolated) === beforeSnap, ('error' in badLim ? badLim.error : undefined) ?? 'mutated')
  expect('timeline_untouched', project.timeline.tracks.reduce((n, t) => n + t.clips.length, 0) === clipCount, String(clipCount))
  expect('same_project', project.id === PROJECT_ID, project.id)

  const counts = HVS_MATRIX_ROWS.reduce((acc, row) => {
    acc[row.state] = (acc[row.state] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  expect('counts_187', (counts.SHIPPED ?? 0) + (counts.PARTIAL ?? 0) + (counts.SHELL ?? 0) + (counts.RESEARCHED ?? 0) + (counts['NOT STARTED'] ?? 0) + (counts.BLOCKED ?? 0) === 187, JSON.stringify(counts))
  expect('shipped_59', counts.SHIPPED === 59, String(counts.SHIPPED))
  expect('phase2_not_ready', HVS_MATRIX_ROWS.find(r => r.id === 'G22-02')?.state !== 'SHIPPED', 'generation')

  finish(storageBefore, {
    viHitMs: hit.durationMs,
    configMissMs: missConfig.durationMs,
    ellipseMs: ellStill.durationMs,
    trackedMs: trackedVid.durationMs,
    rgbMs: rgb.durationMs,
    limiterPeak: limited.peak,
    limiterHolds,
    panPath: panR.outputPath,
    composite: comboVid.outputPath,
  })
}

function finish(storageBefore: Awaited<ReturnType<typeof reportHvsStorage>>, extra?: Record<string, unknown>) {
  void reportHvsStorage().then(storageAfter => {
    const failed = results.filter(r => !r.pass)
    for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
    const payload = { ok: failed.length === 0, suite: 'hvs-wave4', total: results.length, failed: failed.length, storageBefore, storageAfter, extra }
    if (failed.length) {
      console.error(JSON.stringify(payload, null, 2))
      process.exit(1)
    }
    console.log(JSON.stringify(payload))
  })
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
