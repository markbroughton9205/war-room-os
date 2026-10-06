/**
 * HVS local ASR + captions contract. Does not claim full G36 transcription product.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { asrGateStatus, whisperBinaryPath, whisperModelPath } from './asr-gate'
import { syncWhisperModelCatalog, loadWhisperCatalog, TINY_EN_SHA256, TINY_EN_BYTES, TINY_EN_URL } from './asr-catalog'
import { HvsAsrAdapter, ASR_COMMANDER_ERRORS, ASR_COMMANDER_OPTIONS } from './asr-adapter'
import { emptyTranscript, validateTranscriptDocument, searchTranscript, proposeCaptionsFromTranscript, writeTranscript, deleteTranscript } from './transcript'
import { fromSeconds, toSeconds } from './time'
import { buildAsrCacheKey, ASR_CACHE_CONFIG } from './asr-runtime'
import { asrCompletedOnlyWithFile, requestTranscription } from './asr'
import { createHvsJob } from './jobs'
import { buildCaptionProposal, commandsForCaptionProposal, existingCaptionCount } from './production-captions'
import { parseCaptionStyle, captionStyleSpec, HVS_CAPTION_STYLE_SPECS } from './caption-styles'
import { detectHvsProductionIntent } from './war-room-hvs-intent'
import { packetFromRevision } from './war-room-hvs'
import { parseRevisionRequest } from './production-patches'
import { emptyProject } from './types'
import { HVS_WAVE9_ASR_MODEL_DOWNLOAD_AUTHORIZED, HVS_SLICE4_ASR_TINY_EN_AUTHORIZED } from './policy'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { WHISPER_CPP_LICENSE } from './whisper-install'
import { proposeDirectorCommands } from './ai-director'
import { emptyProductionSession } from './production-session'
import { parseProductionIntent } from './production-intent'
import { buildProductionPlan } from './production-ai'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) { results.push({ name, pass, detail }) }
function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const gate = asrGateStatus()
expect('runtime_resolution', Boolean(whisperBinaryPath()) && existsSync(whisperBinaryPath() ?? ''), String(whisperBinaryPath()))
expect('model_present', existsSync(whisperModelPath()), whisperModelPath())
expect('gate_ready', gate.usableNow && (gate.status === 'READY' || gate.status === 'ASR_RUNTIME_READY'), gate.status)
expect('no_wave9_silent_download', HVS_WAVE9_ASR_MODEL_DOWNLOAD_AUTHORIZED === false, String(HVS_WAVE9_ASR_MODEL_DOWNLOAD_AUTHORIZED))
expect('tiny_en_authorized', HVS_SLICE4_ASR_TINY_EN_AUTHORIZED === true, String(HVS_SLICE4_ASR_TINY_EN_AUTHORIZED))
expect('runtime_license_mit', WHISPER_CPP_LICENSE === 'MIT', WHISPER_CPP_LICENSE)
expect('model_source', TINY_EN_URL.includes('huggingface.co/ggerganov/whisper.cpp') && TINY_EN_URL.endsWith('ggml-tiny.en.bin'), TINY_EN_URL)

const bytes = existsSync(whisperModelPath()) ? statSync(whisperModelPath()).size : 0
const hash = existsSync(whisperModelPath())
  ? createHash('sha256').update(readFileSync(whisperModelPath())).digest('hex')
  : ''
expect('model_bytes', bytes === TINY_EN_BYTES, `${bytes} vs ${TINY_EN_BYTES}`)
expect('model_hash', hash === TINY_EN_SHA256, hash)

const catalog = syncWhisperModelCatalog()
expect('catalog_installed', catalog.status === 'INSTALLED' && catalog.backend === 'whisper.cpp', catalog.status)
expect('catalog_truth', catalog.hash === TINY_EN_SHA256 && catalog.bytes === TINY_EN_BYTES && Boolean(catalog.localPath), JSON.stringify({ hash: catalog.hash, bytes: catalog.bytes }))
expect('catalog_file', Boolean(loadWhisperCatalog()?.models[0]?.id === 'whisper-ggml-tiny-en'), loadWhisperCatalog()?.models[0]?.id ?? 'missing')

const tdoc = emptyTranscript('hvs-asr-local', 'asset-a')
tdoc.backend = 'whisper.cpp'
tdoc.model = 'ggml-tiny.en.bin'
tdoc.language = 'en'
tdoc.duration = fromSeconds(4)
tdoc.cacheKey = buildAsrCacheKey('fingerprint-a', 'en')
tdoc.segments = [{
  start: fromSeconds(0.32),
  end: fromSeconds(2.1),
  text: 'And so my fellow Americans',
  words: [
    { start: fromSeconds(0.32), end: fromSeconds(0.5), text: 'And' },
    { start: fromSeconds(1.4), end: fromSeconds(2.0), text: 'Americans' },
  ],
}]
expect('transcript_contract', validateTranscriptDocument(tdoc).ok, validateTranscriptDocument(tdoc).errors.join('; '))
const american = searchTranscript(tdoc, 'Americans')[0]
expect('speech_search_word', Boolean(american && Math.abs(toSeconds(american.timestamp) - 1.4) < 0.05), JSON.stringify(american))
expect('timestamps_segment', toSeconds(tdoc.segments[0].start) < toSeconds(tdoc.segments[0].end), 'start<end')
expect('cache_key_changes', buildAsrCacheKey('fp1', 'en') !== buildAsrCacheKey('fp2', 'en') && buildAsrCacheKey('fp1', 'en') !== buildAsrCacheKey('fp1', 'es'), ASR_CACHE_CONFIG)

const missing = await requestTranscription({ projectId: 'hvs-asr-missing', assetId: 'no-asset' })
expect('job_not_completed_without_file', missing.job.status !== 'COMPLETED' && missing.transcript === null, missing.job.status)
expect('completed_requires_file', asrCompletedOnlyWithFile(missing.job, null), missing.job.status)
const queued = createHvsJob({ kind: 'analysis', projectId: 'hvs-asr-local', backend: 'whisper.cpp', status: 'QUEUED' })
expect('job_lifecycle_states', ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(queued.status), queued.status)

const project = emptyProject({ id: 'hvs-asr-local', name: 'ASR contract' })
project.assets.push({
  id: 'asset-a',
  kind: 'video',
  name: 'spoken.mp4',
  originalPath: '/tmp/spoken.mp4',
  proxyPath: null,
  thumbPath: null,
  waveformPath: null,
  checksumSha256: 'fingerprint-a',
  mimeType: 'video/mp4',
  duration: fromSeconds(4),
  width: 1920,
  height: 1080,
  frameRate: { n: 24, d: 1 },
  variableFrameRate: false,
  sampleRate: 16000,
  channels: 1,
  codec: 'h264',
  container: 'mp4',
  pixelFormat: 'yuv420p',
  rotation: null,
  audioStreams: [{ codec: 'aac', sampleRate: 16000, channels: 1 }],
  immutableOriginal: true,
  generated: false,
  provenance: null,
  createdAt: new Date().toISOString(),
})
deleteTranscript(project.id, 'asset-a')
const noCaps = buildCaptionProposal(project, 'Add captions.')
expect('captions_no_fake_without_transcript', noCaps.proposals.length === 0, String(noCaps.proposals.length))
expect('captions_gate_copy', /speech recognition|ASR_/.test(noCaps.skippedReason ?? ''), String(noCaps.skippedReason))

writeTranscript(tdoc)
const yesCaps = buildCaptionProposal(project, 'Add captions. Use BOLD captions.')
expect('caption_style', parseCaptionStyle('Add captions. Use BOLD captions.') === 'BOLD' && Boolean(HVS_CAPTION_STYLE_SPECS.CLEAN && HVS_CAPTION_STYLE_SPECS.MINIMAL && HVS_CAPTION_STYLE_SPECS.SOCIAL), parseCaptionStyle('Add captions. Use BOLD captions.'))
expect('caption_proposal', yesCaps.proposals.length >= 1 && yesCaps.style === 'BOLD', String(yesCaps.proposals.length))
const ops = commandsForCaptionProposal(project, yesCaps)
expect('caption_ops', ops.length >= 1 && ops.every(op => op.kind === 'addCaption'), ops.map(op => op.kind).join(','))
expect('approval_gate', source('app/api/media-command/produce/route.ts').includes("action === 'apply-revision'") && source('components/war-room/higher-vision-studios/HvsAiCreateStudio.tsx').includes('hvs-ai-apply-revision'), 'approval UI')
expect('war_room_captions', detectHvsProductionIntent('Add captions.', true) === 'captions', detectHvsProductionIntent('Add captions.', true))
expect('war_room_speech_search', detectHvsProductionIntent('Find where I say Americans.', true) === 'revision', detectHvsProductionIntent('Find where I say Americans.', true))
const intent = parseProductionIntent({ projectId: project.id, prompt: 'Make a short video from this clip. Add captions.', sourceAssetIds: ['asset-a'] })
const session = emptyProductionSession(intent)
session.plan = buildProductionPlan(project, intent)
const speechPacket = packetFromRevision(project, session, 'Find where I say Americans.', null)
expect('war_room_search_hits', speechPacket.approvalRequired === false && speechPacket.summaryLines.some(line => /Americans/i.test(line)), speechPacket.summaryLines.join(' | '))
const addCaps = parseRevisionRequest({ projectId: project.id, planId: 'plan', utterance: 'Add captions.', project })
expect('caption_patch', addCaps.patch.kind === 'CHANGE_CAPTIONS', addCaps.patch.kind)
expect('styles_commander', captionStyleSpec('CLEAN').label === 'Clean' && captionStyleSpec('SOCIAL').position === 'center', captionStyleSpec('SOCIAL').position)
expect('failure_copy', ASR_COMMANDER_ERRORS.failed.includes("couldn't transcribe") && ASR_COMMANDER_ERRORS.unclear.includes('unclear'), ASR_COMMANDER_ERRORS.failed)
expect('failure_options', ASR_COMMANDER_OPTIONS.join(',') === 'TRY AGAIN,SKIP CAPTIONS,ADVANCED DETAILS', ASR_COMMANDER_OPTIONS.join(','))
expect('failure_ui', source('components/war-room/higher-vision-studios/HvsAiCreateStudio.tsx').includes('TRY AGAIN') && source('components/war-room/higher-vision-studios/HvsAiCreateStudio.tsx').includes('ADVANCED DETAILS'), 'ui')
expect('transcript_ui', source('components/war-room/higher-vision-studios/HvsProgramReview.tsx').includes('hvs-transcript-line') && source('components/war-room/higher-vision-studios/HvsLaneWorkspaces.tsx').includes('hvs-transcript-line'), 'transcript click')
expect('program_review_captions', source('components/war-room/higher-vision-studios/HvsProgramReview.tsx').includes('hvs-program-caption'), 'overlay')
expect('adapter_exists', typeof new HvsAsrAdapter().transcribe === 'function', 'adapter')
expect('director_transcribe_proposal', proposeDirectorCommands(project, 'Transcribe this clip.', 'AI_DIRECTOR').jobProposal?.status === 'proposal' || proposeDirectorCommands(project, 'Transcribe this clip.', 'AI_DIRECTOR').jobProposal?.status === 'INSTALL_APPROVAL_REQUIRED', 'director')
expect('original_immutability', project.assets.every(asset => asset.immutableOriginal), 'mutable original')
expect('existing_captions_guard', existingCaptionCount(project) === 0, String(existingCaptionCount(project)))
expect('propose_helper', proposeCaptionsFromTranscript(tdoc).length === 1, String(proposeCaptionsFromTranscript(tdoc).length))
expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('g36_02_not_promoted', HVS_MATRIX_ROWS.find(row => row.id === 'G36-02')?.state === 'SHELL', HVS_MATRIX_ROWS.find(row => row.id === 'G36-02')?.state ?? 'missing')
expect('no_cloud_asr', !source('lib/media-command/asr-runtime.ts').includes('openai.com') && !source('lib/media-command/asr-adapter.ts').includes('https://api.'), 'cloud')
const pkg = source('package.json')
expect('wired', pkg.includes('hvs.asr.local.validation.ts') && pkg.includes('hvs.asr.local.live.ts'), 'package')

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-ASR-LOCAL', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-ASR-LOCAL', total: results.length }))
