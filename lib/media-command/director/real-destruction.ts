import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fromSeconds } from '../time'
import type { HvsProject } from '../types'
import type { Hvs3DScene } from '../director3d/types'
import { evaluateScene } from '../director3d/evaluate'
import { ensureImmutableWallSource } from '../destruction/execute'
import { fractureInternalPrimitive } from '../destruction/fracture'
import { buildStructuralGraph, structuralGraphHash } from '../destruction/graph'
import { materialHash, planHash, simConfigHash } from '../destruction/plan'
import { solvePrevis } from '../destruction/physics'
import { destructionRunDir, readJsonFile, writeJsonArtifact } from '../destruction/cache'
import { playbackDocument } from '../destruction/previs'
import { DESTRUCTION_CAMERAS } from '../destruction/playback'
import { applyApprovedDestructionPatch, proposeDestructionPatch } from '../destruction/patch'
import { shortId } from '../destruction/hash'
import {
  HVS_PREVIS_SOLVER_ID,
  HVS_PREVIS_SOLVER_VERSION,
  INTERNAL_FRACTURE_ID,
  INTERNAL_FRACTURE_VERSION,
  emptyDestructionStore,
  type HvsAlleyBinding,
  type HvsDestructionEvent,
  type HvsDestructionPlan,
} from '../destruction/types'
import type { HvsDirectorPlan, HvsDirectorPrevis } from './types'
import { DIRECTOR_NODE } from './compile'
import {
  ALLEY_BUILDING_POSITION,
  ALLEY_FACADE_SCALE,
  HERO_WALK_END,
  HERO_WALK_START,
  facadeOrigin,
  measureHeroFraming,
} from './framing'

const SIM_SECONDS = 5

export type AlleyRun = {
  binding: HvsAlleyBinding
  plan: HvsDestructionPlan
  resimulated: boolean
  timingsMs: { fracture: number; simulation: number; cacheWrite: number; frameExport: number }
  bytes: { geometry: number; transforms: number; events: number; conditioning: number }
}

function executedPlan(plan: HvsDirectorPlan, prompt: string | undefined, previous: HvsDestructionPlan | null): HvsDestructionPlan {
  const destructionPrompt = Boolean(prompt && /right side/.test(prompt.toLowerCase()) && /collapse|fall|later/.test(prompt.toLowerCase()))
  if (previous && !destructionPrompt) return previous
  const base = previous ?? plan.destructionPlan
  if (!base) throw new Error('Director plan has no destruction plan.')
  if (base.performanceTier !== 'SMALL') throw new Error('MEDIUM/LARGE destruction is not authorized.')
  const away = { x: -0.35, y: -0.2, z: -1 }
  const next: HvsDestructionPlan = {
    ...base,
    forcePlan: { ...base.forcePlan, direction: away, cinematicForceOnly: true },
    guidePlan: {
      primitives: [
        ...base.guidePlan.primitives.filter(guide => guide.kind !== 'ATTRACT_FALL_DIRECTION'),
        { kind: 'ATTRACT_FALL_DIRECTION', vector: away, strengthClass: base.forcePlan.impulseClass },
      ],
    },
    simulationConfig: {
      ...base.simulationConfig,
      durationSec: Math.min(SIM_SECONDS, base.simulationConfig.durationSec),
      backend: HVS_PREVIS_SOLVER_ID,
      backendVersion: HVS_PREVIS_SOLVER_VERSION,
    },
    fracturePlan: { ...base.fracturePlan, method: 'GRID', preFractureOnly: true, runtimeFracture: false },
  }
  if (prompt && /right side/.test(prompt.toLowerCase()) && /collapse|fall|later/.test(prompt.toLowerCase())) {
    const patch = proposeDestructionPatch(next, prompt)
    return applyApprovedDestructionPatch(next, patch, true)
  }
  return next
}

function eventTime(events: HvsDestructionEvent[], type: HvsDestructionEvent['type']): number | null {
  return events.find(event => event.type === type)?.time ?? null
}

function syncNearestCrowd(scene: Hvs3DScene, plan: HvsDirectorPlan, reactSec: number): void {
  for (const extra of plan.backgroundPopulation.actors.filter(item => item.nearestToEvent)) {
    const motion = scene.paths.find(item => item.assignedNodeId === extra.ref)
    if (!motion || motion.points.length < 4) continue
    const fleeAt = Math.min(plan.timing.durationSec - 0.2, reactSec + 0.2)
    motion.points[1].time = fromSeconds(Math.min(reactSec, plan.timing.collapseSec))
    motion.points[2].time = fromSeconds(reactSec)
    motion.points[3].time = fromSeconds(Math.max(fleeAt, reactSec + 0.4))
  }
}

function paintStill(scene: Hvs3DScene, sec: number): Buffer {
  const width = 320
  const height = 180
  const pixels = Buffer.alloc(width * height * 3, 8)
  const evald = evaluateScene(scene, fromSeconds(sec, scene.duration.timescale))
  const cam = scene.cameras.find(item => item.id === evald.activeCameraId)
  const camNode = cam ? evald.nodes[cam.nodeId] : null
  const camera = camNode?.transform.position ?? { x: 0, y: 2, z: 8 }
  const look = camNode?.lookAt ?? { x: 0, y: 1, z: -4 }
  const focal = evald.focalLength || 35
  const boxes: Array<{ pos: { x: number; y: number; z: number }; color: [number, number, number] }> = []
  const hero = evald.nodes[DIRECTOR_NODE.person]?.transform.position
  const car = evald.nodes[DIRECTOR_NODE.car]?.transform.position
  const building = evald.nodes[DIRECTOR_NODE.building]?.transform.position
  if (building) boxes.push({ pos: building, color: [36, 48, 68] })
  if (car) boxes.push({ pos: car, color: [16, 16, 16] })
  if (hero) boxes.push({ pos: hero, color: [201, 162, 39] })
  const aspect = width / height
  const fov = Math.max(8, 2 * Math.atan(18 / Math.max(12, focal)) * (180 / Math.PI))
  const tan = Math.tan((fov * Math.PI) / 360)
  const fx = look.x - camera.x
  const fy = look.y - camera.y
  const fz = look.z - camera.z
  const fl = Math.hypot(fx, fy, fz) || 1
  const forward = { x: fx / fl, y: fy / fl, z: fz / fl }
  const rx = forward.y * 0 - forward.z * 1
  const ry = forward.z * 0 - forward.x * 0
  const rz = forward.x * 1 - forward.y * 0
  const rl = Math.hypot(rx, ry, rz) || 1
  const right = { x: rx / rl, y: ry / rl, z: rz / rl }
  const up = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  }
  for (const box of boxes) {
    const dx = box.pos.x - camera.x
    const dy = box.pos.y - camera.y
    const dz = box.pos.z - camera.z
    const z = dx * forward.x + dy * forward.y + dz * forward.z
    if (z < 0.2) continue
    const x = (dx * right.x + dy * right.y + dz * right.z) / (z * tan * aspect)
    const y = (dx * up.x + dy * up.y + dz * up.z) / (z * tan)
    const px = Math.round((x * 0.5 + 0.5) * width)
    const py = Math.round((1 - (y * 0.5 + 0.5)) * height)
    for (let oy = -6; oy <= 6; oy += 1) {
      for (let ox = -4; ox <= 4; ox += 1) {
        const sx = px + ox
        const sy = py + oy
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue
        const i = (sy * width + sx) * 3
        pixels[i] = box.color[0]
        pixels[i + 1] = box.color[1]
        pixels[i + 2] = box.color[2]
      }
    }
  }
  const header = `P6\n${width} ${height}\n255\n`
  return Buffer.concat([Buffer.from(header, 'ascii'), pixels])
}

export function destructionStateForShot(plan: HvsDirectorPlan, binding: HvsAlleyBinding, startSec: number, endSec: number): { start: string; end: string } {
  const label = (sec: number) => {
    if (sec + 0.05 < binding.collapseStartSec) return 'INTACT'
    if (sec < binding.majorCollapseSceneSec) return 'COLLAPSING'
    if (sec >= binding.dustCueSceneSec) return 'COLLAPSED'
    return 'COLLAPSED'
  }
  return { start: label(startSec), end: label(endSec) }
}

export function exportShotConditioning(project: HvsProject, plan: HvsDirectorPlan, scene: Hvs3DScene, binding: HvsAlleyBinding): { refs: string[]; bytes: number; ms: number } {
  const started = performance.now()
  const dir = destructionRunDir(binding.cacheManifestId)
  const refs: string[] = []
  let bytes = 0
  const packages = plan.shots.map(shot => {
    const start = shot.start.ticks / shot.start.timescale
    const end = Math.max(start, shot.end.ticks / shot.end.timescale - 0.04)
    const first = paintStill(scene, start)
    const last = paintStill(scene, end)
    const firstPath = path.join(dir, `${shot.id}-first.ppm`)
    const lastPath = path.join(dir, `${shot.id}-last.ppm`)
    writeFileSync(firstPath, first)
    writeFileSync(lastPath, last)
    bytes += first.length + last.length
    refs.push(firstPath, lastPath)
    const state = destructionStateForShot(plan, binding, start, end)
    const identity = plan.characters[0]
    return {
      projectId: project.id,
      sceneId: scene.id,
      shotId: shot.id,
      firstFrameAssetRef: firstPath,
      lastFrameAssetRef: lastPath,
      cameraSpec: shot.cameraSpec,
      cameraPathSummary: shot.cameraSpec.movement,
      shotPurpose: shot.purpose,
      duration: shot.end.ticks / shot.end.timescale - start,
      aspect: '16:9',
      characterRefs: [identity?.identityRef ?? identity?.ref ?? DIRECTOR_NODE.person],
      elementRefs: plan.elementRefs,
      lightingIntent: plan.lightingPlan.summary,
      focusIntent: shot.purpose === 'RESOLUTION' ? 'Ra\'el face, shallow' : 'scene',
      destructionStateStart: state.start,
      destructionStateEnd: state.end,
      continuityConstraints: shot.constraints,
      conditioningSupport: {
        camera: 'EXACT_GEOMETRY',
        frames: 'REFERENCE_FRAME',
        destruction: 'EXACT_GEOMETRY',
        character: 'SEMANTIC_ONLY',
      },
      character: {
        characterId: identity?.identityRef ?? null,
        label: identity?.label ?? "Ra'el · PLACEHOLDER CHARACTER",
        referenceSetVersion: null,
        wardrobeId: null,
        identityLock: 'placeholder-until-digital-human',
        performanceReferenceIds: [],
      },
      camera: {
        lens: shot.cameraSpec.focalLengthMm,
        shotSize: shot.cameraSpec.shotSize,
        angle: shot.cameraSpec.angle,
        movement: shot.cameraSpec.movement,
        framing: shot.cameraSpec.framing,
        honesty: 'GEOMETRIC',
      },
      generatorAuthorized: false as const,
    }
  })
  const pack = writeJsonArtifact(path.join(dir, 'shot-conditioning.json'), { generatorAuthorized: false, packages })
  refs.push(pack.path)
  bytes += pack.bytes
  return { refs, bytes, ms: performance.now() - started }
}

export function runAlleyDestruction(input: {
  project: HvsProject
  plan: HvsDirectorPlan
  scene: Hvs3DScene
  revisionPrompt?: string
}): AlleyRun {
  const plan = executedPlan(input.plan, input.revisionPrompt, input.project.destruction?.plan ?? null)
  const source = ensureImmutableWallSource(`${input.project.id}-alley-facade`)
  const hash = planHash(plan)
  const previous = input.project.destruction?.cache
  const previousBinding = input.project.destruction?.alleyBinding
  if (
    previous
    && previous.status === 'VALID'
    && previous.planHash === hash
    && previous.sourceGeometryHash === source.sha256
    && previous.backendVersion === HVS_PREVIS_SOLVER_VERSION
    && previousBinding
  ) {
    const collapse = input.plan.timing.collapseSec
    const simMajor = previousBinding.majorCollapseSceneSec - previousBinding.collapseStartSec
    const simDust = previousBinding.dustCueSceneSec - previousBinding.collapseStartSec
    const framing = frameShot5(input.scene, input.plan)
    const shifted: HvsAlleyBinding = {
      ...previousBinding,
      ...framing,
      collapseStartSec: collapse,
      majorCollapseSceneSec: collapse + simMajor,
      crowdReactSceneSec: collapse + simMajor + 0.15,
      shakeSceneSec: collapse + simMajor,
      dustCueSceneSec: collapse + simDust,
      simulationRuns: previous.simulationRuns,
    }
    const conditioning = exportShotConditioning(input.project, input.plan, input.scene, shifted)
    const binding: HvsAlleyBinding = {
      ...shifted,
      conditioningRefs: conditioning.refs,
      timingsMs: { fracture: 0, simulation: 0, cacheWrite: 0, frameExport: conditioning.ms },
      bytes: { geometry: 0, transforms: 0, events: 0, conditioning: conditioning.bytes },
    }
    syncNearestCrowd(input.scene, input.plan, binding.crowdReactSceneSec)
    return {
      binding,
      plan,
      resimulated: false,
      timingsMs: { fracture: 0, simulation: 0, cacheWrite: 0, frameExport: conditioning.ms },
      bytes: { geometry: 0, transforms: 0, events: 0, conditioning: conditioning.bytes },
    }
  }

  const fractureStarted = performance.now()
  const fracture = fractureInternalPrimitive({
    spec: plan.fracturePlan,
    sourcePath: source.path,
    holdRightSupport: plan.guidePlan.primitives.some(guide => guide.kind === 'PROTECT_REGION' && guide.region === 'RIGHT'),
  })
  if (fracture.backend !== INTERNAL_FRACTURE_ID || fracture.method !== 'GRID') {
    throw new Error('Alley fracture must stay INTERNAL_PRIMITIVE GRID.')
  }
  const fractureMs = performance.now() - fractureStarted
  const graph = buildStructuralGraph({ fracture, plan, sourceGeometryHash: source.sha256 })
  const simStarted = performance.now()
  const solved = solvePrevis(graph, plan)
  if (solved.backend !== HVS_PREVIS_SOLVER_ID) throw new Error('Alley physics must stay HVS_PREVIS_SOLVER.')
  const simulationMs = performance.now() - simStarted
  const runs = (previous?.simulationRuns ?? 0) + 1
  const manifestId = shortId('dcache', { plan: hash, source: source.sha256, solver: HVS_PREVIS_SOLVER_VERSION, runs })
  const dir = destructionRunDir(manifestId)
  const cacheStarted = performance.now()
  const geometry = writeJsonArtifact(path.join(dir, 'geometry.json'), fracture)
  const transforms = writeJsonArtifact(path.join(dir, 'transforms.json'), {
    fps: solved.fps,
    frameCount: solved.frameCount,
    nodes: solved.nodes,
  })
  const events = writeJsonArtifact(path.join(dir, 'events.json'), solved.events)
  const audio = writeJsonArtifact(path.join(dir, 'audio-cues.json'), solved.audioCues)
  const cameraCues = writeJsonArtifact(path.join(dir, 'camera-cues.json'), solved.cameraCues)
  const volume = writeJsonArtifact(path.join(dir, 'volume-cues.json'), {
    execution: 'VOLUME_EXECUTION_NOT_AVAILABLE',
    cues: solved.volumeCues,
  })
  const major = eventTime(solved.events, 'MAJOR_COLLAPSE') ?? plan.simulationConfig.durationSec * 0.5
  const dust = solved.volumeCues[0]?.time ?? major + 0.3
  const collapse = input.plan.timing.collapseSec
  const bindingBase: HvsAlleyBinding = {
    sceneNodeId: 'node-building',
    destructionTargetRef: plan.id,
    worldPosition: facadeOrigin(),
    facadeScale: ALLEY_FACADE_SCALE,
    units: 'meters',
    coordinateBasis: '+Y up, -Z forward',
    sourceGeometryHash: source.sha256,
    collapseStartSec: collapse,
    simDurationSec: solved.durationSec,
    fractureMethod: 'GRID',
    fractureBackend: 'INTERNAL_PRIMITIVE',
    physicsBackend: 'HVS_PREVIS_SOLVER',
    volumeExecution: 'VOLUME_EXECUTION_NOT_AVAILABLE',
    chunkCount: fracture.pieces.length,
    cacheManifestId: manifestId,
    transformHash: transforms.sha256,
    simulationRuns: runs,
    protectedRegion: {
      id: 'protect-rael',
      subjectRef: DIRECTOR_NODE.person,
      shape: 'CAPSULE',
      start: HERO_WALK_START,
      end: HERO_WALK_END,
      clearanceClass: 'CINEMATIC',
      engineeringSafety: false,
    },
    majorCollapseSceneSec: collapse + major,
    crowdReactSceneSec: collapse + major + 0.15,
    shakeSceneSec: collapse + major,
    dustCueSceneSec: collapse + dust,
    playbackRef: '',
    conditioningRefs: [],
    framingStatus: 'WARNING',
    heroVisibleFraction: 0,
    backgroundVisibleFraction: 0,
    heroFrameCoverage: 0,
    shotSizeBand: 'CLOSE_UP',
    realKernel: true,
  }
  const playback = playbackDocument({
    summary: 'Alley façade — real kernel cache',
    fps: solved.fps,
    durationSec: solved.durationSec,
    cacheManifestId: manifestId,
    transformHash: transforms.sha256,
    simulationRuns: runs,
    camera: DESTRUCTION_CAMERAS.front,
    nodes: solved.nodes,
    volumeCues: solved.volumeCues,
    cameraCues: solved.cameraCues,
    volumeExecution: 'VOLUME_EXECUTION_NOT_AVAILABLE',
    fractureBackend: INTERNAL_FRACTURE_ID,
    physicsBackend: HVS_PREVIS_SOLVER_ID,
  })
  const playbackFile = writeJsonArtifact(path.join(dir, 'playback.json'), playback)
  bindingBase.playbackRef = playbackFile.path
  const manifest = {
    id: manifestId,
    planId: plan.id,
    planHash: hash,
    structuralGraphHash: structuralGraphHash(graph),
    backend: HVS_PREVIS_SOLVER_ID,
    backendVersion: HVS_PREVIS_SOLVER_VERSION,
    fractureBackend: INTERNAL_FRACTURE_ID,
    fractureBackendVersion: INTERNAL_FRACTURE_VERSION,
    deviceClass: 'CPU_PREVIS' as const,
    timeStep: plan.simulationConfig.timeStep,
    substeps: plan.simulationConfig.substeps,
    geometryArtifacts: [geometry.path],
    transformCache: transforms.path,
    transformHash: transforms.sha256,
    volumeArtifacts: [],
    volumeExecution: 'VOLUME_EXECUTION_NOT_AVAILABLE' as const,
    eventLog: events.path,
    audioCueSheet: audio.path,
    cameraCueSheet: cameraCues.path,
    volumeCueSheet: volume.path,
    createdAt: new Date().toISOString(),
    sourceAssetHashes: [source.sha256],
    materialHash: materialHash(plan),
    simConfigHash: simConfigHash(plan),
    simulationRuns: runs,
    status: 'VALID' as const,
    invalidReason: null,
    buildingPosition: ALLEY_BUILDING_POSITION,
  }
  const manifestFile = writeJsonArtifact(path.join(dir, 'manifest.json'), manifest)
  const cacheWrite = performance.now() - cacheStarted
  const framing = frameShot5(input.scene, input.plan)
  const binding: HvsAlleyBinding = { ...bindingBase, ...framing }
  const conditioning = exportShotConditioning(input.project, input.plan, input.scene, binding)
  binding.conditioningRefs = conditioning.refs
  binding.timingsMs = { fracture: fractureMs, simulation: simulationMs, cacheWrite, frameExport: conditioning.ms }
  binding.bytes = { geometry: geometry.bytes, transforms: transforms.bytes, events: events.bytes, conditioning: conditioning.bytes }
  syncNearestCrowd(input.scene, input.plan, binding.crowdReactSceneSec)
  const store = input.project.destruction ?? emptyDestructionStore()
  input.project.destruction = {
    ...store,
    sceneId: input.scene.id,
    sourceAsset: source,
    intent: input.plan.destructionIntent,
    plan,
    graph,
    alleyBinding: binding,
    cache: {
      manifestId,
      manifestPath: manifestFile.path,
      planHash: hash,
      structuralGraphHash: manifest.structuralGraphHash,
      sourceGeometryHash: source.sha256,
      materialHash: manifest.materialHash,
      simConfigHash: manifest.simConfigHash,
      backend: HVS_PREVIS_SOLVER_ID,
      backendVersion: HVS_PREVIS_SOLVER_VERSION,
      transformHash: transforms.sha256,
      status: 'VALID',
      simulationRuns: runs,
    },
    previsTicket: {
      id: shortId('ptix', { manifestId }),
      cacheManifestId: manifestId,
      projectId: input.project.id,
      sceneId: input.scene.id,
      cameraRef: 'director-scene-clock',
      resolution: { width: 640, height: 360 },
      fps: solved.fps,
      durationSec: solved.durationSec,
      quality: 'PROXY',
      status: 'COMPLETED',
      artifactRef: transforms.path,
      playbackRef: playbackFile.path,
      summary: 'DESTRUCTION PREVIS — REAL KERNEL CACHE',
      resimulated: true,
    },
    jobIds: store.jobIds,
  }
  return {
    binding,
    plan,
    resimulated: true,
    timingsMs: { fracture: fractureMs, simulation: simulationMs, cacheWrite, frameExport: conditioning.ms },
    bytes: {
      geometry: geometry.bytes,
      transforms: transforms.bytes,
      events: events.bytes,
      conditioning: conditioning.bytes,
    },
  }
}

function frameShot5(scene: Hvs3DScene, plan: HvsDirectorPlan) {
  const shot = plan.shots.find(item => item.id === 'shot-5')
  const sec = shot ? shot.start.ticks / shot.start.timescale + 0.2 : plan.timing.closeupStartSec + 0.2
  const evald = evaluateScene(scene, fromSeconds(sec, scene.duration.timescale))
  const cam = scene.cameras.find(item => item.id === 'cam-5')
  const camNode = cam ? evald.nodes[cam.nodeId] : null
  const hero = evald.nodes[DIRECTOR_NODE.person]?.transform.position ?? HERO_WALK_END
  const car = evald.nodes[DIRECTOR_NODE.car]?.transform.position ?? { x: 0, y: 0.45, z: 0 }
  const measured = measureHeroFraming({
    camera: camNode?.transform.position ?? { x: hero.x, y: plan.timing.closeupHeight, z: hero.z + plan.timing.closeupDistance },
    lookAt: camNode?.lookAt ?? { x: hero.x, y: 1.4, z: hero.z },
    focalMm: plan.timing.closeupFocalMm,
    hero,
    buildingPoint: { x: ALLEY_BUILDING_POSITION.x, y: 6.2, z: ALLEY_BUILDING_POSITION.z + 1.1 },
    car: { center: { ...car, y: 0.7 }, half: { x: 0.9, y: 0.7, z: 2.1 } },
    heroBox: { center: { x: hero.x, y: 0.9, z: hero.z }, half: { x: 0.3, y: 0.9, z: 0.25 } },
    buildingBox: { center: ALLEY_BUILDING_POSITION, half: { x: 4, y: 4, z: 1.1 } },
  })
  return {
    framingStatus: measured.status,
    heroVisibleFraction: measured.heroVisibleFraction,
    backgroundVisibleFraction: measured.backgroundTargetVisibleFraction,
    heroFrameCoverage: measured.heroFrameCoverage,
    shotSizeBand: measured.shotSizeBand,
  }
}

export function attachAlleyDestruction(project: HvsProject, plan: HvsDirectorPlan, scene: Hvs3DScene, revisionPrompt?: string): AlleyRun {
  const run = runAlleyDestruction({ project, plan, scene, revisionPrompt })
  if (!project.destruction) return run
  project.destruction.alleyBinding = run.binding
  project.destruction.plan = run.plan
  if (!run.resimulated && project.destruction.cache) {
    project.destruction.cache = { ...project.destruction.cache, simulationRuns: run.binding.simulationRuns, status: 'VALID' }
    if (project.destruction.previsTicket) {
      project.destruction.previsTicket = { ...project.destruction.previsTicket, resimulated: false }
    }
  }
  return run
}

export function readShotStoryboard(binding: HvsAlleyBinding | null): Map<string, string> {
  const map = new Map<string, string>()
  if (!binding) return map
  const file = path.join(destructionRunDir(binding.cacheManifestId), 'storyboard.json')
  if (!existsSync(file)) return map
  const rows = readJsonFile<Array<{ shotId: string; svg: string }>>(file)
  for (const row of rows) map.set(row.shotId, row.svg)
  return map
}

export function writeShotStoryboard(binding: HvsAlleyBinding | null, previs: HvsDirectorPrevis): void {
  if (!binding) return
  writeJsonArtifact(path.join(destructionRunDir(binding.cacheManifestId), 'storyboard.json'), previs.storyboard.map(frame => ({
    shotId: frame.shotId,
    svg: frame.svg,
  })))
}

export function prepareShotConditioning(project: HvsProject, shotIds?: string[]) {
  const binding = project.destruction?.alleyBinding
  const scene = project.director3d?.scenes?.find(item => item.id === project.director3d?.activeSceneId) ?? project.director3d?.scenes?.[0]
  const plan = project.directorOrchestration?.plans.find(item => item.id === project.directorOrchestration?.activePlanId)
  if (!binding || !scene || !plan) throw new Error('Build the Director previs before exporting shot conditioning.')
  const exported = exportShotConditioning(project, plan, scene, binding)
  const refs = shotIds?.length
    ? exported.refs.filter(ref => shotIds.some(id => ref.includes(id)) || ref.endsWith('shot-conditioning.json'))
    : exported.refs
  return { refs, generatorAuthorized: false as const, mutated: false, localOnly: true as const }
}
