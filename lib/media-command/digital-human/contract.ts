/**
 * War Room → HVS digital-human contract.
 * Commander authorizes identity. Director may direct performance.
 * Casting uses the open production and does not open a new project.
 */
import type { HvsProject } from '../types'
import { assertIdentityAuthority } from './authority'
import {
  assignReference,
  buildBackgroundPopulation,
  castRole,
  compileLookDoorway,
  createFictionalHuman,
  proposePatch,
} from './direction'
import { authorizeRael } from './rael'
import { buildActorAScene, buildCoordinationScene, overlayScenePerformance } from './scene'
import { checkpointIdentity } from './checkpoint'
import { runCharacterQc } from './qc'
import { recordPerformanceTake, startPerformanceCapture, stopPerformanceCapture } from './capture'
import { previewPerformance as previewCapturedPerformance } from './retarget'
import { loadPerformanceFrames } from './movenet'
import { bindHumanoidRig, resolveCharacterBody } from './humanoid-rig'
import { compactHumanoidPoses, humanoidPreviewPayload } from './humanoid-retarget'
import { humanoidPoseCacheKey, type HvsDirectorPerformanceTrack } from './scene-performance'
import { zeroTime } from '../time'
import type { Hvs3DScene } from '../director3d/types'
import {
  HVS_HUMANOID_RIG_ID,
  HVS_HUMANOID_RIG_V1,
  RAEL_CHARACTER_ID,
  dhId,
  emptyDigitalHumanStore,
  type HvsAuthorityActor,
  type HvsCaptureMode,
  type HvsCastRoleType,
  type HvsDigitalHuman,
  type HvsDigitalHumanStore,
  type HvsHumanGenerationBlueprint,
  type HvsLipSyncPlan,
  type HvsPerformancePatch,
  type HvsVoiceBinding,
} from './types'
import { sceneTime } from '../director/clock'

const compactPoseCache = new Map<string, ReturnType<typeof compactHumanoidPoses>>()

export function ensureDigitalHumanStore(project: HvsProject): HvsDigitalHumanStore {
  if (!project.digitalHumans) project.digitalHumans = emptyDigitalHumanStore()
  project.digitalHumans.calibrations ??= []
  project.digitalHumans.performanceEdits ??= []
  project.digitalHumans.crowdMotionUses ??= []
  return project.digitalHumans
}

function mirror(project: HvsProject, human: HvsDigitalHuman): void {
  const record = {
    id: human.id,
    name: human.displayName,
    role: human.characterClass,
    notes: human.identityClass,
    referenceAssetIds: [...human.referenceAssetIds],
    identityMorphing: 'off' as const,
  }
  const existing = project.characters.find(item => item.id === human.id)
  if (existing) Object.assign(existing, record)
  else project.characters.push(record)
}

export function getCharacter(project: HvsProject, characterId: string): HvsDigitalHuman | null {
  return ensureDigitalHumanStore(project).characters.find(item => item.id === characterId) ?? null
}

export function castCharacter(
  project: HvsProject,
  input: { characterId?: string; displayName?: string; roleName: string; roleType: HvsCastRoleType; actor: HvsAuthorityActor },
): HvsDigitalHuman {
  const store = ensureDigitalHumanStore(project)
  const wanted = (input.displayName ?? '').toLowerCase()
  let human = input.characterId
    ? store.characters.find(item => item.id === input.characterId) ?? null
    : store.characters.find(item => item.displayName.toLowerCase() === wanted || item.name === wanted) ?? null
  if (!human && /ra.?el/i.test(input.displayName ?? input.roleName)) {
    human = authorizeRael(store, input.actor)
    human.projectScope = project.id
    mirror(project, human)
    checkpointIdentity(project, "Identity enrollment — Ra'el")
  }
  if (!human) throw new Error('That character is not in this production.')
  castRole(store, project.id, { roleName: input.roleName, characterId: human.id, roleType: input.roleType })
  return human
}

export function createFictionalActor(
  project: HvsProject,
  input: { displayName: string; role: string; appearanceIntent?: string | null; actor: HvsAuthorityActor },
): HvsDigitalHuman {
  if (input.actor !== 'commander' && input.actor !== 'director') {
    throw new Error('A fictional actor needs a director or the Commander.')
  }
  const store = ensureDigitalHumanStore(project)
  const { human, creation } = createFictionalHuman({
    displayName: input.displayName,
    role: input.role,
    creation: {
      role: input.role,
      ageIntent: null,
      appearanceIntent: input.appearanceIntent ?? null,
      wardrobeIntent: null,
      personalityIntent: null,
      voiceIntent: null,
      performanceIntent: null,
    },
  })
  human.projectScope = project.id
  store.characters.push(human)
  store.creationIntents.push(creation)
  mirror(project, human)
  castRole(store, project.id, { roleName: input.role, characterId: human.id, roleType: /presenter/i.test(input.role) ? 'PRESENTER' : 'SUPPORTING' })
  return human
}

export function createBackgroundPopulation(
  project: HvsProject,
  input: { count: number; profile?: string; walking?: number; standing?: number; collapseAtSec?: number },
) {
  const store = ensureDigitalHumanStore(project)
  const walking = input.walking ?? Math.max(0, input.count - (input.standing ?? 0))
  const standing = input.standing ?? 0
  const population = buildBackgroundPopulation({
    count: input.count,
    profile: input.profile ?? 'alley',
    walking,
    standing,
    collapseAtSec: input.collapseAtSec,
  })
  store.populations.push(population)
  return population
}

export function directPerformance(project: HvsProject, prompt: string, actor: HvsAuthorityActor = 'commander') {
  const store = ensureDigitalHumanStore(project)
  const text = prompt.trim()
  if (/webcam (take|performance)|use my webcam/i.test(text)) {
    const take = [...store.takes].reverse().find(item => item.selected) ?? store.takes.at(-1)
    if (!take) throw new Error('Start capture before assigning a webcam take. The camera stays off until then.')
    const actorA = store.characters.find(item => item.displayName === 'Actor A')
    const characterId = /actor a/i.test(text) ? actorA?.id ?? null : /ra'?el/i.test(text) ? RAEL_CHARACTER_ID : take.characterId
    const acting = store.actingIntents.find(item => /look back|collapse/i.test(`${item.objective} ${item.headIntent ?? ''}`))
    const shots = project.cinemaDirector?.plans.flatMap(plan => plan.shots) ?? []
    const shot = shots.find(item => /look back|collapse/i.test(`${item.name} ${item.description}`))
    const hesitant = /hesitant/i.test(text)
    const ref = assignReference(store, {
      takeId: take.id,
      characterId,
      shotId: /shot 3|looks back|collapse/i.test(text) ? acting?.shotId ?? shot?.id ?? null : null,
      actingIntentId: acting?.id ?? shot?.actingIntentIds?.[0] ?? null,
      semanticModifier: hesitant ? 'Make the performance more hesitant.' : null,
    })
    if (hesitant && characterId) proposePatch(store, characterId, 'CHANGE_INTENSITY', 'Captured walk stays. Hesitation is a modifier.')
    return { kind: 'reference' as const, characterId, populationId: null, sceneId: null, summary: `Assigned ${take.label}`, referenceId: ref.id }
  }
  if (/same motion for actor a/i.test(text)) {
    const take = [...store.takes].reverse().find(item => item.selected) ?? store.takes.at(-1)
    if (!take) throw new Error('Capture a take before reusing it.')
    const human = store.characters.find(item => item.displayName === 'Actor A')
      ?? createFictionalActor(project, { displayName: 'Actor A', role: 'fictional lead', actor })
    const ref = assignReference(store, { takeId: take.id, characterId: human.id })
    return { kind: 'reference' as const, characterId: human.id, populationId: null, sceneId: null, summary: `Same motion for ${human.displayName}`, referenceId: ref.id }
  }
  if (/take slower|make that take slower/i.test(text)) {
    const take = [...store.takes].reverse().find(item => item.selected) ?? store.takes.at(-1)
    const human = store.characters.find(item => item.id === take?.characterId) ?? store.characters.find(item => item.id === RAEL_CHARACTER_ID)
    if (!human) throw new Error('Cast a character before changing a take.')
    const patch = proposePatch(store, human.id, 'CHANGE_SPEED', 'Make that take slower. Proposal only. The source take stays unchanged.')
    return { kind: 'patch' as const, characterId: human.id, populationId: null, sceneId: null, summary: patch.summary, referenceId: take?.id }
  }
  if (/actor a/i.test(text) && /doorway/i.test(text)) {
    const human = store.characters.find(item => item.displayName === 'Actor A')
      ?? createFictionalActor(project, { displayName: 'Actor A', role: 'fictional lead', actor })
    const scene = buildActorAScene(project, store, human.id)
    return { kind: 'acting' as const, characterId: human.id, populationId: null, sceneId: scene.scene.id, summary: human.displayName }
  }
  if (/ra'?el/i.test(text) && /close-up|collaps|background|wide/i.test(text)) {
    const human = getCharacter(project, RAEL_CHARACTER_ID) ?? castCharacter(project, { displayName: "Ra'el", roleName: 'lead', roleType: 'LEAD', actor })
    let population = store.populations[0]
    if (!population) population = createBackgroundPopulation(project, { count: 12, profile: 'alley', walking: 9, standing: 3, collapseAtSec: 6 })
    const scene = buildCoordinationScene(project, store, population.id)
    return { kind: 'scene' as const, characterId: human.id, populationId: population.id, sceneId: scene.id, summary: "Ra'el, crowd, collapse" }
  }
  if (/12 background|background people|background actors|extras/i.test(text) && /alley|collapse|storefront/i.test(text)) {
    const count = Number(text.match(/\b(\d+)\b/)?.[1] ?? 12)
    const population = createBackgroundPopulation(project, {
      count,
      profile: 'alley',
      walking: Math.max(0, count - 3),
      standing: Math.min(3, count),
      collapseAtSec: 6,
    })
    return { kind: 'crowd' as const, characterId: null, populationId: population.id, sceneId: null, summary: `${population.count} background people` }
  }
  if (/cast ra'?el/i.test(text)) {
    const human = castCharacter(project, { displayName: "Ra'el", roleName: 'lead', roleType: 'LEAD', actor })
    return { kind: 'cast' as const, characterId: human.id, populationId: null, sceneId: null, summary: "Cast Ra'el as the lead" }
  }
  if (/fictional woman|presenter role/i.test(text)) {
    const human = createFictionalActor(project, { displayName: 'Presenter', role: 'presenter', appearanceIntent: 'fictional woman', actor })
    return { kind: 'fictional' as const, characterId: human.id, populationId: null, sceneId: null, summary: 'Fictional presenter' }
  }
  if (/same actress|keep the same actress/i.test(text)) {
    const heroine = [...store.characters].reverse().find(item => item.identityClass === 'FICTIONAL')
    if (!heroine) throw new Error('There is no actress in this production to keep.')
    castRole(store, project.id, { roleName: 'same actress', characterId: heroine.id, roleType: 'LEAD' })
    return { kind: 'continuity' as const, characterId: heroine.id, populationId: null, sceneId: null, summary: `Keep ${heroine.displayName}` }
  }
  if (/crowd react|extras react|react later/i.test(text)) {
    const population = store.populations[0]
    if (population) population.reactionBehavior = 'FLEE'
    const human = store.characters[0]
    if (human) proposePatch(store, human.id, 'CHANGE_BLOCKING', 'Have the crowd react later.')
    return { kind: 'crowd' as const, characterId: human?.id ?? null, populationId: population?.id ?? null, sceneId: null, summary: 'Crowd reaction stays bound to the collapse.' }
  }
  if (/add (\d+) background|add background actors|background actors/i.test(text)) {
    const digit = text.match(/\b(\d+)\b/)
    const count = digit ? Number(digit[1]) : /\btwelve\b/i.test(text) ? 12 : /\btwenty\b/i.test(text) ? 20 : /\bten\b/i.test(text) ? 10 : 10
    const population = createBackgroundPopulation(project, { count, profile: 'background', walking: count, standing: 0 })
    return { kind: 'crowd' as const, characterId: null, populationId: population.id, sceneId: null, summary: `${count} background actors` }
  }
  if (/more serious|look worried|glance|jacket|react/i.test(text)) {
    const human = store.characters.find(item => /ra'?el/i.test(item.displayName)) ?? store.characters[0]
    if (!human) throw new Error('Cast a character before directing them.')
    const patch = reviseFromPrompt(store, human.id, text)
    return { kind: 'patch' as const, characterId: human.id, populationId: store.populations[0]?.id ?? null, sceneId: null, summary: patch.summary }
  }
  if (/look at the doorway|hesitate|answer calmly/i.test(text)) {
    const human = store.characters.find(item => /ra'?el/i.test(item.displayName)) ?? store.characters[0]
    if (!human) throw new Error('Cast a character before directing them.')
    const directed = compileLookDoorway(store, human.id, null, 0, 4)
    directed.acting.objective = 'Look at the doorway, hesitate, then answer calmly.'
    directed.acting.emotion = 'NEUTRAL'
    directed.acting.speechIntent = 'Answer calmly'
    return { kind: 'acting' as const, characterId: human.id, populationId: null, sceneId: null, summary: directed.acting.objective }
  }
  throw new Error('HVS did not map that actor direction.')
}

export function reviseFromPrompt(store: HvsDigitalHumanStore, characterId: string, text: string): HvsPerformancePatch {
  if (/serious/i.test(text)) return proposePatch(store, characterId, 'CHANGE_EMOTION', 'Make the performance more serious.')
  if (/worried/i.test(text)) return proposePatch(store, characterId, 'CHANGE_EMOTION', 'Make him look worried.')
  if (/glance/i.test(text)) return proposePatch(store, characterId, 'CHANGE_GAZE', 'Glance behind him.')
  if (/jacket|wardrobe/i.test(text)) return proposePatch(store, characterId, 'CHANGE_WARDROBE', 'Change the jacket. Proposal only.')
  if (/react/i.test(text)) {
    const population = store.populations[0]
    if (population && !population.reaction) {
      population.reactionBehavior = 'FLEE'
    }
    return proposePatch(store, characterId, 'CHANGE_BLOCKING', 'Have the extras react to the collapse.')
  }
  return proposePatch(store, characterId, 'CHANGE_INTENSITY', text)
}

export function assignPerformanceReference(
  project: HvsProject,
  input: { takeId: string; characterId?: string | null; shotId?: string | null; actingIntentId?: string | null; semanticModifier?: string | null },
) {
  return assignReference(ensureDigitalHumanStore(project), input)
}

export function prepareVoiceBinding(actor: HvsAuthorityActor, voiceClass: HvsVoiceBinding['voiceClass']): HvsVoiceBinding {
  assertIdentityAuthority(actor, 'VOICE_ENROLLMENT')
  return {
    providerNeutralId: dhId('voice'),
    voiceClass,
    providerBindings: [],
    localModelRef: null,
    consentState: voiceClass === 'COMMANDER_AUTHORIZED' ? 'COMMANDER_SELF_AUTHORIZED' : 'EXPLICIT_AUTHORITY_REQUIRED',
    enrolled: false,
  }
}

export function prepareLipSyncPlan(characterId: string): HvsLipSyncPlan {
  return {
    id: dhId('lip'),
    characterId,
    audioAssetId: null,
    transcriptRef: null,
    phonemeTrack: null,
    timing: { start: sceneTime(0), end: sceneTime(1) },
    emotionRef: null,
    backendPreference: null,
    modelInstalled: false,
  }
}

export function generationBlueprint(project: HvsProject, characterId: string): HvsHumanGenerationBlueprint {
  const store = ensureDigitalHumanStore(project)
  const human = store.characters.find(item => item.id === characterId)
  if (!human) throw new Error('Character not found.')
  const blueprint: HvsHumanGenerationBlueprint = {
    id: dhId('print'),
    characterId,
    referenceAssetIds: [...human.referenceAssetIds],
    wardrobeSetId: human.activeWardrobeSetId,
    poseId: store.poses.find(item => item.characterId === characterId)?.id ?? null,
    performanceReferenceId: store.references.find(item => item.characterId === characterId)?.id ?? null,
    shotId: null,
    lighting: null,
    voiceRef: human.voiceBinding?.providerNeutralId ?? null,
    lipsyncRef: null,
    continuityConstraints: ['provider ids are not identity'],
    invoked: false,
  }
  store.blueprints.push(blueprint)
  return blueprint
}

export function promoteBackgroundActor(project: HvsProject, populationId: string, instanceId: string, actor: HvsAuthorityActor): HvsDigitalHuman {
  if (actor !== 'commander') throw new Error('Only the Commander may promote an extra.')
  const store = ensureDigitalHumanStore(project)
  const population = store.populations.find(item => item.id === populationId)
  const instance = population?.instances.find(item => item.id === instanceId)
  if (!population || !instance) throw new Error('Extra not found.')
  const { human } = createFictionalHuman({
    displayName: 'Waiter',
    role: 'promoted extra',
    creation: { role: 'promoted extra', ageIntent: null, appearanceIntent: null, wardrobeIntent: null, personalityIntent: null, voiceIntent: null, performanceIntent: null },
  })
  human.characterClass = 'BACKGROUND_SYNTHETIC'
  human.persistence = 'PERSISTENT'
  human.lodDefault = 'MEDIUM'
  store.characters.push(human)
  mirror(project, human)
  population.instances = population.instances.map(item => item.id === instanceId ? { ...item, persistent: false, identity: 'NON_PERSISTENT_SYNTHETIC' } : item)
  return human
}

export const DigitalHumanHVS = {
  castCharacter,
  createFictionalActor,
  createBackgroundPopulation,
  startPerformanceCapture: (project: HvsProject, input: { characterId?: string | null; mode?: HvsCaptureMode; actor: HvsAuthorityActor }) => {
    const store = ensureDigitalHumanStore(project)
    return startPerformanceCapture(store, input)
  },
  stopPerformanceCapture: (project: HvsProject, sessionId: string) => stopPerformanceCapture(ensureDigitalHumanStore(project), sessionId),
  assignPerformanceReference,
  directPerformance,
  getCharacter,
  capturePerformance: (project: HvsProject, input: { characterId?: string | null; mode?: HvsCaptureMode; actor: HvsAuthorityActor }) => {
    const store = ensureDigitalHumanStore(project)
    return startPerformanceCapture(store, input)
  },
  recordPerformanceTake: (project: HvsProject, sessionId: string, frames?: number) => {
    const store = ensureDigitalHumanStore(project)
    const session = store.captureSessions.find(item => item.id === sessionId)
    if (!session) throw new Error('Capture session not found.')
    return recordPerformanceTake(project, store, session, frames)
  },
  previewPerformance: (project: HvsProject, takeId: string) => {
    const store = ensureDigitalHumanStore(project)
    const take = store.takes.find(item => item.id === takeId)
    if (!take) throw new Error('Performance take not found.')
    const motion = store.motions.find(item => item.id === take.motionRef)
    const frames = loadPerformanceFrames(motion)
    const calibration = [...store.calibrations].reverse().find(item => item.characterId === take.characterId) ?? null
    return previewCapturedPerformance({ characterId: take.characterId, frames, calibration })
  },
  bindHumanoidRig: (project: HvsProject, characterId: string = RAEL_CHARACTER_ID) => {
    const store = ensureDigitalHumanStore(project)
    return bindHumanoidRig(store, characterId)
  },
  resolveCharacterBody: (project: HvsProject, characterId: string = RAEL_CHARACTER_ID) => {
    return resolveCharacterBody(ensureDigitalHumanStore(project), characterId)
  },
  previewHumanoidBody: (project: HvsProject, takeId?: string) => {
    const store = ensureDigitalHumanStore(project)
    const resolved = resolveCharacterBody(store)
    const take = store.takes.find(item => item.id === (takeId ?? resolved.takeId)) ?? null
    if (!take) throw new Error('Performance take not found.')
    const motion = store.motions.find(item => item.id === take.motionRef)
    const frames = loadPerformanceFrames(motion)
    const calibration = [...store.calibrations].reverse().find(item => item.characterId === take.characterId) ?? null
    const payload = humanoidPreviewPayload(frames, calibration)
    const profile = store.characters.find(item => item.id === RAEL_CHARACTER_ID)?.rigBinding.motionRetargetProfile ?? HVS_HUMANOID_RIG_V1
    const key = humanoidPoseCacheKey(HVS_HUMANOID_RIG_ID, take.id, take.motionRef, profile)
    const poses = compactHumanoidPoses(payload.poses)
    if (!compactPoseCache.has(key)) compactPoseCache.set(key, poses)
    return {
      ...payload,
      takeId: take.id,
      motionId: take.motionRef,
      characterId: take.characterId,
      quality: take.quality,
      duration: take.duration,
      rigAssignment: store.characters.find(item => item.id === RAEL_CHARACTER_ID)?.rigBinding ?? null,
      poses,
      cacheHit: false,
      cacheKey: key,
      fallbackLabel: 'PLACEHOLDER RETARGET',
    }
  },
  attachDirectorPerformance: (project: HvsProject, scene: Hvs3DScene) => {
    const store = ensureDigitalHumanStore(project)
    const bound = overlayScenePerformance(store, scene)
    const tracks: HvsDirectorPerformanceTrack[] = []
    for (const character of bound.characters) {
      if (!character.performanceTakeId) continue
      if (character.digitalHumanId && character.digitalHumanId !== RAEL_CHARACTER_ID) continue
      const take = store.takes.find(item => item.id === character.performanceTakeId)
      if (!take) continue
      const motion = store.motions.find(item => item.id === take.motionRef)
      const frames = loadPerformanceFrames(motion)
      const calibration = [...store.calibrations].reverse().find(item => item.characterId === take.characterId) ?? null
      const profile = store.characters.find(item => item.id === RAEL_CHARACTER_ID)?.rigBinding.motionRetargetProfile ?? HVS_HUMANOID_RIG_V1
      const key = humanoidPoseCacheKey(character.rigRef ?? HVS_HUMANOID_RIG_ID, take.id, take.motionRef, profile)
      let poses = compactPoseCache.get(key)
      if (!poses) {
        poses = compactHumanoidPoses(humanoidPreviewPayload(frames, calibration).poses)
        compactPoseCache.set(key, poses)
      }
      tracks.push({
        characterId: character.id,
        nodeId: character.nodeId,
        digitalHumanId: character.digitalHumanId ?? take.characterId,
        takeId: take.id,
        motionId: take.motionRef,
        rigId: character.rigRef ?? HVS_HUMANOID_RIG_ID,
        retargetProfile: profile,
        startTime: character.performanceStartTime ?? zeroTime(bound.duration.timescale),
        takeDuration: take.duration,
        lastSampleTicks: poses[poses.length - 1]?.ticks ?? 0,
        policy: character.performancePlayback ?? 'HOLD_LAST',
        poses,
      })
    }
    return { scene: bound, tracks }
  },
  runCharacterQc: (project: HvsProject) => runCharacterQc(ensureDigitalHumanStore(project)),
}
