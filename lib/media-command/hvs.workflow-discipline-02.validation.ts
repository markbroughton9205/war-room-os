/**
 * HVS-WORKFLOW-DISCIPLINE-02
 * Lesson constraints into the existing planner + real QC → DETERMINISTIC_QC.
 * node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/media-command/hvs.workflow-discipline-02.validation.ts
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { emptyProject } from './types'
import { serializeHvsProject } from './project-format'
import { unknownRights } from './rights'
import { mayPublishAutomatically } from './policy'
import { emptyProductionSession, loadProductionSession, saveProductionSession, projectProductionSessionPath } from './production-session'
import type { HvsProductionIntent } from './production-ai-types'
import { buildProductionPlan, commandsForApprovedPlan } from './production-ai'
import { createFromPrompt } from './hvs-producer-contract'
import {
  captureLessonFromUtterance,
  constraintsDoNotEmitEditOps,
  lessonQueryFromContext,
  planningConstraintsFromLessons,
  retrieveLessons,
} from './lessons/retrieve'
import { saveLesson, setLessonStatus } from './lessons/store'
import type { HvsLesson } from './lessons/types'
import { evaluateVerification } from './verification-classes'
import { resolveDeterministicQc } from './deterministic-qc-evidence'
import { wrapExistingPlan, inspectAssetGap, initialWorkflow } from './workflow-discipline'
import { DIRECTOR_OWNS_HVS_WORKFLOW, directScene } from './director/contract'
import { HVS_MATRIX_ROWS } from './production-matrix'
import type { HvsJob } from './jobs'
import type { HvsQcReport, HvsToolReceipt } from './tool-kernel/types'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}
function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const root = mkdtempSync(path.join(tmpdir(), 'hvs-wf02-'))
const now = '2026-09-24T04:00:00.000Z'

function baseLesson(partial: Partial<HvsLesson> & Pick<HvsLesson, 'id' | 'status' | 'scope'>): HvsLesson {
  return {
    schema: 'hvs.lesson.v1',
    system: 'HVS',
    productionType: 'SHORT_FROM_CLIPS',
    triggeringFailure: 'typography',
    correction: 'Use tighter title safe margins.',
    rootCause: 'Type sat too close to the frame edge.',
    generalizedRule: 'For this style, use tighter title safe margins.',
    projectId: null,
    themeId: null,
    styleId: 'CINEMATIC',
    mediaTypes: ['video'],
    visualContext: null,
    confidence: 0.7,
    evidence: ['utterance:typography'],
    sourceUtterance: 'SECRET_SHOULD_NOT_APPEAR',
    supersededBy: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
}

const intent: HvsProductionIntent = {
  id: 'intent-02',
  projectId: 'hvs-wf02',
  prompt: 'MAKE VIDEO cinematic production with titles',
  sourceAssetIds: [],
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
  createdAt: now,
}

const project = emptyProject({ id: 'hvs-wf02', name: 'WF02' })
project.timeline.themeId = 'luxury_beauty_v1'

const candidate = baseLesson({ id: 'lesson-candidate', status: 'CANDIDATE', scope: 'HVS_ONLY' })
const active = baseLesson({ id: 'lesson-active', status: 'ACTIVE', scope: 'HVS_ONLY' })
const confirmed = baseLesson({
  id: 'lesson-confirmed',
  status: 'CONFIRMED',
  scope: 'HVS_ONLY',
  triggeringFailure: 'framing',
  generalizedRule: 'Keep the hero inside the requested frame.',
})
const superseded = baseLesson({ id: 'lesson-superseded', status: 'SUPERSEDED', scope: 'HVS_ONLY', generalizedRule: 'Old type rule.' })
const retired = baseLesson({ id: 'lesson-retired', status: 'RETIRED', scope: 'HVS_ONLY', generalizedRule: 'Retired type rule.' })
const projectA = baseLesson({ id: 'lesson-proj-a', status: 'ACTIVE', scope: 'PROJECT', projectId: 'hvs-wf02' })
const projectB = baseLesson({ id: 'lesson-proj-b', status: 'ACTIVE', scope: 'PROJECT', projectId: 'other-project' })
const themeLux = baseLesson({
  id: 'lesson-theme-lux',
  status: 'ACTIVE',
  scope: 'THEME',
  themeId: 'luxury_beauty_v1',
  triggeringFailure: 'color',
  generalizedRule: 'Keep the luxury gold look.',
  styleId: null,
})
const styleCine = baseLesson({
  id: 'lesson-style-cine',
  status: 'ACTIVE',
  scope: 'STYLE',
  styleId: 'CINEMATIC',
  triggeringFailure: 'cinematic',
  generalizedRule: 'Stay inside the cinematic plan.',
})
const conflictA = baseLesson({
  id: 'lesson-conflict-a',
  status: 'ACTIVE',
  scope: 'HVS_ONLY',
  triggeringFailure: 'audio',
  generalizedRule: 'Keep dialogue louder than music.',
  styleId: null,
})
const conflictB = baseLesson({
  id: 'lesson-conflict-b',
  status: 'ACTIVE',
  scope: 'HVS_ONLY',
  triggeringFailure: 'audio',
  generalizedRule: 'Keep music louder than dialogue.',
  styleId: null,
})

for (const lesson of [candidate, active, confirmed, superseded, retired, projectA, projectB, themeLux, styleCine, conflictA, conflictB]) {
  await saveLesson(lesson, root)
}

const query = lessonQueryFromContext({
  productionType: 'SHORT_FROM_CLIPS',
  projectId: 'hvs-wf02',
  themeId: 'luxury_beauty_v1',
  styleId: 'CINEMATIC',
})
expect('no_invented_context', !('visualContext' in query) && !('triggeringFailure' in query), JSON.stringify(query))

const retrieved = await retrieveLessons(query, root)
const ids = retrieved.map(row => row.id)
expect('1_active_retrieved', ids.includes('lesson-active'), ids.join(','))
expect('2_confirmed_retrieved', ids.includes('lesson-confirmed'), ids.join(','))
expect('3_candidate_excluded', !ids.includes('lesson-candidate'), ids.join(','))
expect('4_superseded_excluded', !ids.includes('lesson-superseded'), ids.join(','))
expect('5_retired_excluded', !ids.includes('lesson-retired'), ids.join(','))
expect('6_project_isolated', ids.includes('lesson-proj-a') && !ids.includes('lesson-proj-b'), ids.join(','))
const wrongTheme = await retrieveLessons({ ...query, themeId: 'other-theme' }, root)
expect('7_theme_isolated', wrongTheme.every(row => row.id !== 'lesson-theme-lux'), wrongTheme.map(r => r.id).join(','))
const wrongStyle = await retrieveLessons({ productionType: 'SHORT_FROM_CLIPS', projectId: 'hvs-wf02', styleId: 'ENERGETIC' }, root)
expect('8_style_isolated', wrongStyle.every(row => row.id !== 'lesson-style-cine'), wrongStyle.map(r => r.id).join(','))

const set = planningConstraintsFromLessons(retrieved)
const plan = buildProductionPlan(project, intent, { planningConstraints: set.constraints })
expect('existing_planner', plan.id.startsWith('plan-') && wrapExistingPlan(plan).planner === 'HvsProductionPlan' && wrapExistingPlan(plan).secondEngine === false, plan.id)
expect('no_second_planner', !source('lib/media-command/production-ai.ts').includes('buildProductionPlanV2')
  && !source('lib/media-command/production-ai.ts').includes('lessonPlanner')
  && (source('lib/media-command/production-ai.ts').match(/export function buildProductionPlan/g) ?? []).length === 1, 'planner')
expect('1b_active_in_plan', (plan.planningConstraints ?? []).some(row => row.lessonId === 'lesson-active'), String(plan.lessonConstraintCount))
expect('2b_confirmed_in_plan', (plan.planningConstraints ?? []).some(row => row.lessonId === 'lesson-confirmed'), (plan.planningConstraints ?? []).map(r => r.lessonId).join(','))
expect('3b_candidate_not_in_plan', !(plan.planningConstraints ?? []).some(row => row.lessonId === 'lesson-candidate'), 'candidate')
expect('9_no_editops_from_constraints', plan.automaticEditOp === false && constraintsDoNotEmitEditOps(set.constraints).commandCount === 0, 'editops')
const without = buildProductionPlan(project, intent)
const cmdsA = commandsForApprovedPlan(project, intent, without).commands.map(row => row.kind).join(',')
const cmdsB = commandsForApprovedPlan(project, intent, plan).commands.map(row => row.kind).join(',')
expect('9b_same_editops', cmdsA === cmdsB, `${cmdsA} vs ${cmdsB}`)
expect('no_source_utterance', JSON.stringify(plan.planningConstraints).includes('SECRET_SHOULD_NOT_APPEAR') === false, 'utterance')

const created = createFromPrompt(project, { prompt: intent.prompt, projectId: project.id, planningConstraints: set.constraints })
expect('createFromPrompt_constraints', created.lessonConstraintCount === set.constraints.length && created.automaticEditOp === false && created.approvalRequired === true, String(created.lessonConstraintCount))

const session = emptyProductionSession(intent)
session.plan = plan
session.lessonConstraintIds = set.constraints.map(row => row.lessonId)
session.lessonConstraintCount = set.constraints.length
session.workflow = initialWorkflow(true)
session.workflow.activeLessonIds = session.lessonConstraintIds
session.workflow.lessonConstraintIds = session.lessonConstraintIds
session.workflow.lessonConstraintCount = session.lessonConstraintCount
session.workflow.planningConstraints = set.constraints
await saveProductionSession(session)
const stored = JSON.parse(readFileSync(projectProductionSessionPath(session.projectId), 'utf8')) as {
  lessonConstraintCount?: number
  lessonConstraintIds?: string[]
  workflow?: { lessonConstraintIds?: string[] }
}
expect('10_session_records', stored.lessonConstraintCount === set.constraints.length && Array.isArray(stored.lessonConstraintIds) && stored.lessonConstraintIds.includes('lesson-active'), String(stored.lessonConstraintCount))
const serialized = serializeHvsProject(project)
expect('11_not_in_hvsproj', !serialized.includes('hvs.lesson.v1') && !serialized.includes('lesson-active') && !serialized.includes('planningConstraints'), 'project json')

const energeticIntent = { ...intent, style: 'ENERGETIC' as const }
const afterStyle = planningConstraintsFromLessons(await retrieveLessons(lessonQueryFromContext({
  productionType: energeticIntent.goal,
  projectId: energeticIntent.projectId,
  themeId: project.timeline.themeId,
  styleId: energeticIntent.style,
}), root))
const replanned = buildProductionPlan(project, energeticIntent, { planningConstraints: afterStyle.constraints })
expect('12_replan_refresh', !(replanned.planningConstraints ?? []).some(row => row.lessonId === 'lesson-style-cine'), (replanned.planningConstraints ?? []).map(r => r.lessonId).join(','))

const conflictSet = planningConstraintsFromLessons([conflictA, conflictB])
expect('13_conflict_no_silent', conflictSet.constraints.length === 2 && conflictSet.needsHuman === true && conflictSet.conflicts.length >= 1, JSON.stringify(conflictSet.conflicts))

expect('14_commander_outranks', created.approvalRequired === true && created.approvalAction === 'MAKE_VIDEO' && plan.authorityRequirements.every(row => row.allowed === false), 'authority')
const rightsGap = inspectAssetGap({ id: 'blocked', role: 'ORIGINAL', rights: unknownRights() }, 'blocked')
expect('15_rights_outrank', rightsGap.status === 'UNKNOWN' && plan.authorityRequirements.some(row => row.action === 'publish' && row.allowed === false), rightsGap.status)

expect('16_existing_planner_used', source('app/api/media-command/produce/route.ts').includes('buildProductionPlan(project, intent, { planningConstraints:')
  && source('lib/media-command/hvs-producer-contract.ts').includes('buildProductionPlan(project, intent, { planningConstraints:'), 'wired')
expect('17_no_second_engine', wrapExistingPlan(plan).secondEngine === false && DIRECTOR_OWNS_HVS_WORKFLOW === false, 'engine')

const director = directScene(project, { prompt: 'MAKE VIDEO director plan', projectId: project.id, planningConstraints: set.constraints })
expect('director_context_only', director.directorOwnsWorkflow === false && (director.planningConstraints ?? []).length === set.constraints.length && director.mutated === false, String(director.planningConstraints?.length))

const current = { path: '/tmp/master-b.mp4', hash: 'bbb', jobId: 'render-b', versionId: 'ver-b' }
const passReport: HvsQcReport = {
  schema: 'hvs.qc.v1',
  path: '/tmp/master-b.mp4',
  outcome: 'PASS',
  hash: 'bbb',
  durationSec: 12,
  checks: [{ id: 'exists', status: 'PASS', detail: 'ok' }],
  ranAt: now,
}
const failReport: HvsQcReport = {
  ...passReport,
  outcome: 'FAIL',
  hash: 'bbb',
  checks: [{ id: 'exists', status: 'FAIL', detail: 'missing' }],
}
const humanReport: HvsQcReport = {
  ...passReport,
  outcome: 'NEEDS_HUMAN',
  checks: [{ id: 'blackdetect', status: 'NEEDS_HUMAN', detail: 'black' }],
}
const staleReport: HvsQcReport = {
  ...passReport,
  path: '/tmp/master-a.mp4',
  hash: 'aaa',
  outcome: 'PASS',
}

const passRes = resolveDeterministicQc({ reports: [passReport], currentRender: current })
const failRes = resolveDeterministicQc({ reports: [failReport], currentRender: current })
const humanRes = resolveDeterministicQc({ reports: [humanReport], currentRender: current })
const noneRes = resolveDeterministicQc({ reports: [], currentRender: current })
const staleRes = resolveDeterministicQc({ reports: [staleReport], currentRender: current })
const selected = resolveDeterministicQc({ reports: [staleReport, passReport], currentRender: current })
expect('18_qc_pass', passRes.verdict === 'PASS' && passRes.evidence.renderHash === 'bbb', passRes.verdict)
expect('19_qc_fail', failRes.verdict === 'FAIL', failRes.verdict)
expect('20_qc_needs_human', humanRes.verdict === 'NEEDS_HUMAN', humanRes.verdict)
expect('21_qc_not_run', noneRes.verdict === 'NOT_RUN', noneRes.verdict)
expect('22_stale_unbound', staleRes.verdict === 'NOT_RUN', staleRes.verdict)
expect('23_current_selected', selected.verdict === 'PASS' && selected.evidence.path === '/tmp/master-b.mp4', JSON.stringify(selected.evidence))

const passEval = evaluateVerification({ deterministicQc: passRes.verdict, projectIntact: true, mediaAvailable: true, timelineValid: true, renderValid: true, rightsState: 'OWNABLE', provenanceValid: true }, 'v-pass', passRes.evidence)
const failEval = evaluateVerification({ deterministicQc: 'FAIL', projectIntact: true, mediaAvailable: true, timelineValid: true, renderValid: true, rightsState: 'OWNABLE', provenanceValid: true }, 'v-fail', failRes.evidence)
const notRunEval = evaluateVerification({ deterministicQc: 'NOT_RUN', renderExists: true, renderRequired: true, projectIntact: true }, 'v-none')
expect('24_fail_blocks', failEval.classes.DETERMINISTIC_QC === 'FAIL' && failEval.blocksDelivery && failEval.blockingFailures.includes('DETERMINISTIC_QC'), String(failEval.blocksDelivery))
expect('25_not_run_not_pass', notRunEval.classes.DETERMINISTIC_QC === 'NOT_RUN' && String(notRunEval.classes.DETERMINISTIC_QC) !== 'PASS', notRunEval.classes.DETERMINISTIC_QC)
expect('26_intent_separate', passEval.classes.CREATIVE_INTENT_MATCH !== passEval.classes.DETERMINISTIC_QC || passEval.classes.CREATIVE_INTENT_MATCH === 'NOT_RUN', `${passEval.classes.CREATIVE_INTENT_MATCH}/${passEval.classes.DETERMINISTIC_QC}`)
expect('26b_intent_not_folded', source('lib/media-command/verification-classes.ts').includes("CREATIVE_INTENT_MATCH: factualIntent(facts)")
  && source('lib/media-command/verification-classes.ts').includes("DETERMINISTIC_QC: facts.deterministicQc ?? 'NOT_RUN'"), 'separate')
expect('27_no_creative_pass', passEval.creativePass === undefined && !JSON.stringify(passEval).includes('"creativePass":true'), String(passEval.creativePass))

const lessonQc = resolveDeterministicQc({ reports: [], currentRender: current })
expect('28_lesson_not_qc', lessonQc.verdict === 'NOT_RUN' && set.constraints.length > 0, lessonQc.verdict)

const needsHumanEval = evaluateVerification({ deterministicQc: 'NEEDS_HUMAN', projectIntact: true, mediaAvailable: true, timelineValid: true, renderValid: true, rightsState: 'OWNABLE', provenanceValid: true })
expect('20b_needs_human_not_fail', needsHumanEval.classes.DETERMINISTIC_QC === 'NEEDS_HUMAN' && !needsHumanEval.blockingFailures.includes('DETERMINISTIC_QC'), needsHumanEval.classes.DETERMINISTIC_QC)

const job: HvsJob = {
  schemaVersion: 1,
  id: 'hjob-qc-1',
  kind: 'qc',
  status: 'COMPLETED',
  createdAt: now,
  startedAt: now,
  completedAt: now,
  projectId: 'hvs-wf02',
  versionId: 'ver-b',
  inputs: { file: '/tmp/master-b.mp4', renderJobId: 'render-b' },
  outputs: { outcome: 'PASS', hash: 'bbb', outputPath: '/tmp/master-b.mp4', reportId: 'hvs.qc.v1' },
  backend: 'ffmpeg-qc',
  parameters: {},
  error: null,
  retry: { attempt: 1, maxAttempts: 1, lastError: null, retryable: false, nextRetryAt: null },
  provenance: { backend: 'ffmpeg-qc', createdBy: 'system' },
  authority: { spend: false, externalUpload: false, sensitiveTransfer: false },
  metrics: {},
  cancelRequested: false,
}
const fromJob = resolveDeterministicQc({ jobs: [job], currentRender: current })
expect('18b_job_pass', fromJob.verdict === 'PASS' && fromJob.evidence.qcJobId === 'hjob-qc-1', fromJob.verdict)

const receipt: HvsToolReceipt = {
  schema: 'hvs.receipt.v1',
  jobId: 'hvsjob-qc',
  missionId: null,
  projectId: 'hvs-wf02',
  toolName: 'hvs.qc.run',
  argumentsHash: 'abc',
  startedAt: now,
  completedAt: now,
  status: 'COMPLETED',
  outputAssetRefs: [{ id: 'out', role: 'MASTER', path: '/tmp/master-b.mp4', hash: 'bbb' }],
  hashes: { master: 'bbb' },
  qcState: 'FAIL',
  errors: ['black'],
  authorityClass: 'LOCAL_MEDIA',
}
const fromReceipt = resolveDeterministicQc({ receipts: [receipt], currentRender: current })
expect('19b_receipt_fail', fromReceipt.verdict === 'FAIL' && fromReceipt.evidence.receiptId === 'hvsjob-qc', fromReceipt.verdict)

const noRender = resolveDeterministicQc({ reports: [passReport], currentRender: null })
expect('21b_no_render_identity', noRender.verdict === 'NOT_RUN', noRender.verdict)

const old = emptyProductionSession({ ...intent, projectId: 'hvs-wf02-old', prompt: 'MAKE VIDEO' })
const oldFile = projectProductionSessionPath(old.projectId)
await saveProductionSession(old)
const raw = JSON.parse(readFileSync(oldFile, 'utf8')) as Record<string, unknown>
delete raw.workflow
delete raw.lessonConstraintIds
delete raw.lessonConstraintCount
writeFileSync(oldFile, JSON.stringify(raw))
const loaded = await loadProductionSession(old.projectId)
expect('29_old_session', loaded !== null && loaded?.workflow === undefined && loaded?.lessonConstraintIds === undefined && loaded?.intent.prompt === 'MAKE VIDEO', loaded ? 'loaded' : 'missing')
if (existsSync(oldFile)) rmSync(oldFile)

expect('30_foundry_boundary', !source('lib/media-command/lessons/store.ts').includes('strategy-memory')
  && !source('lib/media-command/deterministic-qc-evidence.ts').includes('foundry')
  && source('lib/native-builder/foundryHvsAdapter.ts').includes("HVS owns .hvsproj"), 'foundry')
expect('31_schema_untouched', source('lib/media-command/types.ts').includes('export const HVSPROJ_VERSION = 0')
  && !source('lib/media-command/types.ts').includes('planningConstraints')
  && !source('lib/media-command/types.ts').includes('hvs.lesson.v1'), 'schema')

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
expect('32_protected_hashes', hashDrift === 0, JSON.stringify(hashes))

expect('qc_job_persists_outcome', source('lib/media-command/qc-job.ts').includes('outcome: kernel.outcome') && source('lib/media-command/qc-job.ts').includes('hash: kernel.hash'), 'persist')
expect('capture_still_candidate', captureLessonFromUtterance({ utterance: 'typography wrong', productionType: 'SHORT_FROM_CLIPS' })?.status === 'CANDIDATE', 'promotion unchanged')
expect('no_g28_ship_all', HVS_MATRIX_ROWS.length === 187 && HVS_MATRIX_ROWS.find(row => row.id === 'G28-02')?.state !== 'SHIPPED' && HVS_MATRIX_ROWS.find(row => row.id === 'G28-01')?.state === 'SHELL', 'matrix')

rmSync(root, { recursive: true, force: true })
const failed = results.filter(row => !row.pass)
for (const row of results) console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name} ${row.detail}`)
console.log(`HVS_WORKFLOW_DISCIPLINE_02 ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
if (failed.length) process.exit(1)
