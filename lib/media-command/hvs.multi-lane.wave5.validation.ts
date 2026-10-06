/**
 * HVS WAVE 5 — live closure + engine hardening + generation install gate.
 * No Piper/Comfy/FLUX install. No paid HTTP. No credential read.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
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
import { localEngineCards, requestInstallApproval, beginInstallForbidden, installAuthorizationFor } from './model-install'
import {
  PIPER_INSTALL_MANIFEST,
  PIPER_INSTALL_COMMAND_PLAN,
  COMFYUI_FLUX_INSTALL_MANIFEST,
  COMFYUI_FLUX_INSTALL_COMMAND_PLAN,
  INSTALL_COMMANDS_MUST_NOT_RUN,
} from './install-manifests'
import { loadProject, saveProject, snapshotVersion, restoreVersion, commitCommands } from './store'
import { executeVideoAnalysis, highestMotionHit, loadObservationsSync } from './video-analysis'
import {
  firstBlurGraph,
  firstDualMaskGraph,
  firstEllipseMaskGraph,
  firstTrackedBackgroundBlurGraph,
  validateEffectGraph,
  planEffectGraphLowering,
  readTransformParams,
} from './effect-graph'
import { executeEffectGraph } from './effect-graph-runtime'
import {
  executeColorPipeline,
  firstWave4RgbCurvePipeline,
  firstWave5QualifierPipeline,
} from './color-runtime'
import {
  addRgbCurvePoint,
  COLOR_PIPELINE_EXECUTION_ORDER,
  deleteRgbCurvePoint,
  moveRgbCurvePoint,
  rgbCurvePoints,
  validateColorPipeline,
} from './color-pipeline'
import { proposeShotMatch, statsFromChannels } from './shot-match'
import { validateCubeFile, writeGainCube } from './lut-cube'
import {
  firstWave4AudioGraph,
  executeAudioMix,
  executeAudioGraph,
  interpolateAutomation,
  AUTOMATION_INTERPOLATION,
  crestFactor,
} from './audio-runtime'
import { validateAudioGraph } from './audio-graph'
import { extractFramePixels, regionMean } from './frame-scopes'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { reportHvsStorage, modelsBytesExcludingAuthorizedAsr } from './storage-report'
import { proposeDirectorCommands } from './ai-director'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { fromSeconds, toSeconds } from './time'
import { mediaCommandDataHierarchy } from './paths'
import { newCommandId } from './edit-commands'
import { applyEditCommand } from './edit-ops'
import { UNIFIED_RENDER_SEAM } from './lane-render-seam'
import { inspectGenerationRequest } from './generation-authority'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

const PROJECT_ID = 'hvs-mual21w4-5h2e'
const LIVE_AUTH = 'LIVE_AUTH_BLOCKED'

expect('program_wave', ['HVS-WAVE-5', 'HVS-WAVE-6', 'HVS-WAVE-7', 'HVS-WAVE-9'].includes(HVS_PROGRAM_WAVE), HVS_PROGRAM_WAVE)
expect('phase1_slice', HVS_SLICE === 'HVS-P1-SLICE-G', HVS_SLICE)
expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('g22_02_shell', HVS_MATRIX_ROWS.find(r => r.id === 'G22-02')?.state === 'SHELL', 'no fake generation')
expect('g27_01_shipped', HVS_MATRIX_ROWS.find(r => r.id === 'G27-01')?.state === 'SHIPPED', 'local VI subset live-closed')
expect('g20_03_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G20-03')?.state === 'PARTIAL', 'not full roto')
expect('g19_03_researched', HVS_MATRIX_ROWS.find(r => r.id === 'G19-03')?.state === 'RESEARCHED' || HVS_MATRIX_ROWS.find(r => r.id === 'G19-03')?.state === 'PARTIAL', 'not full HSL qualifier')
expect('install_lock', !HVS_MODEL_INSTALL_AUTHORIZATION && !HVS_PIPER_INSTALL_AUTHORIZED && !HVS_COMFYUI_FLUX_INSTALL_AUTHORIZED && !HVS_WAVE4_MODEL_INSTALL_AUTHORIZED && maySpendMoney() === false, 'flags')
expect('piper_manifest', PIPER_INSTALL_MANIFEST.neverExecute && PIPER_INSTALL_MANIFEST.release === 'v1.8.0', PIPER_INSTALL_MANIFEST.officialRepo)
expect('piper_commands', INSTALL_COMMANDS_MUST_NOT_RUN && PIPER_INSTALL_COMMAND_PLAN.neverExecute && PIPER_INSTALL_COMMAND_PLAN.commands.length >= 8, String(PIPER_INSTALL_COMMAND_PLAN.commands.length))
expect('comfy_manifest', COMFYUI_FLUX_INSTALL_MANIFEST.neverExecute && COMFYUI_FLUX_INSTALL_MANIFEST.comfyui.release === 'v0.37.0', COMFYUI_FLUX_INSTALL_MANIFEST.comfyui.repo)
expect('comfy_commands', COMFYUI_FLUX_INSTALL_COMMAND_PLAN.neverExecute && COMFYUI_FLUX_INSTALL_COMMAND_PLAN.commands.every(c => !c.startsWith('huggingface-cli download') || c.startsWith('#')), 'commented downloads')
expect('auth_token', installAuthorizationFor('piper').authorized === false && installAuthorizationFor('comfyui-flux').authorized === false, installAuthorizationFor('piper').reason)
expect('live_auth_boundary', LIVE_AUTH === 'LIVE_AUTH_BLOCKED', 'credentials not read; login wall remains')
expect('color_order_doc', COLOR_PIPELINE_EXECUTION_ORDER === 'authoring-order', COLOR_PIPELINE_EXECUTION_ORDER)
expect('unified_seam', UNIFIED_RENDER_SEAM.renderEngineConsumesEffectGraph === true && UNIFIED_RENDER_SEAM.renderEngineConsumesColorPipeline === true && UNIFIED_RENDER_SEAM.renderEngineConsumesAudioGraph === true, UNIFIED_RENDER_SEAM.note)

async function windowedLr(ffmpeg: string, file: string, start: number, dur: number): Promise<{ l: number; r: number }> {
  const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave5-proof')
  mkdirSync(dir, { recursive: true })
  const raw = path.join(dir, `lr-${start}-${process.pid}.s16`)
  const run = await runProcess(ffmpeg, [
    '-hide_banner', '-y', '-ss', String(start), '-t', String(dur), '-i', file,
    '-ac', '2', '-ar', '8000', '-f', 's16le', raw,
  ], 30_000)
  if (!run.ok || !existsSync(raw)) return { l: 0, r: 0 }
  const { readFileSync, unlinkSync } = await import('node:fs')
  const buf = readFileSync(raw)
  try { unlinkSync(raw) } catch { /* tmp */ }
  let l = 0
  let r = 0
  const n = Math.floor(buf.length / 4)
  for (let i = 0; i < n; i++) {
    const ls = buf.readInt16LE(i * 4) / 32768
    const rs = buf.readInt16LE(i * 4 + 2) / 32768
    l += ls * ls
    r += rs * rs
  }
  return { l: n ? Math.sqrt(l / n) : 0, r: n ? Math.sqrt(r / n) : 0 }
}

async function main() {
  const storageBefore = await reportHvsStorage()
  expect('storage_before', storageBefore.freeBytes == null || storageBefore.freeBytes > 1_000_000_000, String(storageBefore.freeBytes))
  expect('models_catalog_only', (await modelsBytesExcludingAuthorizedAsr(storageBefore.models ?? 0)) < 50_000, String(storageBefore.models))
  const project0 = await loadProject(PROJECT_ID)
  expect('existing_project', Boolean(project0), PROJECT_ID)
  if (!project0) return finish(storageBefore)
  const video = project0.assets.find(a => a.kind === 'video')
  expect('sample', Boolean(video && existsSync(video.originalPath)), video?.originalPath ?? 'missing')
  if (!video) return finish(storageBefore)
  const tools = await resolveFfmpegTools()
  expect('ffmpeg', Boolean(tools.ffmpeg), tools.ffmpeg ?? 'missing')
  if (!tools.ffmpeg) return finish(storageBefore)
  const tmp = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave5-proof')
  mkdirSync(tmp, { recursive: true })

  const vi = await executeVideoAnalysis({ project: project0, assetId: video.id })
  expect('vi_reanalyze', vi.job.status === 'COMPLETED', `${vi.job.status} ${vi.error ?? ''} hit=${vi.cacheHit} backend=${vi.job.backend}`)
  const doc = loadObservationsSync(project0.id, video.id)
  expect('obs_persist', Boolean(doc && doc.observationCount >= 19), String(doc?.observationCount))
  const high = doc ? highestMotionHit(doc) : null
  expect('live_seek_contract', Boolean(high && Math.abs(toSeconds(high.start) - 1) < 0.25), high ? String(toSeconds(high.start)) : 'none')
  const dirSeek = proposeDirectorCommands(project0, 'Find the highest-motion section.', 'AI_DIRECTOR', { sourceAssetId: video.id, workspacePage: 'media' })
  expect('director_highest_motion', Boolean(dirSeek.sourceSeek && Math.abs(toSeconds(dirSeek.sourceSeek.time) - 1) < 0.25) && dirSeek.commands.every(c => c.kind !== 'insertClip' && c.kind !== 'moveClip'), dirSeek.summary)
  const miss = await executeVideoAnalysis({ project: project0, assetId: video.id, analysisConfig: 'vi-ffmpeg-v5-wave5-probe' })
  expect('cache_miss_config', miss.cacheHit === false && miss.job.status === 'COMPLETED', `hit=${miss.cacheHit}`)
  const hit = await executeVideoAnalysis({ project: project0, assetId: video.id, analysisConfig: 'vi-ffmpeg-v5-wave5-probe' })
  expect('cache_hit_same', hit.cacheHit === true, `hit=${hit.cacheHit}`)
  await executeVideoAnalysis({ project: project0, assetId: video.id, analysisConfig: 'vi-ffmpeg-v1', force: true })

  const split = path.join(tmp, 'luma-split.png')
  await runProcess(tools.ffmpeg, [
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x1A1A1A:s=160x180:d=0.04',
    '-f', 'lavfi', '-i', 'color=c=0xE6E6E6:s=160x180:d=0.04',
    '-filter_complex', 'hstack=inputs=2', '-frames:v', '1', split,
  ], 20_000)
  expect('split_fixture', existsSync(split), split)
  const qualPipe = firstWave5QualifierPipeline({ softness: 0.08, invert: false })
  const qual = await executeColorPipeline({ projectId: project0.id, sourcePath: split, pipeline: qualPipe, atSec: 0, skipCache: true, writeMask: true })
  expect('qualifier_render', qual.job.status === 'COMPLETED' && Boolean(qual.afterPath && existsSync(qual.afterPath)), qual.error ?? `${qual.job.status} graph=${qual.qualifierGraph}`)
  if (qual.beforePath && qual.afterPath && qual.maskPath) {
    const beforePx = await extractFramePixels(qual.beforePath, 0)
    const afterPx = await extractFramePixels(qual.afterPath, 0)
    const maskPx = await extractFramePixels(qual.maskPath, 0)
    if (beforePx && afterPx && maskPx) {
      const inB = regionMean(beforePx, 8, 20, 50, 140)
      const inA = regionMean(afterPx, 8, 20, 50, 140)
      const outB = regionMean(beforePx, 200, 20, 50, 140)
      const outA = regionMean(afterPx, 200, 20, 50, 140)
      const inDelta = Math.abs(inA.luma - inB.luma)
      const outDelta = Math.abs(outA.luma - outB.luma)
      expect('qualifier_inside', inDelta > 8, `inside ${inB.luma.toFixed(1)}→${inA.luma.toFixed(1)} Δ${inDelta.toFixed(1)}`)
      expect('qualifier_outside', outDelta < inDelta * 0.45 || outDelta < 6, `outside ${outB.luma.toFixed(1)}→${outA.luma.toFixed(1)} Δ${outDelta.toFixed(1)}`)
      const maskIn = regionMean(maskPx, 8, 20, 50, 140).luma
      const maskOut = regionMean(maskPx, 200, 20, 50, 140).luma
      expect('qualifier_mask', maskIn > maskOut + 40, `mask in ${maskIn.toFixed(1)} out ${maskOut.toFixed(1)}`)
    } else {
      expect('qualifier_inside', false, 'pixels missing')
      expect('qualifier_outside', false, 'pixels missing')
      expect('qualifier_mask', false, 'mask missing')
    }
  } else {
    expect('qualifier_inside', false, qual.error ?? 'no files')
    expect('qualifier_outside', false, 'no files')
    expect('qualifier_mask', false, 'no files')
  }

  const ramp = path.join(tmp, 'luma-ramp.png')
  await runProcess(tools.ffmpeg, [
    '-hide_banner', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=0.04',
    '-vf', "format=gray,geq=lum='X/W*255'", '-frames:v', '1', ramp,
  ], 20_000)
  const hardQ = await executeColorPipeline({
    projectId: project0.id, sourcePath: ramp, skipCache: true,
    pipeline: firstWave5QualifierPipeline({ softness: 0, invert: false }), atSec: 0,
  })
  const softQ = await executeColorPipeline({
    projectId: project0.id, sourcePath: ramp, skipCache: true,
    pipeline: firstWave5QualifierPipeline({ softness: 0.18, invert: false }), atSec: 0,
  })
  if (hardQ.afterPath && softQ.afterPath) {
    const hp = await extractFramePixels(hardQ.afterPath, 0)
    const sp = await extractFramePixels(softQ.afterPath, 0)
    if (hp && sp) {
      const bandX = Math.round(0.42 * hp.width) - 8
      const hEdge = regionMean(hp, bandX, 20, 24, 140).luma
      const sEdge = regionMean(sp, bandX, 20, 24, 140).luma
      expect('qualifier_softness', Math.abs(hEdge - sEdge) > 1.5, `hardEdge ${hEdge.toFixed(1)} softEdge ${sEdge.toFixed(1)} at x=${bandX}`)
    } else expect('qualifier_softness', false, 'edge pixels missing')
  } else expect('qualifier_softness', false, hardQ.error ?? softQ.error ?? 'softness render failed')

  const invQ = await executeColorPipeline({
    projectId: project0.id, sourcePath: split, skipCache: true, writeMask: true,
    pipeline: firstWave5QualifierPipeline({ softness: 0.08, invert: true }), atSec: 0,
  })
  if (qual.afterPath && invQ.afterPath) {
    const a = await extractFramePixels(qual.afterPath, 0)
    const b = await extractFramePixels(invQ.afterPath, 0)
    if (a && b) {
      const leftA = regionMean(a, 8, 20, 50, 140).luma
      const leftB = regionMean(b, 8, 20, 50, 140).luma
      expect('qualifier_invert', Math.abs(leftA - leftB) > 4, `left ${leftA.toFixed(1)} vs invert ${leftB.toFixed(1)}`)
    } else expect('qualifier_invert', false, 'invert pixels missing')
  } else expect('qualifier_invert', false, invQ.error ?? 'invert failed')

  const cache1 = await executeColorPipeline({ projectId: project0.id, sourcePath: video.originalPath, pipeline: firstWave4RgbCurvePipeline(), atSec: 1, skipCache: true })
  const cache2 = await executeColorPipeline({ projectId: project0.id, sourcePath: video.originalPath, pipeline: firstWave4RgbCurvePipeline(), atSec: 1 })
  expect('color_cache_hit', cache1.job.status === 'COMPLETED' && cache2.cacheHit === true, `first=${cache1.job.status} hit=${cache2.cacheHit}`)
  const cacheMiss = await executeColorPipeline({
    projectId: project0.id, sourcePath: video.originalPath, atSec: 1,
    pipeline: {
      schemaVersion: 1,
      outputColorSpace: 'display-referred',
      nodes: [
        ...firstWave4RgbCurvePipeline().nodes,
        { id: 'w5-cache-miss', type: 'offset', enabled: true, params: { offset: 0.05 + (Date.now() % 700) / 10000 } },
      ],
    },
  })
  expect('color_cache_miss', cacheMiss.cacheHit === false && cacheMiss.job.status === 'COMPLETED', `hit=${cacheMiss.cacheHit} ${cacheMiss.error ?? ''}`)

  const offThenCon = {
    schemaVersion: 1 as const, outputColorSpace: 'display-referred' as const,
    nodes: [
      { id: 'o', type: 'offset' as const, enabled: true, params: { offset: 0.22 } },
      { id: 'c', type: 'contrast-pivot' as const, enabled: true, params: { contrast: 0.7, pivot: 0.5 } },
    ],
  }
  const conThenOff = { ...offThenCon, nodes: [...offThenCon.nodes].reverse() }
  const orderA = await executeColorPipeline({ projectId: project0.id, sourcePath: split, pipeline: offThenCon, atSec: 0, skipCache: true })
  const orderB = await executeColorPipeline({ projectId: project0.id, sourcePath: split, pipeline: conThenOff, atSec: 0, skipCache: true })
  expect('color_order_changes', Boolean(orderA.after && orderB.after && Math.abs((orderA.after.luma ?? 0) - (orderB.after.luma ?? 0)) > 0.5), `A ${orderA.after?.luma?.toFixed(2)} B ${orderB.after?.luma?.toFixed(2)}`)

  let rgbPipe = firstWave4RgbCurvePipeline()
  rgbPipe = addRgbCurvePoint(rgbPipe, 'r', 0.35, 0.2)
  rgbPipe = moveRgbCurvePoint(rgbPipe, 'r', 1, 0.4, 0.15)
  const beforeDelete = rgbCurvePoints(rgbPipe, 'r').length
  rgbPipe = deleteRgbCurvePoint(rgbPipe, 'r', 1)
  expect('rgb_curve_edit', validateColorPipeline(rgbPipe).ok && beforeDelete >= 3 && rgbCurvePoints(rgbPipe, 'r').length === beforeDelete - 1, `pts ${beforeDelete}→${rgbCurvePoints(rgbPipe, 'r').length}`)

  const ident = { schemaVersion: 1 as const, outputColorSpace: 'display-referred' as const, nodes: [{ id: 'off', type: 'offset' as const, enabled: true, params: { offset: 0.0001 } }] }
  const tgtRun = await executeColorPipeline({
    projectId: project0.id, sourcePath: video.originalPath, atSec: 1,
    pipeline: { schemaVersion: 1, outputColorSpace: 'display-referred', nodes: [{ id: 'c', type: 'contrast-pivot', enabled: true, params: { contrast: 0.45, pivot: 0.5 } }] },
  })
  const refRun = await executeColorPipeline({ projectId: project0.id, sourcePath: video.originalPath, pipeline: ident, atSec: 1 })
  if (tgtRun.after && refRun.after) {
    const p1 = proposeShotMatch(statsFromChannels(refRun.after), statsFromChannels(tgtRun.after))
    const p2 = proposeShotMatch(statsFromChannels(refRun.after), statsFromChannels(tgtRun.after))
    expect('shot_match_det', p1.silentApply === false && JSON.stringify(p1.pipeline) === JSON.stringify(p2.pipeline), JSON.stringify(p1.reference))
  } else expect('shot_match_det', false, 'stats missing')

  const cube = writeGainCube({ name: 'hvs-wave5-gain', r: 0.7, g: 1, b: 1 })
  expect('lut_ok', validateCubeFile(cube).ok, validateCubeFile(cube).errors.join(','))
  const badCube = path.join(tmp, 'bad.cube')
  writeFileSync(badCube, 'LUT_3D_SIZE 2\n0 0 0\nnot-a-number 1 1\n', 'utf8')
  expect('lut_reject', !validateCubeFile(badCube).ok, validateCubeFile(badCube).errors.join(','))

  const dual = firstDualMaskGraph(project0.id, video.id, video.id)
  expect('dual_mask_ids', dual.nodes.filter(n => n.kind === 'Mask').length >= 2 && new Set(dual.nodes.map(n => n.id)).size === dual.nodes.length, dual.nodes.map(n => n.id).join(','))
  expect('dual_mask_valid', validateEffectGraph(dual, { assetIds: new Set(project0.assets.map(a => a.id)) }).ok, validateEffectGraph(dual).errors.join(','))
  const dualR = await executeEffectGraph({ project: project0, graph: dual, still: true, atSec: 1, outputPath: path.join(tmp, 'dual-mask.png') })
  expect('dual_mask_render', dualR.job.status === 'COMPLETED' && Boolean(dualR.outputPath && existsSync(dualR.outputPath)), dualR.error ?? dualR.job.status)

  const blurG = firstBlurGraph(project0.id, video.id, 12)
  const blurOn = await executeEffectGraph({ project: project0, graph: blurG, still: true, atSec: 1, outputPath: path.join(tmp, 'blur-on.png') })
  const blurOff = await executeEffectGraph({
    project: project0,
    graph: { ...blurG, nodes: blurG.nodes.map(n => n.kind === 'Blur' ? { ...n, enabled: false } : n) },
    still: true, atSec: 1, outputPath: path.join(tmp, 'blur-off.png'),
  })
  expect('vfx_bypass', blurOn.job.status === 'COMPLETED' && blurOff.job.status === 'COMPLETED', `${blurOn.error} / ${blurOff.error}`)
  if (blurOn.outputPath && blurOff.outputPath) {
    const a = await extractFramePixels(blurOn.outputPath, 0)
    const b = await extractFramePixels(blurOff.outputPath, 0)
    expect('vfx_bypass_effect', Boolean(a && b && Math.abs(a.width - b.width) === 0), a && b ? `on ${a.width} off ${b.width}` : 'pixels')
  }

  const subject = project0.timeline.subjects[0]
  if (subject) {
    const tracked = firstTrackedBackgroundBlurGraph(project0.id, video.id, subject.id, 8)
    expect('tracked_blur_label', tracked.versionLabel.includes('Geometric'), tracked.versionLabel)
    const trackedR = await executeEffectGraph({ project: project0, graph: tracked, still: false, durationSec: 2, outputPath: path.join(tmp, 'tracked-blur.mp4') })
    expect('tracked_blur_render', trackedR.job.status === 'COMPLETED' && (trackedR.label ?? '').includes('TRACKED GEOMETRIC'), trackedR.error ?? trackedR.label ?? trackedR.job.status)
  } else {
    expect('tracked_blur_label', false, 'no TrackSubject')
    expect('tracked_blur_render', false, 'no TrackSubject')
  }

  const xf = dual.nodes.find(n => n.kind === 'Transform')
  const preview = xf ? readTransformParams(xf) : null
  expect('preview_geometry', Boolean(preview && Number.isFinite(preview.scaleX) && planEffectGraphLowering(dual).previewCss?.includes('scale')), planEffectGraphLowering(dual).previewCss ?? 'none')

  let project = project0
  const dualApplied = applyEditCommand(project, { id: newCommandId(), kind: 'updateEffectGraph', actor: 'human', createdAt: new Date().toISOString(), graph: dual })
  expect('dual_persist', dualApplied.ok, dualApplied.ok ? 'ok' : dualApplied.error)
  if (dualApplied.ok) project = dualApplied.project
  const addNode = applyEditCommand(project, {
    id: newCommandId(), kind: 'addEffectNode', actor: 'human', createdAt: new Date().toISOString(),
    graphId: (project.effectGraphs[0] ?? dual).id,
    node: { id: `blur-w5-${Date.now().toString(36)}`, kind: 'Blur', inputs: [{ id: 'in', name: 'rgba', kind: 'input' }], outputs: [{ id: 'out', name: 'rgba', kind: 'output' }], enabled: true, parameters: { radius: 6 } },
  })
  expect('vfx_add', addNode.ok, addNode.ok ? 'ok' : addNode.error)
  if (addNode.ok) project = addNode.project
  const blurId = addNode.ok ? String((addNode.project.effectGraphs[0]?.nodes.find(n => n.kind === 'Blur' && String(n.id).startsWith('blur-w5'))?.id) ?? 'blur-w5') : 'blur-w5'
  const cyclic = applyEditCommand(project, {
    id: newCommandId(), kind: 'connectEffectNodes', actor: 'human', createdAt: new Date().toISOString(),
    graphId: project.effectGraphs[0]?.id,
    fromNode: 'media-out', fromPort: 'out', toNode: project.effectGraphs[0]?.nodes[0]?.id ?? 'media-in', toPort: 'in',
  })
  expect('cycle_reject', !cyclic.ok, cyclic.ok ? 'accepted cycle' : cyclic.error ?? 'rejected')
  const undoRedo = await commitCommands(project, [
    { id: newCommandId(), kind: 'updateEffectNode', actor: 'human', createdAt: new Date().toISOString(), nodeId: blurId, parameters: { radius: 14 }, enabled: true },
  ])
  expect('vfx_update', undoRedo.errors.length === 0, undoRedo.errors.join(','))
  const undone = await commitCommands(undoRedo.project, [{ id: newCommandId(), kind: 'undo', actor: 'human', createdAt: new Date().toISOString() }])
  const redone = await commitCommands(undone.project, [{ id: newCommandId(), kind: 'redo', actor: 'human', createdAt: new Date().toISOString() }])
  expect('vfx_undo_redo', undone.errors.length === 0 && redone.errors.length === 0, `${undone.errors} ${redone.errors}`)
  project = redone.project

  const rgbCommit = await commitCommands(project, [
    { id: newCommandId(), kind: 'updateColorPipeline', actor: 'human', createdAt: new Date().toISOString(), pipeline: rgbPipe },
  ])
  const rgbUndo = await commitCommands(rgbCommit.project, [{ id: newCommandId(), kind: 'undo', actor: 'human', createdAt: new Date().toISOString() }])
  const rgbRedo = await commitCommands(rgbUndo.project, [{ id: newCommandId(), kind: 'redo', actor: 'human', createdAt: new Date().toISOString() }])
  expect('rgb_undo_redo', rgbCommit.errors.length === 0 && rgbUndo.errors.length === 0 && rgbRedo.errors.length === 0 && rgbRedo.project.colorPipeline.nodes.some(n => n.type === 'rgb-curve'), rgbRedo.errors.join(','))
  project = rgbRedo.project

  const busGraph = firstWave4AudioGraph('A1', 'A2')
  expect('bus_valid', validateAudioGraph(busGraph, new Set(['A1', 'A2'])).ok, validateAudioGraph(busGraph).errors.join(','))
  const missingBus = { ...busGraph, channels: busGraph.channels.map(ch => ({ ...ch, outputBusId: 'no-such-bus' })) }
  expect('bus_missing', !validateAudioGraph(missingBus, new Set(['A1', 'A2'])).ok, validateAudioGraph(missingBus).errors.join(','))
  const cycleBus = {
    ...busGraph,
    buses: busGraph.buses.map(b => b.id === 'bus-dialogue' ? { ...b, inputs: ['bus-master'] } : b.id === 'bus-master' ? { ...b, inputs: ['bus-dialogue'] } : b),
  }
  expect('bus_cycle', !validateAudioGraph(cycleBus, new Set(['A1', 'A2'])).ok, validateAudioGraph(cycleBus).errors.join(','))

  const limA = await executeAudioMix({ projectId: project0.id, sourceA: video.originalPath, sourceB: video.originalPath, graph: busGraph })
  const loud = { ...busGraph, channels: busGraph.channels.map(ch => ({ ...ch, volume: 2.2 })) }
  const limB = await executeAudioMix({ projectId: project0.id, sourceA: video.originalPath, sourceB: video.originalPath, graph: loud })
  expect('limiter_regression', limA.job.status === 'COMPLETED' && limA.peak <= 0.55 && limB.peak <= 0.55, `A peak=${limA.peak.toFixed(3)} B peak=${limB.peak.toFixed(3)} ${limA.error ?? ''}`)

  const panGraph = {
    ...busGraph,
    automation: [{
      target: 'ch-A',
      param: 'pan' as const,
      keyframes: [
        { time: fromSeconds(0), value: -1 },
        { time: fromSeconds(1), value: 0 },
        { time: fromSeconds(2), value: 1 },
      ],
    }],
  }
  const panSamples = [0, 0.5, 1, 1.5, 2].map(t => interpolateAutomation(panGraph.automation[0], t))
  expect('pan_interp_linear', AUTOMATION_INTERPOLATION === 'linear' && panSamples[0] === -1 && Math.abs(panSamples[2]) < 0.001 && panSamples[4] === 1 && panSamples[1] < panSamples[3], panSamples.join(','))
  const panR = await executeAudioGraph({ projectId: project0.id, sourcePath: video.originalPath, graph: panGraph, channelId: 'ch-A' })
  expect('pan_render', panR.job.status === 'COMPLETED' && Boolean(panR.outputPath), panR.error ?? panR.job.status)
  if (panR.outputPath) {
    const t0 = await windowedLr(tools.ffmpeg!, panR.outputPath, 0.05, 0.2)
    const t1 = await windowedLr(tools.ffmpeg!, panR.outputPath, 0.9, 0.2)
    const t2 = await windowedLr(tools.ffmpeg!, panR.outputPath, 1.7, 0.2)
    expect('pan_continuity', t0.l >= t1.l && t1.l >= t2.l * 0.4 && t2.r > t0.r, `t0 L${t0.l.toFixed(3)} R${t0.r.toFixed(3)} t2 L${t2.l.toFixed(3)} R${t2.r.toFixed(3)}`)
  } else expect('pan_continuity', false, 'no pan file')

  const autoAdd = await commitCommands(project, [{
    id: newCommandId(), kind: 'updateAudioGraph', actor: 'human', createdAt: new Date().toISOString(), graph: panGraph,
  }])
  const autoUndo = await commitCommands(autoAdd.project, [{ id: newCommandId(), kind: 'undo', actor: 'human', createdAt: new Date().toISOString() }])
  const autoRedo = await commitCommands(autoUndo.project, [{ id: newCommandId(), kind: 'redo', actor: 'human', createdAt: new Date().toISOString() }])
  expect('audio_undo_redo', autoAdd.errors.length === 0 && autoUndo.errors.length === 0 && autoRedo.errors.length === 0 && autoRedo.project.audioGraph.automation[0]?.param === 'pan', autoRedo.errors.join(','))
  project = autoRedo.project

  const compGraph = {
    ...firstWave4AudioGraph('A1', 'A2'),
    channels: firstWave4AudioGraph('A1', 'A2').channels.map((ch, i) => i === 0 ? {
      ...ch,
      inserts: [...ch.inserts, { kind: 'compressor' as const, enabled: true, thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 80, makeupDb: 0 }],
    } : ch),
  }
  const c1 = await executeAudioMix({ projectId: project0.id, sourceA: video.originalPath, sourceB: video.originalPath, graph: compGraph })
  const c2 = await executeAudioMix({ projectId: project0.id, sourceA: video.originalPath, sourceB: video.originalPath, graph: compGraph })
  expect('compressor_repeat', c1.job.status === 'COMPLETED' && Math.abs(c1.peak - c2.peak) < 0.02 && Math.abs(c1.rms - c2.rms) < 0.02, `peak ${c1.peak.toFixed(4)}/${c2.peak.toFixed(4)} rms ${c1.rms.toFixed(4)} crest ${crestFactor(c1.peak, c1.rms).toFixed(2)}`)

  const beforeFail = serializeHvsProject(project)
  const badEq = applyEditCommand(project, {
    id: newCommandId(), kind: 'updateAudioGraph', actor: 'human', createdAt: new Date().toISOString(),
    graph: { ...project.audioGraph, channels: project.audioGraph.channels.map(ch => ({ ...ch, inserts: [{ kind: 'eq', enabled: true, highpassHz: Number.NaN, lowpassHz: null, bands: [] }] })) },
  })
  const badLim = applyEditCommand(project, {
    id: newCommandId(), kind: 'updateAudioGraph', actor: 'human', createdAt: new Date().toISOString(),
    graph: { ...project.audioGraph, buses: project.audioGraph.buses.map(b => b.kind === 'master' ? { ...b, inserts: [{ kind: 'limiter', enabled: true, ceilingDb: Number.NaN }] } : b) },
  })
  const badAuto = applyEditCommand(project, {
    id: newCommandId(), kind: 'updateAudioGraph', actor: 'human', createdAt: new Date().toISOString(),
    graph: { ...project.audioGraph, automation: [{ target: 'ch-A', param: 'pan', keyframes: [{ time: fromSeconds(0), value: Number.NaN }] }] },
  })
  const badCurve = applyEditCommand(project, {
    id: newCommandId(), kind: 'updateColorPipeline', actor: 'human', createdAt: new Date().toISOString(),
    pipeline: { schemaVersion: 1, outputColorSpace: 'display-referred', nodes: [{ id: 'bad', type: 'rgb-curve', enabled: true, params: { r: [{ input: 3, output: 3 }] } }] },
  })
  expect('failure_isolation', !badEq.ok && !badLim.ok && !badAuto.ok && !badCurve.ok && serializeHvsProject(project) === beforeFail, [('error' in badEq ? badEq.error : undefined), ('error' in badLim ? badLim.error : undefined), ('error' in badAuto ? badAuto.error : undefined), ('error' in badCurve ? badCurve.error : undefined)].join(' | '))

  const voice = proposeDirectorCommands(project0, 'Generate a voice line.', 'AI_DIRECTOR')
  expect('director_voice_install_gate', voice.jobProposal?.status === 'INSTALL_APPROVAL_REQUIRED' && voice.commands.length === 0, voice.summary)
  expect('director_qual_shadows', proposeDirectorCommands(project0, 'Qualify the shadows and cool them.', 'AI_DIRECTOR', { workspacePage: 'color' }).commands.some(c => c.kind === 'updateColorPipeline'), 'qual')
  expect('director_tracked_blur', proposeDirectorCommands(project0, 'Blur the tracked background.', 'AI_DIRECTOR', { workspacePage: 'vfx', sourceAssetId: video.id }).commands.some(c => c.kind === 'updateEffectGraph'), 'tracked blur')
  expect('director_pan_limit', proposeDirectorCommands(project0, 'Pan this left to right and limit master.', 'AI_DIRECTOR', { workspacePage: 'audio' }).commands.some(c => c.kind === 'updateAudioGraph'), 'pan+limit')
  const genInspect = inspectGenerationRequest('VOICE_SYNTHESIS', PROJECT_ID, 'voice line')
  expect('no_fake_generate', genInspect.card?.executeAvailable === false, genInspect.surfaceState)

  const asked = requestInstallApproval('piper')
  expect('install_request_no_download', asked.downloaded === false && asked.executed === false, asked.reason)
  expect('install_begin_forbidden', beginInstallForbidden('comfyui-flux').downloaded === false, 'forbidden')
  expect('engines_not_installed', localEngineCards().every(c => c.installState !== 'INSTALLED' && c.installState !== 'INSTALLING'), localEngineCards().map(c => `${c.engineId}:${c.installState}`).join(','))

  const fxApplied = applyEditCommand(project, { id: newCommandId(), kind: 'updateEffectGraph', actor: 'human', createdAt: new Date().toISOString(), graph: dual })
  if (fxApplied.ok) project = fxApplied.project
  project = await saveProject(project)
  const snap = await snapshotVersion(project, 'WAVE5 CROSS LANE', 'human', { description: 'Disposable Wave 5 cross-lane snapshot' })
  const target = snap.versions.find(v => v.label === 'WAVE5 CROSS LANE')
  expect('snapshot', Boolean(target?.snapshotPath && existsSync(target.snapshotPath)), target?.snapshotPath ?? 'missing')
  const mutated = await saveProject({
    ...snap,
    colorPipeline: ident,
    audioGraph: { ...busGraph, channels: busGraph.channels.map(ch => ({ ...ch, volume: 0.2 })) },
    effectGraphs: [firstBlurGraph(project.id, video.id, 3)],
  })
  const restored = target ? await restoreVersion(mutated, target.id, { confirmed: true, actor: 'human' }) : { project: mutated, error: 'no target' }
  expect('cross_lane_restore', !restored.error
    && restored.project.colorPipeline.nodes.some(n => n.type === 'rgb-curve' || n.type === 'luma-qualifier')
    && restored.project.audioGraph.automation.some(a => a.param === 'pan')
    && restored.project.effectGraphs.some(g => g.nodes.filter(n => n.kind === 'Mask').length >= 1),
  restored.error ?? JSON.stringify({ color: restored.project.colorPipeline.nodes.map(n => n.type), audio: restored.project.audioGraph.automation.map(a => a.param), fx: restored.project.effectGraphs.flatMap(g => g.nodes.map(n => n.kind)) }))

  const deliver = serializeHvsProject(restored.project)
  expect('deliver_serializes', deliver.includes(PROJECT_ID) && restored.project.id === PROJECT_ID && restored.project.timeline.tracks.reduce((n, t) => n + t.clips.length, 0) >= 1, restored.project.id)
  expect('same_project', restored.project.id === PROJECT_ID && restored.project.assets.some(a => a.id === video.id), video.id)

  const storageAfter = await reportHvsStorage()
  expect('models_still_tiny', (await modelsBytesExcludingAuthorizedAsr(storageAfter.models ?? 0)) < 50_000, String(storageAfter.models))
  expect('no_delete', (storageAfter.originals ?? 0) >= (storageBefore.originals ?? 0) - 1024, `orig ${storageBefore.originals}→${storageAfter.originals}`)
  finish(storageAfter)
}

function finish(storage: Awaited<ReturnType<typeof reportHvsStorage>>) {
  const failed = results.filter(r => !r.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  const extra = {
    ok: failed.length === 0,
    suite: 'hvs-wave5',
    total: results.length,
    failed: failed.length,
    liveAuth: LIVE_AUTH,
    storageModels: storage.models,
    storageFree: storage.freeBytes,
    qualifierGraphSample: results.find(r => r.name === 'qualifier_render')?.detail,
  }
  if (failed.length) {
    console.error(JSON.stringify({ ...extra, failedNames: failed.map(f => f.name) }))
    process.exit(1)
  }
  console.log(JSON.stringify(extra))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
