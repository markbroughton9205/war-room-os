/**
 * HVS WAVE 2 — first real executable paths.
 * Physical evidence required. No paid generation. No model download.
 */
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { HVS_PROGRAM_WAVE, HVS_SLICE } from './navigation'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVS_PRODUCTION_PAGES } from './production-pages'
import { routeCapability, persistRoutedJob } from './provider-router'
import { auditGenerationBackends, anyUsableGenerationBackend, phase2ExecutionBlocker } from './generation-audit'
import { HVS_WAVE2_PROVIDER_SPEND_AUTHORIZED, maySpendMoney } from './policy'
import { loadProject, saveProject } from './store'
import { ingestFile } from './ingest'
import { executeVideoAnalysis, highestMotionHit, searchPersistedObservations, loadObservationsSync } from './video-analysis'
import { seekSourceFromHit, emptySourceMonitor } from './source-monitor'
import { firstMergeGraph, validateEffectGraph, planEffectGraphLowering } from './effect-graph'
import { executeEffectGraph } from './effect-graph-runtime'
import { firstWave2ColorPipeline, executeColorPipeline } from './color-runtime'
import { firstWave2AudioGraph, executeAudioGraph, audioGraphToFfmpeg } from './audio-runtime'
import { extractFramePixels, regionMean } from './frame-scopes'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { reportHvsStorage } from './storage-report'
import { proposeDirectorCommands } from './ai-director'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { toSeconds } from './time'
import { mediaCommandDataHierarchy } from './paths'
import { VI_IDENTITY_POLICY } from './video-intelligence'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

const PROJECT_ID = 'hvs-mual21w4-5h2e'
const SAMPLE = '/home/chosenone/Sample.mp4'

expect('program_wave', ['HVS-WAVE-2', 'HVS-WAVE-3', 'HVS-WAVE-4', 'HVS-WAVE-5', 'HVS-WAVE-6', 'HVS-WAVE-7', 'HVS-WAVE-9'].includes(HVS_PROGRAM_WAVE), HVS_PROGRAM_WAVE)
expect('phase1_slice', HVS_SLICE === 'HVS-P1-SLICE-G', HVS_SLICE)
expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('spend_locked', maySpendMoney() === false && HVS_WAVE2_PROVIDER_SPEND_AUTHORIZED === false, 'spend')
expect('g22_01_shipped', HVS_MATRIX_ROWS.find(r => r.id === 'G22-01')?.state === 'SHIPPED', 'router')
expect('g22_02_shell', HVS_MATRIX_ROWS.find(r => r.id === 'G22-02')?.state === 'SHELL', 'generation family')
expect('g27_01_shipped', HVS_MATRIX_ROWS.find(r => r.id === 'G27-01')?.state === 'SHIPPED', 'vi')
expect('g20_02_shipped', HVS_MATRIX_ROWS.find(r => r.id === 'G20-02')?.state === 'SHIPPED', 'effectgraph')
expect('g19_02_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G19-02')?.state === 'PARTIAL', 'color nodes')
expect('g19_05_scopes', HVS_MATRIX_ROWS.find(r => r.id === 'G19-05')?.state === 'PARTIAL' || HVS_MATRIX_ROWS.find(r => r.id === 'G19-05')?.state === 'SHIPPED', 'scopes')
expect('g19_06_researched', HVS_MATRIX_ROWS.find(r => r.id === 'G19-06')?.state === 'RESEARCHED', 'ocio')
expect('g31_04_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G31-04')?.state === 'PARTIAL', 'eq')
expect('vfx_page_partial', HVS_PRODUCTION_PAGES.find(p => p.id === 'vfx')?.status === 'PARTIAL', 'vfx page')
expect('identity_lock', VI_IDENTITY_POLICY.personObservationIsNotIdentity, 'identity')

const audit = auditGenerationBackends()
expect('no_usable_generator', anyUsableGenerationBackend(audit) === false, audit.filter(r => r.usableThisWave === 'YES').map(r => r.backend).join(','))
expect('ollama_not_media_gen', audit.some(r => r.backend === 'ollama' && r.usableThisWave === 'NO'), 'ollama')
const imageRoute = routeCapability({ capability: 'IMAGE_GENERATION', projectId: PROJECT_ID, prompt: 'key art' })
expect('phase2_not_submitted', !imageRoute.ok && (imageRoute.status === 'NOT_AVAILABLE' || imageRoute.status === 'BLOCKED_PENDING_APPROVAL'), imageRoute.ok ? 'ok' : imageRoute.status)
const blockedJob = persistRoutedJob({
  request: { capability: 'IMAGE_GENERATION', projectId: PROJECT_ID, prompt: 'key art' },
  decision: imageRoute,
})
expect('phase2_job_blocked', blockedJob.status === 'BLOCKED' || blockedJob.status === 'BLOCKED_PENDING_APPROVAL', blockedJob.status)
const blocker = phase2ExecutionBlocker('IMAGE_GENERATION')
expect('phase2_blocker_shape', Boolean(blocker.operatorDecisionRequired && blocker.requiredCapability === 'IMAGE_GENERATION'), blocker.candidateBackend)

async function extractStill(ffmpeg: string, source: string, at: number, dest: string): Promise<boolean> {
  mkdirSync(path.dirname(dest), { recursive: true })
  const run = await runProcess(ffmpeg, ['-hide_banner', '-y', '-ss', String(at), '-i', source, '-frames:v', '1', '-q:v', '2', dest], 30_000)
  return run.ok && existsSync(dest)
}

async function main() {
  const storageBefore = await reportHvsStorage()
  expect('storage_before', storageBefore.freeBytes == null || storageBefore.freeBytes > 1_000_000_000, String(storageBefore.freeBytes))

  const project0 = await loadProject(PROJECT_ID)
  expect('existing_project', Boolean(project0), PROJECT_ID)
  if (!project0) {
    finish(storageBefore)
    return
  }
  const clipCount = project0.timeline.tracks.reduce((n, t) => n + t.clips.length, 0)
  const video = project0.assets.find(a => a.kind === 'video')
  expect('authorized_asset', Boolean(video && existsSync(video.originalPath)), video?.originalPath ?? 'missing')
  expect('sample_exists', existsSync(SAMPLE), SAMPLE)
  if (!video) {
    finish(storageBefore)
    return
  }

  const analysis = await executeVideoAnalysis({ project: project0, assetId: video.id })
  expect('analysis_completed', analysis.job.status === 'COMPLETED' && existsSync(String(analysis.job.outputs.observationsPath ?? '')), analysis.job.status + ' ' + (analysis.error ?? ''))
  expect('observations_real', Boolean(analysis.document && analysis.document.observationCount > 1 && analysis.document.observations.every(o => o.transcript === null)), String(analysis.document?.observationCount))
  expect('no_invented_walk', !(analysis.document?.observations.some(o => o.actions.some(a => /walk|run|driv/i.test(a.label)))), 'semantic')
  const motionHits = analysis.document ? searchPersistedObservations(analysis.document, { motion: 'HIGH MOTION' }) : []
  expect('search_motion', motionHits.length >= 1, String(motionHits.length))
  const audioHits = analysis.document ? searchPersistedObservations(analysis.document, { audioState: 'AUDIO ACTIVE' }) : []
  expect('search_audio', audioHits.length >= 1, String(audioHits.length))
  const high = analysis.document ? highestMotionHit(analysis.document) : null
  expect('highest_motion', Boolean(high && toSeconds(high.start) >= 0), high ? String(toSeconds(high.start)) : 'none')
  if (high) {
    const sought = seekSourceFromHit(emptySourceMonitor(), video, high)
    expect('source_seek', toSeconds(sought.sourcePlayhead) === toSeconds(high.start) && sought.selectedAssetId === video.id, String(toSeconds(sought.sourcePlayhead)))
  }
  const director = proposeDirectorCommands(project0, 'Find the highest-motion section.', 'AI_DIRECTOR', { sourceAssetId: video.id, workspacePage: 'ai' })
  expect('director_seek', director.lane === 'analysis' && director.jobProposal?.execute === false && Boolean(director.sourceSeek), director.summary)
  expect('director_no_silent_edit', director.commands.every(c => c.kind !== 'insertClip'), director.commands.map(c => c.kind).join(','))

  const tools = await resolveFfmpegTools()
  expect('ffmpeg', Boolean(tools.ffmpeg), tools.ffmpeg ?? 'missing')
  if (!tools.ffmpeg) {
    finish(storageBefore)
    return
  }
  const tmp = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave2-proof')
  mkdirSync(tmp, { recursive: true })
  const stillA = path.join(tmp, 'bg.jpg')
  const stillB = path.join(tmp, 'fg.jpg')
  expect('still_a', await extractStill(tools.ffmpeg, video.originalPath, 1.0, stillA), stillA)
  expect('still_b', await extractStill(tools.ffmpeg, video.originalPath, 4.0, stillB), stillB)

  let project = project0
  const bgIn = await ingestFile({
    project,
    sourcePath: stillA,
    originalName: 'wave2-bg.jpg',
    mimeType: 'image/jpeg',
    provenance: { origin: 'derived', parentAssetIds: [video.id], provider: 'ffmpeg-frame', parameters: { atSec: 1 } },
  })
  project = bgIn.project
  const fgIn = await ingestFile({
    project,
    sourcePath: stillB,
    originalName: 'wave2-fg.jpg',
    mimeType: 'image/jpeg',
    provenance: { origin: 'derived', parentAssetIds: [video.id], provider: 'ffmpeg-frame', parameters: { atSec: 4 } },
  })
  project = fgIn.project
  expect('derived_not_generated_ai', bgIn.asset.provenance?.origin === 'derived' && fgIn.asset.generated === false, String(bgIn.asset.provenance?.origin))

  const graph = firstMergeGraph(project.id, bgIn.asset.id, fgIn.asset.id, { x: 40, y: 80, scaleX: 0.35, scaleY: 0.35, opacity: 0.92 })
  expect('merge_graph_valid', validateEffectGraph(graph, { assetIds: new Set(project.assets.map(a => a.id)) }).ok, validateEffectGraph(graph, { assetIds: new Set(project.assets.map(a => a.id)) }).errors.join(','))
  expect('merge_executable', planEffectGraphLowering(graph).executable === true, 'plan')
  project = await saveProject({ ...project, effectGraphs: [graph], colorPipeline: firstWave2ColorPipeline() })
  const vfx = await executeEffectGraph({ project, graph, still: true })
  expect('vfx_completed', vfx.job.status === 'COMPLETED' && Boolean(vfx.outputPath && existsSync(vfx.outputPath)), vfx.error ?? vfx.job.status)
  expect('vfx_probe', Boolean(vfx.probe && (vfx.probe.width ?? 0) > 0 && (vfx.probe.height ?? 0) > 0), JSON.stringify({ w: vfx.probe?.width, h: vfx.probe?.height }))
  if (vfx.outputPath) {
    const comp = await extractFramePixels(vfx.outputPath, 0)
    const bgPx = await extractFramePixels(stillA, 0)
    if (comp && bgPx) {
      const overlay = regionMean(comp, 40, 80, 179, 318)
      const bgRegion = regionMean(bgPx, 40, 80, 179, 318)
      const delta = Math.abs(overlay.luma - bgRegion.luma) + Math.abs(overlay.meanR - bgRegion.meanR)
      expect('vfx_pixels_changed', delta > 2, `delta=${delta.toFixed(2)} overlayL=${overlay.luma.toFixed(1)} bgL=${bgRegion.luma.toFixed(1)}`)
    } else {
      expect('vfx_pixels_changed', false, 'could not read pixels')
    }
  }

  const color = await executeColorPipeline({
    projectId: project.id,
    sourcePath: video.originalPath,
    pipeline: firstWave2ColorPipeline(),
    atSec: 1,
  })
  expect('color_completed', color.job.status === 'COMPLETED' && Boolean(color.afterPath && existsSync(color.afterPath)), color.error ?? color.job.status)
  expect('color_stats', Boolean(color.before && color.after), 'stats')
  if (color.before && color.after) {
    expect('color_luma_moved', Math.abs(color.after.luma - color.before.luma) > 0.5, `before=${color.before.luma.toFixed(2)} after=${color.after.luma.toFixed(2)}`)
    expect('color_temp_colder', color.after.meanB - color.before.meanB > 0.2 || color.after.meanR < color.before.meanR, `dB=${(color.after.meanB - color.before.meanB).toFixed(2)} dR=${(color.after.meanR - color.before.meanR).toFixed(2)}`)
  }
  expect('scopes_real', Boolean(color.beforeScopes && color.afterScopes && color.afterScopes.histogram.r.some(n => n > 0) && color.afterScopes.vectorscope.samples > 0), String(color.afterScopes?.vectorscope.samples))

  const identityGraph = firstWave2AudioGraph(project.timeline.tracks.find(t => t.kind === 'audio')?.id ?? project.timeline.tracks[0].id)
  identityGraph.channels[0].inserts = []
  identityGraph.channels[0].volume = 1
  identityGraph.channels[0].pan = 0
  const ident = await executeAudioGraph({ projectId: project.id, sourcePath: video.originalPath, graph: identityGraph })
  expect('audio_identity', ident.job.status === 'COMPLETED' && ident.rms > 0, ident.error ?? String(ident.rms))

  const quiet = structuredClone(identityGraph)
  quiet.channels[0].volume = 0.5
  const vol = await executeAudioGraph({ projectId: project.id, sourcePath: video.originalPath, graph: quiet })
  expect('audio_volume_energy', vol.rms < ident.rms * 0.7 && vol.rms > 0, `ident=${ident.rms.toFixed(4)} half=${vol.rms.toFixed(4)}`)

  const panned = structuredClone(identityGraph)
  panned.channels[0].pan = -1
  const pan = await executeAudioGraph({ projectId: project.id, sourcePath: video.originalPath, graph: panned })
  expect('audio_pan_left', pan.leftRms > pan.rightRms * 2, `L=${pan.leftRms.toFixed(4)} R=${pan.rightRms.toFixed(4)}`)

  const eqGraph = firstWave2AudioGraph(identityGraph.channels[0].trackId)
  const eq = await executeAudioGraph({ projectId: project.id, sourcePath: video.originalPath, graph: eqGraph })
  expect('audio_eq', Boolean(eq.bands && ident.bands && eq.bands.low < ident.bands.low), `low ident=${ident.bands?.low.toFixed(4)} eq=${eq.bands?.low.toFixed(4)}`)
  expect('audio_meters', eq.meters.length === 1 && eq.peak > 0, String(eq.peak))

  const muted = structuredClone(identityGraph)
  muted.channels[0].mute = true
  const mute = await executeAudioGraph({ projectId: project.id, sourcePath: video.originalPath, graph: muted })
  expect('audio_mute', mute.rms < 0.001, String(mute.rms))
  expect('audio_signal_order', audioGraphToFfmpeg({ graph: eqGraph }).notes[0].includes('clip'), audioGraphToFfmpeg({ graph: eqGraph }).notes.join(';'))

  project = await saveProject({ ...project, audioGraph: eqGraph })
  const clipsNow = project.timeline.tracks.reduce((n, t) => n + t.clips.length, 0)
  expect('timeline_unchanged', clipsNow === clipCount, `before=${clipCount} after=${clipsNow}`)

  const reloaded = await loadProject(project.id)
  expect('reload_graphs', Boolean(reloaded && reloaded.effectGraphs.length >= 1 && reloaded.colorPipeline.nodes.length >= 3 && reloaded.audioGraph.channels.length >= 1), String(reloaded?.effectGraphs.length))
  const parsed = parseHvsProject(serializeHvsProject(reloaded!))
  expect('parse_roundtrip', parsed.id === project.id && parsed.timeline.tracks[0].clips.length === clipCount, parsed.id)

  const badGraph = firstMergeGraph(project.id, 'missing-a', 'missing-b')
  expect('invalid_vfx_isolated', !validateEffectGraph(badGraph, { assetIds: new Set(project.assets.map(a => a.id)) }).ok, 'invalid graph')
  expect('sources_immutable', existsSync(video.originalPath), video.originalPath)

  const gen = proposeDirectorCommands(project, 'Generate an establishing shot.')
  expect('generation_still_blocked', Boolean(gen.requiresSpendApproval && gen.jobProposal?.status === 'BLOCKED_PENDING_APPROVAL'), gen.summary)

  const counts = HVS_MATRIX_ROWS.reduce((acc, row) => {
    acc[row.state] = (acc[row.state] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  expect('counts_187', (counts.SHIPPED ?? 0) + (counts.PARTIAL ?? 0) + (counts.SHELL ?? 0) + (counts.RESEARCHED ?? 0) + (counts['NOT STARTED'] ?? 0) + (counts.BLOCKED ?? 0) === 187, JSON.stringify(counts))
  expect('shipped_count', counts.SHIPPED === 58 || counts.SHIPPED === 59, String(counts.SHIPPED))
  expect('partial_count', counts.PARTIAL === 28 || counts.PARTIAL === 29 || counts.PARTIAL === 30, String(counts.PARTIAL))

  finish(storageBefore, {
    analysisMs: analysis.durationMs,
    vfxMs: vfx.durationMs,
    colorMs: color.durationMs,
    audioMs: ident.durationMs + vol.durationMs + pan.durationMs + eq.durationMs,
    highMotionSec: high ? toSeconds(high.start) : null,
    vfxPath: vfx.outputPath,
    colorAfter: color.afterPath,
    audioPath: eq.outputPath,
  })
}

function finish(storageBefore: Awaited<ReturnType<typeof reportHvsStorage>>, extra?: Record<string, unknown>) {
  void reportHvsStorage().then(storageAfter => {
    expect('storage_after', storageAfter.freeBytes == null || storageAfter.freeBytes > 0, String(storageAfter.freeBytes))
    const failed = results.filter(r => !r.pass)
    for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
    if (failed.length) {
      console.error(JSON.stringify({ ok: false, wave: 'HVS-WAVE-2', failed: failed.length, total: results.length }, null, 2))
      process.exit(1)
    }
    console.log(JSON.stringify({
      ok: true,
      wave: 'HVS-WAVE-2',
      total: results.length,
      storageBefore: { freeBytes: storageBefore.freeBytes, mediaCommandTotal: storageBefore.mediaCommandTotal },
      storageAfter: { freeBytes: storageAfter.freeBytes, mediaCommandTotal: storageAfter.mediaCommandTotal },
      extra: extra ?? null,
    }))
  }).catch(err => {
    console.error(err)
    process.exit(1)
  })
}

void main().catch(err => {
  console.error(err)
  process.exit(1)
})
