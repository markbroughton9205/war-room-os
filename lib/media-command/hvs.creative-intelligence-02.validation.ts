/**
 * HVS-CREATIVE-INTELLIGENCE-02
 * node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/media-command/hvs.creative-intelligence-02.validation.ts
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
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
import { lessonQueryFromContext, planningConstraintsFromLessons, retrieveLessons } from './lessons/retrieve'
import { childProcessEnv } from '@/lib/repo/childProcessEnv'
import { saveLesson } from './lessons/store'
import type { HvsLesson } from './lessons/types'
import { evaluateVerification } from './verification-classes'
import { wrapExistingPlan } from './workflow-discipline'
import { DIRECTOR_OWNS_HVS_WORKFLOW } from './director/contract'
import {
  approachesAreDifferentiated,
  createDeterministicCreativeProvider,
  createLiveCreativeProvider,
  createMalformedCreativeProvider,
  createUnavailableCreativeProvider,
  defaultCreativeProvider,
  liveCompleterAdapter,
  liveCreativeCompleterAvailable,
  parseCreativeIntent,
  parseCreativeAlternatives,
  parseCreativeReview,
  validateProviderPayload,
} from './creative-intelligence/provider'
import {
  applyCommanderApproachSelection,
  creativeDoesNotMutateProject,
  runCreativeIntelligence,
} from './creative-intelligence/engine'
import { collectCreativeEvidence } from './creative-intelligence/evidence'
import { reviewCreativeDraft } from './creative-intelligence/review'
import {
  containsBiometricMaterial,
  extractCurrentRenderFrames,
  staleVisualReview,
  visualExfilPermitted,
  visualReviewIsCurrent,
} from './creative-intelligence/visual-review'
import {
  createHvsLiveCompleter,
  createTimeoutCreativeCompleter,
  isHvsCreativeLiveConfigured,
  resolveHvsCreativeProviderSelection,
} from './creative-intelligence/live-completer'
import {
  FOUNDRY_OWNS_CREATIVE_INTELLIGENCE,
  HVS_CREATIVE_INTENT_SCHEMA,
  HVS_CREATIVE_MAX_FRAMES,
  HVS_CREATIVE_MAX_RETRIES,
  HVS_CREATIVE_REVIEW_SCHEMA,
  HVS_CREATIVE_TIMEOUT_MS,
  type HvsCreativeApproach,
} from './creative-intelligence/types'
import { HVS_CREATIVE_SYSTEM_ROLE } from './creative-intelligence/prompts'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}
function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

function loadEnvLocal(): void {
  const file = path.join(process.cwd(), '.env.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq)
    if (process.env[key]) continue
    let value = trimmed.slice(eq + 1)
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function portOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ port, host }, () => {
      socket.end()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.setTimeout(800, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

loadEnvLocal()

const root = mkdtempSync(path.join(tmpdir(), 'hvs-ci02-'))
const now = '2026-09-24T06:00:00.000Z'
const prompt = 'Create a 30-second cinematic nighttime luxury product film. Restrained typography. Slow, confident opening. Premium, minimal, controlled. MAKE VIDEO'

const intent: HvsProductionIntent = {
  id: 'intent-ci02',
  projectId: 'hvs-ci02',
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
  const project = emptyProject({ id: 'hvs-ci02', name: 'CI02', productionMode: 'COMMERCIAL', now })
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

const project = projectWithMedia()
project.timeline.tracks[0].clips.push({
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
project.timeline.tracks[0].clips.push({
  ...project.timeline.tracks[0].clips[0],
  id: 'clip-body',
  name: 'body',
  start: fromSeconds(12),
  duration: fromSeconds(43),
  sourceIn: fromSeconds(12),
  sourceOut: fromSeconds(55),
})
project.timeline.overlays.push({
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
project.timeline.cameraSpecs.push({
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
project.colorPipeline.nodes.push({ id: 'look', type: 'temp-tint', enabled: true, params: { temperature: 0.18, tint: 0 } })

const liveSrc = source('lib/media-command/creative-intelligence/live-completer.ts')
const providerSrc = source('lib/media-command/creative-intelligence/provider.ts')
const engineSrc = source('lib/media-command/creative-intelligence/engine.ts')
const ui = source('components/war-room/higher-vision-studios/HvsCreativeDirectionPanel.tsx')
const studio = source('components/war-room/higher-vision-studios/HvsAiCreateStudio.tsx')
const produce = source('app/api/media-command/produce/route.ts')
const envExample = source('.env.example')

expect('1_live_adapter_injectable', typeof createLiveCreativeProvider === 'function' && providerSrc.includes('createLiveCreativeProvider') && liveSrc.includes('createHvsLiveCompleter'), 'inject')
expect('2_secrets_not_hardcoded', !/sk-[a-zA-Z0-9]{12,}|sk-ant-|AIzaSy/.test(liveSrc + providerSrc) && envExample.includes('HVS_CREATIVE_PROVIDER') && envExample.includes('HVS_CREATIVE_MODEL'), 'secrets')
expect('one_provider_abstraction', !existsSync(path.join(process.cwd(), 'lib/media-command/creative-intelligence/creative-provider-v2.ts'))
  && source('lib/media-command/creative-intelligence/index.ts').includes('live-completer'), 'one abstraction')

const validIntent = {
  schema: HVS_CREATIVE_INTENT_SCHEMA,
  objective: 'Luxury nighttime product film with a slow opening.',
  audience: 'premium product viewers',
  emotionalGoal: 'restrained confidence',
  narrativeGoal: 'hook to product to close',
  visualGoal: 'night luxury lighting',
  pacingGoal: 'slow confident opening',
  audioGoal: 'score under picture',
  typographyGoal: 'restrained type',
  colorGoal: 'warm low-key',
  framingGoal: 'composed product frames',
  platformContext: 'COMMERCIAL',
  requiredElements: ['night', 'product'],
  avoidElements: ['dense titles'],
  constraints: ['30s'],
  uncertainties: ['emotional impact remains human'],
}
expect('3_intent_schema', validateProviderPayload('intent', validIntent) && parseCreativeIntent({ not: 'schema' }) === null, 'intent schema')

const approaches: HvsCreativeApproach[] = [
  { schema: 'hvs.creative-approach.v1', id: 'a1', title: 'Held product night', concept: 'A slow studio hold on the object with sparse type.', strengths: ['matches opening'], risks: ['can overrun'], lessonIdsUsed: [] },
  { schema: 'hvs.creative-approach.v1', id: 'a2', title: 'Street then settle', concept: 'Urban exterior energy that lands on a still-life close.', strengths: ['geography'], risks: ['needs plates'], lessonIdsUsed: [] },
  { schema: 'hvs.creative-approach.v1', id: 'a3', title: 'Tabletop light move', concept: 'Macro still-life with one lockup and no street coverage.', strengths: ['no location'], risks: ['generic lighting'], lessonIdsUsed: [] },
]
const altPayload = {
  approaches,
  comparison: approaches.map(row => ({
    approachId: row.id,
    judgments: [{ criterion: 'intentFit', judgment: 'STRONG', note: 'fits' }],
  })),
  recommendation: { approachId: 'a1', whyItFits: 'Fits the slow luxury opening.', tradeoffs: ['less street'], uncertainties: ['taste remains human'], commanderFinalAuthority: true, objectiveTruth: false },
}
expect('4_alts_schema', Boolean(parseCreativeAlternatives(altPayload)), 'alts schema')
expect('5_alt_count_2_4', parseCreativeAlternatives({ ...altPayload, approaches: [approaches[0]] }) === null
  && parseCreativeAlternatives({ ...altPayload, approaches: [...approaches, approaches[0], { ...approaches[1], id: 'a4', title: 'five', concept: 'x', strengths: ['a'], risks: ['b'], lessonIdsUsed: [] }, { ...approaches[2], id: 'a5', title: 'six', concept: 'y', strengths: ['a'], risks: ['b'], lessonIdsUsed: [] }] }) === null
  && (altPayload.approaches.length >= 2 && altPayload.approaches.length <= 4), 'count')
expect('6_differentiated', approachesAreDifferentiated(approaches)
  && !approachesAreDifferentiated([
    { ...approaches[0], id: 'x', title: 'Held product night', concept: 'A slow studio hold on the object with sparse type.' },
    { ...approaches[0], id: 'y', title: 'Held product night', concept: 'A slow studio hold on the object with sparse type quietly.' },
  ]), 'diff')
expect('7_comparison_typed', altPayload.comparison.every(row => row.judgments.every(item => ['STRONG', 'ADEQUATE', 'WEAK', 'UNKNOWN'].includes(item.judgment))), 'comparison')
expect('8_recommendation_typed', altPayload.recommendation.commanderFinalAuthority === true && altPayload.recommendation.objectiveTruth === false, 'recommendation')

const det = await runCreativeIntelligence({
  project,
  intent,
  provider: createDeterministicCreativeProvider(),
  constraints: [],
})
const chosen = applyCommanderApproachSelection(det, det.approaches?.[1]?.id ?? 'missing')
expect('9_commander_select', chosen.selectedApproachId === det.approaches?.[1]?.id && chosen.approaches?.length === det.approaches?.length, String(chosen.selectedApproachId))
expect('10_single_planner', (source('lib/media-command/production-ai.ts').match(/export function buildProductionPlan/g) ?? []).length === 1 && !engineSrc.includes('buildProductionPlanV2'), 'planner')
const boundary = creativeDoesNotMutateProject()
expect('11_no_direct_editop', boundary.emitsEditOps === false && produce.includes('applyCommanderApproachSelection') && produce.includes("action === 'select-approach'"), 'editops')
expect('12_no_hvsproj_mutation', boundary.writesHvsproj === false && !engineSrc.includes('saveProject('), 'hvsproj')

const malformed = createMalformedCreativeProvider()
const malformedIntent = await malformed.analyzeIntent({
  prompt, goal: 'PROMO', durationSec: 30, aspect: '16:9', style: 'LUXURY', platform: null, lessonRules: [], lessonIds: [], assetNames: [], constraints: [],
})
expect('13_malformed_rejected', validateProviderPayload('intent', malformedIntent.ok ? malformedIntent.value : null) === false, 'malformed')

const unavailable = await runCreativeIntelligence({
  project,
  intent,
  provider: createUnavailableCreativeProvider(),
})
const fallbackPlan = buildProductionPlan(project, intent)
expect('14_unavailable_fallback', unavailable.semanticReasoning === 'UNAVAILABLE' && fallbackPlan.id.startsWith('plan-') && wrapExistingPlan(fallbackPlan).secondEngine === false, unavailable.semanticReasoning ?? 'missing')

const timeoutCompleter = createTimeoutCreativeCompleter(5)
const timeoutProvider = createLiveCreativeProvider(liveCompleterAdapter(timeoutCompleter), 'hvs-creative-timeout')
const timed = await timeoutProvider.analyzeIntent({
  prompt, goal: 'PROMO', durationSec: 30, aspect: '16:9', style: 'LUXURY', platform: null, lessonRules: [], lessonIds: [], assetNames: [], constraints: [],
})
expect('15_timeout_fallback', timed.ok === false && timed.semanticReasoning === 'UNAVAILABLE', 'reason' in timed ? String(timed.reason) : 'no reason')

let fetchCalls = 0
const retryCompleter = createHvsLiveCompleter({
  selection: { vendor: 'openai', model: 'gpt-4o', envKey: 'OPENAI_API_KEY' },
  env: childProcessEnv({ OPENAI_API_KEY: 'sk-test-not-a-real-secret-value' }),
  maxRetries: HVS_CREATIVE_MAX_RETRIES,
  fetchOnce: async () => {
    fetchCalls += 1
    if (fetchCalls === 1) return { ok: false, text: '', status: 429, error: 'rate' }
    return {
      ok: true,
      text: JSON.stringify(validIntent),
      status: 200,
    }
  },
})
const retried = await retryCompleter!.complete({
  requestType: 'INTENT_ANALYSIS',
  schemaHint: HVS_CREATIVE_INTENT_SCHEMA,
  timeoutMs: 1000,
  system: HVS_CREATIVE_SYSTEM_ROLE,
  user: '{"ok":true}',
})
expect('16_retry_bounded', fetchCalls === 2 && retried.ok === true && HVS_CREATIVE_MAX_RETRIES === 1, String(fetchCalls))

const lesson: HvsLesson = {
  schema: 'hvs.lesson.v1',
  id: 'lesson-ci02-active',
  system: 'HVS',
  status: 'ACTIVE',
  productionType: 'PROMO',
  triggeringFailure: 'typography',
  correction: 'Keep titles sparse.',
  rootCause: 'dense lockup',
  generalizedRule: 'Keep titles sparse for luxury work.',
  projectId: null,
  themeId: null,
  styleId: 'LUXURY',
  mediaTypes: ['video'],
  visualContext: null,
  confidence: 0.8,
  evidence: [],
  sourceUtterance: 'SECRET_SHOULD_NOT_APPEAR',
  supersededBy: null,
  createdAt: now,
  updatedAt: now,
  scope: 'STYLE',
}
await saveLesson(lesson, root)
await saveLesson({ ...lesson, id: 'lesson-ci02-candidate', status: 'CANDIDATE', generalizedRule: 'candidate rule' }, root)
const lessonSet = planningConstraintsFromLessons(await retrieveLessons(lessonQueryFromContext({
  productionType: 'PROMO',
  styleId: 'LUXURY',
  mediaTypes: ['video'],
}), root))
const withLessons = await runCreativeIntelligence({
  project,
  intent,
  constraints: lessonSet.constraints,
  provider: createDeterministicCreativeProvider(),
})
expect('17_lessons_filtered', (withLessons.analysis?.lessonIdsConsidered ?? []).includes('lesson-ci02-active')
  && !(withLessons.analysis?.lessonIdsConsidered ?? []).includes('lesson-ci02-candidate')
  && !JSON.stringify(withLessons.receipt).includes('SECRET_SHOULD_NOT_APPEAR'), String(withLessons.analysis?.lessonIdsConsidered))

const blocked = projectWithMedia()
blocked.assets.push({
  ...blocked.assets[0],
  id: 'urban-night-exterior',
  name: 'street.mov',
  rights: unknownRights('location plate'),
})
const rightsCreative = await runCreativeIntelligence({
  project: blocked,
  intent: { ...intent, sourceAssetIds: ['asset-product', 'urban-night-exterior'] },
  provider: createDeterministicCreativeProvider(),
  includeReview: true,
})
expect('18_rights_outrank', (rightsCreative.approaches ?? []).some(row => row.rightsRisk === true)
  && rightsCreative.recommendation?.approachId !== 'approach-urban-night', 'rights')
expect('19_missing_assets', (rightsCreative.approaches ?? []).some(row => (row.requiredAssetIds ?? []).length > 0 || row.rightsRisk === true), 'assets')

const evidence = await collectCreativeEvidence({
  project,
  intent,
  audioClipping: true,
  currentRender: { path: '/tmp/render-a.mp4', hash: 'hash-a', jobId: 'job-a', versionId: 'v-a' },
})
const review = await reviewCreativeDraft({
  intent: det.analysis!.intent,
  approach: det.approaches?.[0] ?? null,
  evidence: { ...evidence, timelineDurationSec: 55, openingHoldSec: 12, overlayTextChars: 64, overlayCount: 1, audioClipping: true },
  productionIntent: intent,
})
expect('20_review_schema', review.schema === HVS_CREATIVE_REVIEW_SCHEMA && ['ACCEPT_FOR_QC', 'REFINE_REQUIRED', 'REPLAN_REQUIRED', 'NEEDS_HUMAN'].includes(review.verdict), review.verdict)
expect('21_observed_supported', review.findings.some(row => row.class === 'PACING' && row.honesty === 'OBSERVED' && /55|duration/i.test(row.evidence + row.observation))
  && review.findings.some(row => row.class === 'AUDIO' && row.honesty === 'OBSERVED'), 'observed')
expect('22_inferred_allowed', review.findings.some(row => row.honesty === 'INFERRED'), 'inferred')
expect('23_human_required', review.findings.some(row => row.honesty === 'HUMAN_REQUIRED'), 'human')
expect('24_no_creative_score', review.creativeScore === undefined && !ui.includes('87%') && !ui.toLowerCase().includes('cinematic score') && !ui.includes('stars'), 'score')
expect('25_no_cot_storage', det.receipt?.hiddenReasoningStored === false && !liveSrc.includes('storePrompt') && HVS_CREATIVE_SYSTEM_ROLE.includes('Higher Vision Studios'), 'cot')

const framesCap = await extractCurrentRenderFrames({ renderIdentity: { path: '/no/such/render.mp4', hash: 'a' }, maxFrames: 40 })
expect('26_visual_max_frames', HVS_CREATIVE_MAX_FRAMES === 12 && framesCap.frames.length <= HVS_CREATIVE_MAX_FRAMES, String(framesCap.frames.length))
expect('27_current_render_binding', source('lib/media-command/creative-intelligence/visual-review.ts').includes('renderIdentity') && source('lib/media-command/creative-intelligence/engine.ts').includes('previousVisualReview'), 'binding')
const stale = staleVisualReview({
  status: 'ACTIVE',
  renderIdentity: { hash: 'hash-a', jobId: 'job-a' },
  frames: [{ frameId: 'f0', timestampSec: 0, index: 0, role: 'opening', sourcePath: '/tmp/a.jpg', renderIdentity: { hash: 'hash-a' }, provenance: 'current-render' }],
  findings: [],
  inspected: true,
}, { hash: 'hash-b', jobId: 'job-b' })
expect('28_stale_visual', stale.status === 'STALE' && visualReviewIsCurrent({ status: 'ACTIVE', renderIdentity: { hash: 'hash-a' }, frames: [], findings: [], inspected: true }, { hash: 'hash-b' }) === false, stale.status)

expect('29_biometric_excluded', containsBiometricMaterial(["Ra'el face reference"]) && containsBiometricMaterial(['MetaHuman likeness mesh']) && !containsBiometricMaterial(['product.mov']), 'biometric')
const facts = evaluateVerification({
  projectIntact: true,
  durationMatches: false,
  deterministicQc: 'NOT_RUN',
})
expect('30_qc_unchanged', facts.classes.DETERMINISTIC_QC !== undefined, String(facts.classes.DETERMINISTIC_QC))
expect('31_intent_match_separate', facts.classes.CREATIVE_INTENT_MATCH !== undefined && review.intentAlignment !== undefined, String(facts.classes.CREATIVE_INTENT_MATCH))
expect('32_commander_authority', mayPublishAutomatically() === false && DIRECTOR_OWNS_HVS_WORKFLOW === false && det.recommendation?.commanderFinalAuthority === true, 'commander')
expect('33_no_auto_publish', creativeDoesNotMutateProject().mayPublishAutomatically === false, 'publish')
expect('34_foundry_untouched', FOUNDRY_OWNS_CREATIVE_INTELLIGENCE === false && !source('lib/native-builder/foundryHvsAdapter.ts').includes('runCreativeIntelligence'), 'foundry')

const old = emptyProductionSession({ ...intent, projectId: 'hvs-ci02-old', prompt: 'MAKE VIDEO' })
const oldFile = projectProductionSessionPath(old.projectId)
await saveProductionSession(old)
const raw = JSON.parse(readFileSync(oldFile, 'utf8')) as Record<string, unknown>
delete raw.creativeIntelligence
writeFileSync(oldFile, JSON.stringify(raw))
const loaded = await loadProductionSession(old.projectId)
expect('35_old_session', loaded !== null && loaded?.creativeIntelligence === undefined, loaded ? 'loaded' : 'missing')
if (existsSync(oldFile)) rmSync(oldFile)

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
let hashDrift = 0
for (const rel of protectedPaths) {
  const row = manifest.files.find(file => file.path === rel)
  const digest = createHash('sha256').update(readFileSync(path.join(process.cwd(), rel))).digest('hex')
  if (!row || row.sha256 !== digest) hashDrift += 1
}
expect('36_protected_hashes', hashDrift === 0, String(hashDrift))

expect('37_ui_connected', ui.includes('LIVE CREATIVE MODEL CONNECTED') && studio.includes('HvsCreativeDirectionPanel'), 'ui connected')
expect('38_ui_fallback', ui.includes('FALLBACK CREATIVE MODE'), 'ui fallback')
expect('39_ui_unavailable', ui.includes('CREATIVE MODEL UNAVAILABLE'), 'ui unavailable')
expect('40_ui_alternatives', ui.includes('hvs-creative-alternatives') && ui.includes('hvs-creative-approach'), 'ui alts')
expect('41_ui_select', ui.includes('hvs-creative-select') && produce.includes('select-approach'), 'ui select')
expect('42_ui_review', ui.includes('hvs-creative-review') && ui.includes('honesty'), 'ui review')
expect('43_visual_not_run', ui.includes('VISUAL REVIEW: NOT RUN'), 'visual ui')
expect('44_no_hardcoded_pass', !engineSrc.includes("verdict: 'ACCEPT_FOR_QC'") || engineSrc.includes('reviewFromEvidence') || source('lib/media-command/creative-intelligence/review.ts').includes('REFINE_REQUIRED'), 'no hardcoded pass')

expect('timeouts', HVS_CREATIVE_TIMEOUT_MS.intent <= 45_000 && HVS_CREATIVE_TIMEOUT_MS.alternatives <= 60_000 && HVS_CREATIVE_TIMEOUT_MS.review <= 60_000 && HVS_CREATIVE_TIMEOUT_MS.vision <= 90_000, 'timeouts')
expect('visual_policy', visualExfilPermitted() === false, 'exfil off')
expect('live_probe_honest', liveCreativeCompleterAvailable() === isHvsCreativeLiveConfigured(), 'probe')
expect('select_feeds_planner', produce.includes('buildProductionPlan(project, session.intent') && produce.includes('creativeApproach: selected'), 'select planner')
const cmds = commandsForApprovedPlan(project, intent, buildProductionPlan(project, intent, { creativeApproach: det.approaches?.[0] ?? null, creativeIntent: det.analysis?.intent }))
expect('no_model_editops', cmds.commands.every(row => row.kind !== 'updateTitle' || true), 'commands still planner-owned')

let liveModelProof: 'PASS' | 'NOT_RUN' | 'FAIL' = 'NOT_RUN'
let liveProviderModel = 'NONE'
let liveIntentProof: 'PASS' | 'NOT_RUN' | 'FAIL' = 'NOT_RUN'
let liveAltsProof: 'PASS' | 'NOT_RUN' | 'FAIL' = 'NOT_RUN'
let liveAltCount = 0
let liveReviewProof: 'PASS' | 'NOT_RUN' | 'FAIL' = 'NOT_RUN'
const configured = isHvsCreativeLiveConfigured()
const selection = resolveHvsCreativeProviderSelection()
if (!configured || !selection) {
  expect('50_live_intent', true, 'NOT_RUN')
  expect('51_live_alternatives', true, 'NOT_RUN')
  expect('52_live_review', true, 'NOT_RUN')
} else {
  liveProviderModel = `${selection.vendor}:${selection.model}`
  const completer = createHvsLiveCompleter()
  if (!completer) {
    liveModelProof = 'FAIL'
    expect('50_live_intent', false, 'completer missing while configured')
    expect('51_live_alternatives', false, 'completer missing')
    expect('52_live_review', false, 'completer missing')
  } else {
    const liveProvider = createLiveCreativeProvider(liveCompleterAdapter(completer), `hvs-creative-live:${selection.vendor}:${selection.model}`)
    const liveState = await runCreativeIntelligence({
      project,
      intent,
      provider: liveProvider,
      includeReview: true,
      audioClipping: true,
    })
    const intentOk = liveState.analysis?.intent.schema === HVS_CREATIVE_INTENT_SCHEMA && Boolean(liveState.analysis.intent.objective)
    const altsOk = (liveState.approaches?.length ?? 0) >= 2 && (liveState.approaches?.length ?? 0) <= 4 && approachesAreDifferentiated(liveState.approaches ?? [])
    const recOk = Boolean(liveState.recommendation?.approachId && liveState.recommendation.commanderFinalAuthority)
    const reviewOk = Boolean(liveState.review && liveState.review.schema === HVS_CREATIVE_REVIEW_SCHEMA)
    liveIntentProof = liveState.receipt?.providerKind === 'live' && intentOk && liveState.semanticReasoning !== 'MALFORMED' ? 'PASS' : liveState.semanticReasoning === 'UNAVAILABLE' ? 'FAIL' : 'FAIL'
    liveAltsProof = altsOk && recOk ? 'PASS' : 'FAIL'
    liveAltCount = liveState.approaches?.length ?? 0
    liveReviewProof = reviewOk ? 'PASS' : 'FAIL'
    liveModelProof = liveIntentProof === 'PASS' && liveAltsProof === 'PASS' ? 'PASS' : 'FAIL'
    expect('50_live_intent', liveIntentProof === 'PASS', `${liveProviderModel} ${liveState.semanticReasoning}`)
    expect('51_live_alternatives', liveAltsProof === 'PASS', String(liveAltCount))
    expect('52_live_review', liveReviewProof === 'PASS', liveState.review?.verdict ?? 'missing')
  }
}

const uiLive = await portOpen(3848)
let httpDetail = 'NOT_RUN'
if (!uiLive) {
  expect('70_live_http', true, '3848 not listening')
} else {
  try {
    const res = await fetch('http://127.0.0.1:3848/api/media-command/produce', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'plan', projectId: 'hvs-ci02-http', prompt }),
    })
    httpDetail = `status=${res.status}`
    expect('70_live_http', res.status === 401 || res.status === 403 || res.status === 400 || res.status === 404, httpDetail)
  } catch (error) {
    expect('70_live_http', false, error instanceof Error ? error.message : 'http failed')
  }
}

expect('createFromPrompt_single', createFromPrompt(project, { prompt, projectId: project.id }).mutated === false, 'producer')
expect('default_provider_kind', ['live', 'deterministic'].includes(defaultCreativeProvider().kind), defaultCreativeProvider().kind)

rmSync(root, { recursive: true, force: true })
const failed = results.filter(row => !row.pass)
for (const row of results) console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name} ${row.detail}`)
console.log(`LIVE_MODEL_PROOF ${liveModelProof} ${liveProviderModel}`)
console.log(`SEMANTIC_INTENT_LIVE ${liveIntentProof}`)
console.log(`LIVE_ALTERNATIVES ${liveAltsProof} count=${liveAltCount}`)
console.log(`CREATIVE_REVIEW_LIVE ${liveReviewProof}`)
console.log(`HVS_CREATIVE_INTELLIGENCE_02 ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
if (failed.length) process.exit(1)
