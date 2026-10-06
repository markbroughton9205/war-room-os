/**
 * HVS AI-first UX slice — prompt-driven automated editing.
 * Does not replace .hvsproj, RenderEngine, Version Browser, or the Advanced Editor.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { applyEditCommand } from './edit-ops'
import { emptyProject, cloneProject } from './types'
import { fromSeconds } from './time'
import { parseProductionIntent } from './production-intent'
import {
  buildProductionPlan,
  commandsAreLocalOnly,
  commandsForApprovedPlan,
  commandsForRevisionPatch,
  followUpCommandsAfterCut,
  parseRevisionRequest,
  productionAuthorityOk,
  proveNoMutation,
} from './production-ai'
import { friendlyProductionError } from './production-language'
import {
  HVS_AI_FIRST_SLICE,
  HVS_CREATE_BACKGROUND_DESKTOP_SRC,
  HVS_CREATE_BACKGROUND_MOBILE_SRC,
  HVS_CREATE_BACKGROUND_ORIGINAL_SRC,
  HVS_CREATE_BACKGROUND_SRC,
  hvsCreateHref,
  hvsStudioHref,
} from './navigation'
import { routeHvsCreateIntent } from './war-room-hvs-intent'
import { mayPublishAutomatically, maySpendMoney, mayDeleteOriginal } from './policy'
import { HVSPROJ_VERSION } from './types'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

expect('slice_id', HVS_AI_FIRST_SLICE === 'HVS-AI-FIRST-UX', HVS_AI_FIRST_SLICE)
expect('hvsproj_version_untouched', HVSPROJ_VERSION === 0, String(HVSPROJ_VERSION))
expect('create_href', hvsCreateHref('abc') === '/higher-vision-studios/projects/abc/create', hvsCreateHref('abc'))
expect('editor_href_preserved', hvsStudioHref('abc') === '/higher-vision-studios/projects/abc/editor', hvsStudioHref('abc'))

const project = emptyProject({ id: 'hvs-ai-first', name: 'AI First Demo' })
project.assets.push({
  id: 'clip-1',
  kind: 'video',
  name: 'source.mp4',
  originalPath: '/tmp/source.mp4',
  proxyPath: null,
  thumbPath: null,
  waveformPath: null,
  checksumSha256: 'x',
  mimeType: 'video/mp4',
  duration: fromSeconds(12),
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
  immutableOriginal: true,
  generated: false,
  provenance: null,
  createdAt: new Date().toISOString(),
})

const intent = parseProductionIntent({
  projectId: project.id,
  prompt: 'Take these clips and make me a 30-second cinematic promo. Use the best moments. Make it feel powerful. Add captions. Make it vertical.',
  sourceAssetIds: ['clip-1'],
})
expect('intent_duration', intent.durationSec === 30, String(intent.durationSec))
expect('intent_aspect', intent.aspect === '9:16', String(intent.aspect))
expect('intent_style', intent.style === 'CINEMATIC' || intent.style === 'ENERGETIC', String(intent.style))
expect('intent_captions', intent.captions === true, String(intent.captions))

const before = cloneProject(project)
const plan = buildProductionPlan(project, intent)
expect('plan_status_proposed', plan.status === 'proposed', plan.status)
expect('plan_plain_language', plan.summaryLines.some(line => /strongest moments/i.test(line)) && !/EffectGraph|LUFS|FFmpeg/.test(plan.summaryLines.join(' ')), plan.summaryLines.join(' | '))
expect('plan_maps_editops', plan.editSteps.some(step => step.system === 'EditOps' && step.kind === 'BUILD_ROUGH_CUT'), plan.editSteps.map(s => s.kind).join(','))
expect('plan_maps_color', plan.visualSteps.some(step => step.system === 'ColorPipeline'), plan.visualSteps.map(s => s.system).join(','))
expect('plan_maps_audio', plan.audioSteps.some(step => step.system === 'AudioGraph'), plan.audioSteps.map(s => s.system).join(','))
expect('plan_maps_vi', plan.analysisSteps.some(step => step.system === 'VideoIntelligence'), plan.analysisSteps.map(s => s.system).join(','))
expect('plan_no_publish', plan.authorityRequirements.every(item => item.allowed === false), plan.authorityRequirements.map(i => i.action).join(','))
expect('no_mutation_on_plan', proveNoMutation(before, project), 'timeline changed during plan')

const prepared = commandsForApprovedPlan(project, intent, plan)
expect('local_only_commands', commandsAreLocalOnly(prepared.commands).ok, JSON.stringify(prepared.commands.map(c => c.kind)))
expect('has_version_safety', prepared.commands.some(c => c.kind === 'createVersion'), prepared.commands.map(c => c.kind).join(','))
expect('has_typed_cut', prepared.commands.some(c => c.kind === 'appendClip'), prepared.commands.map(c => c.kind).join(','))
expect('no_generate', !prepared.commands.some(c => c.kind === 'generateVideo' || c.kind === 'generateImage'), prepared.commands.map(c => c.kind).join(','))

let working = cloneProject(project)
const warnings: string[] = []
for (const command of prepared.commands) {
  const result = applyEditCommand(working, command)
  if (!result.ok) {
    expect(`apply_${command.kind}`, false, result.error)
    break
  }
  working = result.project
  warnings.push(...result.warnings)
}
expect('cut_created', (working.timeline.tracks.find(t => t.kind === 'video')?.clips.length ?? 0) >= 1, String(working.timeline.tracks.find(t => t.kind === 'video')?.clips.length))
expect('original_untouched', before.timeline.tracks[0].clips.length === 0, String(before.timeline.tracks[0].clips.length))
expect('plan_project_still_empty', project.timeline.tracks[0].clips.length === 0, 'source project mutated')

const follow = followUpCommandsAfterCut(working, intent, plan)
expect('follow_look', follow.some(c => c.kind === 'applyFilter' || c.kind === 'applyColor' || c.kind === 'updateColorPipeline'), follow.map(c => c.kind).join(','))
for (const command of follow) {
  const result = applyEditCommand(working, command)
  if (result.ok) working = result.project
}

const revision = parseRevisionRequest({ projectId: project.id, planId: plan.id, utterance: 'Make it shorter.' })
expect('revision_is_patch', revision.patch.commandKinds.includes('rippleTrim'), revision.patch.commandKinds.join(','))
const revCommands = commandsForRevisionPatch(working, revision.patch, revision.request.utterance)
expect('revision_typed', revCommands.every(c => c.kind !== 'generateVideo'), revCommands.map(c => c.kind).join(','))
expect('revision_not_raw_prompt', revCommands.length > 0 && !revCommands.some(c => 'utterance' in c), String(revCommands.length))

expect('authority_no_publish', mayPublishAutomatically() === false && productionAuthorityOk().ok, 'publish')
expect('authority_no_spend', maySpendMoney() === false, 'spend')
expect('authority_no_delete', mayDeleteOriginal() === false, 'delete')

expect(
  'friendly_error_hides_ffmpeg',
  friendlyProductionError('ffmpeg filter_complex failed with exit code 1') === 'I could not finish making your video.'
    && !/exit code/.test(friendlyProductionError('ffmpeg filter_complex failed with exit code 1')),
  friendlyProductionError('ffmpeg filter_complex failed with exit code 1'),
)

const home = source('components/war-room/higher-vision-studios/HvsHomeScreen.tsx')
const studio = source('components/war-room/higher-vision-studios/HvsAiCreateStudio.tsx')
const nav = source('lib/media-command/navigation.ts')
const editorRoute = source('app/higher-vision-studios/projects/[id]/editor/page.tsx')
const renderRoute = source('app/api/media-command/render/route.ts')
const produceRoute = source('app/api/media-command/produce/route.ts')
const pkg = source('package.json')

expect('home_ai_first', home.includes('HvsAiCreateStudio') && home.includes('data-testid="hvs-home-screen"'), 'home')
expect('home_keeps_demo_label', home.includes('Luxury Beauty Demo') && !/STARRDOM/.test(home), 'demo label')
expect('prompt_box', studio.includes('data-testid="hvs-ai-prompt"') && studio.includes('data-testid="hvs-ai-create"'), 'prompt')
expect('attach_media', studio.includes('data-testid="hvs-ai-attach-video"') && studio.includes('data-testid="hvs-ai-attach-photo"') && studio.includes('data-testid="hvs-ai-attach-audio"'), 'attach')
expect('suggested_prompts', studio.includes('data-testid="hvs-ai-suggested-prompt"') && source('lib/media-command/production-language.ts').includes('Make a short video from this clip.'), 'suggested')
expect('plan_ui', studio.includes('data-testid="hvs-ai-plan"') && studio.includes('Make video'), 'plan')
expect('approval_gate', produceRoute.includes("action === 'approve'") && produceRoute.includes('commandsForApprovedPlan') && studio.includes('data-testid="hvs-ai-start"'), 'approval')
expect('no_commit_on_plan', produceRoute.includes("action === 'plan'") && produceRoute.includes('proveNoMutation'), 'plan gate')
expect('revision_chat', studio.includes('data-testid="hvs-ai-revision-chat"') && produceRoute.includes("action === 'revise'"), 'revision')
expect('progress_plain', studio.includes('data-testid="hvs-ai-progress"') && source('lib/media-command/production-language.ts').includes('Analyzing your media'), 'progress')
expect('advanced_editor_preserved', editorRoute.includes('HvsEditorShell') && nav.includes("label: 'Advanced Editor'"), 'editor')
expect('editor_route_exists', existsSync(path.join(process.cwd(), 'app/higher-vision-studios/projects/[id]/editor/page.tsx')), 'editor path')
expect('create_route_exists', existsSync(path.join(process.cwd(), 'app/higher-vision-studios/projects/[id]/create/page.tsx')), 'create path')
expect('unified_render_untouched', renderRoute.includes('processRenderQueue') && source('lib/media-command/render-engine.ts').includes('export async function processRenderQueue'), 'render')
expect('version_browser_untouched', source('components/war-room/higher-vision-studios/HvsVersionBrowser.tsx').includes('data-testid="hvs-version-browser"'), 'versions')
expect('studio_css_untouched', source('components/war-room/higher-vision-studios/hvs-studio-v3.css').includes('--hvs-media-w: 336px'), 'v3 css')
expect('no_second_timeline', !studio.includes('create a second timeline') && produceRoute.includes('commitCommands'), 'one timeline')
expect('prior_slice_g_kept', pkg.includes('hvs.p1.sliceG.validation.ts'), 'slice G remains')
expect('wired', pkg.includes('hvs.ai-first.validation.ts'), 'this validator wired')
expect('no_publish_in_produce', !produceRoute.includes('mayPublishAutomatically()') || produceRoute.includes('productionAuthorityOk'), 'authority helper')
expect('no_generation_claim', studio.includes("Final generated footage isn't enabled yet") && !studio.includes('not prompt-to-film generation'), 'honesty')
expect('direct_it_cta', /Direct it/i.test(studio) && studio.includes('data-testid="hvs-ai-create"'), 'cta')
expect('media_optional', studio.includes('Optional') && studio.includes('Add to your production'), 'optional')
expect('director_plan_card', /Your production/i.test(studio) && studio.includes('Build previs'), 'plan card')
expect('route_directed_scene', routeHvsCreateIntent("Create an 11-second nighttime action scene with Ra'el beside a black car. Have him walk toward a doorway while the building behind him collapses. Start wide and finish on a close-up.", false) === 'DIRECTED_SCENE', routeHvsCreateIntent("Create an 11-second nighttime action scene with Ra'el beside a black car. Have him walk toward a doorway while the building behind him collapses.", false))
expect('route_existing_media', routeHvsCreateIntent('Turn these clips into a 30-second cinematic trailer.', true) === 'EXISTING_MEDIA_PRODUCTION', routeHvsCreateIntent('Turn these clips into a 30-second cinematic trailer.', true))
expect('route_mixed', routeHvsCreateIntent("Use this footage in a car commercial starring Ra'el. Build the opening scene around him and use my clip afterward.", true) === 'MIXED_PRODUCTION', routeHvsCreateIntent("Use this footage in a car commercial starring Ra'el. Build the opening scene around him and use my clip afterward.", true))

const shell = source('components/war-room/higher-vision-studios/HvsShell.tsx')
const css = source('components/war-room/higher-vision-studios/hvs-ai-first.css')
const archivedBg = path.join(process.cwd(), 'public/hvs/higher-vision-studio-background.png')
const originalBg = path.join(process.cwd(), 'public/hvs/higher-vision-studio-background-original.png')
const desktopBg = path.join(process.cwd(), 'public/hvs/higher-vision-studio-background-desktop.webp')
const mobileBg = path.join(process.cwd(), 'public/hvs/higher-vision-studio-background-mobile.webp')
const archivedSha = createHash('sha256').update(readFileSync(archivedBg)).digest('hex')
const originalSha = createHash('sha256').update(readFileSync(originalBg)).digest('hex')
const commanderSha = '49a41c6f4a911c30207eb5aa0efcb2e5bf0822395ed9aa7c67ef2c18709ae3c1'
expect('create_bg_src', HVS_CREATE_BACKGROUND_SRC === '/hvs/higher-vision-studio-background.png', HVS_CREATE_BACKGROUND_SRC)
expect('create_bg_original_src', HVS_CREATE_BACKGROUND_ORIGINAL_SRC === '/hvs/higher-vision-studio-background-original.png', HVS_CREATE_BACKGROUND_ORIGINAL_SRC)
expect('create_bg_desktop_src', HVS_CREATE_BACKGROUND_DESKTOP_SRC === '/hvs/higher-vision-studio-background-desktop.webp', HVS_CREATE_BACKGROUND_DESKTOP_SRC)
expect('create_bg_mobile_src', HVS_CREATE_BACKGROUND_MOBILE_SRC === '/hvs/higher-vision-studio-background-mobile.webp', HVS_CREATE_BACKGROUND_MOBILE_SRC)
expect('create_bg_file', existsSync(archivedBg) && existsSync(originalBg), originalBg)
expect('create_bg_desktop_file', existsSync(desktopBg), desktopBg)
expect('create_bg_mobile_file', existsSync(mobileBg), mobileBg)
expect('create_bg_sha', archivedSha === commanderSha && originalSha === commanderSha, originalSha)
expect('bg_provenance', nav.includes('/home/chosenone/higher vision studio background.png'), 'source path comment')
expect('cinema_bg_wired', shell.includes('hvs-cinema-background') && shell.includes('HVS_CREATE_BACKGROUND_DESKTOP_SRC') && shell.includes('HVS_CREATE_BACKGROUND_MOBILE_SRC') && !shell.includes('higher-vision-studio-background-hero.png'), 'shell layers')
expect('cinema_bg_css', css.includes('--hvs-bg-desktop') && css.includes('--hvs-bg-mobile') && css.includes('background-size: cover') && css.includes('background-repeat: no-repeat') && css.includes('.hvs-cinema-bg-scrim'), 'css layers')
expect('hero_director_copy', studio.includes('What will you bring to life?') && studio.includes('Tell Higher Vision what you want to create') && studio.includes('Direct a scene, ad, movie sequence, trailer, show, or video in ordinary language') && studio.includes('HVS plans the cast, shots, cameras, action, sound, effects, and production'), 'hero')
expect('no_legacy_editor_claim', !studio.includes('not prompt-to-film generation') && !studio.includes('plans the edit') && !studio.includes('uses your clips') && !studio.includes('automated editing'), 'legacy')
expect('direct_it_primary', studio.includes('hvs-ai-btn-direct') && studio.includes('hvs-ai-cta-row'), 'cta hierarchy')
expect('planning_no_files', studio.includes('planning does not require files'), 'optional')
expect('home_recent_productions', home.includes('Recent productions') && !home.includes('Recent videos'), 'home')

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, slice: 'HVS-AI-FIRST-UX', failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, slice: 'HVS-AI-FIRST-UX', total: results.length }))
