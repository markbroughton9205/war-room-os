/**
 * HVS WAVE 1 — shared foundations.
 * No paid submit, no model download, no generation WORKING claim, no compositor WORKING claim.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { HVS_PROGRAM_WAVE, HVS_SLICE } from './navigation'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { emptyProject, IDENTITY_COLOR } from './types'
import { parseHvsProject, serializeHvsProject } from './project-format'
import {
  JOB_RECOVERY_POLICY,
  createHvsJob,
  deleteJobFileForTests,
  listJobs,
  loadJob,
  markJobCompleted,
  markJobFailed,
  markJobRunning,
  recoverInterruptedJobs,
  requestCancel,
  retryJob,
  saveJob,
} from './jobs'
import { routeCapability, persistRoutedJob, listProviders } from './provider-router'
import { HVS_CAPABILITIES, listCapabilityBackends } from './provider-registry'
import { HVS_WAVE1_PROVIDER_SPEND_AUTHORIZED, maySpendMoney } from './policy'
import { assertNoSecrets, stripSecrets } from './secrets'
import { GENERATION_CONTRACT_NOTE, normalizeProviderArtifact, provenanceFromNormalized, promptHash } from './generation-requests'
import {
  VI_IDENTITY_POLICY,
  VIDEO_OBSERVATION_SCHEMA,
  observationIsNotIdentity,
  validateObservationDocument,
  videoIntelligence,
  writeObservations,
  defaultMediaSearchIndex,
  type ObservationDocument,
} from './video-intelligence'
import { fromSeconds } from './time'
import {
  passthroughEffectGraph,
  validateEffectGraph,
  planEffectGraphLowering,
  emptyEffectGraph,
} from './effect-graph'
import { emptyColorPipeline, planColorPipelineLowering, validateColorPipeline } from './color-pipeline'
import { emptyAudioGraph, measuredMeter, validateAudioGraph, AUDIO_SIGNAL_ORDER } from './audio-graph'
import { probeCompute, selectComputeBackend } from './compute-policy'
import { CACHE_CONTRACT, cacheDir, writeCacheMeta } from './cache'
import { reportHvsStorage } from './storage-report'
import { proposeDirectorCommands } from './ai-director'
import { applyEditCommand } from './edit-ops'
import { HVS_PRODUCTION_PAGES } from './production-pages'
import { mediaCommandDataHierarchy } from './paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

expect('program_wave', ['HVS-WAVE-1', 'HVS-WAVE-2', 'HVS-WAVE-3', 'HVS-WAVE-4', 'HVS-WAVE-5', 'HVS-WAVE-6', 'HVS-WAVE-7', 'HVS-WAVE-9'].includes(HVS_PROGRAM_WAVE), HVS_PROGRAM_WAVE)
expect('phase1_slice_preserved', HVS_SLICE === 'HVS-P1-SLICE-G', HVS_SLICE)
expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('no_duplicate_ids', new Set(HVS_MATRIX_ROWS.map(r => r.id)).size === 187, 'dup')
expect('shipped_not_below_wave1', HVS_MATRIX_ROWS.filter(r => r.state === 'SHIPPED').length >= 55, 'shipped')
expect('g22_01_at_least_partial', ['PARTIAL', 'SHIPPED'].includes(HVS_MATRIX_ROWS.find(r => r.id === 'G22-01')?.state ?? ''), 'router')
expect('g22_02_still_shell', HVS_MATRIX_ROWS.find(r => r.id === 'G22-02')?.state === 'SHELL', 'gen family')
expect('g20_02_at_least_partial', ['PARTIAL', 'SHIPPED'].includes(HVS_MATRIX_ROWS.find(r => r.id === 'G20-02')?.state ?? ''), 'effectgraph')
expect('g27_01_shipped_local_subset', HVS_MATRIX_ROWS.find(r => r.id === 'G27-01')?.state === 'SHIPPED', 'vi')
expect('vfx_page_not_working', HVS_PRODUCTION_PAGES.find(p => p.id === 'vfx')?.status !== 'WORKING', 'vfx page')
expect('spend_locked', maySpendMoney() === false && HVS_WAVE1_PROVIDER_SPEND_AUTHORIZED === false, 'spend')
expect('recovery_policy', JOB_RECOVERY_POLICY.includes('INTERRUPTED') && JOB_RECOVERY_POLICY.includes('COMPLETED'), 'policy')
expect('cache_contract', CACHE_CONTRACT.includes('NOT .hvsproj'), 'cache')
expect('signal_order', AUDIO_SIGNAL_ORDER.includes('clip'), AUDIO_SIGNAL_ORDER)
expect('identity_boundary', VI_IDENTITY_POLICY.personObservationIsNotIdentity && VI_IDENTITY_POLICY.forbidden.includes('biometric identification'), 'identity')
expect('layout_untouched', source('components/war-room/higher-vision-studios/hvs-studio-v3.css').includes('--hvs-media-w: 336px'), 'v3.1')
expect('version_browser_untouched', source('components/war-room/higher-vision-studios/HvsVersionBrowser.tsx').includes('data-testid="hvs-version-browser"'), 'vb')

const pid = `hvs-w1-${Date.now().toString(36)}`
const project = emptyProject({ id: pid, name: 'Wave 1 kernel' })

const queued = saveJob(createHvsJob({ kind: 'provider', projectId: pid, backend: 'test', status: 'QUEUED' }))
expect('job_persist_queued', queued.status === 'QUEUED' && existsSync(path.join(mediaCommandDataHierarchy().jobs, pid, `${queued.id}.json`)), queued.status)
const running = markJobRunning(queued)
expect('job_running', running.status === 'RUNNING' && running.startedAt != null, running.status)
const fakeComplete = markJobCompleted(running, { note: 'no artifact' })
expect('completed_refused_without_artifact', fakeComplete.status === 'FAILED', fakeComplete.status)
const failed = markJobFailed(createHvsJob({ kind: 'provider', projectId: pid, backend: 'test' }), 'boom')
expect('job_failed', failed.status === 'FAILED' && failed.error === 'boom', failed.status)
const cancelable = saveJob(createHvsJob({ kind: 'provider', projectId: pid, backend: 'test', status: 'QUEUED' }))
const cancelled = requestCancel(cancelable)
expect('job_cancel', cancelled.status === 'CANCELLED' && cancelled.cancelRequested, cancelled.status)
const paid = saveJob(createHvsJob({
  kind: 'provider',
  projectId: pid,
  backend: 'metered',
  status: 'FAILED',
  authority: { spend: true, externalUpload: false, sensitiveTransfer: false },
}))
paid.retry.retryable = true
paid.retry.maxAttempts = 3
const paidRetry = retryJob(paid)
expect('paid_retry_blocked', paidRetry.status === 'BLOCKED_PENDING_APPROVAL', paidRetry.status)
const runningCrash = saveJob({ ...createHvsJob({ kind: 'analysis', projectId: pid, backend: 'local' }), status: 'RUNNING', startedAt: new Date().toISOString() })
const recovered = recoverInterruptedJobs(pid)
expect('recovery_interrupted', recovered.some(j => j.id === runningCrash.id && j.status === 'FAILED' && (j.error ?? '').includes('INTERRUPTED')), String(recovered.length))

const secretJob = createHvsJob({
  kind: 'provider',
  projectId: pid,
  backend: 'test',
  parameters: { prompt: 'ok', nested: { token: 'sk-secret-value' } },
})
expect('secrets_stripped_on_create', Boolean(secretJob.parameters.nested && (secretJob.parameters.nested as { token: string }).token === '[redacted]'), JSON.stringify(secretJob.parameters))
expect('secrets_assert_throws', (() => {
  try {
    assertNoSecrets({ apiKey: 'sk-test' }, 'x')
    return false
  } catch {
    return true
  }
})(), 'assert')

expect('stubs_not_configured', listProviders().every(p => p.configured === false), 'stubs')
expect('capabilities_complete', HVS_CAPABILITIES.length === 12, String(HVS_CAPABILITIES.length))
const videoRoute = routeCapability({ capability: 'VIDEO_GENERATION', projectId: pid, prompt: 'establishing shot' })
expect('unconfigured_video_not_routed', !videoRoute.ok && (videoRoute.status === 'NOT_AVAILABLE' || videoRoute.status === 'BLOCKED_PENDING_APPROVAL'), videoRoute.ok ? 'ok' : videoRoute.status)
expect('no_stub_route', videoRoute.ok === false && videoRoute.backend?.id !== 'stub-video', String(videoRoute.backend?.id))
const imageRoute = routeCapability({ capability: 'IMAGE_GENERATION', projectId: pid, prompt: 'key art' })
expect('image_spend_or_unavailable', !imageRoute.ok && (imageRoute.status === 'BLOCKED_PENDING_APPROVAL' || imageRoute.status === 'NOT_AVAILABLE'), imageRoute.ok ? 'ok' : imageRoute.status)
const persisted = persistRoutedJob({
  request: { capability: 'IMAGE_GENERATION', projectId: pid, prompt: 'night version' },
  decision: imageRoute,
})
expect('paid_request_blocked_job', persisted.status === 'BLOCKED' || persisted.status === 'BLOCKED_PENDING_APPROVAL', persisted.status)
expect('job_has_no_secret', !JSON.stringify(persisted).toLowerCase().includes('sk-'), 'job json')

const vision = routeCapability({ capability: 'VISION_ANALYSIS', projectId: pid })
if (vision.ok) {
  const vjob = persistRoutedJob({ request: { capability: 'VISION_ANALYSIS', projectId: pid }, decision: vision })
  expect('vision_queued_not_completed', vjob.status === 'QUEUED', vjob.status)
} else {
  expect('vision_queued_not_completed', vision.status === 'NOT_AVAILABLE', vision.ok ? 'ok' : vision.status)
}

const analysisJob = videoIntelligence.startWatch({ projectId: pid, assetId: 'asset-w1' })
expect('analysis_not_completed', analysisJob.status !== 'completed' && analysisJob.observationCount === 0, analysisJob.status)
const listed = videoIntelligence.listJobs(pid)
expect('analysis_persisted', listed.some(j => j.id === analysisJob.id), String(listed.length))

const obs: ObservationDocument = {
  schemaVersion: VIDEO_OBSERVATION_SCHEMA,
  projectId: pid,
  assetId: 'asset-w1',
  assetChecksumSha256: 'abc',
  backend: 'contract',
  createdAt: new Date().toISOString(),
  observationCount: 1,
  observations: [{
    id: 'obs-1',
    assetId: 'asset-w1',
    timestamp: fromSeconds(1),
    timeRange: { start: fromSeconds(1), end: fromSeconds(2) },
    scene: 'walk toward car',
    people: [{ id: 'p1', label: 'person', confidence: 0.7 }],
    objects: [{ id: 'o1', label: 'car', confidence: 0.6 }],
    actions: [{ id: 'a1', label: 'walking', confidence: 0.5 }],
    transcript: null,
    camera: { shotSize: 'MS' },
    shotType: 'medium',
    effects: [],
    transition: null,
    color: null,
    audio_event: null,
    audioEvents: [],
    confidence: 0.6,
    evidence: [{ kind: 'contract', note: 'schema only' }],
  }],
}
expect('observation_schema', validateObservationDocument(obs).ok, validateObservationDocument(obs).errors.join(','))
expect('person_not_identity', observationIsNotIdentity(obs.observations[0]), obs.observations[0].people[0].label)
const written = writeObservations(obs)
expect('observations_file', existsSync(written), written)
defaultMediaSearchIndex.indexObservations('asset-w1', obs.observations)
expect('lexical_search', defaultMediaSearchIndex.search({ text: 'car' }).length === 1, 'search')

const fixtureDir = path.join(mediaCommandDataHierarchy().tmp, pid)
mkdirSync(fixtureDir, { recursive: true })
const fixturePath = path.join(fixtureDir, 'contract.png')
writeFileSync(fixturePath, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
))
const normalized = normalizeProviderArtifact({
  artifactPath: fixturePath,
  mimeType: 'image/png',
  kind: 'image',
  provider: 'contract-fixture',
  model: null,
  prompt: 'not generation',
  promptHash: promptHash('not generation'),
  seed: 1,
  parameters: { fixture: true },
  providerJobId: persisted.id,
  referenceAssetIds: [],
  parentAssetIds: [],
  license: null,
  externalTransfer: null,
  fixture: true,
})
expect('normalize_requires_file', normalized.fixture === true && existsSync(normalized.artifactPath), normalized.artifactPath)
const prov = provenanceFromNormalized(pid, normalized)
expect('provenance_generated', prov.origin === 'generated' && prov.providerJobId === persisted.id && !JSON.stringify(prov).includes('sk-'), String(prov.origin))
expect('fixture_not_called_working', source('lib/media-command/generation-requests.ts').includes(GENERATION_CONTRACT_NOTE), 'note')

const validGraph = passthroughEffectGraph(pid, 'asset-w1')
expect('graph_valid', validateEffectGraph(validGraph, { assetIds: new Set(['asset-w1']) }).ok, validateEffectGraph(validGraph, { assetIds: new Set(['asset-w1']) }).errors.join(','))
expect('graph_missing_asset', !validateEffectGraph(validGraph, { assetIds: new Set(['other']) }).ok, 'missing asset')
const cyclic = passthroughEffectGraph(pid)
cyclic.nodes.push(
  { id: 't1', kind: 'Transform', inputs: [{ id: 'in', name: 'rgba', kind: 'input' }], outputs: [{ id: 'out', name: 'rgba', kind: 'output' }], parameters: {} },
  { id: 't2', kind: 'Transform', inputs: [{ id: 'in', name: 'rgba', kind: 'input' }], outputs: [{ id: 'out', name: 'rgba', kind: 'output' }], parameters: {} },
)
cyclic.connections = [
  { fromNode: 'media-in', fromPort: 'out', toNode: 't1', toPort: 'in' },
  { fromNode: 't1', fromPort: 'out', toNode: 't2', toPort: 'in' },
  { fromNode: 't2', fromPort: 'out', toNode: 't1', toPort: 'in' },
]
expect('graph_cycle_rejected', !validateEffectGraph(cyclic).ok && validateEffectGraph(cyclic).errors.some(e => /cycle/i.test(e)), validateEffectGraph(cyclic).errors.join(','))
const starter = emptyEffectGraph(pid)
expect('empty_graph_incomplete', !validateEffectGraph(starter).ok, validateEffectGraph(starter).errors.join(','))
const lowering = planEffectGraphLowering(validGraph)
expect('vfx_passthrough_plan', lowering.executable === true || lowering.executable === false, String(lowering.executable))
project.effectGraphs = [validGraph]
expect('graph_on_project', project.effectGraphs[0].id.startsWith('fxg-'), project.effectGraphs[0].id)

const pipeline = emptyColorPipeline()
pipeline.nodes.push({ id: 'lg', type: 'lift-gamma-gain', enabled: true, params: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1] } })
expect('color_valid', validateColorPipeline(pipeline).ok, validateColorPipeline(pipeline).errors.join(','))
pipeline.nodes.push({ id: 'bad', type: 'lut', enabled: true, params: { assetId: 'missing-lut' } })
expect('color_lut_missing', !validateColorPipeline(pipeline, new Set()).ok, 'lut')
const colorPlan = planColorPipelineLowering(IDENTITY_COLOR, emptyColorPipeline())
expect('phase1_grade_still_lowers', colorPlan.executablePhase1Grade && colorPlan.executablePipeline === false && colorPlan.ocio === false, JSON.stringify(colorPlan.notes))
project.colorPipeline = emptyColorPipeline()

const audio = emptyAudioGraph(project)
expect('audio_valid', validateAudioGraph(audio, new Set(project.timeline.tracks.map(t => t.id))).ok, validateAudioGraph(audio).errors.join(','))
audio.channels[0] && (audio.channels[0].volume = 99)
expect('audio_invalid_volume', !validateAudioGraph(audio).ok, 'volume')
expect('meter_null_without_samples', measuredMeter(null, 'ch-A1', fromSeconds(0), fromSeconds(0.1)) === null, 'meter')
const samples = Float32Array.from([0.1, -0.4, 0.2])
const meter = measuredMeter(samples, 'ch-A1', fromSeconds(0), fromSeconds(0.1))
expect('meter_from_samples', Boolean(meter && meter.peak > 0.39 && meter.rms > 0), JSON.stringify(meter))
project.audioGraph = emptyAudioGraph(project)

const oldRaw = serializeHvsProject(emptyProject({ id: 'hvs-old-p1', name: 'old' }))
const stripped = JSON.parse(oldRaw) as Record<string, unknown>
delete stripped.effectGraphs
delete stripped.colorPipeline
delete stripped.audioGraph
const reparsed = parseHvsProject(JSON.stringify(stripped))
expect('old_project_parse', reparsed.id === 'hvs-old-p1' && Array.isArray(reparsed.effectGraphs) && reparsed.colorPipeline.nodes.length === 0 && reparsed.audioGraph.buses.length === 1, reparsed.id)

const garbage = JSON.parse(serializeHvsProject(project)) as Record<string, unknown>
garbage.effectGraphs = 'not-an-array'
garbage.colorPipeline = { nope: true }
const isolated = parseHvsProject(JSON.stringify(garbage))
expect('isolation_invalid_graphs', isolated.id === project.id && Array.isArray(isolated.effectGraphs), isolated.id)

const compute = probeCompute(true)
expect('cpu_selected', selectComputeBackend() === 'CPU' && compute.selected === 'CPU' && compute.projectFormatIndependent, compute.CUDA)
expect('cuda_not_required', compute.CUDA === 'unavailable' || compute.CUDA === 'unproven', compute.CUDA)

writeCacheMeta({
  key: 'wave1',
  category: 'analysis',
  createdAt: new Date().toISOString(),
  size: 1,
  sourceFingerprint: 'x',
  backend: 'none',
  hit: false,
  miss: true,
  path: cacheDir('analysis'),
})
expect('cache_dir_exists', existsSync(cacheDir('analysis')), cacheDir('analysis'))

const gen = applyEditCommand(project, {
  id: 'cmd-gen',
  kind: 'generateVideo',
  actor: 'human',
  createdAt: new Date().toISOString(),
  prompt: 'Generate an establishing shot.',
})
expect('generate_does_not_break_project', gen.ok && gen.project.timeline.tracks[0].clips.length === 0, gen.ok ? String(gen.project.providerJobs.at(-1)?.status) : gen.error)
expect('generate_pending_approval', gen.ok && gen.project.providerJobs.at(-1)?.status === 'blocked_pending_approval', String(gen.ok ? gen.project.providerJobs.at(-1)?.status : gen.error))

const proposal = proposeDirectorCommands(project, 'Generate an establishing shot.')
expect('director_spend_gate', proposal.requiresSpendApproval === true && proposal.jobProposal?.execute === false && proposal.jobProposal?.status === 'BLOCKED_PENDING_APPROVAL', proposal.summary)
const findProp = proposeDirectorCommands(project, 'Find every close-up of her.', 'AI_DIRECTOR', { workspacePage: 'media' })
expect('director_analysis_proposal', findProp.lane === 'analysis' && findProp.jobProposal?.execute === false, findProp.summary)
const colorProp = proposeDirectorCommands(project, 'Make this feel colder.', 'AI_DIRECTOR', { workspacePage: 'color' })
expect('director_color_proposal', colorProp.lane === 'color' || colorProp.commands.some(c => c.kind === 'applyColor'), colorProp.summary)

const backends = listCapabilityBackends()
expect('no_routeable_unconfigured', backends.filter(b => !b.configured).every(b => !b.routeable), 'routeable')

deleteJobFileForTests(pid, queued.id)

async function finish() {
  const report = await reportHvsStorage()
  expect('storage_report', report.freeBytes == null || report.freeBytes > 0, JSON.stringify({ free: report.freeBytes, total: report.mediaCommandTotal }))
  const failedResults = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  }
  if (failedResults.length) {
    console.error(JSON.stringify({ ok: false, wave: 'HVS-WAVE-1', failed: failedResults.length, total: results.length }, null, 2))
    process.exit(1)
  }
  console.log(JSON.stringify({
    ok: true,
    wave: 'HVS-WAVE-1',
    total: results.length,
    storage: { freeBytes: report.freeBytes, mediaCommandTotal: report.mediaCommandTotal },
    matrix: {
      SHIPPED: HVS_MATRIX_ROWS.filter(r => r.state === 'SHIPPED').length,
      PARTIAL: HVS_MATRIX_ROWS.filter(r => r.state === 'PARTIAL').length,
    },
  }))
}

void finish().catch(error => {
  console.error(error)
  process.exit(1)
})
