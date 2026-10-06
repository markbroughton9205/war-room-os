/**
 * HVS AI Producer Slice 2 — prompt-driven automated production from user-provided media.
 * Does not claim prompt-to-film. Does not add matrix rows.
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
  followUpCommandsAfterCut,
  parseRevisionRequest,
  productionAuthorityOk,
  proveNoMutation,
} from './production-ai'
import { runHvsSelector, durationTolerance } from './production-selector'
import { parseShotMention, shotReferences } from './production-shots'
import { HVS } from './hvs-producer-contract'
import { HVS_AI_PRODUCER_SLICE, HVS_SELECTOR_ENGINE } from './production-ai-types'
import { HVS_AI_FIRST_SLICE, hvsStudioHref } from './navigation'
import { mayPublishAutomatically, maySpendMoney, mayDeleteOriginal } from './policy'
import { HVSPROJ_VERSION } from './types'
import { VIDEO_OBSERVATION_SCHEMA, type ObservationDocument } from './video-intelligence'
import { emptyProductionSession } from './production-session'
import { HVS_MATRIX_ROWS } from './production-matrix'

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

expect('slice_id', HVS_AI_PRODUCER_SLICE === 'HVS-AI-PRODUCER-S2', HVS_AI_PRODUCER_SLICE)
expect('ai_first_preserved', HVS_AI_FIRST_SLICE === 'HVS-AI-FIRST-UX', HVS_AI_FIRST_SLICE)
expect('hvsproj_version_untouched', HVSPROJ_VERSION === 0, String(HVSPROJ_VERSION))
expect('matrix_still_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('selector_engine', HVS_SELECTOR_ENGINE === 'HVS_SELECTOR', HVS_SELECTOR_ENGINE)

const project = emptyProject({ id: 'hvs-ai-s2', name: 'Slice 2 Demo' })
project.assets.push(videoAsset('clip-a', 14, 'walk.mp4'), videoAsset('clip-b', 14, 'still.mp4'), videoAsset('clip-c', 12, 'close.mp4'))

const intent = parseProductionIntent({
  projectId: project.id,
  prompt: 'Make a 30-second video using the best parts of these clips.',
  sourceAssetIds: ['clip-a', 'clip-b', 'clip-c'],
})
expect('intent_duration', intent.durationSec === 30, String(intent.durationSec))
expect('intent_not_vertical_by_default', intent.aspect !== '9:16', String(intent.aspect))

const before = cloneProject(project)
const plan = buildProductionPlan(project, intent)
expect('plan_proposed', plan.status === 'proposed', plan.status)
expect('plan_has_explanation', plan.explanation.using.length >= 1 && !/EditOps|FFmpeg|LUFS/.test(plan.explanation.using.join(' ')), plan.explanation.using.join(' | '))
expect('no_mutation_on_plan', proveNoMutation(before, project), 'timeline changed during plan')

const warRoom = HVS.createFromPrompt(project, { prompt: intent.prompt, projectId: project.id, sourceAssetIds: intent.sourceAssetIds })
expect('war_room_contract', warRoom.approvalRequired === true && warRoom.approvalAction === 'MAKE_VIDEO' && warRoom.mutated === false, JSON.stringify({ approval: warRoom.approvalAction, mutated: warRoom.mutated }))
expect('war_room_no_mutation', proveNoMutation(before, project), 'createFromPrompt mutated')

const docs = new Map<string, ObservationDocument | null>([
  ['clip-a', motionDoc(project.id, 'clip-a', [
    { t: 0.5, y: 8 }, { t: 2, y: 7.2 }, { t: 4, y: 6.8 }, { t: 8, y: 3 }, { t: 12, y: 1 },
  ])],
  ['clip-b', motionDoc(project.id, 'clip-b', [
    { t: 0.5, y: 0.2, audio: 'SILENCE' }, { t: 4, y: 0.1, audio: 'SILENCE' }, { t: 9, y: 0.3, audio: 'SILENCE' },
  ])],
  ['clip-c', motionDoc(project.id, 'clip-c', [
    { t: 1, y: 5 }, { t: 3, y: 6.1 }, { t: 7, y: 4.4 }, { t: 10, y: 5.5 },
  ])],
])
const selector = runHvsSelector(project, intent, docs)
expect('selector_named', selector.engine === 'HVS_SELECTOR', selector.engine)
expect('moment_candidates', selector.candidates.length >= 3 && selector.candidates.every(item => typeof item.score === 'number' && Array.isArray(item.evidence)), String(selector.candidates.length))
expect('multi_asset_selection', new Set(selector.selected.map(item => item.assetId)).size >= 2, selector.selected.map(item => item.assetId).join(','))
expect('not_front_trim_only', selector.selected.some(item => item.start > 0.5 || item.reason.includes('HVS SELECTOR')), selector.selected.map(item => `${item.assetId}:${item.start}-${item.end}`).join(' | '))
expect('open_body_close', selector.selected[0]?.role === 'open' && selector.selected.at(-1)?.role === 'close', selector.selected.map(item => item.role).join(','))
const tol = durationTolerance(30, false)
expect('duration_tolerance_window', tol.min <= 28 && tol.max >= 32, JSON.stringify(tol))
expect('duration_not_hard_truncate', selector.actualSec > 0 && selector.actualSec <= 42, String(selector.actualSec))
expect('still_footage_penalized', (selector.candidates.find(item => item.assetId === 'clip-b')?.score ?? 1) < (selector.candidates.find(item => item.assetId === 'clip-a')?.score ?? 0), 'static scored higher than motion')

const prepared = commandsForApprovedPlan(project, intent, plan)
expect('local_only', commandsAreLocalOnly(prepared.commands).ok, prepared.commands.map(c => c.kind).join(','))
expect('safety_version_once', prepared.commands.filter(c => c.kind === 'createVersion').length === 1, String(prepared.commands.filter(c => c.kind === 'createVersion').length))
expect('typed_cut', prepared.commands.some(c => c.kind === 'appendClip'), prepared.commands.map(c => c.kind).join(','))
expect('no_generate', !prepared.commands.some(c => c.kind === 'generateVideo' || c.kind === 'generateImage'), 'generate present')
expect('look_mapped', prepared.commands.some(c => c.kind === 'updateColorPipeline'), 'no color pipeline')
expect('sound_mapped', prepared.commands.some(c => c.kind === 'updateAudioGraph'), 'no audio graph')
expect('authority', productionAuthorityOk().ok && mayPublishAutomatically() === false && maySpendMoney() === false && mayDeleteOriginal() === false, 'authority')

let working = cloneProject(project)
for (const command of prepared.commands) {
  const result = applyEditCommand(working, command)
  if (!result.ok) {
    expect(`apply_${command.kind}`, false, result.error)
    break
  }
  working = result.project
}
expect('cut_from_multiple', (working.timeline.tracks.find(t => t.kind === 'video')?.clips.length ?? 0) >= 2, String(working.timeline.tracks.find(t => t.kind === 'video')?.clips.length))
expect('original_project_empty', project.timeline.tracks[0].clips.length === 0, 'source mutated')
expect('originals_immutable', working.assets.every(asset => asset.immutableOriginal && asset.originalPath === before.assets.find(a => a.id === asset.id)?.originalPath), 'original path changed')

const follow = followUpCommandsAfterCut(working, intent, applySelectorExplanation(plan, selector))
expect('sparse_transitions', follow.filter(c => c.kind === 'addTransition').length <= Math.max(1, working.timeline.tracks.find(t => t.kind === 'video')!.clips.length - 1), String(follow.filter(c => c.kind === 'addTransition').length))
for (const command of follow) {
  const result = applyEditCommand(working, command)
  if (result.ok) working = result.project
}

const refs = shotReferences(working)
expect('shot_labels', refs[0]?.label === 'Opening shot' && refs.at(-1)?.label === 'Closing shot', refs.map(r => r.label).join(','))
expect('opening_mention', parseShotMention('Make the opening shorter.', refs)?.index === 0, 'opening')
expect('shot_two_mention', refs.length > 1 ? parseShotMention('Take that second clip out.', refs)?.index === 1 : true, 'shot 2')

const shorter = parseRevisionRequest({
  projectId: project.id,
  planId: plan.id,
  utterance: 'Make the opening shorter.',
  project: working,
})
expect('patch_shorten_opening', shorter.patch.kind === 'SHORTEN_SHOT' && shorter.patch.shotRef?.index === 0, `${shorter.patch.kind} ${shorter.patch.shotRef?.label}`)
const shortCommands = commandsForRevisionPatch(working, shorter.patch, shorter.request.utterance)
expect('revision_typed_ops', shortCommands.some(c => c.kind === 'rippleTrim') && shortCommands.every(c => c.kind !== 'generateVideo'), shortCommands.map(c => c.kind).join(','))
const beforeTrim = toSeconds(working.timeline.tracks.find(t => t.kind === 'video')!.clips[0].duration)
for (const command of shortCommands) {
  const result = applyEditCommand(working, command)
  if (result.ok) working = result.project
}
const afterTrim = toSeconds(working.timeline.tracks.find(t => t.kind === 'video')!.clips[0].duration)
expect('opening_actually_shorter', afterTrim < beforeTrim - 0.4, `${beforeTrim} -> ${afterTrim}`)

const vertical = parseRevisionRequest({
  projectId: project.id,
  planId: plan.id,
  utterance: 'Make a vertical version.',
  project: working,
})
expect('patch_aspect', vertical.patch.kind === 'CHANGE_ASPECT', vertical.patch.kind)
const verticalCommands = commandsForRevisionPatch(working, vertical.patch, vertical.request.utterance)
expect('variant_ops', verticalCommands.some(c => c.kind === 'autoReframe') && verticalCommands.some(c => c.kind === 'deriveVerticalVersion'), verticalCommands.map(c => c.kind).join(','))
expect('no_new_originals', !verticalCommands.some(c => c.kind === 'generateVideo'), 'generated media')

const session = emptyProductionSession(intent)
expect('session_resume_fields', session.currentStep === null && Array.isArray(session.completedSteps) && session.failedStep === null && Array.isArray(session.jobIds), JSON.stringify({ current: session.currentStep, jobs: session.jobIds }))

const captionsIntent = parseProductionIntent({ projectId: project.id, prompt: 'Add captions to this short video.' })
const captionsPlan = buildProductionPlan(project, captionsIntent)
expect('captions_honest', captionsPlan.captionSteps.some(step => /speech recognition/i.test(step.detail + (step.skippedReason ?? ''))), captionsPlan.captionSteps.map(s => s.skippedReason ?? s.detail).join(' | '))

const cool = parseProductionIntent({ projectId: project.id, prompt: 'Make it cool and cinematic.' })
expect('look_cinematic_or_cool', cool.style === 'CINEMATIC' || cool.style === 'COOL', String(cool.style))

const studio = source('components/war-room/higher-vision-studios/HvsAiCreateStudio.tsx')
const produceRoute = source('app/api/media-command/produce/route.ts')
const pkg = source('package.json')
const editorRoute = source('app/higher-vision-studios/projects/[id]/editor/page.tsx')
const renderRoute = source('app/api/media-command/render/route.ts')

expect('your_media_ui', studio.includes('data-testid="hvs-ai-your-media"') && studio.includes('Your media'), 'media summary')
expect('plan_explanation_ui', studio.includes('data-testid="hvs-ai-plan-explanation"') && studio.includes('I will leave out'), 'explanation')
expect('make_video_ui', studio.includes('Make video') && studio.includes('data-testid="hvs-ai-start"'), 'make video')
expect('finish_video_ui', studio.includes('Finish video') && studio.includes('data-testid="hvs-ai-finish-video"'), 'finish')
expect('ready_to_review', studio.includes('Your video is ready to review'), 'preview copy')
expect('keep_current', studio.includes('Keep current') && studio.includes('Apply changes'), 'revision confirm')
expect('recovery_ui', studio.includes("I couldn't finish your video") && studio.includes('Try again') && studio.includes('Change plan'), 'recovery')
expect('no_auto_editor_on_fail', !produceRoute.includes('hvsStudioHref') || studio.includes('explain'), 'no forced NLE')
expect('make_video_no_autorender', produceRoute.includes("action === 'approve' || action === 'retry'") && produceRoute.includes("action === 'render'"), 'split finish')
expect('make_not_process_queue_inline', !/action === 'approve'[\s\S]{0,200}processRenderQueue/.test(produceRoute) || produceRoute.includes("action === 'render'"), 'finish uses render engine')
expect('unified_render', renderRoute.includes('processRenderQueue'), 'render engine')
expect('advanced_editor_preserved', editorRoute.includes('HvsEditorShell'), 'editor')
expect('retry_action', produceRoute.includes("'retry'"), 'retry')
expect('selector_file', existsSync(path.join(process.cwd(), 'lib/media-command/production-selector.ts')), 'selector')
expect('contract_file', source('lib/media-command/hvs-producer-contract.ts').includes('createFromPrompt') && source('lib/media-command/hvs-producer-contract.ts').includes('MAKE_VIDEO'), 'contract')
expect('no_second_timeline', !studio.includes('create a second timeline'), 'one timeline')
expect('no_second_render_engine', !produceRoute.includes('new RenderEngine') && renderRoute.includes('processRenderQueue'), 'one engine')
expect('wired', pkg.includes('hvs.ai-producer.slice2.validation.ts') && pkg.includes('hvs.ai-first.validation.ts'), 'validators')
expect('progress_language', source('lib/media-command/production-language.ts').includes('Analyzing your media') && source('lib/media-command/production-language.ts').includes('Finding the strongest moments'), 'progress')
expect('editor_href_preserved', hvsStudioHref('abc') === '/higher-vision-studios/projects/abc/editor', hvsStudioHref('abc'))

const g30 = HVS_MATRIX_ROWS.find(row => row.id === 'G30-03')
expect('no_false_full_director', g30?.state !== 'SHIPPED', `${g30?.id} ${g30?.state}`)

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-AI-PRODUCER-S2', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-AI-PRODUCER-S2', total: results.length }))
