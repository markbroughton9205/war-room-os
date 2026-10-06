/**
 * HVS-GENERATIVE-VIDEO-01 — local Wan 2.2 TI2V-5B generative provider.
 * node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/media-command/hvs.generative-video-01.validation.ts
 *
 * Supervision tests use scripts/hvs/fake_generative_worker.py (FAKE, test-only, stdlib + ffmpeg testsrc).
 * Fake/fixture outputs prove ingest/provenance plumbing only and are NEVER counted as live generation.
 * Runs in an isolated app-data root under ~/.local/share/war-room-os/validation-roots (not /tmp), removed at exit.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync, closeSync, openSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail: detail.slice(0, 300) })
}
function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

// ---- Real-environment facts BEFORE isolating the data root -------------------------------------------
const realAppRoot = path.join(process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share'), 'war-room-os')
const realTools = path.join(realAppRoot, 'data', 'media-command', 'tools')
const { discoverWan22, resolveGenerativeConfig, readInstalledModelMetadata } = await import('./generative/model-storage')
const realDiscovery = discoverWan22()

// ---- Isolate -------------------------------------------------------------------------------------------
const isoRoot = path.join(realAppRoot, 'validation-roots', `hvs-gv01-${Date.now().toString(36)}`)
mkdirSync(isoRoot, { recursive: true })
process.env.WAR_ROOM_LOCAL_DATA_DIR = isoRoot
process.env.HVS_GENERATIVE_TEST_HOOKS = '1'
delete process.env.HVS_GENERATIVE_MODELS_DIR
delete process.env.HVS_WAN22_MODEL_PATH
delete process.env.HVS_GENERATIVE_WORKER_PYTHON
if (existsSync(path.join(realTools, 'ffmpeg'))) process.env.HVS_FFMPEG_PATH = path.join(realTools, 'ffmpeg')
if (existsSync(path.join(realTools, 'ffprobe'))) process.env.HVS_FFPROBE_PATH = path.join(realTools, 'ffprobe')

const types = await import('./generative/types')
const { validateGenerateVideoRequest } = await import('./generative/contract')
const { listGenerativeProviders, providersForCapability, registryIsLocalOnly } = await import('./generative/registry')
const gpu = await import('./generative/gpu-policy')
const runtime = await import('./generative/runtime')
const { runSupervisedWorker, workerEnvironment } = await import('./generative/supervisor')
const jobs = await import('./generative/jobs')
const { parseGenerateVideoUtterance } = await import('./generative/director')
const { readGenerationReceipt } = await import('./generative/receipts')
const { WAN22_REQUIRED_FILES, plannedSettings, reducedMemorySettings } = await import('./generative/providers/wan22')
const { createProject, loadProject } = await import('./store')
const { ingestFile } = await import('./ingest')
const { mediaCommandDataHierarchy } = await import('./paths')
const { emptySourceMonitor, loadAssetIntoSource } = await import('./source-monitor')
const { proposeDirectorCommands } = await import('./ai-director')
const { mayPublishAutomatically } = await import('./policy')
const { normalizeRights } = await import('./rights')
const { resolveFfmpegTools } = await import('./ffmpeg')
const { generationStateLine } = await import('./generative/status-lines')

const PY = existsSync('/usr/bin/python3') ? '/usr/bin/python3' : 'python3'
const FAKE = path.join(process.cwd(), 'scripts/hvs/fake_generative_worker.py')
const fakeHooks = (mode: NonNullable<import('./generative/jobs').GenerationTestHooks['fakeMode']>, extra: Partial<import('./generative/jobs').GenerationTestHooks> = {}) => ({
  worker: { python: PY, script: FAKE }, bypassModelGate: true, bypassGpuGate: true, fakeMode: mode, timeoutMs: 120_000, readyTimeoutMs: 30_000, ...extra,
})
const dirs = mediaCommandDataHierarchy()
const project = await createProject({ name: 'HVS GV01 validation' })
const pid = project.id
const clipCount = (p: { timeline: { tracks: Array<{ clips: unknown[] }> } }) => p.timeline.tracks.reduce((n, t) => n + t.clips.length, 0)
const clipsBefore = clipCount(project)
const PROMPT = 'Generate a 5-second cinematic nighttime city shot.'

// 1 provider registration ------------------------------------------------------------------------------
const providers = listGenerativeProviders()
expect('01_provider_registration',
  providers.length === 1 && providers[0].provider === 'wan' && providers[0].providerFamily === 'WAN' && providers[0].modelFamily === 'Wan2.2'
  && providers[0].modelVariant === 'TI2V-5B' && JSON.stringify(providers[0].capabilities) === JSON.stringify(['TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO'])
  && providersForCapability('VIDEO_TO_VIDEO').length === 0 && types.HVS_GENERATIVE_FUTURE_CAPABILITIES.length > 0
  && !source('lib/media-command/provider-registry.ts').includes('generative/') && !source('lib/media-command/creative-intelligence/provider.ts').includes('generative/'),
  `${providers.map(p => `${p.provider}:${p.modelFamily}-${p.modelVariant}`).join(',')} caps=${providers[0]?.capabilities.join('+')}`)

// 2 typed contract --------------------------------------------------------------------------------------
const good = validateGenerateVideoRequest({ projectId: pid, prompt: 'cinematic nighttime city', durationSeconds: 5, width: 1280, height: 704, fps: 24, seed: 42, modelPreference: 'wan2.2-ti2v-5b' })
const badCases: Array<[string, unknown]> = [
  ['dur0', { projectId: pid, prompt: 'abc city', durationSeconds: 0 }],
  ['dur6', { projectId: pid, prompt: 'abc city', durationSeconds: 6 }],
  ['durNaN', { projectId: pid, prompt: 'abc city', durationSeconds: Number.NaN }],
  ['size', { projectId: pid, prompt: 'abc city', durationSeconds: 3, width: 1920, height: 1080 }],
  ['fps', { projectId: pid, prompt: 'abc city', durationSeconds: 3, fps: 30 }],
  ['seed', { projectId: pid, prompt: 'abc city', durationSeconds: 3, seed: -1 }],
  ['short', { projectId: pid, prompt: 'a', durationSeconds: 3 }],
  ['long', { projectId: pid, prompt: 'x'.repeat(5000), durationSeconds: 3 }],
  ['model', { projectId: pid, prompt: 'abc city', durationSeconds: 3, modelPreference: 'grok-video' }],
  ['project', { projectId: '../etc', prompt: 'abc city', durationSeconds: 3 }],
]
const badRejected = badCases.filter(([, body]) => { const v = validateGenerateVideoRequest(body); return !v.ok && v.error.code === 'INVALID_GENERATION_REQUEST' })
expect('02_typed_contract',
  good.ok && badRejected.length === badCases.length && JSON.stringify(types.HVS_GENERATION_STATUSES) === JSON.stringify(['QUEUED', 'LOADING_MODEL', 'GENERATING', 'ENCODING', 'INGESTING', 'COMPLETE', 'FAILED', 'CANCELLED'])
  && types.framesForDuration(5) === 121 && types.framesForDuration(1) === 25,
  `good=${good.ok} rejected=${badRejected.length}/${badCases.length} frames5=${types.framesForDuration(5)}`)

// 3 no arbitrary command ------------------------------------------------------------------------------
const forbiddenBodies = ['command', 'shell', 'bash', 'pythonCode', 'script', 'sourceImagePath', 'inputImagePath', 'outputPath', 'modelPath', 'env', 'url']
  .map(key => validateGenerateVideoRequest({ projectId: pid, prompt: 'abc city', durationSeconds: 3, [key]: 'rm -rf /' }))
const pathAsAsset = validateGenerateVideoRequest({ projectId: pid, prompt: 'abc city', durationSeconds: 3, sourceImageAssetId: '/home/chosenone/x.png' })
const genSources = ['types', 'contract', 'registry', 'model-storage', 'gpu-policy', 'runtime', 'supervisor', 'jobs', 'receipts', 'director', 'status-lines', 'providers/wan22']
  .map(f => source(`lib/media-command/generative/${f}.ts`)).join('\n')
const supervisorSrc = source('lib/media-command/generative/supervisor.ts')
const routeSrc = source('app/api/media-command/generate-video/route.ts')
expect('03_no_arbitrary_command',
  forbiddenBodies.every(v => !v.ok) && !pathAsAsset.ok
  && supervisorSrc.includes('spawn(options.python, [options.script]') && !/shell:\s*true/.test(genSources) && !/\bexec(Sync)?\(/.test(genSources)
  && routeSrc.includes('HVS_GENERATION_FORBIDDEN_KEYS') && !routeSrc.includes('testHooks') && source('lib/media-command/generative/jobs.ts').includes("process.env.HVS_GENERATIVE_TEST_HOOKS === '1'"),
  `forbidden rejected=${forbiddenBodies.filter(v => !v.ok).length}/${forbiddenBodies.length} pathAsAsset=${!pathAsAsset.ok}`)

// 4 model discovery -------------------------------------------------------------------------------------
const synthModels = path.join(isoRoot, 'synthetic-models')
const synthModel = path.join(synthModels, 'Wan2.2-TI2V-5B')
for (const row of WAN22_REQUIRED_FILES) {
  const file = path.join(synthModel, row.path)
  mkdirSync(path.dirname(file), { recursive: true })
  closeSync(openSync(file, 'w'))
  truncateSync(file, row.bytes) // sparse: no real disk use
}
writeFileSync(path.join(synthModel, 'README.md'), '---\nlicense: apache-2.0\npipeline_tag: text-to-video\n---\n# synthetic\n')
const synthEnv = { ...process.env, HVS_GENERATIVE_MODELS_DIR: synthModels }
const noMeta = discoverWan22(synthEnv)
writeFileSync(path.join(synthModel, 'hvs-install-manifest.json'), JSON.stringify({ hfRevision: '921dbaf3f1674a56f47e83fb80a34bac8a8f203e' }))
const withMeta = discoverWan22(synthEnv)
truncateSync(path.join(synthModel, 'Wan2.2_VAE.pth'), 1024)
const incomplete = discoverWan22(synthEnv)
const disabled = discoverWan22({ ...synthEnv, HVS_WAN22_ENABLED: '0' })
const emptyMeta = readInstalledModelMetadata(path.join(isoRoot, 'nope'))
expect('04_model_discovery',
  noMeta.weightsInstalled && noMeta.status === 'RUNTIME_MISSING' && noMeta.metadata.modelVersion === null && noMeta.metadata.license === 'apache-2.0'
  && withMeta.metadata.modelVersion === '921dbaf3f1674a56f47e83fb80a34bac8a8f203e' && withMeta.metadata.modelVersionSource === 'hvs-install-manifest'
  && incomplete.status === 'INCOMPLETE' && disabled.status === 'DISABLED' && emptyMeta.modelVersion === null && emptyMeta.modelVersionSource === 'UNKNOWN'
  && resolveGenerativeConfig(synthEnv).modelsDirSource === 'env' && realDiscovery.autoDownload === false,
  `real=${realDiscovery.status} modelsDir=${realDiscovery.config.modelsDir}(${realDiscovery.config.modelsDirSource}) synth=${noMeta.status}/${withMeta.metadata.modelVersion?.slice(0, 8)} incomplete=${incomplete.status}`)

// 5 model missing ----------------------------------------------------------------------------------------
const missing = await jobs.submitGenerateVideo({ projectId: pid, prompt: 'cinematic nighttime city', durationSeconds: 2 })
const isoModelDir = resolveGenerativeConfig().wan22ModelPath
expect('05_model_missing_state',
  missing.status === 'FAILED' && missing.error?.code === 'MODEL_NOT_INSTALLED' && !existsSync(isoModelDir) && /never auto-downloads/i.test(missing.error?.message ?? ''),
  `${missing.status} ${missing.error?.code} realStatus=${realDiscovery.status}`)

// 6 GPU status ------------------------------------------------------------------------------------------
const snap = gpu.snapshotGpu()
const fakeSnap = (free: number, total = 16311) => ({ ...snap, present: true, backend: 'CUDA' as const, totalMiB: total, freeMiB: free, name: 'synthetic', holders: [] })
const sNone = gpu.decideGpuAdmission({ snapshot: { ...snap, present: false, backend: 'NONE', totalMiB: null, freeMiB: null }, lifecycle: 'UNLOADED', heavyLockHeld: false })
const sLow = gpu.decideGpuAdmission({ snapshot: fakeSnap(4078), lifecycle: 'UNLOADED', heavyLockHeld: false })
const sBusy = gpu.decideGpuAdmission({ snapshot: fakeSnap(16000), lifecycle: 'UNLOADED', heavyLockHeld: true })
const sFree = gpu.decideGpuAdmission({ snapshot: fakeSnap(16000), lifecycle: 'UNLOADED', heavyLockHeld: false })
const sReady = gpu.decideGpuAdmission({ snapshot: fakeSnap(16000), lifecycle: 'READY', heavyLockHeld: false })
const realAdmission = gpu.decideGpuAdmission({ snapshot: snap, lifecycle: 'UNLOADED', heavyLockHeld: false })
expect('06_gpu_status',
  sNone.state === 'GPU_UNAVAILABLE' && sLow.state === 'INSUFFICIENT_VRAM' && sBusy.state === 'MODEL_BUSY' && sFree.state === 'MODEL_NOT_LOADED' && sFree.admitted
  && sReady.state === 'AVAILABLE' && sLow.policy.compatibility === 'UNTESTED_BELOW_OFFICIAL_24GB' && JSON.stringify(gpu.NVIDIA_SMI_GPU_QUERY).includes('--format=csv'),
  `real: ${snap.name} total=${snap.totalMiB} free=${snap.freeMiB} backend=${snap.backend} state=${realAdmission.state} holders=${snap.holders.slice(0, 2).map(h => `${h.processName.split('/').pop()}:${h.usedMiB}`).join(',')}`)

// 7 + 8 queue / one heavy job ---------------------------------------------------------------------------
const qa = await jobs.submitGenerateVideo({ projectId: pid, prompt: 'queue clip one city lights', durationSeconds: 1, seed: 7 }, { testHooks: fakeHooks('success-fixture') })
const qb = await jobs.submitGenerateVideo({ projectId: pid, prompt: 'queue clip two harbor fog', durationSeconds: 1, seed: 8 }, { testHooks: fakeHooks('success-fixture') })
let maxConcurrent = 0
let lockSeenHeld = false
let lockStolen = false
let lifecycleStates = new Set<string>()
for (let i = 0; i < 1200; i++) {
  const a = jobs.getGeneration(qa.generationId)
  const b = jobs.getGeneration(qb.generationId)
  const active = [a, b].filter(r => r && ['LOADING_MODEL', 'GENERATING', 'ENCODING', 'INGESTING'].includes(r.status)).length
  maxConcurrent = Math.max(maxConcurrent, active)
  if (active > 0) {
    if (runtime.heavyLockHeld()) lockSeenHeld = true
    const steal = runtime.tryAcquireHeavyLock('thief')
    if (steal) { lockStolen = true; steal.release() }
  }
  lifecycleStates.add(runtime.modelLifecycle().lifecycle)
  if (a && b && types.isTerminalGenerationStatus(a.status) && types.isTerminalGenerationStatus(b.status)) break
  await sleep(25)
}
const ra = await jobs.waitForGeneration(qa.generationId)!
const rb = await jobs.waitForGeneration(qb.generationId)!
const jobFiles = existsSync(path.join(dirs.jobs, pid)) ? JSON.parse(readFileSync(path.join(dirs.jobs, pid, `${ra.jobId}.json`), 'utf8')) as { kind: string; backend: string; status: string } : null
expect('07_queue', qb.status === 'QUEUED' && ra.status === 'COMPLETE' && rb.status === 'COMPLETE' && jobFiles?.kind === 'provider' && jobFiles.backend === 'local-wan22' && jobFiles.status === 'COMPLETED',
  `a=${ra.status} b=${rb.status} job=${jobFiles?.kind}/${jobFiles?.backend}/${jobFiles?.status}`)
expect('08_one_heavy_job', maxConcurrent === 1 && lockSeenHeld && !lockStolen && !runtime.heavyLockHeld() && runtime.modelLifecycle().lifecycle === 'UNLOADED',
  `maxConcurrent=${maxConcurrent} lockHeld=${lockSeenHeld} stolen=${lockStolen} lifecycles=${[...lifecycleStates].join('>')}`)

// 9 cancellation ----------------------------------------------------------------------------------------
const assetsBeforeCancel = (await loadProject(pid))!.assets.length
const hang = await jobs.submitGenerateVideo({ projectId: pid, prompt: 'cancel me slow pan', durationSeconds: 2 }, { testHooks: fakeHooks('hang') })
const queuedBehind = await jobs.submitGenerateVideo({ projectId: pid, prompt: 'cancel me while queued', durationSeconds: 2 }, { testHooks: fakeHooks('success-fixture') })
for (let i = 0; i < 400 && jobs.getGeneration(hang.generationId)?.status !== 'GENERATING'; i++) await sleep(25)
const sawProgress = jobs.getGeneration(hang.generationId)?.progress
const cq = jobs.cancelGeneration(queuedBehind.generationId)
jobs.cancelGeneration(hang.generationId)
const hangDone = await jobs.waitForGeneration(hang.generationId)!
const assetsAfterCancel = (await loadProject(pid))!.assets.length
const hangOut = path.join(dirs.projects, pid, 'generations', hang.generationId, `wan22-${hang.generationId}.mp4`)
expect('09_cancellation',
  hangDone.status === 'CANCELLED' && hangDone.error?.code === 'CANCELLED' && !hangDone.outputAssetId && cq?.status === 'CANCELLED' && assetsAfterCancel === assetsBeforeCancel && !existsSync(hangOut),
  `running=${hangDone.status} queued=${cq?.status} assets ${assetsBeforeCancel}->${assetsAfterCancel} progress=${JSON.stringify(sawProgress)}`)

// 10 timeout (direct supervisor: process group incl. grandchild must be gone) -------------------------
const tOut = await runSupervisedWorker({
  python: PY, script: FAKE, timeoutMs: 5_000, readyTimeoutMs: 5_000, killGraceMs: 500,
  input: { fakeMode: 'hang', outputPath: path.join(dirs.tmp, 'never.mp4'), frames: 25, width: 1280, height: 704, fps: 24, seed: 1 },
})
const timeoutViaQueue = await jobs.submitGenerateVideo({ projectId: pid, prompt: 'timeout path check', durationSeconds: 1 }, { testHooks: fakeHooks('hang', { timeoutMs: 5_000 }) })
const timeoutDone = await jobs.waitForGeneration(timeoutViaQueue.generationId)!
expect('10_timeout', tOut.error?.code === 'GENERATION_TIMEOUT' && tOut.processGroupKilled && tOut.processGroupGone === true && timeoutDone.error?.code === 'GENERATION_TIMEOUT',
  `${tOut.error?.code} groupGone=${tOut.processGroupGone} queue=${timeoutDone.error?.code} ${tOut.durationMs}ms`)

// 11 worker crash ---------------------------------------------------------------------------------------
const crash = await jobs.waitForGeneration((await jobs.submitGenerateVideo({ projectId: pid, prompt: 'crash path check', durationSeconds: 1 }, { testHooks: fakeHooks('crash') })).generationId)!
const crashLoad = await runSupervisedWorker({ python: PY, script: FAKE, timeoutMs: 20_000, input: { fakeMode: 'crash-load' } })
const loadFail = await jobs.waitForGeneration((await jobs.submitGenerateVideo({ projectId: pid, prompt: 'load fail check', durationSeconds: 1 }, { testHooks: fakeHooks('load-fail') })).generationId)!
const noOutput = await jobs.waitForGeneration((await jobs.submitGenerateVideo({ projectId: pid, prompt: 'no output check', durationSeconds: 1 }, { testHooks: fakeHooks('no-output') })).generationId)!
expect('11_worker_crash',
  crash.status === 'FAILED' && crash.error?.code === 'GENERATION_FAILED' && /crashed/.test(crash.error?.message ?? '') && crashLoad.error?.code === 'MODEL_LOAD_FAILED'
  && loadFail.error?.code === 'MODEL_LOAD_FAILED' && noOutput.error?.code === 'ENCODE_FAILED' && crashLoad.processGroupGone === true,
  `crash=${crash.error?.code} crashLoad=${crashLoad.error?.code} loadFail=${loadFail.error?.code} noOutput=${noOutput.error?.code}`)

// 12 OOM mapping + bounded reduced-memory retry ---------------------------------------------------------
const oom = await jobs.waitForGeneration((await jobs.submitGenerateVideo({ projectId: pid, prompt: 'oom path check', durationSeconds: 5 }, { testHooks: fakeHooks('oom') })).generationId)!
const oomRetry = await jobs.waitForGeneration((await jobs.submitGenerateVideo({ projectId: pid, prompt: 'oom then retry harbor at dusk', durationSeconds: 5, seed: 99 }, { testHooks: fakeHooks('oom-then-success') })).generationId)!
const reduced = reducedMemorySettings(plannedSettings({ projectId: pid, prompt: 'x y z', durationSeconds: 5 }, 1))
expect('12_oom_mapping',
  oom.error?.code === 'GPU_OUT_OF_MEMORY' && oom.attempts === 2 && /model=Wan2\.2-TI2V-5B/.test(oom.error.message) && /resolution=1280x704/.test(oom.error.message) && /frames=49/.test(oom.error.message)
  && oomRetry.status === 'COMPLETE' && oomRetry.attempts === 2 && oomRetry.requested?.frames === 121 && oomRetry.actual?.frames === 49 && oomRetry.actual?.memoryMode === 'REDUCED_MEMORY_RETRY'
  && reduced.offloadModel && reduced.t5Cpu && reduced.convertModelDtype && jobs.MAX_GENERATION_ATTEMPTS === 2
  && reduced.frames === 49 && reducedMemorySettings(reduced).frames === 25 && reducedMemorySettings(reduced).durationSeconds > 0,
  `oom=${oom.error?.code} attempts=${oom.attempts} retry=${oomRetry.status} req=${oomRetry.requested?.frames} act=${oomRetry.actual?.frames}`)

// 13 + 14 output containment / no /tmp final asset ------------------------------------------------------
const escape = await jobs.waitForGeneration((await jobs.submitGenerateVideo({ projectId: pid, prompt: 'escape path check', durationSeconds: 1 }, { testHooks: fakeHooks('escape-path') })).generationId)!
const genDirFile = path.join(dirs.projects, pid, 'generations', ra.generationId, `wan22-${ra.generationId}.mp4`)
expect('13_output_path_containment',
  jobs.isContainedOutputPath(genDirFile) && !jobs.isContainedOutputPath('/tmp/x.mp4') && !jobs.isContainedOutputPath(path.join(dirs.mediaCommandRoot, '..', 'escape.mp4'))
  && !jobs.isContainedOutputPath(path.join(tmpdir(), 'x.mp4')) && escape.error?.code === 'ENCODE_FAILED' && existsSync(genDirFile),
  `escape=${escape.error?.code} stagedOutput=${existsSync(genDirFile)}`)
const finalPath = ra.outputPath ?? ''
expect('14_no_tmp_final_asset',
  finalPath.startsWith(dirs.originals + path.sep) && !finalPath.startsWith('/tmp/') && !finalPath.startsWith(path.resolve(tmpdir()) + path.sep),
  finalPath)

// 15 – 17 ingest / provenance / AssetRecord -------------------------------------------------------------
const afterProject = (await loadProject(pid))!
const asset = afterProject.assets.find(a => a.id === ra.outputAssetId)
const params = (asset?.provenance?.parameters?.hvsGeneration ?? {}) as Record<string, unknown>
const jobsSrc = source('lib/media-command/generative/jobs.ts')
expect('15_real_ingest_integration',
  Boolean(asset) && jobsSrc.includes("import { ingestFile } from '../ingest'") && jobsSrc.includes("import { probeMediaFile } from '../probe'") && Boolean(asset?.proxyPath && existsSync(asset.proxyPath)),
  `asset=${asset?.id} proxy=${Boolean(asset?.proxyPath)}`)
expect('16_provenance',
  asset?.provenance?.origin === 'generated' && asset.provenance.provider === 'wan' && asset.provenance.model === 'Wan2.2-TI2V-5B' && asset.provenance.providerJobId === ra.generationId
  && asset.provenance.promptHash === createHash('sha256').update('queue clip one city lights').digest('hex') && asset.provenance.seed === 7
  && params.localGeneration === true && params.synthetic === true && params.generationId === ra.generationId && params.providerFamily === 'WAN' && params.modelFamily === 'Wan2.2'
  && params.modelVariant === 'TI2V-5B' && params.liveMarker === 'FIXTURE' && Boolean(params.requested) && Boolean(params.actual) && typeof params.generatedAt === 'string' && params.fixture === true && params.liveGeneration === false
  && asset.provenance.externalTransfer?.transferred === false,
  `origin=${asset?.provenance?.origin} model=${asset?.provenance?.model} fixture=${params.fixture} live=${params.liveGeneration} version=${params.modelVersion ?? 'null(UNKNOWN)'}`)
const fileHash = asset ? createHash('sha256').update(readFileSync(asset.originalPath)).digest('hex') : ''
expect('17_asset_record_creation',
  asset?.generated === true && asset.kind === 'video' && asset.immutableOriginal === true && asset.checksumSha256 === fileHash && asset.duration.ticks > 0
  && Boolean(asset.width && asset.height) && asset.rights?.state === 'UNKNOWN' && asset.rights.commercialOk === false && asset.role === 'ORIGINAL',
  `kind=${asset?.kind} ${asset?.width}x${asset?.height} rights=${asset?.rights?.state}`)

// image-to-video fixture path (AssetRecord-only source image)
const tools = await resolveFfmpegTools()
const pngTmp = path.join(dirs.tmp, 'gv01-source.png')
if (tools.ffmpeg) execFileSync(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x176', '-frames:v', '1', pngTmp])
const imgIngest = await ingestFile({ project: (await loadProject(pid))!, sourcePath: pngTmp, originalName: 'gv01-source.png', mimeType: 'image/png' })
const i2v = await jobs.waitForGeneration((await jobs.submitGenerateVideo({ projectId: pid, prompt: 'animate the skyline softly', durationSeconds: 1, sourceImageAssetId: imgIngest.asset.id }, { testHooks: fakeHooks('success-fixture') })).generationId)!
const notFound = await jobs.submitGenerateVideo({ projectId: pid, prompt: 'missing source image', durationSeconds: 1, sourceImageAssetId: 'asset-does-not-exist' }, { testHooks: fakeHooks('success-fixture') })
const i2vAsset = (await loadProject(pid))!.assets.find(a => a.id === i2v.outputAssetId)
const i2vParams = (i2vAsset?.provenance?.parameters?.hvsGeneration ?? {}) as Record<string, unknown>
const i2vOk = i2v.status === 'COMPLETE' && i2v.capability === 'IMAGE_TO_VIDEO' && i2vParams.sourceImageAssetId === imgIngest.asset.id && i2vAsset?.provenance?.parentAssetId === imgIngest.asset.id && notFound.error?.code === 'SOURCE_ASSET_NOT_FOUND'

// 18 Source monitor ------------------------------------------------------------------------------------
const sm = asset ? loadAssetIntoSource(emptySourceMonitor(), asset) : null
const panelSrc = source('components/war-room/higher-vision-studios/HvsGenerateVideoPanel.tsx')
const editorSrc = source('components/war-room/higher-vision-studios/HvsEditorShell.tsx')
expect('18_source_monitor_discoverability',
  sm?.selectedAssetId === asset?.id && (sm?.sourceDuration.ticks ?? 0) > 0 && panelSrc.includes('?sourceAsset=') && editorSrc.includes("get('sourceAsset')") && editorSrc.includes('selectAssetForSource(requested)'),
  `source=${sm?.selectedAssetId} dur=${sm?.sourceDuration.ticks}`)

// 19 no auto timeline insert ---------------------------------------------------------------------------
expect('19_no_auto_timeline_insert', clipCount((await loadProject(pid))!) === clipsBefore && !jobsSrc.includes('insertClip') && !jobsSrc.includes('appendClip') && !jobsSrc.includes('commitCommands'),
  `clips ${clipsBefore}->${clipCount((await loadProject(pid))!)}`)

// 20 Director typed op ---------------------------------------------------------------------------------
const dir = proposeDirectorCommands((await loadProject(pid))!, PROMPT)
const op = dir.generativeOps?.[0]
const opValid = op ? validateGenerateVideoRequest({ ...op.request, projectId: pid }) : null
const legacy = proposeDirectorCommands((await loadProject(pid))!, 'Generate an establishing shot.')
const voice = proposeDirectorCommands((await loadProject(pid))!, 'Generate a voice line.', 'AI_DIRECTOR')
const nl = parseGenerateVideoUtterance(PROMPT, { projectId: pid })
const dirSrc = source('lib/media-command/ai-director.ts')
expect('20_director_typed_op',
  op?.op === 'hvs.generate.video' && op.execute === false && op.request.durationSeconds === 5 && /nighttime city/.test(op.request.prompt) && Boolean(opValid?.ok)
  && dir.commands.length === 0 && dir.jobProposal?.execute === false && legacy.jobProposal?.status === 'BLOCKED_PENDING_APPROVAL' && legacy.requiresSpendApproval === true
  && !voice.generativeOps && voice.commands.length === 0 && nl?.op.request.prompt === 'cinematic nighttime city shot'
  && !dirSrc.includes('generative/jobs') && !dirSrc.includes('generative/supervisor'),
  `op=${op?.op} prompt="${op?.request.prompt}" dur=${op?.request.durationSeconds} commands=${dir.commands.length} legacy=${legacy.jobProposal?.status}`)

// 21 UI model state ------------------------------------------------------------------------------------
const disc = (status: string, installed = false) => ({ ...realDiscovery, status, weightsInstalled: installed, runtimeInstalled: installed }) as typeof realDiscovery
const realStatus = jobs.generativeVideoStatus(pid)
const lines = [
  jobs.modelStatusLineFor(disc('MODEL_NOT_INSTALLED'), sFree, false),
  jobs.modelStatusLineFor(disc('INSTALLED', true), sLow, false),
  jobs.modelStatusLineFor(disc('INSTALLED', true), sFree, true),
  jobs.modelStatusLineFor(disc('INSTALLED', true), sFree, false),
  jobs.modelStatusLineFor(disc('INCOMPLETE'), sFree, false),
  jobs.modelStatusLineFor(disc('INSTALLED', true), sNone, false),
]
expect('21_ui_model_state',
  JSON.stringify(lines) === JSON.stringify(['MODEL NOT INSTALLED', 'INSUFFICIENT VRAM', 'BUSY', 'WAN 2.2 READY', 'ERROR', 'GPU UNAVAILABLE'])
  && realStatus.modelStatusLine !== 'WAN 2.2 READY' && panelSrc.includes("?? 'CHECKING…'")
  && jobs.modelInstallLineFor(disc('INSTALLED', true)) === 'MODEL INSTALLED' && jobs.modelInstallLineFor(disc('MODEL_NOT_INSTALLED')) === 'MODEL NOT INSTALLED'
  && jobs.modelInstallLineFor(disc('INCOMPLETE')) === 'MODEL INCOMPLETE' && jobs.modelInstallLineFor(disc('RUNTIME_MISSING')) === 'RUNTIME MISSING'
  && jobs.gpuAdmissionLineFor(sLow, false) === 'INSUFFICIENT VRAM' && jobs.gpuAdmissionLineFor(sFree, false) === 'GPU ADMISSION READY'
  && jobs.gpuAdmissionLineFor(sFree, true) === 'BUSY' && jobs.gpuAdmissionLineFor(sNone, false) === 'GPU UNAVAILABLE'
  && realStatus.modelInstallLine === 'MODEL NOT INSTALLED' && typeof realStatus.gpuAdmissionLine === 'string'
  && panelSrc.includes('data-testid="hvs-generate-install-status"') && panelSrc.includes('data-testid="hvs-generate-gpu-admission"') && panelSrc.includes("status?.modelStatusLine === 'WAN 2.2 READY'") && panelSrc.includes('data-testid="hvs-generate-model-status"'),
  `lines=${lines.join('|')} isolatedLine=${realStatus.modelStatusLine} install=${realStatus.modelInstallLine} admission=${realStatus.gpuAdmissionLine}`)

// 22 UI generation state -------------------------------------------------------------------------------
const studioSrc = source('components/war-room/higher-vision-studios/HvsAiCreateStudio.tsx')
const stateLines = [generationStateLine({ ...ra }), generationStateLine({ ...ra, status: 'GENERATING', progress: { step: 3, totalSteps: 50 } }), generationStateLine(oom), generationStateLine({ ...ra, status: 'LOADING_MODEL', progress: null })]
expect('22_ui_generation_state',
  panelSrc.includes('data-testid="hvs-generate-state"') && panelSrc.includes("from '@/lib/media-command/generative/status-lines'") && studioSrc.includes('<HvsGenerateVideoPanel') && studioSrc.includes("Final generated footage isn't enabled yet")
  && stateLines[0].startsWith('COMPLETE') && stateLines[1] === 'GENERATING · step 3/50' && stateLines[2].startsWith('FAILED · GPU_OUT_OF_MEMORY') && stateLines[3] === 'LOADING MODEL' && !stateLines.some(l => l.includes('%')),
  stateLines.map(l => l.slice(0, 60)).join(' | '))

// 23 – 24 cloud / Grok boundary ------------------------------------------------------------------------
const workerSrc = source('scripts/hvs/wan22_worker.py')
const installerSrc = source('scripts/hvs/install-wan22.sh')
const pathOnly = (s: string) => s.split('\n').filter(l => !/^\s*(\*|\/\/|#)/.test(l)).join('\n')
expect('23_no_cloud_provider_dependency',
  registryIsLocalOnly() && !/\bfetch\(/.test(pathOnly(genSources)) && !/from '[^']*(provider-adapters|provider-router|creative-intelligence|provider-registry)[^']*'/.test(genSources)
  && !/import (dashscope|requests|openai|anthropic)|from (dashscope|openai|anthropic)/.test(workerSrc) && workerSrc.includes('install_network_guard()')
  && !/\"dashscope/.test(installerSrc) && workerEnvironment().HF_HUB_OFFLINE === '1',
  `localOnly=${registryIsLocalOnly()} offline=${workerEnvironment().HF_HUB_OFFLINE}`)
process.env.XAI_API_KEY = 'xai-validation-dummy'
process.env.OPENAI_API_KEY = 'sk-validation-dummy'
const wEnv = workerEnvironment({ HVS_X: '1', XAI_API_KEY: 'xai-leak' } as Record<string, string>)
delete process.env.XAI_API_KEY
delete process.env.OPENAI_API_KEY
const grokRe = /\bgrok\b|xai|x\.ai|XAI_API_KEY|OPENAI_API_KEY|ANTHROPIC|GEMINI_API_KEY|live-completer/i
expect('24_no_grok_runtime_dependency',
  !grokRe.test(pathOnly(genSources)) && !grokRe.test(pathOnly(workerSrc)) && !grokRe.test(pathOnly(routeSrc)) && !('XAI_API_KEY' in wEnv) && !('OPENAI_API_KEY' in wEnv) && wEnv.HVS_X === '1',
  `envKeys=${Object.keys(wEnv).length}`)

// 25 – 27 authority boundaries -------------------------------------------------------------------------
const mw = source('middleware.ts')
expect('25_no_auth_weakening', mw.includes('api/health') && !mw.includes('generate-video') && !routeSrc.includes('export const config')
  && routeSrc.includes("import { requireCommanderSession } from '@/lib/security/commanderSession'") && (routeSrc.match(/await requireCommanderSession\(/g) ?? []).length === 2 && !/skipAuth|bypassAuth|public: true/i.test(routeSrc),
  'middleware covers /api/media-command/generate-video')
expect('26_no_rights_weakening', normalizeRights(asset?.rights).commercialOk === false && !jobsSrc.includes("'OWNABLE'") && !jobsSrc.includes("'AI_GENERATED'") && jobsSrc.includes('unknownRights('),
  `rights=${asset?.rights?.state}`)
expect('27_no_publish_authority', mayPublishAutomatically() === false && !/publish|deliver-presets|render-engine/.test(pathOnly(genSources).replace(/mayPublish/g, '')),
  'no publish path')

// 28 protected core hashes (reuses the HVS-WORKFLOW-DISCIPLINE-01 baseline manifest list) -------------
const protectedPaths = [
  'lib/media-command/ffmpeg.ts', 'lib/media-command/rights.ts', 'lib/media-command/policy.ts', 'lib/media-command/ingest.ts',
  'lib/media-command/preview-engine.ts', 'lib/media-command/render-engine.ts', 'lib/media-command/director3d/blender-audit.ts',
  'lib/media-command/character-production/authority.ts',
]
const manifestFile = '/home/chosenone/Codex/hvs-workflow-discipline-01-baseline/BASELINE_MANIFEST.json'
let drift = -1
if (existsSync(manifestFile)) {
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { files: Array<{ path: string; sha256: string }> }
  drift = protectedPaths.filter(rel => manifest.files.find(f => f.path === rel)?.sha256 !== createHash('sha256').update(readFileSync(path.join(process.cwd(), rel))).digest('hex')).length
}
expect('28_protected_core_hashes', drift === 0, `drift=${drift}`)

// 29 fixture never accepted as live ---------------------------------------------------------------------
const receipt = readGenerationReceipt(pid, ra.generationId)
expect('29_fixture_not_live_generation',
  !jobs.isLiveGenerationProof(ra) && ra.fixture === true && ra.liveGeneration === false && receipt?.liveGeneration === false && receipt.fixture === true && source('scripts/hvs/fake_generative_worker.py').includes('TEST ONLY'),
  `fixture=${ra.fixture} live=${ra.liveGeneration} receiptLive=${receipt?.liveGeneration}`)

// 30 canonical safety -----------------------------------------------------------------------------------
const pkg = JSON.parse(source('package.json')) as { scripts: Record<string, string> }
const projRaw = readFileSync(path.join(dirs.projects, `${pid}.hvsproj`), 'utf8')
const projJson = JSON.parse(projRaw) as Record<string, unknown>
const receiptSize = receipt ? statSync(path.join(dirs.projects, pid, 'generations', ra.generationId, 'receipt.json')).size : 0
let zombies = ''
try { zombies = execFileSync('pgrep', ['-af', 'fake_generative_worker'], { encoding: 'utf8' }).trim() } catch { zombies = '' }
expect('30_canonical_safety',
  pkg.scripts['validate:hvs-generative-video-01']?.includes('hvs.generative-video-01.validation.ts') && pkg.scripts['validate:hvs'].includes('hvs.generative-video-01.validation.ts')
  && !('generations' in projJson) && !('generativeQueue' in projJson) && receiptSize > 0 && receiptSize < 16_384 && receipt?.localGeneration === true && receipt.network === 'none'
  && !zombies && !runtime.heavyLockHeld() && runtime.modelLifecycle().lifecycle === 'UNLOADED' && i2vOk,
  `receipt=${receiptSize}B zombies=${zombies ? 'YES' : 'none'} i2v=${i2vOk} lifecycle=${runtime.modelLifecycle().lifecycle}`)

// ---- Live generation: only with real installed weights + admitted GPU + explicit opt-in ---------------
let live = 'NOT_RUN'
let liveDetail = `model=${realDiscovery.status} gpu=${realAdmission.state}`
if (realDiscovery.status === 'INSTALLED' && realAdmission.admitted && process.env.HVS_GV01_LIVE === '1') {
  live = 'ATTEMPTED'
  liveDetail = 'live run must be executed against the real data root via the API; not inside the isolated validator root.'
}

rmSync(isoRoot, { recursive: true, force: true })
const failed = results.filter(r => !r.pass)
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} — ${r.detail}`)
console.log(`MODEL_DISCOVERY_REAL ${realDiscovery.status} modelsDir=${realDiscovery.config.modelsDir} python=${realDiscovery.workerPythonExists ? 'present' : 'missing'}`)
console.log(`GPU_REAL ${snap.name} total=${snap.totalMiB}MiB free=${snap.freeMiB}MiB admission=${realAdmission.state}`)
console.log(`LIVE_GENERATION ${live} ${liveDetail}`)
console.log(`HVS_GENERATIVE_VIDEO_01 ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
if (failed.length) process.exit(1)
process.exit(0)
