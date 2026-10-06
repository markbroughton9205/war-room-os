import {
  did,
  HVS_RAEL_CHARACTER_ID,
  HVS_RAEL_NODE_ID,
  type HvsBackgroundActor,
  type HvsBackgroundPopulation,
  type HvsBlockingPlan,
  type HvsDirectorPlan,
  type HvsDirectorShot,
  type HvsDirectorTiming,
  type HvsShotPurpose,
  type HvsStoryBeat,
} from './types'
import { defaultDirectorTiming, directorCreativeGoal } from './parse'
import { destructionStateAt } from './clock'
import { sceneTime } from './clock'
import type { CameraSpec } from '../types'
import { parseDestructionIntent } from '../destruction/intent'
import { buildDestructionPlan } from '../destruction/plan'
import { toSeconds } from '../time'

const IDS = {
  person: HVS_RAEL_NODE_ID,
  car: 'node-car',
  building: 'node-building',
  doorway: 'node-doorway',
}

export function extraNodeId(index: number): string {
  return `node-extra-${String(index + 1).padStart(2, '0')}`
}

export function layoutBackgroundActors(timing: HvsDirectorTiming): HvsBackgroundActor[] {
  const count = Math.max(12, Math.round(timing.crowdCount))
  const actors: HvsBackgroundActor[] = []
  const storefront = Math.min(3, count)
  for (let i = 0; i < count; i++) {
    const store = i < storefront
    const start = store
      ? { x: 5.4, y: 0, z: -2.2 - i * 2.1 }
      : { x: i % 2 === 0 ? -3.35 : 3.55, y: 0, z: 6.8 - (i - storefront) * 1.45 }
    const nearestToEvent = start.z < -5
    actors.push({
      id: `bg-${String(i + 1).padStart(2, '0')}`,
      ref: extraNodeId(i),
      role: store ? 'STOREFRONT' : 'WALKING',
      start,
      nearestToEvent,
      reactStartSec: nearestToEvent ? timing.crowdReactSec : timing.crowdReactSec + 0.25,
      fleeStartSec: nearestToEvent ? timing.crowdFleeSec : timing.crowdFleeSec + 0.3,
    })
  }
  return actors
}

function spec(input: {
  id: string
  name: string
  shotSize: CameraSpec['shotSize']
  angle: CameraSpec['angle']
  movement: CameraSpec['movement']
  mm: number
  framing: string
}): CameraSpec {
  return {
    id: input.id,
    name: input.name,
    shotSize: input.shotSize,
    angle: input.angle,
    movement: input.movement,
    framing: input.framing,
    subjectTargetId: IDS.person,
    lensIntent: `${input.mm}mm`,
    depthOfField: input.mm >= 70 ? 'shallow' : input.mm <= 28 ? 'deep' : 'medium',
    trackingBehavior: "TARGET LOCK RA'EL",
    trajectory: null,
    cameraId: input.id,
    focalLengthMm: input.mm,
    sensorWidthMm: 36,
    sensorHeightMm: 24,
    aperture: input.mm >= 70 ? 2 : 4,
    lookAtTargetId: IDS.person,
    aspect: '16:9',
    honesty: 'GEOMETRIC',
  }
}

function mkShot(input: {
  order: number
  beatId: string
  name: string
  purpose: HvsShotPurpose
  reason: string
  start: number
  end: number
  cameraSpec: CameraSpec
  motion: HvsDirectorShot['motionPreset']
  label: string
  constraints?: string[]
}): HvsDirectorShot {
  return {
    id: `shot-${input.order}`,
    order: input.order,
    beatId: input.beatId,
    name: input.name,
    purpose: input.purpose,
    directorReason: input.reason,
    start: sceneTime(input.start),
    end: sceneTime(input.end),
    cameraSpec: input.cameraSpec,
    motionPreset: input.motion,
    targetLock: 'PERSON',
    transitionIn: 'CUT',
    commanderLabel: input.label,
    sceneNodeCameraId: `cam-${input.order}`,
    constraints: input.constraints ?? ['KEEP_RAEL_VISIBLE'],
  }
}

export function resolveRaelIdentity(
  characters: Array<{ id: string; name: string }> | undefined,
  digitalHumans?: Array<{ id: string; displayName?: string; name?: string }> | undefined,
): string {
  const fromDh = digitalHumans?.find(item => item.id === HVS_RAEL_CHARACTER_ID || item.displayName === "Ra'el" || /^ra'?el$/i.test(item.name ?? ''))
  if (fromDh) return fromDh.id
  const existing = characters?.find(item => item.id === HVS_RAEL_CHARACTER_ID || /^ra'?el$/i.test(item.name))
  return existing?.id ?? HVS_RAEL_CHARACTER_ID
}

export function buildDirectorPlan(input: {
  prompt: string
  projectId: string
  timing?: Partial<HvsDirectorTiming>
  identityRef?: string
  now?: string
}): HvsDirectorPlan {
  const prompt = input.prompt.trim()
  const timing: HvsDirectorTiming = { ...defaultDirectorTiming(prompt), ...input.timing }
  const t = timing
  const now = input.now ?? new Date().toISOString()
  const identityRef = input.identityRef ?? HVS_RAEL_CHARACTER_ID
  const extras = layoutBackgroundActors(t)
  const population: HvsBackgroundPopulation = {
    id: 'crowd-alley',
    count: extras.length,
    honesty: 'PLACEHOLDER PEOPLE',
    actors: extras,
    reactionCue: 'MAJOR_COLLAPSE',
  }
  const blocking: HvsBlockingPlan = {
    id: 'block-rael',
    subjectRef: IDS.person,
    identityRef,
    pathId: 'path-person',
    actions: [
      { id: 'act-stand', atSec: 0, kind: 'STAND', description: "Ra'el starts beside the black car." },
      { id: 'act-walk', atSec: t.orbitStartSec, kind: 'WALK', description: "Ra'el walks toward the doorway." },
      { id: 'act-arrive', atSec: t.walkArriveSec, kind: 'ARRIVE', description: "Ra'el reaches the doorway." },
      ...(t.lookBack
        ? [
            { id: 'act-look', atSec: t.lookBackSec, kind: 'LOOK_BACK' as const, description: "Ra'el looks back at the collapse." },
            { id: 'act-turn', atSec: t.turnToCameraSec, kind: 'TURN_TO_CAMERA' as const, description: "Ra'el turns to camera." },
          ]
        : []),
      { id: 'act-hold', atSec: t.closeupStartSec, kind: 'HOLD', description: "Ra'el holds for the close-up." },
    ],
  }

  const beats: HvsStoryBeat[] = [
    {
      id: 'beat-1',
      order: 1,
      description: "Establish alley / car / Ra'el.",
      purpose: 'Geography before action changes the space.',
      start: sceneTime(0),
      end: sceneTime(t.orbitStartSec),
      subjectActions: ["Ra'el stands beside the black car."],
      environmentActions: ['Alley and building remain intact. Background actors occupy the alley.'],
      cameraIntent: `${t.establishFocalMm}mm wide establishing, then low behind the car.`,
      vfxIntent: null,
      audioIntent: 'Night alley ambience.',
    },
    {
      id: 'beat-2',
      order: 2,
      description: "Ra'el walks toward doorway.",
      purpose: 'Track the walk so the Commander reads destination.',
      start: sceneTime(t.orbitStartSec),
      end: sceneTime(t.walkArriveSec),
      subjectActions: ["Ra'el walks toward the doorway."],
      environmentActions: ['Car stays. Building stays intact.'],
      cameraIntent: `${t.orbitFocalMm}mm clockwise orbit, target locked on Ra'el.`,
      vfxIntent: null,
      audioIntent: 'Footsteps in alley.',
    },
    {
      id: 'beat-3',
      order: 3,
      description: 'Collapse begins.',
      purpose: 'Show impact without losing the hero.',
      start: sceneTime(t.collapseSec),
      end: sceneTime(t.closeupStartSec),
      subjectActions: t.lookBack
        ? ["Ra'el looks back at the collapse, then holds at the doorway."]
        : ["Ra'el holds at the doorway."],
      environmentActions: ["Building façade begins collapsing behind Ra'el."],
      cameraIntent: `${t.retreatFocalMm}mm backward track synchronized to collapse.`,
      vfxIntent: 'Debris, dust, camera shake at impact.',
      audioIntent: 'Collapse rumble.',
    },
    {
      id: 'beat-4',
      order: 4,
      description: 'Crowd reacts.',
      purpose: 'Nearby extras react only after the collapse cue.',
      start: sceneTime(t.crowdReactSec),
      end: sceneTime(t.closeupStartSec),
      subjectActions: ['Nearest background actors REACT, then MOVE_AWAY / FLEE.'],
      environmentActions: ['Collapse continues. Protected hero path stays clear.'],
      cameraIntent: 'Keep Ra\'el framed while crowd clears the edges.',
      vfxIntent: 'Dust and debris already in progress.',
      audioIntent: 'Crowd motion over rumble.',
    },
    {
      id: 'beat-5',
      order: 5,
      description: 'Final close-up.',
      purpose: "Land on Ra'el's face while dust crosses foreground.",
      start: sceneTime(t.closeupStartSec),
      end: sceneTime(t.durationSec),
      subjectActions: ["Ra'el remains at the doorway."],
      environmentActions: ['Dust crosses foreground. Building stays in collapse state.'],
      cameraIntent: `${t.closeupFocalMm}mm close-up.`,
      vfxIntent: 'Dust cue continues.',
      audioIntent: 'Dust and distant debris.',
    },
  ]

  const shots: HvsDirectorShot[] = [
    mkShot({
      order: 1,
      beatId: 'beat-1',
      name: 'Wide establishing',
      purpose: 'ESTABLISH_GEOGRAPHY',
      reason: 'Use a 24mm wide first so the alley, car, doorway, and building are established before the space changes.',
      start: 0,
      end: t.orbitStartSec / 2,
      cameraSpec: spec({
        id: 'spec-1',
        name: 'Establishing',
        shotSize: 'WS',
        angle: 'eye',
        movement: 'static',
        mm: t.establishFocalMm,
        framing: 'alley geography',
      }),
      motion: 'STATIC',
      label: 'Establishing',
      constraints: ['KEEP_RAEL_VISIBLE', 'KEEP_CAR_VISIBLE', 'BUILDING_INTACT_UNTIL_BEAT'],
    }),
    mkShot({
      order: 2,
      beatId: 'beat-1',
      name: 'Low car reveal',
      purpose: 'INTRODUCE_SUBJECT',
      reason: "Cut low behind the car so Ra'el is introduced against the vehicle he stands beside.",
      start: t.orbitStartSec / 2,
      end: t.orbitStartSec,
      cameraSpec: spec({
        id: 'spec-2',
        name: 'Low car',
        shotSize: 'MLS',
        angle: 'low',
        movement: 'static',
        mm: t.revealFocalMm,
        framing: 'low behind car',
      }),
      motion: 'REVEAL',
      label: 'Low car reveal',
      constraints: ['KEEP_RAEL_VISIBLE', 'KEEP_CAR_VISIBLE'],
    }),
    mkShot({
      order: 3,
      beatId: 'beat-2',
      name: 'Orbit',
      purpose: 'TRACK_ACTION',
      reason: "Orbit clockwise around Ra'el while he walks so the doorway he is moving toward stays readable.",
      start: t.orbitStartSec,
      end: t.orbitEndSec,
      cameraSpec: spec({
        id: 'spec-3',
        name: 'Orbit',
        shotSize: 'MS',
        angle: 'eye',
        movement: 'orbit',
        mm: t.orbitFocalMm,
        framing: "orbit Ra'el",
      }),
      motion: 'ORBIT',
      label: 'Orbit',
      constraints: ['KEEP_RAEL_VISIBLE', 'BUILDING_INTACT_UNTIL_BEAT'],
    }),
    mkShot({
      order: 4,
      beatId: 'beat-3',
      name: 'Collapse retreat',
      purpose: 'SHOW_IMPACT',
      reason: "Pull the camera backward as the façade comes down so Ra'el stays framed while the collapse reads.",
      start: t.orbitEndSec,
      end: t.closeupStartSec,
      cameraSpec: spec({
        id: 'spec-4',
        name: 'Retreat',
        shotSize: 'MS',
        angle: 'eye',
        movement: 'dolly',
        mm: t.retreatFocalMm,
        framing: 'pull back with collapse',
      }),
      motion: 'PULL_OUT',
      label: 'Collapse retreat',
      constraints: ['KEEP_RAEL_VISIBLE', 'PROTECT_HERO_REGION', 'KEEP_BACKGROUND_DESTRUCTION_VISIBLE'],
    }),
    mkShot({
      order: 5,
      beatId: 'beat-5',
      name: 'Close-up',
      purpose: 'RESOLUTION',
      reason: "An 85mm close-up isolates Ra'el while dust crossing the foreground ends the scene.",
      start: t.closeupStartSec,
      end: t.durationSec,
      cameraSpec: spec({
        id: 'spec-5',
        name: 'Close-up',
        shotSize: t.closeupFocalMm >= 80 ? 'CU' : 'MCU',
        angle: t.closeupHeight < 1.2 ? 'low' : 'eye',
        movement: 'static',
        mm: t.closeupFocalMm,
        framing: "Ra'el close-up, building in background",
      }),
      motion: 'STATIC',
      label: 'Close-up',
      constraints: ['END_ON_RAEL', 'KEEP_RAEL_VISIBLE', 'KEEP_BACKGROUND_DESTRUCTION_VISIBLE'],
    }),
  ]

  const destIntent = parseDestructionIntent({
    prompt: "Building façade begins collapsing behind Ra'el at about six seconds. Hybrid cinematic moderate. Keep Ra'el protected. Add debris when it hits.",
    projectId: input.projectId,
    sceneId: 'scene-director',
    targetRefs: [IDS.building],
  })
  destIntent.targetNodeIds = [IDS.building]
  destIntent.destructionClass = 'FACADE'
  destIntent.mode = 'HYBRID'
  destIntent.severity = 0.62
  destIntent.durationSec = Math.max(2, t.durationSec - t.collapseSec)
  destIntent.protectedRegions = [...destIntent.protectedRegions]
  const destPlan = buildDestructionPlan(destIntent)
  destPlan.status = 'DRAFT'

  return {
    schemaVersion: 1,
    id: did('dplan'),
    projectId: input.projectId,
    sceneId: null,
    prompt,
    creativeGoal: directorCreativeGoal(prompt),
    tone: 'nighttime action',
    duration: sceneTime(t.durationSec),
    aspect: '16:9',
    storyBeats: beats,
    shots,
    characters: [{
      id: identityRef,
      ref: IDS.person,
      label: "Ra'el · PLACEHOLDER CHARACTER",
      state: 'PLACEHOLDER CHARACTER',
      startRef: 'beside-car',
      endRef: 'at-doorway',
      identityRef,
      canonicalName: "Ra'el",
    }],
    elements: [
      { id: 'el-car', ref: IDS.car, kind: 'car', label: 'Black car', color: '#111111' },
      { id: 'el-building', ref: IDS.building, kind: 'building', label: 'Building façade', color: '#243044' },
      { id: 'el-doorway', ref: IDS.doorway, kind: 'doorway', label: 'Doorway', color: '#c48a4a' },
      { id: 'el-ground', ref: 'node-ground', kind: 'ground', label: 'Alley ground', color: '#141820' },
      { id: 'el-dust', ref: 'node-dust', kind: 'dust', label: 'Dust volume', color: '#9aa3ad' },
    ],
    locations: ['night alley'],
    spatialRelations: [
      { subjectRef: IDS.person, relation: 'BESIDE', objectRef: IDS.car, distanceIntent: 1.7, direction: '+X', confidence: 1 },
      { subjectRef: IDS.doorway, relation: 'IN_FRONT_OF', objectRef: IDS.person, distanceIntent: 11.5, direction: '-Z', confidence: 1 },
      { subjectRef: IDS.building, relation: 'BEHIND', objectRef: IDS.person, distanceIntent: 14, direction: '-Z', confidence: 1 },
      { subjectRef: 'cam-2', relation: 'BEHIND', objectRef: IDS.car, distanceIntent: 5.4, direction: '+Z', confidence: 1 },
      { subjectRef: IDS.person, relation: 'MOVING_TOWARD', objectRef: IDS.doorway, distanceIntent: null, direction: '-Z', confidence: 1 },
      { subjectRef: IDS.person, relation: 'FACING', objectRef: IDS.doorway, distanceIntent: null, direction: '-Z', confidence: 1 },
      { subjectRef: extras[0]?.ref ?? 'node-extra-01', relation: 'NEAR', objectRef: IDS.car, distanceIntent: 4, direction: '+X', confidence: 0.8 },
    ],
    castRefs: [identityRef],
    backgroundPopulationRefs: [population.id],
    elementRefs: ['el-car', 'el-building', 'el-doorway', 'el-ground', 'el-dust'],
    locationRefs: ['night alley'],
    cameraPlanRefs: shots.map(shot => shot.cameraSpec.id),
    blockingRefs: [blocking.id],
    cameraPlan: `24mm establish → 28mm low car → 35mm clockwise orbit (target lock Ra'el) → 35mm retreat with collapse → ${t.closeupFocalMm}mm close-up.`,
    movementPlan: `Ra'el walks from beside the car to the doorway by ${t.walkArriveSec.toFixed(1)}s. Camera orbit stays on Ra'el. Collapse at ${t.collapseSec.toFixed(1)}s. Crowd reacts at ${t.crowdReactSec.toFixed(1)}s.`,
    blockingPlan: blocking,
    backgroundPopulation: population,
    acting: {
      lookBack: t.lookBack,
      lookBackSec: t.lookBackSec,
      turnToCameraSec: t.turnToCameraSec,
      gazeTargetRef: t.lookBack ? IDS.building : null,
    },
    destructionIntent: destIntent,
    destructionPlan: destPlan,
    destructionPlanRefs: [destPlan.id],
    protectedSubjectRegion: { subjectRef: IDS.person, radiusMeters: 2.4 },
    destructionHonesty: 'GEOMETRIC_PROXY_NOT_SIMULATION',
    vfxCues: [
      { id: 'vfx-shake', kind: 'CAMERA_SHAKE', time: sceneTime(t.impactSec), linkedEvent: 'impact', execution: 'PREVIS_PLACEHOLDER', label: 'Camera shake at major impact' },
      { id: 'vfx-dust', kind: 'DUST', time: sceneTime(t.dustSec), linkedEvent: 'collapse', execution: 'PREVIS_PLACEHOLDER', label: 'Dust crosses foreground' },
      { id: 'vfx-debris', kind: 'DEBRIS', time: sceneTime(t.collapseSec), linkedEvent: 'collapse', execution: 'INTENT_ONLY', label: 'Debris with façade' },
      { id: 'vfx-smoke', kind: 'SMOKE', time: sceneTime(t.impactSec), linkedEvent: 'impact', execution: 'INTENT_ONLY', label: 'Smoke after impact' },
      { id: 'vfx-glass', kind: 'GLASS', time: sceneTime(t.impactSec), linkedEvent: 'impact', execution: 'INTENT_ONLY', label: 'Glass burst metadata' },
      { id: 'vfx-sparks', kind: 'SPARKS', time: sceneTime(t.impactSec + 0.1), linkedEvent: 'impact', execution: 'INTENT_ONLY', label: 'Sparks metadata' },
      { id: 'vfx-haze', kind: 'HAZE', time: sceneTime(t.dustSec), linkedEvent: 'collapse', execution: 'INTENT_ONLY', label: 'Haze metadata' },
      { id: 'vfx-flash', kind: 'LIGHT_FLASH', time: sceneTime(t.impactSec), linkedEvent: 'impact', execution: 'INTENT_ONLY', label: 'Impact flash metadata' },
    ],
    lightingPlan: {
      timeOfDay: 'night',
      keyDirection: 'moon from camera-left / -X',
      fillIntent: 'cool alley fill so the building stays readable',
      backlightIntent: 'warm doorway practical',
      environment: 'night alley',
      contrast: 'high',
      colorTemperatureIntent: 'cool ambient, warm practical',
      summary: "NIGHT · cool ambient · warm doorway practical · building readable · Ra'el face visible in the close-up.",
      shotOverrides: [{ shotId: 'shot-5', note: "Keep doorway warmth on Ra'el's face. Building remains readable behind him." }],
    },
    focusPlan: {
      defaultTarget: IDS.person,
      visualDof: 'PARTIAL',
      honesty: 'METADATA_PASS_VISUAL_PARTIAL',
      shots: [
        { shotId: 'shot-1', target: 'geography', focalLengthMm: t.establishFocalMm, depthOfField: 'deep', rackFrom: null },
        { shotId: 'shot-2', target: IDS.person, focalLengthMm: t.revealFocalMm, depthOfField: 'medium', rackFrom: IDS.car },
        { shotId: 'shot-3', target: IDS.person, focalLengthMm: t.orbitFocalMm, depthOfField: 'medium', rackFrom: null },
        { shotId: 'shot-4', target: IDS.person, focalLengthMm: t.retreatFocalMm, depthOfField: 'medium', rackFrom: null },
        { shotId: 'shot-5', target: IDS.person, focalLengthMm: t.closeupFocalMm, depthOfField: t.closeupFocalMm >= 75 ? 'shallow' : 'medium', rackFrom: null },
      ],
    },
    audioIntent: 'Night alley, footsteps, collapse rumble, crowd reaction, dust.',
    continuityState: {
      subjectScreenPosition: 'center',
      movementDirection: '-Z toward doorway',
      cameraSide: 'alley +Z / car rear, do not cross the line',
      axisOfAction: "car → Ra'el → doorway → building along -Z",
      propPlacement: [{ ref: IDS.car, note: 'Single black car. Same orientation unless action moves it.' }],
      characterPlacement: [{ ref: IDS.person, note: "Ra'el. Same identity across shots. Placeholder visual." }],
      lightingState: "NIGHT · cool ambient · warm doorway practical.",
      destructionStateByTime: [
        { time: sceneTime(0), state: destructionStateAt(t.collapseSec, t.impactSec, t.durationSec, 0) },
        { time: sceneTime(t.collapseSec), state: 'CRACKING' },
        { time: sceneTime(t.impactSec), state: 'COLLAPSING' },
        { time: sceneTime(t.durationSec), state: 'COLLAPSED' },
      ],
      wardrobe: "Ra'el wardrobe unchanged across the 11-second scene.",
      crowdState: `${population.count} placeholder extras. Nearest group reacts after ${t.crowdReactSec.toFixed(1)}s.`,
    },
    constraints: [
      'KEEP_RAEL_VISIBLE',
      'KEEP_CAR_VISIBLE',
      'BUILDING_INTACT_UNTIL_BEAT',
      'END_ON_RAEL',
      'DO_NOT_CROSS_AXIS',
      'PROTECT_HERO_REGION',
      'KEEP_BACKGROUND_DESTRUCTION_VISIBLE',
      `Building must remain intact until ${t.collapseSec.toFixed(1)}s.`,
    ],
    timing: t,
    approvalRequired: true,
    approvalAction: 'BUILD_PREVIS',
    status: 'proposed',
    mutated: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function scenePlanFromDirector(plan: HvsDirectorPlan): import('../director3d/types').HvsScenePlan {
  return {
    id: `sceneplan-${plan.id}`,
    intentId: plan.id,
    projectId: plan.projectId,
    title: plan.creativeGoal,
    durationLabel: `${plan.timing.durationSec} seconds`,
    environmentLabel: plan.lightingPlan.summary,
    shotCount: plan.shots.length,
    shots: plan.shots.map(shot => ({
      id: shot.id,
      order: shot.order,
      label: shot.commanderLabel,
      durationLabel: `${Math.max(1, Math.round(toSeconds(shot.end) - toSeconds(shot.start)))} sec`,
    })),
    steps: plan.shots.map(shot => ({
      id: `step-${shot.id}`,
      label: `${shot.commanderLabel} — ${shot.purpose.replace(/_/g, ' ')}`,
      doneIntent: shot.directorReason,
    })),
    status: 'proposed',
    approvalRequired: true,
    approvalAction: 'BUILD_SCENE',
    mutated: false,
    createdAt: plan.createdAt,
  }
}
