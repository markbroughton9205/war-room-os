/**
 * `hvs.generate.video` orchestration: minimal FIFO queue on the existing HvsJob envelope
 * (media-command/jobs/<projectId>/<jobId>.json, kind 'provider', backend 'local-wan22'),
 * one heavy job at a time (runtime.ts lock), supervised worker (supervisor.ts),
 * probe via existing probe.ts/ffmpeg.ts, ingest via existing ingest.ts → real AssetRecord.
 *
 * Never: auto-download, cloud call, timeline insertion, rights validation, publish.
 */
import { existsSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHvsJob, markJobCompleted, markJobFailed, markJobRunning, saveJob, type HvsJob } from '../jobs'
import { mediaCommandDataHierarchy } from '../paths'
import { loadProject } from '../store'
import { ingestFile } from '../ingest'
import { probeMediaFile } from '../probe'
import { resolveFfmpegTools } from '../ffmpeg'
import { unknownRights } from '../rights'
import { normalizeProviderArtifact, promptHash, provenanceFromNormalized } from '../generation-requests'
import { validateGenerateVideoRequest } from './contract'
import { discoverWan22, type ModelDiscovery } from './model-storage'
import { decideGpuAdmission, snapshotGpu, type GpuAdmission } from './gpu-policy'
import { heavyLockHeld, modelLifecycle, settleLifecycleUnloaded, transitionLifecycle, tryAcquireHeavyLock, type HeavyLease } from './runtime'
import { runSupervisedWorker, type SupervisorOutcome, type WorkerEvent } from './supervisor'
import { WAN22_PROVIDER, buildWan22WorkerInput, capabilityFor, plannedSettings, reducedMemorySettings } from './providers/wan22'
import { generationDir, listGenerationReceipts, writeGenerationReceipt, type HvsGenerationReceipt } from './receipts'
import {
  WAN22_IDENTITY,
  type HvsGenerateVideoRequest,
  type HvsGenerateVideoResult,
  type HvsGenerationError,
  type HvsGenerationSettings,
  type HvsModelStatusLine,
} from './types'

export const WAN22_MODEL_LABEL = `${WAN22_IDENTITY.modelFamily}-${WAN22_IDENTITY.modelVariant}`
export const DEFAULT_GENERATION_TIMEOUT_MS = 60 * 60 * 1000
export const MAX_GENERATION_ATTEMPTS = 2

/** Test-only supervision hooks. Honored only when HVS_GENERATIVE_TEST_HOOKS=1 (never set by the app/HTTP route). */
export type GenerationTestHooks = {
  worker?: { python: string; script: string }
  bypassModelGate?: boolean
  bypassGpuGate?: boolean
  timeoutMs?: number
  readyTimeoutMs?: number
  fakeMode?: 'success-fixture' | 'crash' | 'hang' | 'oom' | 'oom-then-success' | 'load-fail' | 'no-output' | 'escape-path'
}

type GenerationRecord = {
  result: HvsGenerateVideoResult
  request: HvsGenerateVideoRequest
  job: HvsJob
  controller: AbortController
  hooks: GenerationTestHooks | null
  createdBy: 'human' | 'ai-director' | 'system'
  done: Promise<HvsGenerateVideoResult>
  resolve: (r: HvsGenerateVideoResult) => void
  admission: GpuAdmission | null
  discovery: ModelDiscovery | null
  logTail: string
  peakVramMiB: number | null
}

type QueueState = { queue: string[]; running: string | null; records: Map<string, GenerationRecord>; pumping: boolean }

const GLOBAL_KEY = '__hvsGenerativeVideoQueueV1'
function q(): QueueState {
  const g = globalThis as unknown as Record<string, QueueState | undefined>
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { queue: [], running: null, records: new Map(), pumping: false }
  return g[GLOBAL_KEY] as QueueState
}

function hooksAllowed(hooks?: GenerationTestHooks | null): GenerationTestHooks | null {
  return hooks && process.env.HVS_GENERATIVE_TEST_HOOKS === '1' ? hooks : null
}

export function newGenerationId(): string {
  return `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function workerScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const fromModule = path.resolve(here, '../../../scripts/hvs/wan22_worker.py')
  if (existsSync(fromModule)) return fromModule
  return path.join(process.cwd(), WAN22_PROVIDER.workerScript)
}

/** Output must live inside the media-command hierarchy and never under the OS temp dir. */
export function isContainedOutputPath(candidate: string): boolean {
  const root = path.resolve(mediaCommandDataHierarchy().mediaCommandRoot)
  const resolved = path.resolve(candidate)
  const tmp = path.resolve(tmpdir())
  if (!(resolved === root || resolved.startsWith(`${root}${path.sep}`))) return false
  if (resolved.startsWith(`${tmp}${path.sep}`) && !root.startsWith(`${tmp}${path.sep}`)) return false
  if (resolved.startsWith('/tmp/') && !root.startsWith('/tmp/')) return false
  try {
    if (existsSync(resolved)) {
      const real = realpathSync(resolved)
      const realRoot = realpathSync(root)
      if (!(real.startsWith(`${realRoot}${path.sep}`))) return false
    }
  } catch {
    return false
  }
  return true
}

function failResult(base: Partial<HvsGenerateVideoResult>, error: HvsGenerationError): HvsGenerateVideoResult {
  return {
    generationId: base.generationId ?? 'invalid',
    provider: 'wan',
    model: WAN22_MODEL_LABEL,
    status: error.code === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
    ...base,
    error,
    completedAt: new Date().toISOString(),
    liveGeneration: false,
  }
}

async function resolveSourceImage(projectId: string, assetId: string | undefined): Promise<{ ok: true; path: string | null } | { ok: false; error: HvsGenerationError }> {
  if (!assetId) return { ok: true, path: null }
  const project = await loadProject(projectId)
  const asset = project?.assets.find(a => a.id === assetId) ?? null
  if (!asset || !(asset.kind === 'image' || asset.kind === 'graphic' || asset.kind === 'logo')) {
    return { ok: false, error: { code: 'SOURCE_ASSET_NOT_FOUND', message: `No image AssetRecord ${assetId} in project ${projectId}.` } }
  }
  if (!asset.originalPath || !existsSync(asset.originalPath) || !isContainedOutputPath(asset.originalPath)) {
    return { ok: false, error: { code: 'SOURCE_ASSET_NOT_FOUND', message: `AssetRecord ${assetId} has no stored original inside media-command.` } }
  }
  return { ok: true, path: asset.originalPath }
}

function persistResultIntoJob(record: GenerationRecord): void {
  record.job = saveJob({
    ...record.job,
    outputs: { ...record.job.outputs, generation: { ...record.result } },
  })
}

function setStatus(record: GenerationRecord, status: HvsGenerateVideoResult['status']): void {
  record.result = { ...record.result, status, phaseTimes: { ...(record.result.phaseTimes ?? {}), [status]: new Date().toISOString() } }
  persistResultIntoJob(record)
}

function buildReceipt(record: GenerationRecord): HvsGenerationReceipt {
  const r = record.result
  const started = r.startedAt ? Date.parse(r.startedAt) : null
  const completed = r.completedAt ? Date.parse(r.completedAt) : null
  return {
    schema: 'hvs.generation-receipt.v1',
    generationId: r.generationId,
    projectId: record.request.projectId,
    jobId: record.job.id,
    provider: 'wan',
    model: WAN22_MODEL_LABEL,
    modelVersion: record.discovery?.metadata.modelVersion ?? null,
    capability: r.capability ?? capabilityFor(record.request),
    status: r.status,
    requested: r.requested ?? null,
    actual: r.actual ?? null,
    seed: r.seed ?? null,
    promptHash: promptHash(record.request.prompt),
    promptPreview: record.request.prompt,
    sourceImageAssetId: record.request.sourceImageAssetId ?? null,
    outputAssetId: r.outputAssetId ?? null,
    outputPath: r.outputPath ?? null,
    startedAt: r.startedAt ?? null,
    completedAt: r.completedAt ?? null,
    durationMs: started && completed ? Math.max(0, completed - started) : null,
    attempts: r.attempts ?? 0,
    errorCode: r.error?.code ?? null,
    errorMessage: r.error?.message ?? null,
    localGeneration: true,
    liveGeneration: Boolean(r.liveGeneration),
    fixture: Boolean(r.fixture),
    network: 'none',
    workerLogTail: record.logTail,
    gpu: record.admission
      ? { name: record.admission.snapshot.name, freeMiBAtAdmission: record.admission.snapshot.freeMiB, peakVramMiB: record.peakVramMiB }
      : null,
  }
}

function finalize(record: GenerationRecord, patch: Partial<HvsGenerateVideoResult>): HvsGenerateVideoResult {
  record.result = { ...record.result, ...patch, completedAt: patch.completedAt ?? new Date().toISOString() }
  const r = record.result
  if (r.status === 'COMPLETE') {
    record.job = markJobCompleted(record.job, {
      artifactPath: record.job.outputs.artifactPath,
      generation: { ...r },
    })
    if (record.job.status !== 'COMPLETED') {
      record.result = { ...r, status: 'FAILED', error: { code: 'INGEST_FAILED', message: record.job.error ?? 'COMPLETED refused by job envelope.' }, outputAssetId: undefined }
    }
  } else if (r.status === 'CANCELLED') {
    record.job = saveJob({ ...record.job, status: 'CANCELLED', cancelRequested: true, completedAt: r.completedAt ?? null, error: r.error?.message ?? 'Cancelled.', outputs: { ...record.job.outputs, generation: { ...r } } })
  } else {
    record.job = markJobFailed({ ...record.job, outputs: { ...record.job.outputs, generation: { ...r } } }, `${r.error?.code ?? 'GENERATION_FAILED'}: ${r.error?.message ?? ''}`.slice(0, 500))
  }
  try {
    writeGenerationReceipt(buildReceipt(record))
  } catch {
    // receipt failure must not change the generation outcome
  }
  record.resolve(record.result)
  return record.result
}

export type SubmitOptions = { createdBy?: 'human' | 'ai-director' | 'system'; testHooks?: GenerationTestHooks }

/** Typed entry point for `hvs.generate.video`. Returns immediately (QUEUED or a typed failure). */
export async function submitGenerateVideo(raw: unknown, options: SubmitOptions = {}): Promise<HvsGenerateVideoResult> {
  const validation = validateGenerateVideoRequest(raw)
  if (!validation.ok) return failResult({}, validation.error)
  const request = validation.request
  const hooks = hooksAllowed(options.testHooks)
  const generationId = newGenerationId()
  const project = await loadProject(request.projectId)
  if (!project) return failResult({ generationId }, { code: 'INVALID_GENERATION_REQUEST', message: `Project ${request.projectId} not found.` })

  const source = await resolveSourceImage(request.projectId, request.sourceImageAssetId)
  const seed = request.seed ?? Math.floor(Math.random() * 2_147_483_647)
  const requested = plannedSettings(request, seed)
  const capability = capabilityFor(request)

  let resolveDone!: (r: HvsGenerateVideoResult) => void
  const done = new Promise<HvsGenerateVideoResult>(res => { resolveDone = res })
  const job = saveJob(createHvsJob({
    kind: 'provider',
    projectId: request.projectId,
    versionId: project.currentVersionId,
    backend: 'local-wan22',
    inputs: {
      op: 'hvs.generate.video',
      generationId,
      promptHash: promptHash(request.prompt),
      promptPreview: request.prompt.slice(0, 160),
      durationSeconds: request.durationSeconds,
      sourceImageAssetId: request.sourceImageAssetId ?? null,
    },
    parameters: { requested, provider: 'wan', model: WAN22_MODEL_LABEL, localGeneration: true, network: 'none' },
    authority: { spend: false, externalUpload: false, sensitiveTransfer: false },
    provenance: { createdBy: options.createdBy ?? 'human', capability: 'VIDEO_GENERATION', notes: `hvs.generate.video ${capability} local Wan 2.2` },
  }))
  const record: GenerationRecord = {
    result: {
      generationId,
      provider: 'wan',
      model: WAN22_MODEL_LABEL,
      status: 'QUEUED',
      capability,
      seed,
      requested,
      actual: null,
      attempts: 0,
      liveGeneration: false,
      fixture: false,
      progress: null,
      jobId: job.id,
    },
    request,
    job,
    controller: new AbortController(),
    hooks,
    createdBy: options.createdBy ?? 'human',
    done,
    resolve: resolveDone,
    admission: null,
    discovery: null,
    logTail: '',
    peakVramMiB: null,
  }
  q().records.set(generationId, record)

  if (!source.ok) return finalize(record, { status: 'FAILED', error: source.error })

  const discovery = discoverWan22()
  record.discovery = discovery
  if (!hooks?.bypassModelGate) {
    if (discovery.status === 'DISABLED') return finalize(record, { status: 'FAILED', error: { code: 'MODEL_NOT_INSTALLED', message: discovery.detail } })
    if (discovery.status !== 'INSTALLED') return finalize(record, { status: 'FAILED', error: { code: 'MODEL_NOT_INSTALLED', message: discovery.detail } })
  }
  if (!hooks?.bypassGpuGate) {
    const admission = decideGpuAdmission({ snapshot: snapshotGpu(), lifecycle: modelLifecycle().lifecycle, heavyLockHeld: false })
    record.admission = admission
    if (admission.state === 'GPU_UNAVAILABLE') return finalize(record, { status: 'FAILED', error: { code: 'GPU_UNAVAILABLE', message: admission.reason } })
    if (admission.state === 'INSUFFICIENT_VRAM') return finalize(record, { status: 'FAILED', error: { code: 'INSUFFICIENT_VRAM', message: admission.reason } })
  }
  q().queue.push(generationId)
  void pump()
  return { ...record.result }
}

export function waitForGeneration(generationId: string): Promise<HvsGenerateVideoResult> | null {
  return q().records.get(generationId)?.done ?? null
}

export function getGeneration(generationId: string): HvsGenerateVideoResult | null {
  const r = q().records.get(generationId)?.result
  return r ? { ...r } : null
}

export function listActiveGenerations(projectId?: string): HvsGenerateVideoResult[] {
  return [...q().records.values()]
    .filter(r => !projectId || r.request.projectId === projectId)
    .map(r => ({ ...r.result }))
    .slice(-20)
}

export function queueSnapshot(): { running: string | null; queued: string[] } {
  return { running: q().running, queued: [...q().queue] }
}

/** Cancel: QUEUED → removed; running → worker process group killed. Never produces a COMPLETE asset. */
export function cancelGeneration(generationId: string): HvsGenerateVideoResult | null {
  const state = q()
  const record = state.records.get(generationId)
  if (!record) return null
  if (record.result.status === 'COMPLETE' || record.result.status === 'FAILED' || record.result.status === 'CANCELLED') return { ...record.result }
  const idx = state.queue.indexOf(generationId)
  if (idx >= 0) {
    state.queue.splice(idx, 1)
    return finalize(record, { status: 'CANCELLED', error: { code: 'CANCELLED', message: 'Cancelled while queued.' } })
  }
  if (record.result.status === 'INGESTING') {
    // Ingest is the existing atomic AssetRecord write; cancelling mid-ingest could leave a half-written project.
    return { ...record.result, error: { code: 'CANCELLED', message: 'Too late to cancel: ingest already started.' } }
  }
  record.controller.abort()
  return { ...record.result }
}

async function pump(): Promise<void> {
  const state = q()
  if (state.pumping) return
  state.pumping = true
  try {
    while (!state.running && state.queue.length) {
      const id = state.queue.shift() as string
      const record = state.records.get(id)
      if (!record) continue
      state.running = id
      try {
        await runOne(record)
      } catch (error) {
        if (record.result.status !== 'COMPLETE' && record.result.status !== 'FAILED' && record.result.status !== 'CANCELLED') {
          finalize(record, { status: 'FAILED', error: { code: 'GENERATION_FAILED', message: error instanceof Error ? error.message.slice(0, 300) : 'unexpected' } })
        }
      } finally {
        state.running = null
      }
    }
  } finally {
    state.pumping = false
  }
}

async function acquireLease(record: GenerationRecord): Promise<HeavyLease | null> {
  for (;;) {
    if (record.controller.signal.aborted) return null
    const lease = tryAcquireHeavyLock(record.result.generationId)
    if (lease) return lease
    await new Promise(res => setTimeout(res, 1000))
  }
}

function onWorkerEvent(record: GenerationRecord, evt: WorkerEvent): void {
  if (evt.event === 'state') {
    if (evt.state === 'LOADING_MODEL') {
      if (modelLifecycle().lifecycle === 'UNLOADED') transitionLifecycle('LOADING')
      setStatus(record, 'LOADING_MODEL')
    } else if (evt.state === 'GENERATING') {
      if (modelLifecycle().lifecycle === 'LOADING') transitionLifecycle('READY')
      if (modelLifecycle().lifecycle === 'READY') transitionLifecycle('GENERATING')
      setStatus(record, 'GENERATING')
    } else if (evt.state === 'ENCODING') {
      if (modelLifecycle().lifecycle === 'GENERATING') transitionLifecycle('READY')
      setStatus(record, 'ENCODING')
    }
  } else if (evt.event === 'progress') {
    if (Number.isInteger(evt.step) && Number.isInteger(evt.total) && evt.total > 0 && evt.step >= 0 && evt.step <= evt.total) {
      record.result = { ...record.result, progress: { step: evt.step, totalSteps: evt.total } }
    }
  } else if (evt.event === 'vram' && typeof evt.peakMiB === 'number') {
    record.peakVramMiB = Math.max(record.peakVramMiB ?? 0, Math.round(evt.peakMiB))
  }
}

async function runAttempt(record: GenerationRecord, settings: HvsGenerationSettings, inputImagePath: string | null, outputPath: string): Promise<SupervisorOutcome> {
  const discovery = record.discovery ?? discoverWan22()
  const hooks = record.hooks
  const tools = await resolveFfmpegTools()
  const input = {
    ...buildWan22WorkerInput({
      generationId: record.result.generationId,
      prompt: record.request.prompt,
      settings,
      inputImagePath,
      outputPath,
      checkpointDir: discovery.config.wan22ModelPath,
      codeDir: discovery.config.wan22CodeDir,
    }),
    ...(hooks?.fakeMode ? { fakeMode: hooks.fakeMode, attempt: record.result.attempts ?? 1 } : {}),
    ffmpegPath: tools.ffmpeg,
  }
  const extraEnv: Record<string, string> = {}
  if (tools.ffmpeg && path.isAbsolute(tools.ffmpeg)) extraEnv.IMAGEIO_FFMPEG_EXE = tools.ffmpeg
  if (settings.memoryMode === 'REDUCED_MEMORY_RETRY') extraEnv.PYTORCH_CUDA_ALLOC_CONF = 'expandable_segments:True'
  if (process.env.HVS_WAN22_ALLOW_SDPA_FALLBACK === '1') extraEnv.HVS_WAN22_ALLOW_SDPA_FALLBACK = '1'
  const timeoutRaw = Number(process.env.HVS_WAN22_TIMEOUT_MS)
  const timeoutMs = hooks?.timeoutMs ?? (Number.isFinite(timeoutRaw) && timeoutRaw >= 60_000 ? Math.min(timeoutRaw, 4 * 60 * 60 * 1000) : DEFAULT_GENERATION_TIMEOUT_MS)
  return runSupervisedWorker({
    python: hooks?.worker?.python ?? discovery.config.workerPython,
    script: hooks?.worker?.script ?? workerScriptPath(),
    input,
    timeoutMs,
    readyTimeoutMs: hooks?.readyTimeoutMs ?? 180_000,
    signal: record.controller.signal,
    extraEnv,
    killGraceMs: hooks ? 1_000 : 5_000,
    onEvent: evt => onWorkerEvent(record, evt),
  })
}

async function runOne(record: GenerationRecord): Promise<void> {
  const lease = await acquireLease(record)
  if (!lease) {
    finalize(record, { status: 'CANCELLED', error: { code: 'CANCELLED', message: 'Cancelled before the heavy-model lock was acquired.' } })
    return
  }
  try {
    const projectId = record.request.projectId
    const generationId = record.result.generationId
    const startedAt = new Date().toISOString()
    record.result = { ...record.result, startedAt }
    record.job = markJobRunning(record.job)

    if (!record.hooks?.bypassGpuGate) {
      const admission = decideGpuAdmission({ snapshot: snapshotGpu(), lifecycle: modelLifecycle().lifecycle, heavyLockHeld: false })
      record.admission = admission
      if (!admission.admitted) {
        finalize(record, { status: 'FAILED', error: { code: admission.state === 'GPU_UNAVAILABLE' ? 'GPU_UNAVAILABLE' : 'INSUFFICIENT_VRAM', message: admission.reason } })
        return
      }
    }
    const source = await resolveSourceImage(projectId, record.request.sourceImageAssetId)
    if (!source.ok) {
      finalize(record, { status: 'FAILED', error: source.error })
      return
    }
    const outputPath = path.join(generationDir(projectId, generationId), `wan22-${generationId}.mp4`)
    if (!isContainedOutputPath(outputPath)) {
      finalize(record, { status: 'FAILED', error: { code: 'GENERATION_FAILED', message: 'Output path escaped media-command storage.' } })
      return
    }

    let settings = record.result.requested as HvsGenerationSettings
    let outcome: SupervisorOutcome | null = null
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      record.result = { ...record.result, attempts: attempt, actual: settings }
      setStatus(record, 'LOADING_MODEL')
      outcome = await runAttempt(record, settings, source.path, outputPath)
      record.logTail = outcome.stderrTail
      settleLifecycleUnloaded()
      if (outcome.ok || outcome.error?.code !== 'GPU_OUT_OF_MEMORY' || record.controller.signal.aborted) break
      if (attempt < MAX_GENERATION_ATTEMPTS) settings = reducedMemorySettings(settings)
    }
    if (!outcome) throw new Error('No worker attempt ran.')
    if (record.controller.signal.aborted || outcome.cancelled) {
      finalize(record, { status: 'CANCELLED', error: { code: 'CANCELLED', message: outcome.error?.message ?? 'Cancelled.' }, outputAssetId: undefined })
      return
    }
    if (!outcome.ok || !outcome.result) {
      const err = outcome.error ?? { code: 'GENERATION_FAILED' as const, message: 'Worker failed.' }
      const message = err.code === 'GPU_OUT_OF_MEMORY'
        ? `${err.message} | model=${WAN22_MODEL_LABEL} resolution=${settings.width}x${settings.height} frames=${settings.frames} (${settings.durationSeconds}s) gpu=${record.admission?.snapshot.name ?? 'unknown'} freeMiB@admission=${record.admission?.snapshot.freeMiB ?? 'unknown'} peakMiB=${outcome.peakVramMiB ?? record.peakVramMiB ?? 'unknown'} attempts=${record.result.attempts}`
        : err.message
      finalize(record, { status: 'FAILED', error: { code: err.code, message: message.slice(0, 600) } })
      return
    }

    // ENCODING verification: the worker can only write to the path HVS gave it.
    const produced = outcome.result
    if (path.resolve(produced.outputPath) !== path.resolve(outputPath) || !isContainedOutputPath(produced.outputPath)) {
      finalize(record, { status: 'FAILED', error: { code: 'ENCODE_FAILED', message: 'Worker reported an output outside the assigned media-command path.' } })
      return
    }
    if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
      finalize(record, { status: 'FAILED', error: { code: 'ENCODE_FAILED', message: 'Worker reported success but no encoded file exists.' } })
      return
    }
    setStatus(record, 'ENCODING')
    const probe = await probeMediaFile(outputPath)
    if (!probe.hasVideo || probe.durationSec <= 0) {
      finalize(record, { status: 'FAILED', error: { code: 'ENCODE_FAILED', message: 'ffprobe found no decodable video stream in the worker output.' } })
      return
    }
    const fixture = Boolean(produced.fixture || produced.fake || record.hooks)
    const liveGeneration = !fixture && outcome.ready?.fake !== true
    const actual: HvsGenerationSettings = {
      ...settings,
      width: probe.width ?? produced.width,
      height: probe.height ?? produced.height,
      fps: probe.frameRateN && probe.frameRateD ? Math.round((probe.frameRateN / probe.frameRateD) * 1000) / 1000 : produced.fps,
      frames: produced.frames,
      durationSeconds: Math.round(probe.durationSec * 1000) / 1000,
      seed: produced.seed,
      attention: typeof outcome.ready?.attention === 'string' ? outcome.ready.attention : null,
      hostRamLoad: typeof outcome.ready?.hostRamLoad === 'string' ? outcome.ready.hostRamLoad : null,
    }

    setStatus(record, 'INGESTING')
    const discovery = record.discovery
    const artifact = normalizeProviderArtifact({
      artifactPath: outputPath,
      mimeType: 'video/mp4',
      kind: 'video',
      provider: 'wan',
      model: WAN22_MODEL_LABEL,
      prompt: record.request.prompt.slice(0, 500),
      promptHash: promptHash(record.request.prompt),
      seed: produced.seed,
      parameters: {
        hvsGeneration: {
          schema: 'hvs.generation-provenance.v1',
          generationId,
          provider: 'wan',
          providerFamily: WAN22_IDENTITY.providerFamily,
          modelFamily: WAN22_IDENTITY.modelFamily,
          modelVariant: WAN22_IDENTITY.modelVariant,
          model: WAN22_MODEL_LABEL,
          modelVersion: discovery?.metadata.modelVersion ?? null,
          modelVersionSource: discovery?.metadata.modelVersionSource ?? 'UNKNOWN',
          license: discovery?.metadata.license ?? null,
          capability: record.result.capability,
          requested: record.result.requested,
          actual,
          attempts: record.result.attempts,
          sourceImageAssetId: record.request.sourceImageAssetId ?? null,
          localGeneration: true,
          synthetic: true,
          generated: true,
          liveGeneration,
          liveMarker: liveGeneration ? 'LIVE' : 'FIXTURE',
          fixture,
          network: 'none',
          generatedAt: new Date().toISOString(),
          worker: {
            torch: outcome.ready?.torch ?? null, python: outcome.ready?.python ?? null, wanImportMode: outcome.ready?.wanImportMode ?? null,
            cudaRuntime: outcome.ready?.cudaRuntime ?? null, device: outcome.ready?.device ?? null, hfOffline: outcome.ready?.hfOffline ?? null,
            networkGuard: outcome.ready?.networkGuard ?? null, oomScoreAdj: outcome.ready?.oomScoreAdj ?? null,
          },
          phaseTimes: record.result.phaseTimes ?? null,
          peakVramMiB: record.peakVramMiB,
        },
      },
      providerJobId: generationId,
      referenceAssetIds: record.request.sourceImageAssetId ? [record.request.sourceImageAssetId] : [],
      parentAssetIds: record.request.sourceImageAssetId ? [record.request.sourceImageAssetId] : [],
      license: discovery?.metadata.license ?? null,
      externalTransfer: { provider: 'none', transferred: false, reason: 'Local generation. No upload.' },
      fixture,
    })
    let ingested
    try {
      const project = await loadProject(projectId)
      if (!project) throw new Error('Project disappeared before ingest.')
      if (record.controller.signal.aborted) {
        finalize(record, { status: 'CANCELLED', error: { code: 'CANCELLED', message: 'Cancelled before ingest; no asset created.' } })
        return
      }
      ingested = await ingestFile({
        project,
        sourcePath: outputPath,
        originalName: `wan22-${generationId}.mp4`,
        mimeType: 'video/mp4',
        generated: true,
        provenance: provenanceFromNormalized(projectId, artifact),
        rights: unknownRights('Locally generated by Wan 2.2 (synthetic). Rights are not auto-validated; Commander review required.'),
        role: 'ORIGINAL',
      })
    } catch (error) {
      finalize(record, { status: 'FAILED', error: { code: 'INGEST_FAILED', message: error instanceof Error ? error.message.slice(0, 300) : 'ingest failed' } })
      return
    }
    record.job = saveJob({ ...record.job, outputs: { ...record.job.outputs, artifactPath: ingested.asset.originalPath, assetId: ingested.asset.id } })
    finalize(record, {
      status: 'COMPLETE',
      outputAssetId: ingested.asset.id,
      outputPath: ingested.asset.originalPath,
      durationSeconds: actual.durationSeconds,
      width: actual.width,
      height: actual.height,
      fps: actual.fps,
      seed: actual.seed,
      actual,
      liveGeneration,
      fixture,
      error: undefined,
    })
  } finally {
    settleLifecycleUnloaded()
    lease.release()
  }
}

export type GenerativeVideoStatus = {
  provider: typeof WAN22_PROVIDER.provider
  model: string
  modelStatusLine: HvsModelStatusLine
  modelInstallLine: HvsModelInstallLine
  gpuAdmissionLine: HvsGpuAdmissionLine
  discovery: Pick<ModelDiscovery, 'status' | 'weightsInstalled' | 'runtimeInstalled' | 'missingFiles' | 'requiredBytes' | 'hfTotalBytes' | 'detail' | 'autoDownload'> & {
    modelsDir: string
    modelsDirSource: string
    modelPath: string
    workerPython: string
    modelVersion: string | null
    license: string | null
    freeBytes: number | null
  }
  gpu: { state: GpuAdmission['state']; name: string | null; totalMiB: number | null; freeMiB: number | null; backend: string; reason: string; compatibility: string; minFreeMiB: number }
  lifecycle: string
  queue: { running: string | null; queued: string[] }
  generations: HvsGenerateVideoResult[]
  receipts: Array<Record<string, unknown>>
  capabilities: string[]
}

/** HVS-GENERATIVE-VIDEO-01A: install state, independent of GPU admission (never conflated). */
export type HvsModelInstallLine = 'MODEL INSTALLED' | 'MODEL NOT INSTALLED' | 'MODEL INCOMPLETE' | 'RUNTIME MISSING' | 'DISABLED'
/** HVS-GENERATIVE-VIDEO-01A: GPU admission state, independent of install state. */
export type HvsGpuAdmissionLine = 'GPU ADMISSION READY' | 'INSUFFICIENT VRAM' | 'BUSY' | 'GPU UNAVAILABLE' | 'ERROR'

export function modelInstallLineFor(discovery: ModelDiscovery): HvsModelInstallLine {
  switch (discovery.status) {
    case 'INSTALLED': return 'MODEL INSTALLED'
    case 'INCOMPLETE': return 'MODEL INCOMPLETE'
    case 'RUNTIME_MISSING': return 'RUNTIME MISSING'
    case 'DISABLED': return 'DISABLED'
    default: return 'MODEL NOT INSTALLED'
  }
}

export function gpuAdmissionLineFor(admission: GpuAdmission, busy: boolean): HvsGpuAdmissionLine {
  if (busy || admission.state === 'MODEL_BUSY') return 'BUSY'
  if (admission.state === 'GPU_UNAVAILABLE') return 'GPU UNAVAILABLE'
  if (admission.state === 'INSUFFICIENT_VRAM') return 'INSUFFICIENT VRAM'
  if (admission.admitted) return 'GPU ADMISSION READY'
  return 'ERROR'
}

export function modelStatusLineFor(discovery: ModelDiscovery, admission: GpuAdmission, busy: boolean): HvsModelStatusLine {
  if (discovery.status === 'DISABLED') return 'DISABLED'
  if (discovery.status === 'INCOMPLETE') return 'ERROR'
  if (discovery.status !== 'INSTALLED') return 'MODEL NOT INSTALLED'
  if (busy || admission.state === 'MODEL_BUSY') return 'BUSY'
  if (admission.state === 'GPU_UNAVAILABLE') return 'GPU UNAVAILABLE'
  if (admission.state === 'INSUFFICIENT_VRAM') return 'INSUFFICIENT VRAM'
  if (admission.admitted) return 'WAN 2.2 READY'
  return 'ERROR'
}

export function generativeVideoStatus(projectId?: string | null): GenerativeVideoStatus {
  const discovery = discoverWan22()
  const busy = Boolean(q().running) || heavyLockHeld()
  const admission = decideGpuAdmission({ snapshot: snapshotGpu(), lifecycle: modelLifecycle().lifecycle, heavyLockHeld: busy })
  return {
    provider: WAN22_PROVIDER.provider,
    model: WAN22_MODEL_LABEL,
    modelStatusLine: modelStatusLineFor(discovery, admission, busy),
    modelInstallLine: modelInstallLineFor(discovery),
    gpuAdmissionLine: gpuAdmissionLineFor(admission, busy),
    discovery: {
      status: discovery.status,
      weightsInstalled: discovery.weightsInstalled,
      runtimeInstalled: discovery.runtimeInstalled,
      missingFiles: discovery.missingFiles,
      requiredBytes: discovery.requiredBytes,
      hfTotalBytes: discovery.hfTotalBytes,
      detail: discovery.detail,
      autoDownload: false,
      modelsDir: discovery.config.modelsDir,
      modelsDirSource: discovery.config.modelsDirSource,
      modelPath: discovery.config.wan22ModelPath,
      workerPython: discovery.config.workerPython,
      modelVersion: discovery.metadata.modelVersion,
      license: discovery.metadata.license,
      freeBytes: discovery.disk.freeBytes,
    },
    gpu: {
      state: admission.state,
      name: admission.snapshot.name,
      totalMiB: admission.snapshot.totalMiB,
      freeMiB: admission.snapshot.freeMiB,
      backend: admission.snapshot.backend,
      reason: admission.reason,
      compatibility: admission.policy.compatibility,
      minFreeMiB: admission.policy.minFreeMiB,
    },
    lifecycle: modelLifecycle().lifecycle,
    queue: queueSnapshot(),
    generations: projectId ? listActiveGenerations(projectId) : [],
    receipts: projectId ? listGenerationReceipts(projectId) : [],
    capabilities: [...WAN22_PROVIDER.capabilities],
  }
}

/** A deterministic fixture or fake worker is never accepted as live generation proof. */
export function isLiveGenerationProof(result: HvsGenerateVideoResult): boolean {
  return result.status === 'COMPLETE' && result.liveGeneration === true && result.fixture !== true && Boolean(result.outputAssetId)
}
