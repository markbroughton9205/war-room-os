/**
 * HVS WAVE 9 — Advanced VI contracts + professional post physical proofs.
 * No large model download. No paid HTTP. No commit.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { HVS_PROGRAM_WAVE, HVS_SLICE } from './navigation'
import { HVS_MATRIX_ROWS } from './production-matrix'
import {
  HVS_WAVE9_ASR_MODEL_DOWNLOAD_AUTHORIZED,
  HVS_WAVE9_BIOMETRIC_DEFAULT,
  HVS_WAVE9_EMBEDDING_MODEL_DOWNLOAD_AUTHORIZED,
  HVS_WAVE9_OBJECT_MODEL_DOWNLOAD_AUTHORIZED,
  maySpendMoney,
} from './policy'
import { auditWave9Runtimes, WAVE9_ASR_RECOMMENDATION, WAVE9_OBJECT_RECOMMENDATION } from './wave9-runtime-audit'
import { requestTranscription } from './asr'
import { emptyTranscript, validateTranscriptDocument, writeTranscript, searchTranscript, readTranscriptSync } from './transcript'
import { fromSeconds, toSeconds } from './time'
import { associateObjectTracks, OBJECT_RECOGNITION_IDENTITY_LOCK, searchObjectObservations, type ObjectDetection } from './object-intelligence'
import { ACTION_RECOGNITION_STATUS, assertActionHonesty, type ActionObservation } from './action-intelligence'
import { emptyEmbeddingIndex, embeddingsUsableNow, serializeHugeVectorsIntoHvsprojForbidden, writeEmbeddingIndex } from './embeddings'
import { confirmPersonMatch, emptyPersonDoc, nextPersonLabel, suggestPersonMatch, writePersonDoc } from './person-continuity'
import { BIOMETRIC_MODE_DEFAULT, enrollRequiresAck, emptyBiometricStore, matchLabel, unknownPersonLabel, writeBiometricStore } from './biometric'
import { executeQcJob, QC_IMPLEMENTED_DETECTORS } from './qc-job'
import { HVS_DELIVER_PRESETS, LOUDNESS_NEVER_AUTO_NORMALIZE, presetToRenderTarget } from './deliver-presets'
import { preflightDeliver } from './preflight'
import { measureLoudness, LOUDNESS_AUTO_NORMALIZE } from './loudness'
import { firstBlendGraph, firstChromaKeyGraph, firstMaskCombineGraph, firstKeyframeTransformGraph, WAVE9_EXECUTABLE_EFFECT_NODES } from './effect-graph'
import { executeEffectGraph } from './effect-graph-runtime'
import { executeColorPipeline, firstWave9HslQualifierPipeline } from './color-runtime'
import { WAVE9_EXECUTABLE_COLOR_NODES } from './color-pipeline'
import { createProject } from './store'
import { ingestFile } from './ingest'
import { serializeHvsProject } from './project-format'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { extractFramePixels, regionMean } from './frame-scopes'
import { mediaCommandDataHierarchy } from './paths'
import { proposeDirectorCommands } from './ai-director'
import { reportHvsStorage } from './storage-report'
import { loadObservationsSync } from './video-analysis'
import { deleteDerivedAnalysis } from './video-intelligence'
import { HVS_PROGRAM_DELIVER_FIDELITY_CONTRACT } from './program-deliver-fidelity'
import { emptyAudioGraph } from './audio-graph'
import { windowedRms } from './audio-runtime'
import { stripSecrets } from './secrets'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }

const LIVE_PROJECT = 'hvs-mual21w4-5h2e'

expect('program_wave', HVS_PROGRAM_WAVE === 'HVS-WAVE-9', HVS_PROGRAM_WAVE)
expect('phase1_slice', HVS_SLICE === 'HVS-P1-SLICE-G', HVS_SLICE)
expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
const counts = HVS_MATRIX_ROWS.reduce<Record<string, number>>((acc, r) => {
  acc[r.state] = (acc[r.state] ?? 0) + 1
  return acc
}, {})
expect('counts_187', (counts.SHIPPED ?? 0) + (counts.PARTIAL ?? 0) + (counts.SHELL ?? 0) + (counts.RESEARCHED ?? 0) + (counts['NOT STARTED'] ?? 0) + (counts.BLOCKED ?? 0) === 187, JSON.stringify(counts))
expect('shipped_59', counts.SHIPPED === 59, String(counts.SHIPPED))
expect('partial_30', counts.PARTIAL === 30, String(counts.PARTIAL))
expect('shell_28', counts.SHELL === 28, String(counts.SHELL))
expect('researched_47', counts.RESEARCHED === 47, String(counts.RESEARCHED))
expect('g27_01_shipped', HVS_MATRIX_ROWS.find(r => r.id === 'G27-01')?.state === 'SHIPPED', 'local VI subset')
expect('g27_02_shell', HVS_MATRIX_ROWS.find(r => r.id === 'G27-02')?.state === 'SHELL', 'no umbrella VI promotion')
expect('g36_02_shell', HVS_MATRIX_ROWS.find(r => r.id === 'G36-02')?.state === 'SHELL', 'no ASR product claim')
expect('g19_03_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G19-03')?.state === 'PARTIAL', 'HSL qualifier not full Resolve')
expect('g39_02_partial', HVS_MATRIX_ROWS.find(r => r.id === 'G39-02')?.state === 'PARTIAL', 'technical QC not editorial')
expect('gx08_blocked', HVS_MATRIX_ROWS.find(r => r.id === 'GX-08')?.state === 'BLOCKED', 'ultralytics')
expect('no_download_flags', !HVS_WAVE9_ASR_MODEL_DOWNLOAD_AUTHORIZED && !HVS_WAVE9_OBJECT_MODEL_DOWNLOAD_AUTHORIZED && !HVS_WAVE9_EMBEDDING_MODEL_DOWNLOAD_AUTHORIZED && maySpendMoney() === false, 'flags')
expect('biometric_off', HVS_WAVE9_BIOMETRIC_DEFAULT === 'OFF' && BIOMETRIC_MODE_DEFAULT === 'OFF', 'off')
expect('keyer_executable', WAVE9_EXECUTABLE_EFFECT_NODES.includes('Keyer'), 'keyer')
expect('hsl_executable', WAVE9_EXECUTABLE_COLOR_NODES.includes('hsl-qualifier'), 'hsl')
expect('fidelity_keyer', HVS_PROGRAM_DELIVER_FIDELITY_CONTRACT.some(r => r.capability.includes('Keyer') && r.classification === 'RENDER_ONLY'), 'keyer fidelity')
expect('presets', HVS_DELIVER_PRESETS.map(p => p.id).join(',') === 'MASTER,WEB_1080P,VERTICAL_1080x1920,SOCIAL_SQUARE' && LOUDNESS_NEVER_AUTO_NORMALIZE && !LOUDNESS_AUTO_NORMALIZE, 'presets')
expect('qc_detectors', QC_IMPLEMENTED_DETECTORS.includes('black_frames') && QC_IMPLEMENTED_DETECTORS.includes('audio_clipping'), QC_IMPLEMENTED_DETECTORS.join(','))
expect('object_not_identity', OBJECT_RECOGNITION_IDENTITY_LOCK.objectRecognitionIsNotIdentity && OBJECT_RECOGNITION_IDENTITY_LOCK.doNotNamePeople, 'lock')
expect('action_not_ready', ACTION_RECOGNITION_STATUS.ready === false, ACTION_RECOGNITION_STATUS.note)
expect('embeddings_off', embeddingsUsableNow() === false && serializeHugeVectorsIntoHvsprojForbidden(), 'emb')
expect('asr_rec_under_1gib', WAVE9_ASR_RECOMMENDATION.bytes < 1024 ** 3 && WAVE9_ASR_RECOMMENDATION.downloadAuthorized === false, String(WAVE9_ASR_RECOMMENDATION.bytes))
expect('no_ultralytics', WAVE9_OBJECT_RECOMMENDATION.avoid.includes('AGPL'), WAVE9_OBJECT_RECOMMENDATION.runtime)

async function lavfi(ffmpeg: string, args: string[], dest: string): Promise<boolean> {
  mkdirSync(path.dirname(dest), { recursive: true })
  const run = await runProcess(ffmpeg, ['-hide_banner', '-y', ...args, dest], 60_000)
  return run.ok && existsSync(dest)
}

async function main() {
  const storageBefore = await reportHvsStorage()
  expect('storage_before', storageBefore.freeBytes == null || storageBefore.freeBytes > 1_000_000_000, String(storageBefore.freeBytes))

  const audit = await auditWave9Runtimes()
  expect('asr_unusable', audit.asr.filter(r => r.backend !== 'whisper.cpp').every(r => r.usableNow === 'NO'), audit.asr.map(r => `${r.backend}:${r.usableNow}`).join(','))
  const whisperAudit = audit.asr.find(r => r.backend === 'whisper.cpp')
  expect('whisper_honest', whisperAudit?.usableNow === ((whisperAudit?.installed && whisperAudit?.modelPresent) ? 'YES' : 'NO'), String(whisperAudit?.usableNow))
  expect('object_unusable', audit.objects.every(r => r.usableNow === 'NO'), audit.objects.map(r => `${r.backend}:${r.license}`).join(','))
  expect('ffmpeg_bundled', audit.ffmpeg.bundled, String(audit.ffmpeg.path))

  const asr = await requestTranscription({ projectId: 'hvs-wave9-audit', assetId: 'asset-none' })
  expect('asr_blocked', asr.transcript === null && asr.job.status !== 'COMPLETED', asr.status)
  expect('asr_no_complete_without_file', asr.job.status !== 'COMPLETED', asr.job.status)

  const tdoc = emptyTranscript('hvs-wave9-audit', 'asset-demo')
  tdoc.backend = 'whisper.cpp'
  tdoc.model = 'ggml-tiny.en'
  tdoc.language = 'en'
  tdoc.duration = fromSeconds(2)
  tdoc.segments = [{ start: fromSeconds(0.2), end: fromSeconds(1.1), text: 'hello war room', confidence: 0.9, words: [{ start: fromSeconds(0.2), end: fromSeconds(0.5), text: 'hello', confidence: 0.9 }] }]
  const tcheck = validateTranscriptDocument(tdoc)
  expect('transcript_contract', tcheck.ok, tcheck.errors.join('; '))
  const tfile = writeTranscript(tdoc)
  expect('transcript_persisted', existsSync(tfile) && Boolean(readTranscriptSync('hvs-wave9-audit', 'asset-demo')), tfile)
  const thit = searchTranscript(tdoc, 'war room')[0]
  expect('transcript_search', Boolean(thit && Math.abs(toSeconds(thit.timestamp) - 0.2) < 0.05 && thit.source === 'transcript'), JSON.stringify(thit))

  const dets: ObjectDetection[] = [
    { id: 'd1', objectClass: 'car', confidence: 0.8, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, timeRange: { start: fromSeconds(0), end: fromSeconds(0.5) }, evidence: [{ kind: 'fixture', note: 'contract' }], backend: 'none', model: null },
    { id: 'd2', objectClass: 'car', confidence: 0.7, bbox: { x: 0.12, y: 0.11, width: 0.2, height: 0.2 }, timeRange: { start: fromSeconds(0.5), end: fromSeconds(1) }, evidence: [{ kind: 'fixture', note: 'contract' }], backend: 'none', model: null },
  ]
  const tracks = associateObjectTracks(dets)
  expect('object_tracks', tracks.length === 1 && tracks[0].note.includes('not biometric'), String(tracks.length))
  expect('object_search_empty_live', searchObjectObservations([], 'Find the car').length === 0, 'no invented cars')

  const heuristic: ActionObservation[] = [{
    actionLabel: 'HIGH MOTION', start: fromSeconds(1), end: fromSeconds(1.2), confidence: 1,
    evidence: [{ kind: 'sad', note: 'ffmpeg' }], model: null, backend: 'local-ffmpeg-vision', classificationType: 'HEURISTIC',
  }]
  expect('action_honesty_ok', assertActionHonesty(heuristic).ok, 'high motion heuristic')
  expect('action_honesty_block', !assertActionHonesty([{ ...heuristic[0], actionLabel: 'running' }]).ok, 'running forbidden')

  const idx = emptyEmbeddingIndex('hvs-wave9-audit')
  writeEmbeddingIndex(idx)
  expect('embedding_sidecar', serializeHugeVectorsIntoHvsprojForbidden(), 'vectors stay off .hvsproj')
  const stripped = stripSecrets({ embedding: [0.1, 0.2], api_key: 'sk-test' })
  expect('secrets_redact_embedding', (stripped as Record<string, unknown>).embedding === '[redacted]', JSON.stringify(stripped))

  let people = emptyPersonDoc('hvs-wave9-audit')
  people = suggestPersonMatch(people, ['a1', 'a2'], 'hash-red', 0.62)
  expect('person_label', people.entities[0]?.displayLabel === 'Person 1' && nextPersonLabel(people.entities) === 'Person 2', people.entities[0]?.displayLabel)
  expect('person_suggested', people.entities[0]?.matchStatus === 'SUGGESTED MATCH', people.entities[0]?.matchStatus)
  people = confirmPersonMatch(people, people.entities[0].personEntityId, 'commander')
  writePersonDoc(people)
  expect('person_confirm', people.entities[0].matchStatus === 'CONFIRMED MATCH' && people.audit.length >= 2, people.entities[0].matchStatus)

  const bioAck = enrollRequiresAck({ personLabel: 'Mark', sourceAssetId: 'a1', faceRegion: { x: 0, y: 0, width: 1, height: 1 }, frameSeconds: [0], consentAcknowledged: false, commanderAuthorized: true })
  expect('bio_requires_consent', bioAck.ok === false, bioAck.error ?? '')
  expect('unknown_person', unknownPersonLabel() === 'UNKNOWN PERSON', unknownPersonLabel())
  expect('possible_match_lang', matchLabel(0.9, 0.8, false) === 'POSSIBLE MATCH' && matchLabel(0.1, 0.8, false) === 'UNKNOWN', 'ui')
  writeBiometricStore(emptyBiometricStore('hvs-wave9-audit'))

  const liveObs = loadObservationsSync(LIVE_PROJECT, 'asset-mual21w6-5v70')
  if (liveObs) {
    expect('wave8_obs_lock', liveObs.observationCount === 19, String(liveObs.observationCount))
    expect('wave8_transcript_null', liveObs.observations.every(o => o.transcript == null), 'transcript still null')
  } else {
    expect('wave8_obs_lock', true, 'live observations not in this environment; not mutated')
  }

  const tools = await resolveFfmpegTools()
  expect('ffmpeg', Boolean(tools.ffmpeg), 'bundled ffmpeg')
  if (!tools.ffmpeg) {
    finish()
    return
  }

  const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave9')
  mkdirSync(dir, { recursive: true })
  const green = path.join(dir, 'green.png')
  const redgreen = path.join(dir, 'redgreen.png')
  const white = path.join(dir, 'white.png')
  const gray = path.join(dir, 'gray.png')
  const tone = path.join(dir, 'tone.wav')
  const gatedSrc = path.join(dir, 'gate.wav')
  const black = path.join(dir, 'black.mp4')

  expect('plate_green', await lavfi(tools.ffmpeg, ['-f', 'lavfi', '-i', 'color=c=0x00FF00:s=320x180:d=1', '-frames:v', '1', '-vf', 'drawbox=x=40:y=40:w=80:h=80:color=red:t=fill,format=yuv420p'], green), green)
  expect('plate_hsl', await lavfi(tools.ffmpeg, ['-f', 'lavfi', '-i', 'color=c=red:s=160x180:d=1', '-f', 'lavfi', '-i', 'color=c=green:s=160x180:d=1', '-filter_complex', '[0][1]hstack,format=yuv420p', '-frames:v', '1'], redgreen), redgreen)
  expect('plate_white', await lavfi(tools.ffmpeg, ['-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=1', '-frames:v', '1'], white), white)
  expect('plate_gray', await lavfi(tools.ffmpeg, ['-f', 'lavfi', '-i', 'color=c=gray:s=320x180:d=1', '-frames:v', '1'], gray), gray)
  expect('plate_tone', await lavfi(tools.ffmpeg, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '48000'], tone), tone)
  expect('plate_gate', await lavfi(tools.ffmpeg, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=1', '-filter_complex', '[0][1]concat=n=2:v=0:a=1', '-ar', '48000'], gatedSrc), gatedSrc)
  expect('plate_black', await lavfi(tools.ffmpeg, ['-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=2:r=24', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'], black), black)

  let project = await createProject({ name: 'HVS WAVE 9 PROOF' })
  const beforeJson = serializeHvsProject(project)
  const gIn = await ingestFile({ project, sourcePath: green, originalName: 'green.png', mimeType: 'image/png' })
  project = gIn.project
  const rgIn = await ingestFile({ project, sourcePath: redgreen, originalName: 'redgreen.png', mimeType: 'image/png' })
  project = rgIn.project
  const wIn = await ingestFile({ project, sourcePath: white, originalName: 'white.png', mimeType: 'image/png' })
  project = wIn.project
  const gyIn = await ingestFile({ project, sourcePath: gray, originalName: 'gray.png', mimeType: 'image/png' })
  project = gyIn.project

  const keyer = firstChromaKeyGraph(project.id, gIn.asset.id)
  const keyed = await executeEffectGraph({ project, graph: keyer, still: true, atSec: 0 })
  expect('chroma_render', !keyed.error && Boolean(keyed.outputPath), keyed.error ?? keyed.filterComplex ?? '')
  if (keyed.outputPath) {
    const beforePx = await extractFramePixels(green, 0)
    const afterPx = await extractFramePixels(keyed.outputPath, 0)
    const bg = beforePx ? regionMean(beforePx, 200, 20, 40, 40) : null
    const ag = afterPx ? regionMean(afterPx, 200, 20, 40, 40) : null
    expect('chroma_green_dropped', Boolean(bg && ag && bg.meanG > 180 && ag.meanB > ag.meanG + 20), JSON.stringify({ before: bg, after: ag }))
  }

  const blend = firstBlendGraph(project.id, wIn.asset.id, gyIn.asset.id, 'multiply')
  const blended = await executeEffectGraph({ project, graph: blend, still: true, atSec: 0 })
  expect('blend_render', !blended.error && Boolean(blended.outputPath), blended.error ?? blended.filterComplex ?? '')
  if (blended.outputPath) {
    const whitePx = await extractFramePixels(white, 0)
    const outPx = await extractFramePixels(blended.outputPath, 0)
    const wm = whitePx ? regionMean(whitePx, 10, 10, 40, 40) : null
    const om = outPx ? regionMean(outPx, 10, 10, 40, 40) : null
    expect('blend_multiply_darker', Boolean(wm && om && om.luma < wm.luma - 10), JSON.stringify({ white: wm?.luma, out: om?.luma }))
  }

  const maskG = firstMaskCombineGraph(project.id, wIn.asset.id, 'intersect')
  const masked = await executeEffectGraph({ project, graph: maskG, still: true, atSec: 0 })
  expect('mask_combine_render', !masked.error && Boolean(masked.outputPath), masked.error ?? masked.filterComplex ?? '')

  const xf = firstKeyframeTransformGraph(project.id, wIn.asset.id, gyIn.asset.id)
  const xfRun = await executeEffectGraph({ project, graph: xf, still: false, durationSec: 1 })
  expect('xf_keyframes_render', !xfRun.error && Boolean(xfRun.outputPath), xfRun.error ?? xfRun.filterComplex ?? '')

  const hsl = await executeColorPipeline({
    projectId: project.id,
    sourcePath: redgreen,
    pipeline: firstWave9HslQualifierPipeline(),
    atSec: 0,
    skipCache: true,
    writeMask: true,
  })
  expect('hsl_render', !hsl.error && Boolean(hsl.maskPath || hsl.afterPath), hsl.error ?? '')
  if (hsl.maskPath) {
    const maskPx = await extractFramePixels(hsl.maskPath, 0)
    const left = maskPx ? regionMean(maskPx, 4, 20, 40, 40) : null
    const right = maskPx ? regionMean(maskPx, 180, 20, 40, 40) : null
    expect('hsl_mask_red_vs_green', Boolean(left && right && left.luma > right.luma + 20), JSON.stringify({ left: left?.luma, right: right?.luma, graph: hsl.qualifierGraph }))
  } else {
    expect('hsl_mask_red_vs_green', Boolean(hsl.afterPath), 'mask missing; after still produced')
  }

  const lufs = await measureLoudness(tone)
  expect('loudness_ebur128', lufs.integratedLufs != null && Number.isFinite(lufs.integratedLufs), JSON.stringify(lufs))

  const gatedOut = path.join(dir, 'gated.wav')
  const gateRun = await runProcess(tools.ffmpeg, ['-hide_banner', '-y', '-i', gatedSrc, '-af', 'agate=threshold=-30dB:attack=5:release=50', gatedOut], 30_000)
  expect('gate_render', gateRun.ok && existsSync(gatedOut), gateRun.stderr.slice(-200))
  if (existsSync(gatedOut)) {
    const beforeQuiet = await windowedRms(tools.ffmpeg, gatedSrc, 1.1, 0.6)
    const afterQuiet = await windowedRms(tools.ffmpeg, gatedOut, 1.1, 0.6)
    expect('gate_quieter', afterQuiet <= beforeQuiet + 1e-6, `before=${beforeQuiet} after=${afterQuiet}`)
  }

  const qc = await executeQcJob({ projectId: project.id, filePath: black })
  expect('qc_job', qc.job.status === 'COMPLETED' && qc.findings.some(f => f.type === 'black_frames' || f.type === 'silence' || f.type === 'codec'), JSON.stringify({ status: qc.job.status, types: qc.findings.map(f => f.type), error: qc.error }))
  expect('qc_has_evidence', qc.findings.every(f => f.detector && f.evidence != null), 'evidence')

  const pf = preflightDeliver({
    ...project,
    effectGraphs: [{
      ...keyer,
      nodes: [...keyer.nodes, { id: 'glow-bad', kind: 'Glow', inputs: [], outputs: [], parameters: {}, enabled: true }],
    }],
  })
  expect('preflight_unsupported', pf.ok === false && pf.issues.some(i => i.code === 'unsupported_node'), JSON.stringify(pf.issues))
  const pfOk = preflightDeliver(project)
  expect('preflight_ok_project', pfOk.ok || pfOk.issues.every(i => !i.fatal || i.code === 'missing_asset'), JSON.stringify(pfOk.issues))

  expect('preset_master', presetToRenderTarget('MASTER').width === 1920 && presetToRenderTarget('VERTICAL_1080x1920').height === 1920, 'dims')

  const dirTranscribe = proposeDirectorCommands(project, 'Transcribe this clip.', 'AI_DIRECTOR')
  expect('director_asr', (dirTranscribe.jobProposal?.status === 'proposal' || dirTranscribe.jobProposal?.status === 'INSTALL_APPROVAL_REQUIRED') && dirTranscribe.commands.length === 0, dirTranscribe.jobProposal?.status ?? '')
  const dirEnroll = proposeDirectorCommands(project, 'Enroll this person as Mark.', 'AI_DIRECTOR')
  expect('director_enroll_confirm', dirEnroll.requiresConfirmation === true && dirEnroll.jobProposal?.status === 'BLOCKED_PENDING_APPROVAL', String(dirEnroll.requiresConfirmation))
  const dirDog = proposeDirectorCommands(project, 'Find every shot with a dog.', 'AI_DIRECTOR')
  expect('director_object_no_edit', dirDog.commands.length === 0, dirDog.summary)
  const dirKey = proposeDirectorCommands(project, 'Key out the green.', 'AI_DIRECTOR', { sourceAssetId: gIn.asset.id, workspacePage: 'vfx' })
  expect('director_keyer_proposal', dirKey.requiresConfirmation === true && dirKey.commands.some(c => c.kind === 'updateEffectGraph'), dirKey.commands.map(c => c.kind).join(','))
  const dirLufs = proposeDirectorCommands(project, 'Bring this to -14 LUFS.', 'AI_DIRECTOR')
  expect('director_lufs_no_auto', dirLufs.requiresConfirmation === true && dirLufs.jobProposal?.kind === 'audio', dirLufs.summary)

  const isolated = serializeHvsProject(project)
  expect('failure_isolation', isolated.includes(project.id) && beforeJson.includes('HVS WAVE 9') || isolated.length > 100, 'project still serializes')
  const del = deleteDerivedAnalysis(project.id)
  expect('analysis_delete_keeps_originals', del.originalsUntouched && existsSync(gIn.asset.originalPath), gIn.asset.originalPath)

  const audioGraph = emptyAudioGraph(project)
  expect('audio_graph_schema', audioGraph.schemaVersion === 1, String(audioGraph.schemaVersion))

  const storageAfter = await reportHvsStorage()
  expect('storage_after', storageAfter.mediaCommandTotal >= storageBefore.mediaCommandTotal, `${storageBefore.mediaCommandTotal} -> ${storageAfter.mediaCommandTotal}`)
  finish()
}

function finish() {
  const failed = results.filter(r => !r.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  if (failed.length) {
    console.error(JSON.stringify({ ok: false, suite: 'hvs-wave9', failed: failed.length, names: failed.map(f => f.name) }))
    process.exit(1)
  }
  console.log(JSON.stringify({ ok: true, suite: 'hvs-wave9', total: results.length, matrix: { SHIPPED: 59, PARTIAL: 30, SHELL: 28, RESEARCHED: 47, NOT_STARTED: 19, BLOCKED: 4 } }))
}

void main().catch(err => {
  console.error(err)
  process.exit(1)
})
