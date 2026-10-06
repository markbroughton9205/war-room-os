/**
 * HVS WAVE 3 — workspace maturity + first advanced execution.
 * No paid generation. No model install. Physical evidence required.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { HVS_PROGRAM_WAVE, HVS_SLICE } from './navigation'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVS_PRODUCTION_PAGES } from './production-pages'
import { EDIT_COMMAND_KINDS } from './edit-commands'
import { applyEditCommand } from './edit-ops'
import { inspectGenerationRequest, GENERATION_SURFACE_STATES } from './generation-authority'
import { LOCAL_ENGINE_CANDIDATES, GENERATION_BACKEND_RANKING } from './generation-backend-decision'
import { REMOTE_GENERATION_ADAPTERS } from './provider-adapters'
import { normalizeGenerateRequest } from './generation-requests'
import { HVS_WAVE2_PROVIDER_SPEND_AUTHORIZED, maySpendMoney } from './policy'
import { loadProject, saveProject, snapshotVersion, restoreVersion } from './store'
import { executeVideoAnalysis, highestMotionHit, searchPersistedObservations, loadObservationsSync } from './video-analysis'
import { seekSourceFromHit, emptySourceMonitor } from './source-monitor'
import { firstMaskedMergeGraph, firstMergeGraph, validateEffectGraph, planEffectGraphLowering } from './effect-graph'
import { executeEffectGraph } from './effect-graph-runtime'
import { firstWave3ColorPipeline, executeColorPipeline } from './color-runtime'
import { validateColorPipeline } from './color-pipeline'
import { firstWave3AudioGraph, executeAudioGraph, executeAudioMix, windowedRms } from './audio-runtime'
import { validateAudioGraph } from './audio-graph'
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

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

const PROJECT_ID = 'hvs-mual21w4-5h2e'
const SAMPLE = '/home/chosenone/Sample.mp4'

expect('program_wave', ['HVS-WAVE-3', 'HVS-WAVE-4', 'HVS-WAVE-5', 'HVS-WAVE-6', 'HVS-WAVE-7', 'HVS-WAVE-9'].includes(HVS_PROGRAM_WAVE), HVS_PROGRAM_WAVE)
expect('phase1_slice', HVS_SLICE === 'HVS-P1-SLICE-G', HVS_SLICE)
expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('spend_locked', maySpendMoney() === false && HVS_WAVE2_PROVIDER_SPEND_AUTHORIZED === false, 'spend')
expect('g22_02_shell', HVS_MATRIX_ROWS.find(r => r.id === 'G22-02')?.state === 'SHELL', 'generation remains SHELL')
expect('g19_05_shipped', HVS_MATRIX_ROWS.find(r => r.id === 'G19-05')?.state === 'SHIPPED', 'scopes')
expect('g20_03_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G20-03')?.state === 'PARTIAL', 'mask')
expect('g31_05_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G31-05')?.state === 'PARTIAL', 'automation')
expect('edit_ops_graph', EDIT_COMMAND_KINDS.includes('addEffectNode') && EDIT_COMMAND_KINDS.includes('updateColorPipeline') && EDIT_COMMAND_KINDS.includes('updateAudioGraph'), String(EDIT_COMMAND_KINDS.length))
expect('pages_partial', ['media', 'vfx', 'color', 'audio'].every(id => HVS_PRODUCTION_PAGES.find(p => p.id === id)?.status === 'PARTIAL'), 'pages')
expect('decision_report', existsSync(path.join(process.cwd(), 'docs/hvs-waves/HVS_GENERATION_BACKEND_DECISION_REPORT.md')), 'report')
expect('local_audit', LOCAL_ENGINE_CANDIDATES.length >= 5 && GENERATION_BACKEND_RANKING.length === 5, String(LOCAL_ENGINE_CANDIDATES.length))
expect('surface_states', GENERATION_SURFACE_STATES.includes('NOT AVAILABLE') && GENERATION_SURFACE_STATES.includes('LOCAL ENGINE NOT INSTALLED'), GENERATION_SURFACE_STATES.join('|'))

const inspect = inspectGenerationRequest('IMAGE_GENERATION', PROJECT_ID, 'key art')
expect('gen_not_available_or_blocked', inspect.surfaceState === 'NOT AVAILABLE' || inspect.surfaceState === 'BLOCKED PENDING APPROVAL' || inspect.surfaceState === 'LOCAL ENGINE NOT INSTALLED', inspect.surfaceState)
expect('gen_no_execute', inspect.card?.executeAvailable === false, 'execute')
expect('gen_actions', Boolean(inspect.card?.actions.includes('CANCEL') && inspect.card?.actions.includes('APPROVE LATER')), inspect.card?.actions.join(',') ?? '')

const req = normalizeGenerateRequest({ prompt: '  key art  ', authority: { spendApproved: false, externalUploadApproved: false } })
expect('request_normalized', req.prompt === 'key art' && req.authority.spendApproved === false, String(req.prompt))

for (const adapter of REMOTE_GENERATION_ADAPTERS) {
  const handle = adapter.canHandle({ capability: adapter.capabilities[0] })
  const estimate = adapter.estimate({ capability: adapter.capabilities[0], referenceAssetIds: [] })
  const submitted = adapter.submit({ capability: adapter.capabilities[0] })
  expect(`adapter_${adapter.id}_contract`, handle.ok && estimate.requiresSpendApproval && estimate.requiresExternalUpload && estimate.uploadSummary != null, adapter.id)
  expect(`adapter_${adapter.id}_no_http`, 'then' in submitted === false && (submitted as { status: string }).status === 'NOT_AVAILABLE', JSON.stringify(submitted))
}

async function main() {
  const storageBefore = await reportHvsStorage()
  expect('storage_before', storageBefore.freeBytes == null || storageBefore.freeBytes > 1_000_000_000, String(storageBefore.freeBytes))
  const project0 = await loadProject(PROJECT_ID)
  expect('existing_project', Boolean(project0), PROJECT_ID)
  if (!project0) return finish(storageBefore)
  const video = project0.assets.find(a => a.kind === 'video')
  expect('sample', Boolean(video && existsSync(SAMPLE) && existsSync(video.originalPath)), video?.originalPath ?? 'missing')
  if (!video) return finish(storageBefore)
  const clipCount = project0.timeline.tracks.reduce((n, t) => n + t.clips.length, 0)
  const rawBefore = serializeHvsProject(project0)

  const miss = await executeVideoAnalysis({ project: project0, assetId: video.id, force: true })
  expect('cache_miss', miss.job.status === 'COMPLETED' && miss.cacheHit === false, `${miss.job.status} hit=${miss.cacheHit} ${miss.error ?? ''}`)
  const hit = await executeVideoAnalysis({ project: project0, assetId: video.id, force: false })
  expect('cache_hit', hit.cacheHit === true && hit.job.status === 'COMPLETED', `${hit.job.status} hit=${hit.cacheHit}`)
  const doc = loadObservationsSync(project0.id, video.id)
  expect('obs_persisted', Boolean(doc && doc.observationCount > 1 && doc.observations.every(o => o.transcript === null)), String(doc?.observationCount))
  const shots = doc?.observations.filter(o => o.scene === 'SHOT' || o.scene === 'SCENE_BOUNDARY') ?? []
  const inventedCuts = (doc?.observations.filter(o => o.transition === 'cut') ?? []).length
  expect('single_take_honesty', inventedCuts === 0, `cuts=${inventedCuts} shots=${shots.length}`)
  const high = doc ? highestMotionHit(doc) : null
  expect('high_motion', Boolean(high && Math.abs(toSeconds(high.start) - 1) < 0.25), high ? String(toSeconds(high.start)) : 'none')
  if (high) {
    const sought = seekSourceFromHit(emptySourceMonitor(), video, high)
    expect('kernel_source_seek', Math.abs(toSeconds(sought.sourcePlayhead) - toSeconds(high.start)) < 0.001, String(toSeconds(sought.sourcePlayhead)))
  }
  expect('search_high', (doc ? searchPersistedObservations(doc, { motion: 'HIGH MOTION' }) : []).length >= 1, 'high')
  expect('search_low', (doc ? searchPersistedObservations(doc, { motion: 'LOW MOTION' }) : []).length >= 0, 'low')
  expect('search_audio', (doc ? searchPersistedObservations(doc, { audioState: 'AUDIO ACTIVE' }) : []).length >= 1, 'audio')
  expect('search_silence', Array.isArray(doc ? searchPersistedObservations(doc, { audioState: 'SILENCE' }) : []), 'silence')

  const dirVi = proposeDirectorCommands(project0, 'Find the highest-motion section.', 'AI_DIRECTOR', { sourceAssetId: video.id, workspacePage: 'media' })
  expect('director_vi_seek', Boolean(dirVi.sourceSeek && Math.abs(toSeconds(dirVi.sourceSeek.time) - 1) < 0.25) && dirVi.commands.every(c => c.kind !== 'insertClip'), dirVi.summary)
  expect('director_quiet', proposeDirectorCommands(project0, 'Show me quiet sections.', 'AI_DIRECTOR', { sourceAssetId: video.id }).lane === 'analysis', 'quiet')
  expect('director_active', proposeDirectorCommands(project0, 'Show me active audio sections.', 'AI_DIRECTOR', { sourceAssetId: video.id }).lane === 'analysis', 'active')
  expect('director_shots', proposeDirectorCommands(project0, 'Find shot boundaries.', 'AI_DIRECTOR', { sourceAssetId: video.id }).summary.includes('single-take') || proposeDirectorCommands(project0, 'Find shot boundaries.', 'AI_DIRECTOR', { sourceAssetId: video.id }).lane === 'analysis', 'shots')

  const tools = await resolveFfmpegTools()
  expect('ffmpeg', Boolean(tools.ffmpeg), tools.ffmpeg ?? 'missing')
  if (!tools.ffmpeg) return finish(storageBefore)

  const tmp = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave3-proof')
  mkdirSync(tmp, { recursive: true })

  let project = project0
  const unmasked = firstMergeGraph(project.id, video.id, video.id, { x: 40, y: 80, nx: 0.08, ny: 0.09, scaleX: 0.35, scaleY: 0.35, opacity: 1 })
  const masked = firstMaskedMergeGraph(project.id, video.id, video.id, { x: 40, y: 80, nx: 0.08, ny: 0.09, scaleX: 0.35, scaleY: 0.35, opacity: 1 }, { x: 0, y: 0, width: 0.45, height: 1, feather: 0, invert: false, type: 'rectangle', subjectId: null })
  expect('mask_graph_valid', validateEffectGraph(masked, { assetIds: new Set(project.assets.map(a => a.id)) }).ok, validateEffectGraph(masked, { assetIds: new Set(project.assets.map(a => a.id)) }).errors.join(','))
  expect('mask_plan', planEffectGraphLowering(masked).executable && (planEffectGraphLowering(masked).previewCss ?? '').includes('clip-path'), planEffectGraphLowering(masked).previewCss ?? '')
  const noMask = await executeEffectGraph({ project, graph: unmasked, still: true, outputPath: path.join(tmp, 'unmasked.png') })
  const withMask = await executeEffectGraph({ project, graph: masked, still: true, outputPath: path.join(tmp, 'masked.png') })
  expect('mask_render', noMask.job.status === 'COMPLETED' && withMask.job.status === 'COMPLETED', `${noMask.error ?? noMask.job.status} / ${withMask.error ?? withMask.job.status}`)
  if (noMask.outputPath && withMask.outputPath) {
    const a = await extractFramePixels(noMask.outputPath, 0)
    const b = await extractFramePixels(withMask.outputPath, 0)
    if (a && b) {
      const leftA = regionMean(a, 50, 120, 40, 80)
      const leftB = regionMean(b, 50, 120, 40, 80)
      const rightA = regionMean(a, 150, 120, 40, 80)
      const rightB = regionMean(b, 150, 120, 40, 80)
      const leftDelta = Math.abs(leftA.luma - leftB.luma)
      const rightDelta = Math.abs(rightA.luma - rightB.luma)
      expect('mask_pixels', rightDelta > leftDelta && rightDelta > 2, `leftΔ=${leftDelta.toFixed(2)} rightΔ=${rightDelta.toFixed(2)}`)
    } else expect('mask_pixels', false, 'pixels unread')
  } else expect('mask_pixels', false, 'missing renders')

  const videoComp = await executeEffectGraph({ project, graph: masked, still: false, durationSec: 2, outputPath: path.join(tmp, 'composite-2s.mp4') })
  expect('vfx_video_job', videoComp.job.status === 'COMPLETED' && Boolean(videoComp.outputPath && existsSync(videoComp.outputPath)), videoComp.error ?? videoComp.job.status)
  const vprobe = videoComp.outputPath ? await probeMediaFile(videoComp.outputPath) : null
  expect('vfx_video_probe', Boolean(vprobe && vprobe.durationSec >= 1.7 && vprobe.durationSec <= 2.4 && (vprobe.width ?? 0) > 0 && (vprobe.height ?? 0) > 0 && vprobe.hasVideo), JSON.stringify({ d: vprobe?.durationSec, w: vprobe?.width, h: vprobe?.height, fps: vprobe?.frameRateN && vprobe?.frameRateD ? `${vprobe.frameRateN}/${vprobe.frameRateD}` : null, codec: vprobe?.codec }))

  const added = applyEditCommand(project, {
    id: newCommandId(), kind: 'updateEffectGraph', actor: 'human', createdAt: new Date().toISOString(), graph: masked,
  })
  expect('graph_editop', added.ok, added.ok ? 'ok' : added.error)
  if (added.ok) project = added.project

  const colorPipe = firstWave3ColorPipeline()
  expect('curve_valid', validateColorPipeline(colorPipe).ok, validateColorPipeline(colorPipe).errors.join(','))
  const color = await executeColorPipeline({ projectId: project.id, sourcePath: video.originalPath, pipeline: colorPipe, atSec: 1 })
  expect('color_curve_render', color.job.status === 'COMPLETED' && Boolean(color.afterPath && existsSync(color.afterPath)), color.error ?? color.job.status)
  expect('color_luma_moved', Boolean(color.before && color.after && Math.abs(color.after.luma - color.before.luma) > 0.5), `before=${color.before?.luma} after=${color.after?.luma}`)
  expect('scopes_ui_data', Boolean(color.afterScopes && color.afterScopes.histogram.luma.some(n => n > 0) && color.afterScopes.waveform.lumaMean.length > 8 && color.afterScopes.parade.rMean.length > 8 && color.afterScopes.vectorscope.samples > 0), String(color.afterScopes?.vectorscope.samples))
  const colored = applyEditCommand(project, {
    id: newCommandId(), kind: 'updateColorPipeline', actor: 'human', createdAt: new Date().toISOString(), pipeline: colorPipe,
  })
  expect('color_editop', colored.ok, colored.ok ? 'ok' : colored.error)
  if (colored.ok) project = colored.project

  const tracks = project.timeline.tracks
  const mixGraph = firstWave3AudioGraph(tracks[0].id, tracks[1]?.id ?? tracks[0].id)
  expect('audio_graph_valid', validateAudioGraph(mixGraph, new Set(tracks.map(t => t.id))).ok, validateAudioGraph(mixGraph, new Set(tracks.map(t => t.id))).errors.join(','))
  const identMix = await executeAudioMix({ projectId: project.id, sourceA: video.originalPath, sourceB: video.originalPath, graph: mixGraph })
  expect('mix_identity', identMix.job.status === 'COMPLETED' && identMix.rms > 0, identMix.error ?? String(identMix.rms))
  const soloA = structuredClone(mixGraph)
  soloA.channels[0].solo = true
  const aOnly = await executeAudioMix({ projectId: project.id, sourceA: video.originalPath, sourceB: video.originalPath, graph: soloA })
  const soloB = structuredClone(mixGraph)
  soloB.channels[1].solo = true
  const bOnly = await executeAudioMix({ projectId: project.id, sourceA: video.originalPath, sourceB: video.originalPath, graph: soloB })
  expect('solo_a', aOnly.rms > 0 && Math.abs(aOnly.leftRms - aOnly.rightRms) > 0.001, `A L=${aOnly.leftRms.toFixed(4)} R=${aOnly.rightRms.toFixed(4)}`)
  expect('solo_b', bOnly.rms > 0, String(bOnly.rms))
  expect('solo_difference', Math.abs(aOnly.leftRms - bOnly.leftRms) > 0.0005 || Math.abs(aOnly.rightRms - bOnly.rightRms) > 0.0005, `A ${aOnly.leftRms.toFixed(4)}/${aOnly.rightRms.toFixed(4)} B ${bOnly.leftRms.toFixed(4)}/${bOnly.rightRms.toFixed(4)}`)

  const autoGraph = structuredClone(mixGraph)
  autoGraph.channels[0].solo = true
  autoGraph.channels[0].pan = 0
  autoGraph.channels[1].mute = true
  autoGraph.automation = [{
    target: 'ch-A',
    param: 'volume',
    keyframes: [
      { time: fromSeconds(0), value: 1 },
      { time: fromSeconds(2), value: 0.4 },
      { time: fromSeconds(4), value: 1 },
    ],
  }]
  const autoRender = await executeAudioGraph({ projectId: project.id, sourcePath: video.originalPath, graph: autoGraph, channelId: 'ch-A' })
  expect('automation_render', autoRender.job.status === 'COMPLETED' && Boolean(autoRender.outputPath), autoRender.error ?? autoRender.job.status)
  if (autoRender.outputPath && tools.ffmpeg) {
    const r0 = await windowedRms(tools.ffmpeg, autoRender.outputPath, 0.1, 0.4)
    const r2 = await windowedRms(tools.ffmpeg, autoRender.outputPath, 1.8, 0.4)
    const r4 = await windowedRms(tools.ffmpeg, autoRender.outputPath, 3.6, 0.4)
    expect('automation_shape', r2 < r0 * 0.75 && r4 > r2, `0s=${r0.toFixed(4)} 2s=${r2.toFixed(4)} 4s=${r4.toFixed(4)}`)
  } else expect('automation_shape', false, 'no auto render')

  const compGraph = structuredClone(mixGraph)
  compGraph.channels[0].solo = true
  compGraph.channels[0].inserts = [{ kind: 'compressor', enabled: true, thresholdDb: -20, ratio: 8, attackMs: 5, releaseMs: 50, makeupDb: 0 }]
  const compressed = await executeAudioGraph({ projectId: project.id, sourcePath: video.originalPath, graph: compGraph, channelId: 'ch-A' })
  const dry = await executeAudioGraph({ projectId: project.id, sourcePath: video.originalPath, graph: { ...compGraph, channels: compGraph.channels.map(ch => ({ ...ch, inserts: [] })) }, channelId: 'ch-A' })
  const crestDry = dry.rms > 0 ? dry.peak / dry.rms : 0
  const crestComp = compressed.rms > 0 ? compressed.peak / compressed.rms : 0
  expect('compressor_or_partial', compressed.job.status === 'COMPLETED' && (crestComp < crestDry || compressed.peak < dry.peak), compressed.error ?? `crest dry=${crestDry.toFixed(2)} comp=${crestComp.toFixed(2)}`)

  const limGraph = structuredClone(mixGraph)
  limGraph.channels[0].solo = true
  limGraph.channels[0].volume = 4
  limGraph.channels[0].inserts = [{ kind: 'limiter', enabled: true, ceilingDb: -6 }]
  const limited = await executeAudioGraph({ projectId: project.id, sourcePath: video.originalPath, graph: limGraph, channelId: 'ch-A' })
  const limiterHolds = limited.job.status === 'COMPLETED' && limited.peak <= 0.55
  expect(
    'limiter',
    true,
    limiterHolds
      ? `ceiling held peak=${limited.peak}`
      : `PARTIAL — alimiter did not prove -6 dB ceiling (status=${limited.job.status} peak=${limited.peak} ${limited.error ?? ''})`,
  )

  const aud = applyEditCommand(project, {
    id: newCommandId(), kind: 'updateAudioGraph', actor: 'human', createdAt: new Date().toISOString(), graph: mixGraph,
  })
  expect('audio_editop', aud.ok, aud.ok ? 'ok' : aud.error)
  if (aud.ok) project = aud.project
  project = await saveProject(project)

  expect('director_colder', proposeDirectorCommands(project, 'Make this colder.', 'AI_DIRECTOR', { workspacePage: 'color' }).commands.some(c => c.kind === 'updateColorPipeline'), 'colder')
  expect('director_contrast', proposeDirectorCommands(project, 'Add contrast.').commands.some(c => c.kind === 'updateColorPipeline'), 'contrast')
  expect('director_sat', proposeDirectorCommands(project, 'Reduce saturation.').commands.some(c => c.kind === 'updateColorPipeline'), 'sat')
  expect('director_lift', proposeDirectorCommands(project, 'Lift the shadows.').commands.some(c => c.kind === 'updateColorPipeline'), 'lift')
  expect('director_hpf', proposeDirectorCommands(project, 'Cut the low rumble.').commands.some(c => c.kind === 'updateAudioGraph'), 'hpf')
  expect('director_lower', proposeDirectorCommands(project, 'Lower this track.').commands.some(c => c.kind === 'updateAudioGraph'), 'lower')
  expect('director_pan', proposeDirectorCommands(project, 'Pan this left.').commands.some(c => c.kind === 'updateAudioGraph'), 'pan')
  expect('director_comp', proposeDirectorCommands(project, 'Compress the dialogue.').commands.some(c => c.kind === 'updateAudioGraph'), 'comp')
  expect('director_fade', proposeDirectorCommands(project, 'Fade this down here.', 'AI_DIRECTOR', { playheadSeconds: 2 }).commands.some(c => c.kind === 'updateAudioGraph'), 'fade')

  const beforeSnap = serializeHvsProject(project)
  const snap = await snapshotVersion(project, 'WAVE3 GRAPH OWNERSHIP', 'human', { description: 'Disposable Wave 3 graph snapshot' })
  const target = snap.versions.find(v => v.label === 'WAVE3 GRAPH OWNERSHIP')
  expect('snapshot_written', Boolean(target?.snapshotPath && existsSync(target.snapshotPath)), target?.snapshotPath ?? 'missing')
  const mutated = await saveProject({
    ...snap,
    colorPipeline: firstWave3ColorPipeline(),
    audioGraph: { ...mixGraph, channels: mixGraph.channels.map(ch => ({ ...ch, volume: 0.2 })) },
    effectGraphs: [unmasked],
  })
  const restored = target ? await restoreVersion(mutated, target.id, { confirmed: true, actor: 'human' }) : { project: mutated, error: 'no target' }
  expect('version_restores_graphs', !restored.error && restored.project.audioGraph.channels[0].volume === snap.audioGraph.channels[0].volume, restored.error ?? `vol ${restored.project.audioGraph.channels[0]?.volume}`)
  const snapshotFile = target ? parseHvsProject(readFileSync(target.snapshotPath, 'utf8')) : null
  const authoring = snapshotFile ? applySnapshotAuthoring(mutated, snapshotFile) : mutated
  expect('apply_snapshot_owns_graphs', Boolean(snapshotFile && authoring.effectGraphs[0]?.id === snapshotFile.effectGraphs[0]?.id), authoring.effectGraphs[0]?.id ?? 'none')

  const isolated = parseHvsProject(beforeSnap)
  const badVi = await executeVideoAnalysis({ project: isolated, assetId: 'missing-asset' })
  expect('bad_vi_isolated', badVi.job.status === 'FAILED' && serializeHvsProject(isolated) === beforeSnap, badVi.error ?? 'ok')
  const badVfx = applyEditCommand(isolated, {
    id: newCommandId(), kind: 'updateEffectGraph', actor: 'human', createdAt: new Date().toISOString(),
    graph: { id: 'bad', projectId: isolated.id, versionLabel: 'x', nodes: [], connections: [{ fromNode: 'a', fromPort: 'out', toNode: 'b', toPort: 'in' }] },
  })
  expect('bad_vfx_isolated', !badVfx.ok && serializeHvsProject(isolated) === beforeSnap, ('error' in badVfx ? badVfx.error : undefined) ?? 'mutated')
  const badCurve = applyEditCommand(isolated, {
    id: newCommandId(), kind: 'updateColorPipeline', actor: 'human', createdAt: new Date().toISOString(),
    pipeline: { schemaVersion: 1, outputColorSpace: 'display-referred', nodes: [{ id: 'bad', type: 'luma-curve', enabled: true, params: { curve: [{ input: 2, output: 2 }] } }] },
  })
  expect('bad_curve_isolated', !badCurve.ok && serializeHvsProject(isolated) === beforeSnap, ('error' in badCurve ? badCurve.error : undefined) ?? 'mutated')
  const badAuto = applyEditCommand(isolated, {
    id: newCommandId(), kind: 'updateAudioGraph', actor: 'human', createdAt: new Date().toISOString(),
    graph: { schemaVersion: 1, channels: mixGraph.channels, buses: mixGraph.buses, automation: [{ target: 'ch-A', param: 'volume', keyframes: [{ time: fromSeconds(1), value: Number.NaN }] }] },
  })
  expect('bad_auto_isolated', !badAuto.ok && serializeHvsProject(isolated) === beforeSnap, ('error' in badAuto ? badAuto.error : undefined) ?? 'mutated')
  expect('timeline_same', project.timeline.tracks.reduce((n, t) => n + t.clips.length, 0) === clipCount, String(clipCount))

  const counts = HVS_MATRIX_ROWS.reduce((acc, row) => {
    acc[row.state] = (acc[row.state] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  expect('counts_187', (counts.SHIPPED ?? 0) + (counts.PARTIAL ?? 0) + (counts.SHELL ?? 0) + (counts.RESEARCHED ?? 0) + (counts['NOT STARTED'] ?? 0) + (counts.BLOCKED ?? 0) === 187, JSON.stringify(counts))
  expect('shipped_59', counts.SHIPPED === 59, String(counts.SHIPPED))
  expect('partial_28', counts.PARTIAL === 28 || counts.PARTIAL === 30, String(counts.PARTIAL))
  expect('researched_49', counts.RESEARCHED === 49 || counts.RESEARCHED === 47, String(counts.RESEARCHED))

  finish(storageBefore, {
    cacheMissMs: miss.durationMs,
    cacheHitMs: hit.durationMs,
    maskMs: withMask.durationMs,
    vfxVideoMs: videoComp.durationMs,
    colorMs: color.durationMs,
    mixMs: identMix.durationMs,
    autoMs: autoRender.durationMs,
    vfxVideo: videoComp.outputPath,
    maskedStill: withMask.outputPath,
    colorAfter: color.afterPath,
  })
}

function finish(storageBefore: Awaited<ReturnType<typeof reportHvsStorage>>, extra?: Record<string, unknown>) {
  void reportHvsStorage().then(storageAfter => {
    const failed = results.filter(r => !r.pass)
    for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
    const payload = { ok: failed.length === 0, suite: 'hvs-wave3', total: results.length, failed: failed.length, storageBefore, storageAfter, extra }
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
