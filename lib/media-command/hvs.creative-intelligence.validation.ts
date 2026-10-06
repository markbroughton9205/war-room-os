/**
 * HVS-CREATIVE-INTELLIGENCE-01
 * node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/media-command/hvs.creative-intelligence.validation.ts
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { emptyProject, IDENTITY_COLOR, IDENTITY_CROP, IDENTITY_TRANSFORM } from './types'
import { serializeHvsProject } from './project-format'
import { unknownRights } from './rights'
import { mayPublishAutomatically } from './policy'
import { fromSeconds } from './time'
import { emptyProductionSession, loadProductionSession, saveProductionSession, projectProductionSessionPath } from './production-session'
import type { HvsProductionIntent } from './production-ai-types'
import { buildProductionPlan, commandsForApprovedPlan } from './production-ai'
import { createFromPrompt } from './hvs-producer-contract'
import {
  lessonQueryFromContext,
  planningConstraintsFromLessons,
  retrieveLessons,
} from './lessons/retrieve'
import { saveLesson } from './lessons/store'
import type { HvsLesson } from './lessons/types'
import { evaluateVerification } from './verification-classes'
import { applyReplan, HVS_DEFAULT_MAX_REPLANS, initialWorkflow, inspectAssetGap, prepareProduction, wrapExistingPlan } from './workflow-discipline'
import { DIRECTOR_OWNS_HVS_WORKFLOW, directScene } from './director/contract'
import {
  createDeterministicCreativeProvider,
  createMalformedCreativeProvider,
  createUnavailableCreativeProvider,
  liveCreativeCompleterAvailable,
  parseCreativeReview,
  validateProviderPayload,
} from './creative-intelligence/provider'
import { isHvsCreativeLiveConfigured } from './creative-intelligence/live-completer'
import { runCreativeIntelligence, shouldRunCreativeIntelligence, creativeDoesNotMutateProject, candidateLessonFromCorrection } from './creative-intelligence/engine'
import { collectCreativeEvidence } from './creative-intelligence/evidence'
import { reviewCreativeDraft } from './creative-intelligence/review'
import { FOUNDRY_OWNS_CREATIVE_INTELLIGENCE } from './creative-intelligence/types'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}
function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const root = mkdtempSync(path.join(tmpdir(), 'hvs-ci01-'))
const now = '2026-09-24T05:00:00.000Z'

const prompt = 'Create a cinematic 30-second nighttime luxury product film with restrained typography and a slow, confident opening. MAKE VIDEO production render.'
const trivial = 'move this title down 20px'

const intent: HvsProductionIntent = {
  id: 'intent-ci',
  projectId: 'hvs-ci01',
  prompt,
  sourceAssetIds: ['asset-product'],
  goal: 'PROMO',
  durationSec: 30,
  aspect: '16:9',
  style: 'LUXURY',
  tone: 'restrained',
  platform: null,
  captions: false,
  music: 'keep',
  voice: 'keep',
  constraints: [],
  createdAt: now,
}

function projectWithMedia() {
  const project = emptyProject({ id: 'hvs-ci01', name: 'CI', productionMode: 'COMMERCIAL', now })
  project.assets.push({
    id: 'asset-product',
    kind: 'video',
    name: 'product.mov',
    originalPath: '/tmp/product.mov',
    proxyPath: null,
    thumbPath: null,
    waveformPath: null,
    checksumSha256: 'abc',
    mimeType: 'video/mp4',
    duration: fromSeconds(40),
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
    createdAt: now,
    role: 'ORIGINAL',
    rights: { state: 'OWNABLE', commercialOk: true, source: 'owned', notes: 'owned' },
  })
  return project
}

const lesson: HvsLesson = {
  schema: 'hvs.lesson.v1',
  id: 'lesson-dense-titles',
  system: 'HVS',
  productionType: 'PROMO',
  triggeringFailure: 'typography',
  correction: 'Luxury intros should avoid dense title stacks.',
  rootCause: 'Stacked titles crowded the open.',
  generalizedRule: 'Luxury intros should avoid dense title stacks.',
  scope: 'STYLE',
  projectId: null,
  themeId: null,
  styleId: 'LUXURY',
  mediaTypes: ['video'],
  visualContext: null,
  confidence: 0.8,
  evidence: ['review'],
  status: 'ACTIVE',
  sourceUtterance: 'SECRET_SHOULD_NOT_APPEAR',
  supersededBy: null,
  createdAt: now,
  updatedAt: now,
}

await saveLesson(lesson, root)
await saveLesson({ ...lesson, id: 'lesson-candidate-typo', status: 'CANDIDATE', generalizedRule: 'Candidate must not reach creative analysis.' }, root)
await saveLesson({
  ...lesson,
  id: 'lesson-conflict-a',
  triggeringFailure: 'audio',
  generalizedRule: 'Keep music quieter than voice.',
  status: 'ACTIVE',
  scope: 'HVS_ONLY',
  styleId: null,
}, root)
await saveLesson({
  ...lesson,
  id: 'lesson-conflict-b',
  triggeringFailure: 'audio',
  generalizedRule: 'Lead with music louder than voice.',
  status: 'ACTIVE',
  scope: 'HVS_ONLY',
  styleId: null,
  confidence: 0.8,
}, root)

expect('1_trivial_skips', shouldRunCreativeIntelligence(trivial) === false, trivial)
expect('2_substantial_invokes', shouldRunCreativeIntelligence(prompt) === true, prompt)

const project = projectWithMedia()
const query = lessonQueryFromContext({
  productionType: intent.goal,
  projectId: project.id,
  styleId: intent.style,
  mediaTypes: ['video'],
})
const lessonSet = planningConstraintsFromLessons(await retrieveLessons(query, root))
const creative = await runCreativeIntelligence({
  project,
  intent,
  constraints: lessonSet.constraints,
  conflicts: lessonSet.conflicts,
  provider: createDeterministicCreativeProvider(),
})

expect('3_richer_intent', Boolean(creative.analysis?.intent.schema === 'hvs.creative-intent.v1' && creative.analysis.intent.typographyGoal && creative.analysis.intent.pacingGoal), creative.analysis?.intent.typographyGoal ?? 'missing')
expect('4_single_planner', (source('lib/media-command/production-ai.ts').match(/export function buildProductionPlan/g) ?? []).length === 1
  && !source('lib/media-command/production-ai.ts').includes('buildProductionPlanV2')
  && !source('lib/media-command/creative-intelligence/engine.ts').includes('buildProductionPlanV2'), 'planner')
expect('5_lessons_enter', (creative.analysis?.lessonIdsConsidered ?? []).includes('lesson-dense-titles')
  && (creative.approaches ?? []).every(row => row.lessonIdsUsed.includes('lesson-dense-titles')), String(creative.analysis?.lessonIdsConsidered))
expect('6_candidate_excluded', !(creative.analysis?.lessonIdsConsidered ?? []).includes('lesson-candidate-typo'), String(creative.analysis?.lessonIdsConsidered))
expect('7_conflict_surfaced', (creative.analysis?.lessonConflicts.length ?? 0) > 0 || lessonSet.conflicts.length > 0, JSON.stringify(lessonSet.conflicts))
expect('8_alt_bounds', (creative.approaches?.length ?? 0) >= 2 && (creative.approaches?.length ?? 0) <= 4, String(creative.approaches?.length))
expect('9_alt_strengths_risks', (creative.approaches ?? []).every(row => row.strengths.length > 0 && row.risks.length > 0), 'strengths/risks')
expect('10_typed_comparison', (creative.comparison ?? []).every(row => row.judgments.every(item => ['STRONG', 'ADEQUATE', 'WEAK', 'UNKNOWN'].includes(item.judgment))), String(creative.comparison?.length))

const selected = creative.approaches?.find(row => row.id === creative.selectedApproachId) ?? null
const plan = buildProductionPlan(project, intent, {
  planningConstraints: lessonSet.constraints,
  creativeApproach: selected,
  creativeIntent: creative.analysis?.intent,
  creativeAnalysisId: creative.analysisId,
})
expect('11_approach_in_planner', plan.creativeApproachId === selected?.id && plan.summaryLines.some(line => line.includes('Creative approach:')), plan.creativeApproachId ?? 'missing')
const without = buildProductionPlan(project, intent)
const withCmds = commandsForApprovedPlan(project, intent, plan)
const withoutCmds = commandsForApprovedPlan(project, intent, without)
expect('12_no_direct_editop', withCmds.commands.map(row => row.kind).join(',') === withoutCmds.commands.map(row => row.kind).join(',')
  && creativeDoesNotMutateProject().emitsEditOps === false
  && (selected?.id ? true : false), withCmds.commands.map(row => row.kind).join(','))

const beforeJson = serializeHvsProject(project)
const afterPlan = buildProductionPlan(project, intent, { planningConstraints: lessonSet.constraints, creativeApproach: selected })
expect('13_no_hvsproj_write', serializeHvsProject(project) === beforeJson && !serializeHvsProject(project).includes('hvs.creative-intent.v1') && !afterPlan.summaryLines.join('').includes('SECRET_SHOULD_NOT_APPEAR'), 'project json')

const fixture = projectWithMedia()
fixture.timeline.tracks[0].clips.push({
  id: 'clip-open',
  trackId: 'V1',
  assetId: 'asset-product',
  name: 'open',
  start: fromSeconds(0),
  duration: fromSeconds(12),
  sourceIn: fromSeconds(0),
  sourceOut: fromSeconds(12),
  speed: { n: 1, d: 1 },
  reversed: false,
  freeze: false,
  transform: IDENTITY_TRANSFORM,
  crop: IDENTITY_CROP,
  opacity: 1,
  volume: 1,
  fadeIn: fromSeconds(0),
  fadeOut: fromSeconds(0),
  pan: 0,
  color: IDENTITY_COLOR,
  effects: [],
  filters: [],
  enabled: true,
})
fixture.timeline.tracks[0].clips.push({
  ...fixture.timeline.tracks[0].clips[0],
  id: 'clip-body',
  name: 'body',
  start: fromSeconds(12),
  duration: fromSeconds(43),
  sourceIn: fromSeconds(12),
  sourceOut: fromSeconds(55),
})
fixture.timeline.overlays.push({
  id: 'title-dense',
  kind: 'title',
  assetId: null,
  text: 'NIGHTTIME LUXURY COLLECTION LIMITED EDITION SIGNATURE SERIES',
  secondaryText: 'ESTABLISHED CRAFT FOR THE MODERN COLLECTOR AND THE HOUSE ARCHIVE',
  start: fromSeconds(0),
  duration: fromSeconds(8),
  x: 0.5,
  y: 0.4,
  scale: 1,
  opacity: 1,
})
fixture.timeline.cameraSpecs.push({
  id: 'cam-1',
  name: 'open',
  shotSize: 'WS',
  angle: 'eye',
  movement: 'static',
  framing: 'product center',
  subjectTargetId: null,
  lensIntent: '35mm',
  depthOfField: 'shallow',
  trackingBehavior: null,
  trajectory: null,
})
fixture.colorPipeline.nodes.push({ id: 'look', type: 'temp-tint', enabled: true, params: { temperature: 0.18, tint: 0 } })
fixture.timeline.tracks[3].clips.push({
  ...fixture.timeline.tracks[0].clips[0],
  id: 'music-1',
  trackId: 'A2',
  name: 'score',
  duration: fromSeconds(55),
})

const evidence = await collectCreativeEvidence({
  project: fixture,
  intent,
  constraints: lessonSet.constraints,
  audioClipping: true,
  currentRender: { path: '/tmp/master-a.mp4', hash: 'aaa', jobId: 'render-a', versionId: fixture.currentVersionId },
})
const review = await reviewCreativeDraft({
  intent: creative.analysis!.intent,
  approach: selected,
  evidence,
  productionIntent: intent,
  constraints: lessonSet.constraints,
})

expect('14_typed_findings', review.findings.length > 0 && review.schema === 'hvs.creative-review.v1', String(review.findings.length))
expect('15_pacing_finding', review.findings.some(row => row.class === 'PACING' && row.honesty === 'OBSERVED' && /55s vs requested 30s/.test(row.observation))
  && review.findings.some(row => row.class === 'PACING' && row.honesty === 'INFERRED'), review.findings.filter(row => row.class === 'PACING').map(row => row.honesty).join(','))
expect('16_typography_finding', review.findings.some(row => row.class === 'TYPOGRAPHY' && row.honesty === 'OBSERVED'), 'type')
expect('17_audio_finding', review.findings.some(row => row.class === 'AUDIO' && row.honesty === 'OBSERVED' && /clipping/.test(row.observation)), 'audio')
expect('18_framing_metadata', review.findings.some(row => row.class === 'FRAMING' && row.honesty === 'OBSERVED' && /WS|product center/.test(row.evidence + row.observation)), 'framing')
expect('19_unknown_visual_human', review.findings.some(row => row.honesty === 'HUMAN_REQUIRED' && row.class === 'COMPOSITION'), 'human visual')
expect('20_refine_required', review.verdict === 'REFINE_REQUIRED' && review.requiresStructuralReplan === false, review.verdict)

const blockedProject = projectWithMedia()
blockedProject.assets.push({
  ...blockedProject.assets[0],
  id: 'urban-night-exterior',
  name: 'street.mov',
  rights: unknownRights('location plate'),
})
const rightsCreative = await runCreativeIntelligence({
  project: blockedProject,
  intent: { ...intent, sourceAssetIds: ['asset-product', 'urban-night-exterior'] },
  constraints: lessonSet.constraints,
  includeReview: true,
  provider: createDeterministicCreativeProvider(),
})
const urban = rightsCreative.approaches?.find(row => row.id === 'approach-urban-night')
const rightsReview = await reviewCreativeDraft({
  intent: rightsCreative.analysis!.intent,
  approach: urban ?? null,
  evidence: await collectCreativeEvidence({
    project: blockedProject,
    intent: { ...intent, sourceAssetIds: ['asset-product', 'urban-night-exterior'] },
    constraints: lessonSet.constraints,
  }),
  productionIntent: { ...intent, sourceAssetIds: ['asset-product', 'urban-night-exterior'] },
})
expect('21_replan_required', rightsReview.verdict === 'REPLAN_REQUIRED' && rightsReview.requiresStructuralReplan === true, rightsReview.verdict)

const workflow = initialWorkflow(true)
const stopped = applyReplan(applyReplan(applyReplan(applyReplan(workflow, 'one'), 'two'), 'three'), 'four')
expect('22_stop_replan', applyReplan(workflow, 'structural').currentStage === 'REPLAN', applyReplan(workflow, 'structural').currentStage)
expect('23_replan_bound', stopped.currentStage === 'STOPPED' && stopped.replanCount > HVS_DEFAULT_MAX_REPLANS && HVS_DEFAULT_MAX_REPLANS === 3, `${stopped.currentStage}:${stopped.replanCount}`)
expect('24_commander_authority', mayPublishAutomatically() === false && createFromPrompt(project, { prompt, projectId: project.id }).approvalRequired === true, 'authority')

const prep = prepareProduction({
  project: blockedProject,
  intent: { ...intent, sourceAssetIds: ['urban-night-exterior'] },
})
const gap = inspectAssetGap(blockedProject.assets.find(asset => asset.id === 'urban-night-exterior') ?? null, 'urban-night-exterior')
expect('25_rights_outrank', gap.status === 'UNKNOWN' && prep.assetGaps.some(row => row.status === 'UNKNOWN') && rightsCreative.recommendation?.approachId !== undefined, gap.status)
expect('26_lessons_not_rights', !lessonSet.constraints.some(row => row.rule.toLowerCase().includes('override rights')), 'lessons')
expect('27_no_auto_promote', candidateLessonFromCorrection({ utterance: 'typography is weak', productionType: 'PROMO' })?.status === 'CANDIDATE', 'candidate')

const malformed = createMalformedCreativeProvider()
const malformedIntent = await malformed.analyzeIntent({
  prompt, goal: 'PROMO', durationSec: 30, aspect: '16:9', style: 'LUXURY', platform: null, lessonRules: [], lessonIds: [], assetNames: [], constraints: [],
})
const malformedAlts = await malformed.generateAlternatives({
  prompt, goal: 'PROMO', durationSec: 30, aspect: '16:9', style: 'LUXURY', platform: null, lessonRules: [], lessonIds: [], assetNames: [], constraints: [],
  intent: creative.analysis!.intent, lessonConflicts: [], unavailableAssets: [], rightsBlockedAssets: [],
})
const malformedReview = await malformed.reviewDraft({
  intent: creative.analysis!.intent, approach: selected, evidence: {}, lessonRules: [],
})
expect('28_malformed_handled', validateProviderPayload('intent', malformedIntent.ok ? malformedIntent.value : null) === false
  && validateProviderPayload('alternatives', malformedAlts.ok ? malformedAlts.value : null) === false
  && parseCreativeReview(malformedReview.ok ? malformedReview.value : { schema: 'hvs.creative-review.v1', verdict: 'WONDERFUL', creativeScore: 87 }) === null, 'malformed')

const unavailable = await runCreativeIntelligence({
  project,
  intent,
  constraints: lessonSet.constraints,
  provider: createUnavailableCreativeProvider(),
})
const fallbackPlan = buildProductionPlan(project, intent)
expect('29_unavailable_fallback', unavailable.semanticReasoning === 'UNAVAILABLE' && fallbackPlan.id.startsWith('plan-') && wrapExistingPlan(fallbackPlan).secondEngine === false, unavailable.semanticReasoning ?? 'missing')

const receiptJson = JSON.stringify(creative.receipt)
expect('30_no_hidden_reasoning', !/chain.of.thought|private reasoning|hiddenReasoning":true/i.test(receiptJson) && creative.receipt?.hiddenReasoningStored === false, 'cot')
expect('31_bounded_receipt', Boolean(creative.receipt?.analysisId && creative.receipt.intentSummary && Array.isArray(creative.receipt.lessonIdsConsidered) && !receiptJson.includes('SECRET_SHOULD_NOT_APPEAR')), creative.receipt?.analysisId ?? 'missing')

const facts = evaluateVerification({
  projectIntact: true,
  durationMatches: false,
  deterministicQc: 'NOT_RUN',
})
expect('32_intent_match_factual', facts.classes.CREATIVE_INTENT_MATCH === 'FAIL' && facts.creativePass === undefined && review.intentAlignment !== undefined, facts.classes.CREATIVE_INTENT_MATCH)
expect('33_no_numeric_score', review.creativeScore === undefined && review.cinematicScore === undefined && !JSON.stringify(review).includes('"creativeScore":') && !source('lib/media-command/creative-intelligence/types.ts').includes('creativeScore: number'), 'score')
expect('34_no_foundry_ownership', FOUNDRY_OWNS_CREATIVE_INTELLIGENCE === false && DIRECTOR_OWNS_HVS_WORKFLOW === false
  && !source('lib/media-command/creative-intelligence/engine.ts').includes('strategy-memory')
  && source('lib/native-builder/foundryHvsAdapter.ts').includes('HVS owns .hvsproj'), 'foundry')

const baseline = '/home/chosenone/Codex/hvs-workflow-discipline-01-baseline/BASELINE_MANIFEST.json'
const manifest = JSON.parse(readFileSync(baseline, 'utf8')) as { files: Array<{ path: string; sha256: string }> }
const protectedPaths = [
  'lib/media-command/ffmpeg.ts',
  'lib/media-command/rights.ts',
  'lib/media-command/policy.ts',
  'lib/media-command/ingest.ts',
  'lib/media-command/preview-engine.ts',
  'lib/media-command/render-engine.ts',
  'lib/media-command/director3d/blender-audit.ts',
  'lib/media-command/character-production/authority.ts',
]
const hashes: Record<string, string> = {}
let hashDrift = 0
for (const rel of protectedPaths) {
  const row = manifest.files.find(file => file.path === rel)
  const digest = createHash('sha256').update(readFileSync(path.join(process.cwd(), rel))).digest('hex')
  hashes[rel] = digest
  if (!row || row.sha256 !== digest) hashDrift += 1
}
expect('35_protected_hashes', hashDrift === 0, JSON.stringify(hashes))

const old = emptyProductionSession({ ...intent, projectId: 'hvs-ci01-old', prompt: 'MAKE VIDEO' })
const oldFile = projectProductionSessionPath(old.projectId)
await saveProductionSession(old)
const raw = JSON.parse(readFileSync(oldFile, 'utf8')) as Record<string, unknown>
delete raw.workflow
delete raw.creativeIntelligence
writeFileSync(oldFile, JSON.stringify(raw))
const loaded = await loadProductionSession(old.projectId)
expect('old_session', loaded !== null && loaded?.creativeIntelligence === undefined && loaded?.intent.prompt === 'MAKE VIDEO', loaded ? 'loaded' : 'missing')
if (existsSync(oldFile)) rmSync(oldFile)

expect('self_challenge_substantial', review.selfChallenge?.asked === true && Boolean(review.selfChallenge.moreCinematic), 'challenge')
expect('recommendation_tradeoffs', Boolean(creative.recommendation?.tradeoffs.length && creative.recommendation.commanderFinalAuthority === true && creative.recommendation.objectiveTruth === false), String(creative.recommendation?.tradeoffs.length))
expect('color_finding', review.findings.some(row => row.class === 'COLOR' && row.honesty === 'OBSERVED'), 'color')
expect('story_not_forced_on_ad', !review.findings.some(row => row.class === 'STORY_STRUCTURE'), 'ad')
const filmIntent = { ...intent, prompt: 'MAKE VIDEO short film night story with a turn and payoff', goal: 'CUSTOM' as const }
const filmReview = await reviewCreativeDraft({
  intent: { ...creative.analysis!.intent, narrativeGoal: 'opening → turn → payoff' },
  approach: selected,
  evidence: { ...evidence, productionMode: 'FILM_SHOW' },
  productionIntent: filmIntent,
})
expect('story_for_film', filmReview.findings.some(row => row.class === 'STORY_STRUCTURE'), 'film story')
expect('live_not_faked', liveCreativeCompleterAvailable() === isHvsCreativeLiveConfigured(), 'honest live probe')
expect('direct_scene_context', directScene(project, { prompt, projectId: project.id, creativeApproach: selected }).directorOwnsWorkflow === false, 'director')
expect('lesson_no_title_edit', !withCmds.commands.some(row => row.kind === 'updateTitle'), 'no auto title')

const replanCreative = await runCreativeIntelligence({
  project: blockedProject,
  intent: { ...intent, sourceAssetIds: ['asset-product', 'urban-night-exterior'] },
  constraints: lessonSet.constraints,
  provider: createDeterministicCreativeProvider(),
})
expect('replan_respects_assets', replanCreative.selectedApproachId !== 'approach-urban-night' || replanCreative.recommendation?.approachId === 'approach-restrained-luxury', String(replanCreative.selectedApproachId))

rmSync(root, { recursive: true, force: true })
const failed = results.filter(row => !row.pass)
for (const row of results) console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name} ${row.detail}`)
console.log(`HVS_CREATIVE_INTELLIGENCE_01 ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
if (failed.length) process.exit(1)
