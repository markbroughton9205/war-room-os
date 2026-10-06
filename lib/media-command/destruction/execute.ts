import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cloneProject, type HvsProject } from '../types'
import { originalAssetPath } from '../paths'
import { createHvsJob, markJobCompleted, markJobFailed, markJobRunning, saveJob } from '../jobs'
import { productionAuthorityOk } from '../production-ai'
import { sha256Buffer, sha256Json, shortId } from './hash'
import { fractureInternalPrimitive, selectFractureBackend, type FractureArtifact } from './fracture'
import { buildStructuralGraph, structuralGraphHash } from './graph'
import { commanderSummary, materialHash, planHash, simConfigHash } from './plan'
import { solvePrevis, type PrevisSolveResult } from './physics'
import { destructionRunDir, fileBytes, readJsonFile, writeJsonArtifact } from './cache'
import { DESTRUCTION_CAMERAS, type HvsDestructionPlayback } from './playback'
import { encodeProxyMp4, measureRasterFps, playbackDocument, writeHtmlPlayer, writeProofFrames } from './previs'
import type {
  HvsDestructionCacheManifest,
  HvsDestructionIntent,
  HvsDestructionPlan,
  HvsDestructionPrevisTicket,
  HvsDestructionStore,
  HvsStructuralGraph,
} from './types'
import {
  HVS_DESTRUCTION_SCHEMA,
  HVS_PREVIS_SOLVER_ID,
  HVS_PREVIS_SOLVER_VERSION,
  INTERNAL_FRACTURE_ID,
  INTERNAL_FRACTURE_VERSION,
  REALTIME_PREVIS_FPS_THRESHOLD,
  emptyDestructionStore,
} from './types'

const SOURCE_NAME = 'HVS DESTRUCTION TEST — WALL 01'

export type DestructionRunReport = {
  ok: boolean
  error: string | null
  project: HvsProject
  resimulated: boolean
  fractureBackend: string
  physicsBackend: string
  volumeExecution: 'VOLUME_EXECUTION_NOT_AVAILABLE'
  previsBackend: string
  timingsMs: {
    fracture: number
    simulation: number
    cacheWrite: number
    previs: number
  }
  bytes: {
    fracturedGeometry: number
    simulationCache: number
    eventLog: number
    previs: number
    html: number
  }
  rasterFps: number
  realtimePrevis: 'PASS' | 'FAIL'
  realtimeThresholdFps: number
  sourceSha256: string
  transformHash: string
  cacheManifestId: string | null
  chunkCount: number
  eventCount: number
  secondaryDebris: number
}

function wallSourceJson(): string {
  return `${JSON.stringify({
    kind: 'WALL_PRIMITIVE',
    name: SOURCE_NAME,
    width: 6,
    height: 3,
    thickness: 0.22,
    materialId: 'CONCRETE',
    immutable: true,
    units: 'meters',
  }, null, 2)}\n`
}

export function ensureImmutableWallSource(assetId: string): { id: string; path: string; sha256: string; byteLength: number } {
  const file = originalAssetPath(assetId, '.json')
  if (!existsSync(file)) writeFileSync(file, wallSourceJson(), 'utf8')
  const body = readFileSync(file)
  return { id: assetId, path: file, sha256: sha256Buffer(body), byteLength: body.length }
}

function assertSmallTier(plan: HvsDestructionPlan): void {
  if (plan.performanceTier !== 'SMALL' || !plan.operationalSupport) {
    throw new Error('MEDIUM/LARGE destruction is not authorized.')
  }
}

async function runJob(projectId: string, capability: string, backend: string, outputPath: string, work: () => Promise<void> | void): Promise<string> {
  let job = saveJob(createHvsJob({
    kind: 'vfx',
    projectId,
    backend,
    parameters: { stage: capability },
    provenance: { createdBy: 'human', capability, notes: 'HVS destruction kernel. No spend. No upload.' },
    authority: { spend: false, externalUpload: false, sensitiveTransfer: false },
  }))
  job = markJobRunning(job)
  try {
    await work()
    markJobCompleted(job, { outputPath, validState: true })
    return job.id
  } catch (error) {
    markJobFailed(job, error instanceof Error ? error.message : 'destruction job failed')
    throw error
  }
}

export function cacheStillValid(store: HvsDestructionStore, plan: HvsDestructionPlan, graph: HvsStructuralGraph, sourceHash: string): boolean {
  if (!store.cache || store.cache.status !== 'VALID') return false
  return store.cache.planHash === planHash(plan)
    && store.cache.structuralGraphHash === structuralGraphHash(graph)
    && store.cache.sourceGeometryHash === sourceHash
    && store.cache.materialHash === materialHash(plan)
    && store.cache.simConfigHash === simConfigHash(plan)
    && store.cache.backendVersion === HVS_PREVIS_SOLVER_VERSION
}

export async function simulateDestruction(project: HvsProject, input: {
  plan: HvsDestructionPlan
  intent: HvsDestructionIntent
  approval: boolean
  fracture?: (artifactInput: { spec: HvsDestructionPlan['fracturePlan']; sourcePath: string; holdRightSupport: boolean }) => FractureArtifact
}): Promise<DestructionRunReport> {
  const authority = productionAuthorityOk()
  if (!authority.ok) throw new Error(authority.error)
  if (input.approval !== true) throw new Error('SIMULATE approval required.')
  assertSmallTier(input.plan)
  const snapshot = cloneProject(project)
  const empty: DestructionRunReport = {
    ok: false,
    error: null,
    project: snapshot,
    resimulated: false,
    fractureBackend: INTERNAL_FRACTURE_ID,
    physicsBackend: HVS_PREVIS_SOLVER_ID,
    volumeExecution: 'VOLUME_EXECUTION_NOT_AVAILABLE',
    previsBackend: 'THREE_JS',
    timingsMs: { fracture: 0, simulation: 0, cacheWrite: 0, previs: 0 },
    bytes: { fracturedGeometry: 0, simulationCache: 0, eventLog: 0, previs: 0, html: 0 },
    rasterFps: 0,
    realtimePrevis: 'FAIL',
    realtimeThresholdFps: REALTIME_PREVIS_FPS_THRESHOLD,
    sourceSha256: '',
    transformHash: '',
    cacheManifestId: null,
    chunkCount: 0,
    eventCount: 0,
    secondaryDebris: 0,
  }
  const source = ensureImmutableWallSource(`${project.id}-wall-source`)
  const sourceBefore = source.sha256
  try {
    const fractureBackend = selectFractureBackend()
    if (fractureBackend.id !== INTERNAL_FRACTURE_ID) {
      throw new Error('Refusing to label a non-selected fracture backend as internal.')
    }
    const manifestId = shortId('dcache', { plan: planHash(input.plan), source: source.sha256, solver: HVS_PREVIS_SOLVER_VERSION })
    const dir = destructionRunDir(manifestId)
    const planFile = path.join(dir, 'plan.json')
    const planJob = await runJob(project.id, 'DESTRUCTION_PLAN', 'hvs-plan', planFile, () => {
      writeJsonArtifact(planFile, { intent: input.intent, plan: input.plan, approval: 'SIMULATE' })
    })
    let fractureArtifact: FractureArtifact | null = null
    let geometryFile = { path: path.join(dir, 'geometry.json'), bytes: 0, sha256: '' }
    const fractureStarted = performance.now()
    const fractureJob = await runJob(project.id, 'DESTRUCTION_FRACTURE', INTERNAL_FRACTURE_ID, geometryFile.path, () => {
      fractureArtifact = (input.fracture ?? fractureInternalPrimitive)({
        spec: input.plan.fracturePlan,
        sourcePath: source.path,
        holdRightSupport: true,
      })
      if (!fractureArtifact || fractureArtifact.backend !== INTERNAL_FRACTURE_ID) {
        throw new Error('Fracture backend honesty check failed.')
      }
      geometryFile = writeJsonArtifact(geometryFile.path, fractureArtifact)
    })
    const fractureMs = performance.now() - fractureStarted
    if (!fractureArtifact) throw new Error('Fracture produced no artifact.')
    const produced = fractureArtifact as FractureArtifact
    const graph = buildStructuralGraph({ fracture: produced, plan: input.plan, sourceGeometryHash: source.sha256 })
    let solved: PrevisSolveResult | null = null
    let transforms = { path: path.join(dir, 'transforms.json'), bytes: 0, sha256: '' }
    let events = { path: path.join(dir, 'events.json'), bytes: 0, sha256: '' }
    const simStarted = performance.now()
    const simJob = await runJob(project.id, 'DESTRUCTION_SIM', HVS_PREVIS_SOLVER_ID, transforms.path, () => {
      solved = solvePrevis(graph, input.plan)
      if (!solved || solved.backend !== HVS_PREVIS_SOLVER_ID) throw new Error('Physics backend honesty check failed.')
      transforms = writeJsonArtifact(transforms.path, {
        fps: solved.fps,
        frameCount: solved.frameCount,
        nodes: solved.nodes,
      })
    })
    const simulationMs = performance.now() - simStarted
    if (!solved) throw new Error('Simulation produced no result.')
    const sim = solved as PrevisSolveResult
    const transformHash = sha256Json(sim.nodes)
    const cacheStarted = performance.now()
    events = writeJsonArtifact(events.path, sim.events)
    writeJsonArtifact(path.join(dir, 'audio-cues.json'), sim.audioCues)
    writeJsonArtifact(path.join(dir, 'camera-cues.json'), sim.cameraCues)
    writeJsonArtifact(path.join(dir, 'volume-cues.json'), {
      execution: 'VOLUME_EXECUTION_NOT_AVAILABLE',
      cues: sim.volumeCues,
    })
    writeJsonArtifact(path.join(dir, 'structural-graph.json'), graph)
    const manifest: HvsDestructionCacheManifest = {
      id: manifestId,
      planId: input.plan.id,
      planHash: planHash(input.plan),
      structuralGraphHash: structuralGraphHash(graph),
      backend: HVS_PREVIS_SOLVER_ID,
      backendVersion: HVS_PREVIS_SOLVER_VERSION,
      fractureBackend: INTERNAL_FRACTURE_ID,
      fractureBackendVersion: INTERNAL_FRACTURE_VERSION,
      deviceClass: 'CPU_PREVIS',
      timeStep: input.plan.simulationConfig.timeStep,
      substeps: input.plan.simulationConfig.substeps,
      geometryArtifacts: [geometryFile.path],
      transformCache: transforms.path,
      transformHash,
      volumeArtifacts: [],
      volumeExecution: 'VOLUME_EXECUTION_NOT_AVAILABLE',
      eventLog: events.path,
      audioCueSheet: path.join(dir, 'audio-cues.json'),
      cameraCueSheet: path.join(dir, 'camera-cues.json'),
      volumeCueSheet: path.join(dir, 'volume-cues.json'),
      createdAt: new Date().toISOString(),
      sourceAssetHashes: [source.sha256],
      materialHash: materialHash(input.plan),
      simConfigHash: simConfigHash(input.plan),
      simulationRuns: 1,
      status: 'VALID',
      invalidReason: null,
    }
    const manifestFile = writeJsonArtifact(path.join(dir, 'manifest.json'), manifest)
    const cacheJob = await runJob(project.id, 'DESTRUCTION_CACHE', 'hvs-cache', manifestFile.path, () => undefined)
    const cacheMs = performance.now() - cacheStarted
    const playback = playbackDocument({
      summary: commanderSummary(input.intent),
      fps: sim.fps,
      durationSec: sim.durationSec,
      cacheManifestId: manifestId,
      transformHash,
      simulationRuns: 1,
      camera: DESTRUCTION_CAMERAS.front,
      nodes: sim.nodes,
      volumeCues: sim.volumeCues,
      cameraCues: sim.cameraCues,
      volumeExecution: 'VOLUME_EXECUTION_NOT_AVAILABLE',
      fractureBackend: INTERNAL_FRACTURE_ID,
      physicsBackend: HVS_PREVIS_SOLVER_ID,
    })
    const previsStarted = performance.now()
    const html = writeHtmlPlayer(playback, path.join(dir, 'previs.html'))
    writeProofFrames(playback, dir)
    writeJsonArtifact(path.join(dir, 'playback-front.json'), playback)
    const mp4 = await encodeProxyMp4(playback, path.join(dir, 'previs-front.mp4'))
    const previsJob = await runJob(project.id, 'DESTRUCTION_PREVIS', mp4.backend === 'FFMPEG_PROXY' ? 'FFMPEG_PROXY' : 'HTML_CANVAS', mp4.path ?? html, () => undefined)
    const previsMs = performance.now() - previsStarted
    const rasterFps = measureRasterFps(playback)
    const ticket: HvsDestructionPrevisTicket = {
      id: shortId('dticket', { manifestId, camera: 'cam-front' }),
      cacheManifestId: manifestId,
      projectId: project.id,
      sceneId: input.intent.sceneId,
      cameraRef: 'cam-front',
      resolution: { width: 640, height: 360 },
      fps: sim.fps,
      durationSec: sim.durationSec,
      quality: 'PROXY',
      status: 'COMPLETED',
      artifactRef: mp4.path ?? html,
      playbackRef: path.join(dir, 'playback-front.json'),
      summary: playback.summary,
      resimulated: true,
    }
    const after = readFileSync(source.path)
    if (sha256Buffer(after) !== sourceBefore) throw new Error('Source geometry changed during simulation.')
    const store: HvsDestructionStore = {
      ...emptyDestructionStore(),
      schemaVersion: HVS_DESTRUCTION_SCHEMA,
      sceneId: input.intent.sceneId,
      sourceAsset: source,
      intent: input.intent,
      plan: { ...input.plan, status: 'SIMULATED' },
      graph,
      cache: {
        manifestId,
        manifestPath: manifestFile.path,
        planHash: manifest.planHash,
        structuralGraphHash: manifest.structuralGraphHash,
        sourceGeometryHash: source.sha256,
        materialHash: manifest.materialHash,
        simConfigHash: manifest.simConfigHash,
        backend: HVS_PREVIS_SOLVER_ID,
        backendVersion: HVS_PREVIS_SOLVER_VERSION,
        transformHash,
        status: 'VALID',
        simulationRuns: 1,
      },
      look: snapshot.destruction?.look ?? { tint: '#b7b1a6' },
      audioCueBinding: snapshot.destruction?.audioCueBinding ?? null,
      previsTicket: ticket,
      pendingPatch: null,
      jobIds: [planJob, fractureJob, simJob, cacheJob, previsJob],
    }
    const next = cloneProject(snapshot)
    next.destruction = store
    next.updatedAt = new Date().toISOString()
    return {
      ...empty,
      ok: true,
      project: next,
      resimulated: true,
      previsBackend: mp4.backend === 'FFMPEG_PROXY' ? 'FFMPEG_PROXY+THREE_JS' : 'HTML_CANVAS+THREE_JS',
      timingsMs: { fracture: fractureMs, simulation: simulationMs, cacheWrite: cacheMs, previs: previsMs },
      bytes: {
        fracturedGeometry: geometryFile.bytes,
        simulationCache: transforms.bytes,
        eventLog: events.bytes,
        previs: mp4.path ? fileBytes(mp4.path) : 0,
        html: fileBytes(html),
      },
      rasterFps,
      realtimePrevis: rasterFps >= REALTIME_PREVIS_FPS_THRESHOLD ? 'PASS' : 'FAIL',
      sourceSha256: source.sha256,
      transformHash,
      cacheManifestId: manifestId,
      chunkCount: produced.pieces.length,
      eventCount: sim.events.length,
      secondaryDebris: sim.nodes.filter(node => node.role === 'SECONDARY_DEBRIS').length,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'destruction failed'
    const after = existsSync(source.path) ? sha256Buffer(readFileSync(source.path)) : ''
    if (after && after !== sourceBefore) {
      return { ...empty, error: 'Source geometry was modified during a failed run.' }
    }
    return { ...empty, error: message, sourceSha256: sourceBefore }
  }
}

export async function replayDestructionCamera(project: HvsProject, camera: 'front' | 'three-quarter'): Promise<{
  project: HvsProject
  resimulated: false
  transformHash: string
  simulationRuns: number
  playback: HvsDestructionPlayback
}> {
  const store = project.destruction
  if (!store?.cache || !store.previsTicket?.playbackRef || !store.intent || !store.plan) {
    throw new Error('No destruction cache to replay.')
  }
  const cached = readJsonFile<HvsDestructionPlayback>(store.previsTicket.playbackRef)
  if (cached.transformHash !== store.cache.transformHash) throw new Error('Playback does not match the destruction cache.')
  const playback = playbackDocument({
    summary: cached.summary,
    fps: cached.fps,
    durationSec: cached.durationSec,
    cacheManifestId: store.cache.manifestId,
    transformHash: store.cache.transformHash,
    simulationRuns: store.cache.simulationRuns,
    camera: DESTRUCTION_CAMERAS[camera],
    nodes: cached.nodes,
    volumeCues: cached.volumeCues,
    cameraCues: cached.cameraCues,
    volumeExecution: 'VOLUME_EXECUTION_NOT_AVAILABLE',
    fractureBackend: cached.fractureBackend,
    physicsBackend: HVS_PREVIS_SOLVER_ID,
  })
  const dir = path.dirname(store.cache.manifestPath)
  const playbackPath = path.join(dir, `playback-${camera}.json`)
  writeJsonArtifact(playbackPath, playback)
  const html = writeHtmlPlayer(playback, path.join(dir, `previs-${camera}.html`))
  const mp4 = await encodeProxyMp4(playback, path.join(dir, `previs-${camera}.mp4`))
  const next = cloneProject(project)
  next.destruction = {
    ...store,
    previsTicket: {
      ...store.previsTicket,
      id: shortId('dticket', { manifestId: store.cache.manifestId, camera }),
      cameraRef: DESTRUCTION_CAMERAS[camera].id,
      artifactRef: mp4.path ?? html,
      playbackRef: playbackPath,
      resimulated: false,
    },
  }
  return {
    project: next,
    resimulated: false,
    transformHash: store.cache.transformHash,
    simulationRuns: store.cache.simulationRuns,
    playback,
  }
}

export function setDestructionLook(project: HvsProject, tint: string, audioCueBinding: string | null): HvsProject {
  const next = cloneProject(project)
  next.destruction = {
    ...(next.destruction ?? emptyDestructionStore()),
    look: { tint },
    audioCueBinding,
  }
  return next
}

export function invalidateDestructionCache(project: HvsProject, reason: string): HvsProject {
  const next = cloneProject(project)
  if (!next.destruction?.cache) return next
  const manifest = readJsonFile<HvsDestructionCacheManifest>(next.destruction.cache.manifestPath)
  manifest.status = 'INVALID'
  manifest.invalidReason = reason
  writeJsonArtifact(next.destruction.cache.manifestPath, manifest)
  next.destruction = {
    ...next.destruction,
    cache: { ...next.destruction.cache, status: 'INVALID' },
  }
  return next
}
