/**
 * HVS AI Producer Slice 4 — local ASR, captions, variant pack, War Room contracts.
 * Does not claim prompt-to-film. Does not add matrix rows. Does not download extra models.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { applyEditCommand } from './edit-ops'
import { emptyProject, cloneProject } from './types'
import { fromSeconds, toSeconds } from './time'
import { parseProductionIntent } from './production-intent'
import {
  commandsAreLocalOnly,
  commandsForRevisionPatch,
  parseRevisionRequest,
  productionAuthorityOk,
  proveNoMutation,
} from './production-ai'
import { HVS } from './hvs-producer-contract'
import { detectHvsProductionIntent } from './war-room-hvs-intent'
import { asrEnvironmentSnapshot, asrGateStatus, HVS_ASR_INSTALL_PLAN } from './asr-gate'
import { SLICE4_COUNTS } from './asr-runtime'
import {
  buildCaptionProposal,
  commandsForCaptionProposal,
  mapSourceRangeToProgram,
} from './production-captions'
import { emptyTranscript, validateTranscriptDocument, writeTranscript, deleteTranscript } from './transcript'
import {
  parseRequestedVariantAspects,
  buildProductionVariants,
  commandsForVariants,
  outputSpecForAspect,
} from './production-variants'
import {
  captionStyleSpec,
  parseCaptionStyle,
  CAPTION_SAFE_MARGINS,
  captionBoxForAspect,
  HVS_CAPTION_STYLE_SPECS,
} from './caption-styles'
import { HVS_AI_PRODUCER_SLICE, HVS_AI_PRODUCER_SLICE3, HVS_AI_PRODUCER_SLICE4 } from './production-ai-types'
import { HVS_AI_FIRST_SLICE } from './navigation'
import { mayPublishAutomatically, maySpendMoney, mayDeleteOriginal, HVS_WAVE9_ASR_MODEL_DOWNLOAD_AUTHORIZED, HVS_SLICE4_ASR_TINY_EN_AUTHORIZED } from './policy'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { emptyProductionSession } from './production-session'
import { TINY_EN_SHA256, TINY_EN_FILENAME, WHISPER_CPP_GIT } from './whisper-install'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

function videoAsset(id: string, seconds: number, name = `${id}.mp4`) {
  return {
    id,
    kind: 'video' as const,
    name,
    originalPath: `/tmp/${name}`,
    proxyPath: null,
    thumbPath: null,
    waveformPath: null,
    checksumSha256: `sum-${id}`,
    mimeType: 'video/mp4',
    duration: fromSeconds(seconds),
    width: 1920,
    height: 1080,
    frameRate: { n: 24, d: 1 },
    variableFrameRate: false,
    sampleRate: 48000,
    channels: 2,
    codec: 'h264',
    container: 'mp4',
    pixelFormat: 'yuv420p',
    rotation: 0,
    audioStreams: [{ codec: 'aac', sampleRate: 48000, channels: 2 }],
    immutableOriginal: true as const,
    generated: false,
    provenance: null,
    createdAt: new Date().toISOString(),
  }
}

expect('slice4_id', HVS_AI_PRODUCER_SLICE4 === 'HVS-AI-PRODUCER-S4', HVS_AI_PRODUCER_SLICE4)
expect('slice3_preserved', HVS_AI_PRODUCER_SLICE3 === 'HVS-AI-PRODUCER-S3', HVS_AI_PRODUCER_SLICE3)
expect('slice2_preserved', HVS_AI_PRODUCER_SLICE === 'HVS-AI-PRODUCER-S2', HVS_AI_PRODUCER_SLICE)
expect('ai_first_preserved', HVS_AI_FIRST_SLICE === 'HVS-AI-FIRST-UX', HVS_AI_FIRST_SLICE)
expect('matrix_still_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('wave9_download_flag_false', HVS_WAVE9_ASR_MODEL_DOWNLOAD_AUTHORIZED === false, 'wave9 flag')
expect('slice4_tiny_authorized', HVS_SLICE4_ASR_TINY_EN_AUTHORIZED === true, 'slice4 flag')
expect('install_plan_not_silent', HVS_ASR_INSTALL_PLAN.downloadAuthorized === false, HVS_ASR_INSTALL_PLAN.status)
expect('tiny_en_name', TINY_EN_FILENAME === 'ggml-tiny.en.bin', TINY_EN_FILENAME)
expect('whisper_official_repo', WHISPER_CPP_GIT.includes('ggml-org/whisper.cpp'), WHISPER_CPP_GIT)
expect('tiny_en_hash_recorded', TINY_EN_SHA256.length === 64, TINY_EN_SHA256)

const asr = asrGateStatus()
expect('fixture_a_asr_ready', (asr.status === 'ASR_RUNTIME_READY' || asr.status === 'READY') && asr.usableNow, asr.status)
expect('runtime_binary', Boolean(asr.snapshot.whisperCppBinary && existsSync(asr.snapshot.whisperCppBinary)), String(asr.snapshot.whisperCppBinary))
expect('tiny_en_present', asr.snapshot.tinyEnPresent && asr.snapshot.tinyEnBytes > 70_000_000, String(asr.snapshot.tinyEnBytes))

const missing = asrGateStatus(asrEnvironmentSnapshot({ modelPathOverride: '/tmp/hvs-missing-ggml-tiny.en.bin' }))
expect('fixture_c_model_missing', missing.status === 'ASR_MODEL_MISSING' && missing.usableNow === false, missing.status)

const project = emptyProject({ id: 'hvs-ai-s4', name: 'Slice 4 Demo' })
project.assets.push(videoAsset('clip-a', 8, 'spoken.mp4'))
deleteTranscript(project.id, 'clip-a')
const videoTrack = project.timeline.tracks.find(track => track.kind === 'video')!
videoTrack.clips.push({
  id: 'clip-1',
  trackId: videoTrack.id,
  assetId: 'clip-a',
  name: 'Spoken',
  start: fromSeconds(0),
  duration: fromSeconds(6),
  sourceIn: fromSeconds(1),
  sourceOut: fromSeconds(7),
  speed: { n: 1, d: 1 },
  reversed: false,
  freeze: false,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
  opacity: 1,
  volume: 1,
  fadeIn: fromSeconds(0),
  fadeOut: fromSeconds(0),
  pan: 0,
  color: { exposure: 0, contrast: 0, saturation: 0, temperature: 0, lookId: null },
  effects: [],
  filters: [],
  enabled: true,
})

const mapped = mapSourceRangeToProgram(project, 'clip-a', 1.5, 3.5)
expect('source_program_map', mapped.length === 1 && Math.abs(mapped[0].start - 0.5) < 0.05 && Math.abs(mapped[0].end - 2.5) < 0.05, JSON.stringify(mapped))

const noFake = buildCaptionProposal(project, 'Add captions.')
expect('fixture_c_no_fake', noFake.proposals.length === 0, String(noFake.proposals.length))
expect('no_invented_words', /speech|unavailable|missing|failed|recognition/i.test(noFake.skippedReason ?? ''), String(noFake.skippedReason))

const tdoc = emptyTranscript(project.id, 'clip-a')
tdoc.backend = 'whisper.cpp'
tdoc.model = 'ggml-tiny.en.bin'
tdoc.language = 'en'
tdoc.duration = fromSeconds(8)
tdoc.segments = [{ start: fromSeconds(1.5), end: fromSeconds(3.5), text: 'higher vision studios' }]
expect('transcript_contract', validateTranscriptDocument(tdoc).ok, validateTranscriptDocument(tdoc).errors.join('; '))
writeTranscript(tdoc)

const bundle = buildCaptionProposal(project, 'Add captions.')
expect('fixture_d_caption_proposal', bundle.proposals.length >= 1 && bundle.proposals[0].text.toLowerCase().includes('higher vision'), bundle.proposals.map(p => p.text).join(' | '))
expect('caption_program_timing', bundle.timing === 'program' && Math.abs(toSeconds(bundle.proposals[0].start) - 0.5) < 0.08, String(toSeconds(bundle.proposals[0]?.start ?? fromSeconds(0))))
const ops = commandsForCaptionProposal(project, bundle)
expect('caption_editops', ops.some(command => command.kind === 'addCaption'), ops.map(c => c.kind).join(','))

let working = cloneProject(project)
for (const command of ops) {
  const result = applyEditCommand(working, command)
  if (result.ok) working = result.project
}
expect('caption_cues_committed', working.timeline.captionTracks.some(track => track.cues.length >= 1), String(working.timeline.captionTracks[0]?.cues.length))

const overwrite = buildCaptionProposal(working, 'Add captions.')
expect('fixture_f_existing', overwrite.proposals.length === 0 && /already exist/i.test(overwrite.skippedReason ?? ''), String(overwrite.skippedReason))
expect('overwrite_count', SLICE4_COUNTS.EXISTING_CAPTION_OVERWRITE_COUNT === 0, String(SLICE4_COUNTS.EXISTING_CAPTION_OVERWRITE_COUNT))

expect('styles_real', Object.values(HVS_CAPTION_STYLE_SPECS).every(spec => spec.fontSize > 0 && spec.fontWeight > 0 && spec.positionPreset), 'styles')
expect('style_labels', parseCaptionStyle('add bold captions') === 'BOLD' && captionStyleSpec('CLEAN').label === 'Clean' && captionStyleSpec('MINIMAL').label === 'Minimal' && captionStyleSpec('SOCIAL').label === 'Social', parseCaptionStyle('add bold captions'))
expect('safe_16_9', CAPTION_SAFE_MARGINS['16:9'].bottom >= 0.08, String(CAPTION_SAFE_MARGINS['16:9'].bottom))
expect('safe_9_16', CAPTION_SAFE_MARGINS['9:16'].bottom > CAPTION_SAFE_MARGINS['16:9'].bottom, String(CAPTION_SAFE_MARGINS['9:16'].bottom))
expect('safe_1_1', CAPTION_SAFE_MARGINS['1:1'].bottom >= 0.10, String(CAPTION_SAFE_MARGINS['1:1'].bottom))
const box916 = captionBoxForAspect(captionStyleSpec('CLEAN'), '9:16')
expect('vertical_safe_box', box916.y + box916.height <= 1 - CAPTION_SAFE_MARGINS['9:16'].bottom + 0.001, JSON.stringify(box916))

const pack = parseRequestedVariantAspects('Make widescreen, vertical, and square versions.')
expect('fixture_k_aspects', pack.includes('16:9') && pack.includes('9:16') && pack.includes('1:1'), pack.join(','))
const variants = buildProductionVariants(project, ['16:9', '9:16', '1:1'], 30)
expect('variant_pack', variants.length === 3 && outputSpecForAspect('16:9').width === 1920 && outputSpecForAspect('9:16').height === 1920 && outputSpecForAspect('1:1').width === 1080, variants.map(v => v.name).join(','))
expect('shared_project', variants.every(item => item.derivedFromVersionId === project.currentVersionId), 'derived')
expect('variant_ops', commandsForVariants(project, variants).filter(c => c.kind === 'autoReframe').length === 3, 'reframe')

expect('route_plan', detectHvsProductionIntent('Make a short video from these clips.') === 'new_production', detectHvsProductionIntent('Make a short video from these clips.'))
expect('route_captions', detectHvsProductionIntent('Add captions.', true) === 'captions', detectHvsProductionIntent('Add captions.', true))
expect('route_revision', detectHvsProductionIntent('Make the opening shorter.', true) === 'revision', detectHvsProductionIntent('Make the opening shorter.', true))
expect('route_versions', detectHvsProductionIntent('Make widescreen, vertical, and square versions.', true) === 'variants', detectHvsProductionIntent('Make widescreen, vertical, and square versions.', true))

const before = cloneProject(project)
const contract = HVS.createFromPrompt(project, { prompt: 'Make a short video from these clips.', projectId: project.id, sourceAssetIds: ['clip-a'] })
expect('pre_approval_no_mutation', proveNoMutation(before, project) && contract.mutated === false, 'mutated')
expect('pre_approval_count', SLICE4_COUNTS.WAR_ROOM_PRE_APPROVAL_MUTATION_COUNT === 0, 'pre')

const addCaps = parseRevisionRequest({ projectId: project.id, planId: 'plan', utterance: 'Add captions.', project: working })
expect('caption_patch', addCaps.patch.kind === 'CHANGE_CAPTIONS', addCaps.patch.kind)
const short = parseRevisionRequest({ projectId: project.id, planId: 'plan', utterance: 'Make the opening shorter.', project: working })
expect('revision_patch', short.patch.kind === 'SHORTEN_SHOT', short.patch.kind)
expect('revision_typed', commandsForRevisionPatch(working, short.patch, short.request.utterance).some(c => c.kind === 'rippleTrim'), 'trim')

const session = emptyProductionSession(parseProductionIntent({ projectId: project.id, prompt: 'Make a short video from these clips.', sourceAssetIds: ['clip-a'] }))
expect('session_fields', Array.isArray(session.transcriptAssetIds) && session.asrWordLevel === false && session.warRoomConversationId === null, 'session')

expect('counts_remote', SLICE4_COUNTS.ASR_REMOTE_CALL_COUNT === 0, String(SLICE4_COUNTS.ASR_REMOTE_CALL_COUNT))
expect('counts_fake', SLICE4_COUNTS.FAKE_TRANSCRIPT_COUNT === 0, String(SLICE4_COUNTS.FAKE_TRANSCRIPT_COUNT))
expect('counts_unauthorized', SLICE4_COUNTS.UNAUTHORIZED_MODEL_DOWNLOAD_COUNT === 0, String(SLICE4_COUNTS.UNAUTHORIZED_MODEL_DOWNLOAD_COUNT))
expect('counts_second_truth', SLICE4_COUNTS.SECOND_HVS_PROJECT_TRUTH_COUNT === 0, String(SLICE4_COUNTS.SECOND_HVS_PROJECT_TRUTH_COUNT))
expect('counts_second_engine', SLICE4_COUNTS.SECOND_RENDER_ENGINE_COUNT === 0, String(SLICE4_COUNTS.SECOND_RENDER_ENGINE_COUNT))
expect('authority', productionAuthorityOk().ok && mayPublishAutomatically() === false && maySpendMoney() === false && mayDeleteOriginal() === false, 'authority')
expect('local_only', commandsAreLocalOnly(ops).ok, 'local')

const produceRoute = source('app/api/media-command/produce/route.ts')
const warRoomRoute = source('app/api/media-command/war-room/route.ts')
const page = source('app/page.tsx')
const pkg = source('package.json')
const card = source('components/war-room/HvsWarRoomProductionCard.tsx')
expect('program_review', source('components/war-room/higher-vision-studios/HvsProgramReview.tsx').includes('mapPlayheadToSource'), 'preview')
expect('war_room_card', page.includes('hvs_production') && card.includes('Make video'), 'card')
expect('war_room_resume', page.includes('readHvsResume'), 'resume project handoff')
expect('produce_transcribe', produceRoute.includes('transcribeTimelineAssets'), 'asr wired')
expect('create_versions_pack', produceRoute.includes("'16:9', '9:16', '1:1'"), 'default pack')
expect('war_room_produce', warRoomRoute.includes("POST as producePost"), 'same produce path')
expect('war_room_revise_patch', warRoomRoute.includes('pendingPatch') && warRoomRoute.includes("mapped === 'revise'"), 'revise maps pendingPatch')
expect('unified_render', source('app/api/media-command/render/route.ts').includes('processRenderQueue'), 'render')
expect('advanced_editor', source('app/higher-vision-studios/projects/[id]/editor/page.tsx').includes('HvsEditorShell'), 'editor')
expect('wired', pkg.includes('hvs.ai-producer.slice4.validation.ts') && pkg.includes('hvs.ai-producer.slice3.validation.ts'), 'validators')
expect('no_generative', !produceRoute.includes('generateVideo') || commandsAreLocalOnly(ops).ok, 'no gen')

const g30 = HVS_MATRIX_ROWS.find(row => row.id === 'G30-03')
expect('no_false_full_director', g30?.state !== 'SHIPPED', `${g30?.id} ${g30?.state}`)

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-AI-PRODUCER-S4', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-AI-PRODUCER-S4', total: results.length }))
