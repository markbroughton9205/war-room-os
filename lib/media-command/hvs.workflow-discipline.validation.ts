/**
 * HVS-WORKFLOW-DISCIPLINE-01
 * node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/media-command/hvs.workflow-discipline.validation.ts
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { emptyProject, cloneProject } from './types'
import { unknownRights } from './rights'
import { mayPublishAutomatically } from './policy'
import { emptyProductionSession, loadProductionSession, saveProductionSession } from './production-session'
import { projectProductionSessionPath } from './production-session'
import type { HvsProductionIntent } from './production-ai-types'
import {
  applyReplan,
  canEnterWorkflowStage,
  classifyProduction,
  createUsesEditOps,
  deliveryReady,
  HVS_DEFAULT_MAX_REPLANS,
  initialWorkflow,
  inspectAssetGap,
  planDoesNotMutateProject,
  prepareProduction,
  requiresReplan,
  reviewProduction,
  retryIsNotReplan,
  shouldUseWorkflowDiscipline,
  specialistTasksFor,
  wrapExistingPlan,
} from './workflow-discipline'
import { captureLessonFromUtterance, lessonApplies, lessonIsPlanningConstraint, retrieveLessons } from './lessons/retrieve'
import { saveLesson, setLessonStatus } from './lessons/store'
import { evaluateVerification, HVS_BLOCKING_VERIFICATION } from './verification-classes'
import { DIRECTOR_OWNS_HVS_WORKFLOW } from './director/contract'
import { HVS_MATRIX_ROWS } from './production-matrix'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}
function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const substantial = classifyProduction('MAKE VIDEO from these clips with a director plan and render')
expect('1_substantial_enters', substantial.substantial && shouldUseWorkflowDiscipline('MAKE VIDEO cinematic render'), substantial.reason)
const trivial = classifyProduction('ripple trim the first clip')
expect('2_trivial_skips', trivial.trivial && !trivial.substantial && !shouldUseWorkflowDiscipline('single caption correction'), trivial.reason)

const project = emptyProject({ id: 'hvs-wf', name: 'WF' })
const before = JSON.stringify(cloneProject(project))
const intent: HvsProductionIntent = {
  id: 'intent-1',
  projectId: project.id,
  prompt: 'MAKE VIDEO',
  sourceAssetIds: ['missing-asset'],
  goal: 'SHORT_FROM_CLIPS',
  durationSec: 15,
  aspect: '16:9',
  style: 'CINEMATIC',
  tone: null,
  platform: null,
  captions: true,
  music: null,
  voice: null,
  constraints: [],
  createdAt: '2026-09-24T00:00:00.000Z',
}
const prep = prepareProduction({ project, intent, lessonIds: [] })
expect('3_plan_no_mutate', planDoesNotMutateProject(before, JSON.stringify(project)) && prep.mutatedProject === false, 'project json')
expect('4_prepare_assets', prep.assetGaps.some(gap => gap.assetId === 'missing-asset' && gap.status === 'MISSING'), prep.assetGaps.map(g => g.status).join(','))
const unknownGap = inspectAssetGap({ id: 'a-unknown', role: 'ORIGINAL', rights: unknownRights() }, 'a-unknown')
expect('5_prepare_rights', unknownGap.status === 'UNKNOWN' && String(unknownGap.status) !== 'AVAILABLE', unknownGap.reason)
expect('6_create_editops', createUsesEditOps().system === 'EditOps' && createUsesEditOps().kinds.includes('trimClip'), 'EditOps')

const refine = reviewProduction({ substantial: true, weakOutput: true })
const replanReview = reviewProduction({ substantial: true, structuralIssue: true })
expect('7_review_refine', refine.outcome === 'REFINE_REQUIRED', refine.outcome)
expect('8_review_replan', replanReview.outcome === 'REPLAN_REQUIRED', replanReview.outcome)
expect('9_elegance_substantial_only', refine.elegance.asked === true && reviewProduction({ substantial: false, weakOutput: true }).elegance.asked === false, 'elegance')
const retry = retryIsNotReplan()
expect('10_retry_stays_retry', retry.retry.startsWith('re-execute') && !source('app/api/media-command/produce/route.ts').includes("action === 'retry' || action === 'replan'"), retry.retry)
expect('11_replan_distinct', requiresReplan('COMMANDER_WRONG') && retry.replan.includes('alter plan'), retry.replan)

let state = initialWorkflow(true)
for (let i = 0; i < HVS_DEFAULT_MAX_REPLANS; i += 1) state = applyReplan(state, 'again')
expect('12_replan_bounded_before_stop', state.currentStage === 'REPLAN' && state.needsHuman !== true && state.replanCount === 3, state.currentStage)
state = applyReplan(state, 'bound')
expect('12b_replan_needs_human', state.needsHuman === true && state.currentStage === 'STOPPED', state.stopReason ?? '')

const root = mkdtempSync(path.join(tmpdir(), 'hvs-lessons-'))
const captured = captureLessonFromUtterance({ utterance: 'typography wrong', productionType: 'SHORT_FROM_CLIPS', projectId: 'p1', now: '2026-09-24T00:00:00.000Z' })
expect('13_candidate_captured', captured?.status === 'CANDIDATE' && captured.scope === 'HVS_ONLY' && captured.generalizedRule.length > 10, captured?.status ?? 'null')
if (captured) await saveLesson(captured, root)
const hidden = await retrieveLessons({ productionType: 'SHORT_FROM_CLIPS', triggeringFailure: 'typography' }, root)
expect('14_candidate_not_retrieved', hidden.length === 0, String(hidden.length))
await setLessonStatus(captured!.id, 'ACTIVE', root)
const active = await retrieveLessons({ productionType: 'SHORT_FROM_CLIPS', triggeringFailure: 'typography', projectId: 'p1' }, root)
expect('15_active_retrieved', active.length === 1 && lessonIsPlanningConstraint(active[0]).automaticEditOp === false, String(active.length))
await setLessonStatus(captured!.id, 'CONFIRMED', root)
expect('16_confirmed_retrieved', (await retrieveLessons({ productionType: 'SHORT_FROM_CLIPS', triggeringFailure: 'typography' }, root)).length === 1, 'confirmed')
await setLessonStatus(captured!.id, 'SUPERSEDED', root)
expect('17_superseded_excluded', (await retrieveLessons({ productionType: 'SHORT_FROM_CLIPS' }, root)).length === 0, 'superseded')
await setLessonStatus(captured!.id, 'RETIRED', root)
expect('18_retired_excluded', (await retrieveLessons({ productionType: 'SHORT_FROM_CLIPS' }, root)).length === 0, 'retired')

const projectLesson = { ...captured!, id: 'lesson-project', status: 'ACTIVE' as const, scope: 'PROJECT' as const, projectId: 'p1' }
const other = { ...captured!, id: 'lesson-other', status: 'ACTIVE' as const, scope: 'PROJECT' as const, projectId: 'p2' }
const theme = { ...captured!, id: 'lesson-theme', status: 'ACTIVE' as const, scope: 'THEME' as const, themeId: 'luxury', triggeringFailure: 'color' as const }
await saveLesson(projectLesson, root)
await saveLesson(other, root)
await saveLesson(theme, root)
const isolated = await retrieveLessons({ productionType: 'SHORT_FROM_CLIPS', projectId: 'p1', triggeringFailure: 'typography' }, root)
expect('19_project_scope', isolated.some(l => l.id === 'lesson-project') && !isolated.some(l => l.id === 'lesson-other'), isolated.map(l => l.id).join(','))
const themed = await retrieveLessons({ productionType: 'SHORT_FROM_CLIPS', themeId: 'luxury', triggeringFailure: 'color' }, root)
const wrongTheme = await retrieveLessons({ productionType: 'SHORT_FROM_CLIPS', themeId: 'other', triggeringFailure: 'color' }, root)
expect('20_theme_filter', themed.some(l => l.id === 'lesson-theme') && wrongTheme.length === 0 && lessonApplies(theme, { themeId: 'luxury', triggeringFailure: 'color' }), String(themed.length))

expect('21_not_in_hvsproj', !source('lib/media-command/types.ts').includes('hvs.lesson.v1') && !source('lib/media-command/lessons/store.ts').includes('.hvsproj'), 'project type')
expect('22_not_foundry_memory', !source('lib/media-command/lessons/store.ts').includes('strategy-memory') && !source('lib/media-command/lessons/store.ts').includes('native-builder'), 'store')

const rightsFail = evaluateVerification({ rightsState: 'UNKNOWN', projectIntact: true, mediaAvailable: true, timelineValid: true, renderValid: true, provenanceValid: true, deterministicQc: 'PASS' })
const mediaFail = evaluateVerification({ rightsState: 'OWNABLE', mediaAvailable: false, projectIntact: true })
const renderFail = evaluateVerification({ rightsState: 'OWNABLE', renderValid: false, projectIntact: true, mediaAvailable: true, timelineValid: true })
expect('23_classes_independent', rightsFail.kernelQcReferenced === true && source('lib/media-command/verification-classes.ts').includes('qc-job') === false, 'matrix')
expect('24_qc_independent', source('lib/media-command/qc-job.ts').includes('HVS_VERIFICATION_CLASSES') === false, 'qc-job')
expect('25_rights_fail_blocks', rightsFail.classes.RIGHTS_VALID === 'FAIL' && rightsFail.blocksDelivery, rightsFail.classes.RIGHTS_VALID)
expect('26_unknown_fail_closed', unknownGap.status === 'UNKNOWN' && rightsFail.classes.RIGHTS_VALID === 'FAIL', 'unknown')
expect('27_media_fail_blocks', mediaFail.classes.MEDIA_AVAILABLE === 'FAIL' && mediaFail.blocksDelivery, 'media')
expect('28_render_fail_blocks', renderFail.classes.RENDER_VALID === 'FAIL' && renderFail.blocksDelivery, 'render')
expect('29_creative_needs_human', rightsFail.classes.FRAMING_VALID === 'NEEDS_HUMAN' && rightsFail.classes.COLOR_TREATMENT === 'NEEDS_HUMAN', 'creative')
const intentMatch = evaluateVerification({
  durationMatches: true,
  aspectMatches: true,
  resolutionMatches: true,
  captionsRequired: true,
  captionsPresent: true,
  requiredAssetsPresent: true,
  audioRequired: true,
  audioPresent: true,
  renderRequired: true,
  renderExists: true,
})
expect('30_intent_factual', intentMatch.classes.CREATIVE_INTENT_MATCH === 'PASS' && !source('lib/media-command/verification-classes.ts').includes('emotional impact'), intentMatch.classes.CREATIVE_INTENT_MATCH)
expect('31_no_single_creative_pass', intentMatch.creativePass === undefined && !('creativePass' in { ...intentMatch, creativePass: intentMatch.creativePass } && source('lib/media-command/verification-classes.ts').includes('creativePass: true')), 'matrix')
expect('32_commander_authority', mayPublishAutomatically() === false, 'publish')
expect('33_publish_manual', source('app/api/media-command/produce/route.ts').includes('mayPublishAutomatically() === true') === false, 'route')
expect('34_blender', source('lib/media-command/director3d/blender-audit.ts').includes("canonicalTruth: 'Hvs3DScene'"), 'blender')
expect('35_ffmpeg_untouched', source('lib/media-command/ffmpeg.ts').includes('ffmpeg') && !source('lib/media-command/workflow-discipline.ts').includes('spawn ffmpeg'), 'ffmpeg')
expect('36_preview_not_commit', !source('lib/media-command/workflow-discipline.ts').includes('commitCommands') && !source('lib/media-command/workflow-discipline.ts').includes('saveProject'), 'preview')

const oldIntent = { ...intent, projectId: 'hvs-wf-old-session' }
const old = emptyProductionSession(oldIntent)
const oldFile = projectProductionSessionPath(old.projectId)
await saveProductionSession(old)
const stored = JSON.parse(readFileSync(oldFile, 'utf8')) as { workflow?: unknown }
delete stored.workflow
writeFileSync(oldFile, JSON.stringify(stored))
const loaded = await loadProductionSession(old.projectId)
expect('37_old_session', loaded !== null && loaded?.workflow === undefined && loaded?.intent.prompt === 'MAKE VIDEO', loaded ? 'loaded' : 'missing')
if (existsSync(oldFile)) rmSync(oldFile)
expect('38_identity', DIRECTOR_OWNS_HVS_WORKFLOW === false && wrapExistingPlan(null).secondEngine === false, 'identity')

const tasks = specialistTasksFor('MAKE VIDEO typography audio render rights')
expect('tasks_cannot_publish', tasks.every(task => task.owner === 'HVS' && task.canPublish === false && task.canSpend === false && task.canDeclareCompletion === false && task.foundryMission === false), String(tasks.length))
expect('stage_gate', canEnterWorkflowStage('PLAN', 'RESEARCH_PREPARE') && !canEnterWorkflowStage('PLAN', 'DELIVER'), 'stages')
expect('blocking_set', HVS_BLOCKING_VERIFICATION.includes('RIGHTS_VALID') && HVS_BLOCKING_VERIFICATION.includes('RENDER_VALID'), 'block')
expect('delivery_not_plan', deliveryReady({
  completion: { PLAN_COMPLETED: true, CREATE_COMPLETED: false, REVIEW_COMPLETED: false, QC_COMPLETED: false, DELIVERY_READY: false, DELIVERED: false },
  blockingFail: false,
  commanderApproved: true,
}) === false, 'plan != deliver')
expect('g28_partial_only', HVS_MATRIX_ROWS.length === 187 && HVS_MATRIX_ROWS.find(row => row.id === 'G28-02')?.state !== 'SHIPPED' && HVS_MATRIX_ROWS.find(row => row.id === 'G28-01')?.state === 'SHELL', 'g28')
expect('secret_not_captured', captureLessonFromUtterance({ utterance: 'api_key sk-secret pacing wrong', productionType: 'SHORT_FROM_CLIPS' }) === null, 'secret')
expect('thanks_not_captured', captureLessonFromUtterance({ utterance: 'thanks', productionType: 'SHORT_FROM_CLIPS' }) === null, 'trivial utterance')

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
expect('protected_hashes', hashDrift === 0, `drift=${hashDrift}`)

rmSync(root, { recursive: true, force: true })
void saveProductionSession

const failed = results.filter(row => !row.pass)
for (const row of results) console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name} ${row.detail}`)
console.log(`HVS_WORKFLOW_DISCIPLINE ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
if (failed.length) process.exit(1)
