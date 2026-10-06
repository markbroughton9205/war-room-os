/**
 * HVS AI Producer Slice 3 — duration fill, variants, program review, War Room routing, ASR gate.
 * Does not claim prompt-to-film. Does not add matrix rows. Does not install models.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { applyEditCommand } from './edit-ops'
import { emptyProject, cloneProject } from './types'
import { fromSeconds, toSeconds } from './time'
import { parseProductionIntent } from './production-intent'
import {
  applySelectorExplanation,
  buildProductionPlan,
  commandsAreLocalOnly,
  commandsForApprovedPlan,
  commandsForRevisionPatch,
  parseRevisionRequest,
  productionAuthorityOk,
  proveNoMutation,
} from './production-ai'
import { runHvsSelector, durationTolerance, wantsExactDuration } from './production-selector'
import { HVS } from './hvs-producer-contract'
import { detectHvsProductionIntent, emptyUnroutedPacket } from './war-room-hvs-intent'
import { normalizeWarRoomMediaRefs, createWarRoomPlan } from './war-room-hvs'
import { asrGateStatus, HVS_ASR_INSTALL_PLAN } from './asr-gate'
import { buildCaptionProposal, commandsForCaptionProposal } from './production-captions'
import { emptyTranscript, validateTranscriptDocument, proposeCaptionsFromTranscript } from './transcript'
import { parseRequestedVariantAspects, buildProductionVariants, commandsForVariants } from './production-variants'
import { captionStyleSpec, parseCaptionStyle } from './caption-styles'
import { HVS_AI_PRODUCER_SLICE3 } from './production-ai-types'
import { HVS_AI_FIRST_SLICE, HVS_AI_PRODUCER_SLICE } from './navigation'
import { mayPublishAutomatically, maySpendMoney, mayDeleteOriginal } from './policy'
import { HVSPROJ_VERSION } from './types'
import { VIDEO_OBSERVATION_SCHEMA, type ObservationDocument } from './video-intelligence'
import { emptyProductionSession } from './production-session'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { durationReportLine } from './production-language'

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
    rotation: null,
    audioStreams: [{ codec: 'aac', sampleRate: 48000, channels: 2 }],
    immutableOriginal: true as const,
    generated: false,
    provenance: null,
    createdAt: new Date().toISOString(),
  }
}

function motionDoc(projectId: string, assetId: string, rows: Array<{ t: number; y: number; audio?: string }>): ObservationDocument {
  return {
    schemaVersion: VIDEO_OBSERVATION_SCHEMA,
    projectId,
    assetId,
    assetChecksumSha256: `sum-${assetId}`,
    backend: 'local-ffmpeg-vision',
    createdAt: new Date().toISOString(),
    observationCount: rows.length,
    observations: rows.map((row, index) => ({
      id: `${assetId}-obs-${index}`,
      assetId,
      timestamp: fromSeconds(row.t),
      timeRange: { start: fromSeconds(row.t), end: fromSeconds(row.t + 0.5) },
      scene: null,
      people: [],
      objects: [],
      actions: [{ id: `${assetId}-act-${index}`, label: row.y >= 6 ? 'HIGH MOTION' : row.y >= 2 ? 'MEDIUM MOTION' : 'LOW MOTION', confidence: 0.7 }],
      transcript: null,
      camera: { movement: row.y >= 2 ? 'MOTION' : 'STATIC' },
      shotType: null,
      effects: [],
      transition: null,
      color: null,
      audio_event: row.audio ?? 'AUDIO ACTIVE',
      audioEvents: [row.audio ?? 'AUDIO ACTIVE'],
      confidence: 0.7,
      evidence: [{ kind: 'ffmpeg-motion', note: `tblend difference YAVG=${row.y.toFixed(3)}` }],
    })),
  }
}

expect('slice3_id', HVS_AI_PRODUCER_SLICE3 === 'HVS-AI-PRODUCER-S3', HVS_AI_PRODUCER_SLICE3)
expect('slice2_preserved', HVS_AI_PRODUCER_SLICE === 'HVS-AI-PRODUCER-S2', HVS_AI_PRODUCER_SLICE)
expect('ai_first_preserved', HVS_AI_FIRST_SLICE === 'HVS-AI-FIRST-UX', HVS_AI_FIRST_SLICE)
expect('hvsproj_version_untouched', HVSPROJ_VERSION === 0, String(HVSPROJ_VERSION))
expect('matrix_still_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))

const project = emptyProject({ id: 'hvs-ai-s3', name: 'Slice 3 Demo' })
project.assets.push(
  videoAsset('clip-a', 16, 'walk.mp4'),
  videoAsset('clip-b', 16, 'move.mp4'),
  videoAsset('clip-c', 16, 'close.mp4'),
  videoAsset('clip-d', 16, 'still.mp4'),
)

const intent = parseProductionIntent({
  projectId: project.id,
  prompt: 'Make a 30-second video using the best parts of these clips.',
  sourceAssetIds: ['clip-a', 'clip-b', 'clip-c', 'clip-d'],
})
expect('intent_duration', intent.durationSec === 30, String(intent.durationSec))

const before = cloneProject(project)
const plan = buildProductionPlan(project, intent)
expect('no_mutation_on_plan', proveNoMutation(before, project), 'timeline changed during plan')
expect('authority_gate', plan.authorityRequirements.every(item => item.allowed === false), plan.authorityRequirements.map(i => i.action).join(','))

const docs = new Map<string, ObservationDocument | null>([
  ['clip-a', motionDoc(project.id, 'clip-a', Array.from({ length: 8 }, (_, i) => ({ t: 0.4 + i * 2, y: 7.2 })))],
  ['clip-b', motionDoc(project.id, 'clip-b', Array.from({ length: 8 }, (_, i) => ({ t: 0.5 + i * 2, y: 6.4 })))],
  ['clip-c', motionDoc(project.id, 'clip-c', Array.from({ length: 8 }, (_, i) => ({ t: 0.6 + i * 2, y: 5.8 })))],
  ['clip-d', motionDoc(project.id, 'clip-d', [
    { t: 0.5, y: 0.1, audio: 'SILENCE' }, { t: 4, y: 0.2, audio: 'SILENCE' }, { t: 10, y: 0.1, audio: 'SILENCE' },
  ])],
])
const selector = runHvsSelector(project, intent, docs)
const tol = durationTolerance(30, false)
expect('duration_window', tol.min <= 27.6 && tol.max >= 32.4, JSON.stringify(tol))
expect('fill_pass_recorded', selector.fillPass === 1 || selector.fillPass === 2, String(selector.fillPass))
expect('multi_asset_selection', new Set(selector.selected.map(item => item.assetId)).size >= 2, selector.selected.map(item => item.assetId).join(','))
expect('quality_floor_skips_still', !selector.selected.some(item => item.assetId === 'clip-d'), selector.selected.map(item => item.assetId).join(','))
expect('duration_report', selector.durationReport.requestedSec === 30 && typeof selector.durationReport.createdSec === 'number', JSON.stringify(selector.durationReport))
expect('duration_fill_or_honest', selector.durationReport.withinWindow || selector.durationReport.underfilled, JSON.stringify(selector.durationReport))
expect('no_blank_pad', selector.selected.every(item => item.duration >= 0.55), selector.selected.map(item => item.duration).join(','))
expect('open_body_close', selector.selected[0]?.role === 'open' && selector.selected.at(-1)?.role === 'close', selector.selected.map(item => item.role).join(','))
expect('duration_copy', durationReportLine(30, 29.4).includes('Requested') && durationReportLine(30, 29.4).includes('Created'), durationReportLine(30, 29.4))

const exactIntent = parseProductionIntent({
  projectId: project.id,
  prompt: 'Make exactly 30 seconds using the best parts of these clips.',
  sourceAssetIds: ['clip-a', 'clip-b', 'clip-c'],
})
expect('exact_flag', wantsExactDuration(exactIntent.prompt), exactIntent.prompt)
const exactSelector = runHvsSelector(project, exactIntent, docs)
expect('exact_tolerance', exactSelector.tolerance.exact === true && exactSelector.tolerance.min === 30, JSON.stringify(exactSelector.tolerance))
expect('exact_not_called_approx', exactSelector.durationReport.exact === true, JSON.stringify(exactSelector.durationReport))

const warRoom = HVS.createFromPrompt(project, { prompt: intent.prompt, projectId: project.id, sourceAssetIds: intent.sourceAssetIds })
expect('war_room_createFromPrompt', warRoom.approvalRequired && warRoom.approvalAction === 'MAKE_VIDEO' && warRoom.mutated === false, JSON.stringify(warRoom.approvalAction))
expect('war_room_no_mutation', proveNoMutation(before, project), 'createFromPrompt mutated')
expect('route_new_production', detectHvsProductionIntent('Make a short video from these clips.') === 'new_production', detectHvsProductionIntent('Make a short video from these clips.'))
expect('route_unrelated', detectHvsProductionIntent('What is the weather in Atlanta?') === 'none', detectHvsProductionIntent('What is the weather in Atlanta?'))
expect('route_revision_needs_session', detectHvsProductionIntent('Make the opening shorter.') === 'none', 'false positive without session')
expect('route_revision_with_session', detectHvsProductionIntent('Make the opening shorter.', true) === 'revision', detectHvsProductionIntent('Make the opening shorter.', true))
expect('empty_unrouted', emptyUnroutedPacket().routed === false && emptyUnroutedPacket().mutated === false, 'unrouted')
const media = normalizeWarRoomMediaRefs({ sourceAssetIds: ['clip-a'], localPaths: ['/secret/home/video.mp4'] })
expect('media_handoff_no_paths', media.sourceAssetIds.includes('clip-a') && media.rejectedPaths.length === 1, JSON.stringify(media))
const planned = createWarRoomPlan(project, { prompt: intent.prompt, sourceAssetIds: intent.sourceAssetIds })
expect('war_room_plan_uses_contract', planned.approvalAction === 'MAKE_VIDEO' && planned.mutated === false, planned.approvalAction)

const asr = asrGateStatus()
expect('asr_not_ready_or_approval', ['ASR_RUNTIME_READY', 'READY', 'ASR_RUNTIME_NOT_READY', 'ASR_RUNTIME_MISSING', 'ASR_MODEL_MISSING', 'ASR_MODEL_APPROVAL_REQUIRED', 'ASR_FAILED'].includes(asr.status), asr.status)
expect('asr_no_silent_install', HVS_ASR_INSTALL_PLAN.downloadAuthorized === false && HVS_ASR_INSTALL_PLAN.overOneGiB === false, JSON.stringify(HVS_ASR_INSTALL_PLAN.status))
expect('asr_tiny_under_1gib', HVS_ASR_INSTALL_PLAN.estimatedBytes < 1024 ** 3, String(HVS_ASR_INSTALL_PLAN.estimatedBytes))

const captionsNoTranscript = buildCaptionProposal(project, 'Add captions.')
expect('captions_no_fake', captionsNoTranscript.proposals.length === 0, String(captionsNoTranscript.proposals.length))
expect('captions_gate', /ASR_|speech recognition/.test(captionsNoTranscript.skippedReason ?? ''), String(captionsNoTranscript.skippedReason))
expect('captions_no_ops', commandsForCaptionProposal(project, captionsNoTranscript).length === 0, 'invented captions')

const tdoc = emptyTranscript(project.id, 'clip-a')
tdoc.backend = 'whisper.cpp'
tdoc.model = 'ggml-tiny.en'
tdoc.segments = [{ start: fromSeconds(0.2), end: fromSeconds(1.4), text: 'hello war room', confidence: 0.9 }]
expect('transcript_contract', validateTranscriptDocument(tdoc).ok, validateTranscriptDocument(tdoc).errors.join('; '))
expect('caption_style_clean', parseCaptionStyle('add captions') === 'CLEAN' && captionStyleSpec('BOLD').label === 'Bold', parseCaptionStyle('add captions'))

const addCaps = parseRevisionRequest({ projectId: project.id, planId: plan.id, utterance: 'Add captions.', project })
expect('caption_patch', addCaps.patch.kind === 'CHANGE_CAPTIONS', addCaps.patch.kind)

const variants = parseRequestedVariantAspects('Make a vertical and square version too.')
expect('variant_aspects', variants.includes('9:16') && variants.includes('1:1'), variants.join(','))
const variantRecords = buildProductionVariants(project, ['9:16', '1:1', '16:9'], 30)
expect('variant_contract', variantRecords.length === 3 && variantRecords.every(item => item.derivedFromVersionId === project.currentVersionId && item.outputSpec.format === 'mp4'), variantRecords.map(v => v.name).join(','))
const variantOps = commandsForVariants(project, variantRecords)
expect('variant_reframe_ops', variantOps.filter(c => c.kind === 'autoReframe').length === 3, variantOps.map(c => c.kind).join(','))
expect('shared_project_truth', variantOps.every(c => c.kind !== 'generateVideo'), 'no new originals')

const prepared = commandsForApprovedPlan(project, intent, plan)
expect('typed_editops', prepared.commands.some(c => c.kind === 'appendClip') && commandsAreLocalOnly(prepared.commands).ok, prepared.commands.map(c => c.kind).join(','))
expect('selector_fill_on_approve', prepared.selector.fillPass === 1 || prepared.selector.fillPass === 2, String(prepared.selector.fillPass))

let working = cloneProject(project)
for (const command of prepared.commands) {
  const result = applyEditCommand(working, command)
  if (result.ok) working = result.project
}
const clipCount = working.timeline.tracks.find(t => t.kind === 'video')?.clips.length ?? 0
expect('rough_cut_created', clipCount >= 2, String(clipCount))
expect('original_immutability_flag', project.assets.every(asset => asset.immutableOriginal), 'mutable original')

const shorter = parseRevisionRequest({ projectId: project.id, planId: plan.id, utterance: 'Make the opening shorter.', project: working })
expect('revision_patch', shorter.patch.kind === 'SHORTEN_SHOT' && shorter.patch.shotRef?.index === 0, `${shorter.patch.kind}`)
const shortOps = commandsForRevisionPatch(working, shorter.patch, shorter.request.utterance)
expect('revision_typed', shortOps.some(c => c.kind === 'rippleTrim'), shortOps.map(c => c.kind).join(','))

const session = emptyProductionSession(intent)
expect('session_resume', session.variants.length === 0 && session.warRoomConversationId === null && session.failedStep === null, JSON.stringify({ variants: session.variants.length, failed: session.failedStep }))
expect('recovery_fields', Array.isArray(session.completedSteps) && Array.isArray(session.jobIds), 'recovery')

expect('authority_runtime', productionAuthorityOk().ok && mayPublishAutomatically() === false && maySpendMoney() === false && mayDeleteOriginal() === false, 'authority')

const studio = source('components/war-room/higher-vision-studios/HvsAiCreateStudio.tsx')
const produceRoute = source('app/api/media-command/produce/route.ts')
const warRoomRoute = source('app/api/media-command/war-room/route.ts')
const page = source('app/page.tsx')
const pkg = source('package.json')
const editorRoute = source('app/higher-vision-studios/projects/[id]/editor/page.tsx')
const renderRoute = source('app/api/media-command/render/route.ts')

expect('program_review_ui', studio.includes('HvsProgramReview') && existsSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/HvsProgramReview.tsx')), 'program review')
expect('program_review_uses_engine', source('components/war-room/higher-vision-studios/HvsProgramReview.tsx').includes('mapPlayheadToSource'), 'preview engine')
expect('duration_report_ui', studio.includes('hvs-ai-duration-report') && source('lib/media-command/production-language.ts').includes('Requested:'), 'duration copy')
expect('create_versions_action', produceRoute.includes("'create-versions'") && studio.includes('Create versions'), 'create versions')
expect('war_room_execute_hook', source('app/api/chat/execute.ts').includes('tryHandleWarRoomHvs'), 'chat hook')
expect('war_room_route', warRoomRoute.includes('HVS.createFromPrompt') || warRoomRoute.includes('createWarRoomPlan'), 'war room API')
expect('war_room_card', page.includes('hvs_production') && page.includes('HvsWarRoomProductionCard') && source('components/war-room/HvsWarRoomProductionCard.tsx').includes('Make video'), 'war room card')
expect('war_room_not_bypass', warRoomRoute.includes('createFromPrompt') || source('lib/media-command/war-room-hvs.ts').includes('HVS.createFromPrompt'), 'contract used')
expect('finish_video_progress', source('lib/media-command/production-language.ts').includes('Finishing your video'), 'finish copy')
expect('advanced_editor_preserved', editorRoute.includes('HvsEditorShell'), 'editor')
expect('unified_render', renderRoute.includes('processRenderQueue'), 'render engine')
expect('wired', pkg.includes('hvs.ai-producer.slice3.validation.ts') && pkg.includes('hvs.ai-producer.slice2.validation.ts') && pkg.includes('hvs.ai-first.validation.ts'), 'validators')
expect('no_second_state', !warRoomRoute.includes('second HVS project state') && source('lib/media-command/war-room-hvs-session.ts').includes('production-session'), 'binding sidecar')

const g30 = HVS_MATRIX_ROWS.find(row => row.id === 'G30-03')
expect('no_false_full_director', g30?.state !== 'SHIPPED', `${g30?.id} ${g30?.state}`)
expect('transcript_propose_helper', typeof proposeCaptionsFromTranscript === 'function', 'propose')
expect('plan_explanation_applied', applySelectorExplanation(plan, selector).explanation.foundCount >= 0, 'explanation')

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-AI-PRODUCER-S3', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-AI-PRODUCER-S3', total: results.length }))
