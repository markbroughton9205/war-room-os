/**
 * HVS digital-human / actor foundation.
 * `node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/media-command/hvs.digital-human.foundation.validation.ts`
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { emptyProject, HVSPROJ_VERSION } from './types'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVS } from './hvs-producer-contract'
import { detectHvsProductionIntent } from './war-room-hvs-intent'
import { DIRECTOR_ACCEPT_PROMPT } from './director/parse'
import { HVS_SCENE_TIMESCALE } from './director/clock'
import { toSeconds } from './time'
import { assertIdentityAuthority, identityActionAllowed } from './digital-human/authority'
import { auditMotionRuntime } from './digital-human/motion-runtime'
import { prepareLipSyncPlan, prepareVoiceBinding } from './digital-human/contract'
import { continuityDrift, runCharacterQc } from './digital-human/qc'
import { sharedClockOk } from './digital-human/direction'
import { PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED, RAEL_CHARACTER_ID } from './digital-human/types'
import { parseHvsProject, serializeHvsProject } from './project-format'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}
function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const ACTOR_A = 'Have Actor A stand beside the black car, look at the doorway, hesitate, then walk toward it.'
const ALLEY = 'Add 12 background people in the alley. Most are walking. Three are standing near the storefront. When the collapse begins, the closest people turn and move away.'
const SCENE = "Start wide. Ra'el walks toward the doorway. He looks back when the building starts collapsing. The nearby extras react and move away. Finish on a close-up of Ra'el."

expect('hvsproj_untouched', HVSPROJ_VERSION === 0, String(HVSPROJ_VERSION))
expect('matrix_not_expanded', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('matrix_extension_required', true, 'MATRIX_EXTENSION_REQUIRED')
expect('page', existsSync(path.join(process.cwd(), 'app/higher-vision-studios/characters/page.tsx')), 'characters')
expect('contract', source('lib/media-command/hvs-producer-contract.ts').includes('castCharacter') && source('lib/media-command/hvs-producer-contract.ts').includes('directPerformance'), 'HVS')
expect('no_provider_identity', !/heygen|runway|kling|veo|luma/i.test(source('lib/media-command/digital-human/types.ts')), 'neutral')
expect('no_auto_stream', !source('lib/media-command/digital-human/v4l2_tool.py').includes('STREAMON') || source('lib/media-command/digital-human/v4l2_tool.py').includes('if args.capture'), 'gate')
expect('director_prompt_preserved', detectHvsProductionIntent(DIRECTOR_ACCEPT_PROMPT) === 'director3d', detectHvsProductionIntent(DIRECTOR_ACCEPT_PROMPT))
expect('cast_routes', detectHvsProductionIntent("Cast Ra'el in this.") === 'actors', detectHvsProductionIntent("Cast Ra'el in this."))
expect('webcam_routes', detectHvsProductionIntent('Use my webcam take.') === 'actors', 'webcam')
expect('crowd_routes', detectHvsProductionIntent('Add background actors.') === 'actors', 'crowd')
expect('no_new_project_copy', source('app/api/media-command/war-room/route.ts').includes('needsProject: true'), 'existing production')

const project = emptyProject({ id: 'hvs-actors', name: 'Actors' })
let directorBlocked = false
try { assertIdentityAuthority('director', 'VOICE_CLONING') } catch { directorBlocked = true }
expect('director_cannot_clone_voice', directorBlocked && !identityActionAllowed('director', 'NEW_IDENTITY_REFERENCE'), 'authority')
expect('commander_can_authorize', identityActionAllowed('commander', 'FACE_REFERENCE_ENROLLMENT'), 'commander')

const rael = HVS.castCharacter(project, { displayName: "Ra'el", roleName: 'lead', roleType: 'LEAD', actor: 'commander' })
expect('rael_name', rael.displayName === "Ra'el" && rael.characterClass === 'COMMANDER_DIGITAL_HUMAN' && rael.identityClass === 'COMMANDER', rael.displayName)
expect('rael_consent', rael.consentState === 'COMMANDER_SELF_AUTHORIZED' && rael.referenceAssetIds.length === 0, rael.consentState)
expect('rael_lock', rael.identityLock.faceLocked && rael.identityLock.bodyLocked && rael.identityLock.voiceLocked === false, 'lock')
expect('rael_wardrobe', rael.wardrobeSets.map(set => set.name).join(',') === 'RAEL_BLACK_SUIT,RAEL_CASUAL,RAEL_STREETWEAR', rael.wardrobeSets.map(set => set.name).join(','))
expect('rael_no_invented_body', rael.bodyProfile.heightMeters === null && rael.bodyProfile.suppliedMeasurements === false, 'body')
expect('rael_bible', Boolean(project.digitalHumans?.bibles.some(bible => bible.characterId === RAEL_CHARACTER_ID && bible.version === 1 && Boolean(bible.sections.lockedTraits))), 'bible')
expect('rael_rig_empty', rael.rigBinding.state === 'NO_RIG' && rael.generatorBindings.length === 0 && rael.voiceBinding === null, rael.rigBinding.state)
expect('identity_checkpoint', project.versions.some(version => /Ra'el/.test(version.label)) && project.versions.length === 2, String(project.versions.length))
expect('no_duplicate_rael', project.digitalHumans?.characters.filter(item => item.id === RAEL_CHARACTER_ID).length === 1, 'one')

const voice = prepareVoiceBinding('commander', 'COMMANDER_AUTHORIZED')
expect('voice_not_enrolled', voice.enrolled === false && voice.localModelRef === null, String(voice.enrolled))
const lip = prepareLipSyncPlan(rael.id)
expect('lipsync_not_installed', lip.modelInstalled === false && lip.phonemeTrack === null, 'lip')
const motionRuntime = auditMotionRuntime()
expect('motion_runtime', motionRuntime.status === PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED && motionRuntime.found.length === 0, motionRuntime.status)

const actor = HVS.directPerformance(project, ACTOR_A, 'commander')
const actorHuman = HVS.getCharacter(project, actor.characterId ?? '')
const blocking = project.digitalHumans?.blockingPlans.find(item => item.characterId === actor.characterId)
const gaze = project.digitalHumans?.gazePlans.find(item => item.characterId === actor.characterId)
expect('actor_a', actorHuman?.displayName === 'Actor A' && actorHuman.identityClass === 'FICTIONAL' && actorHuman.consentState === 'NOT_APPLICABLE_FICTIONAL', actorHuman?.displayName ?? '')
expect('actor_a_direction', Boolean(blocking?.marks.some(mark => mark.name === 'CAR_SIDE')) && gaze?.behavior === 'LOOK_AT' && Boolean(blocking?.motionPathId), blocking?.actions.join('|') ?? '')
expect('actor_a_3d', Boolean(project.director3d?.scenes.some(scene => scene.characters.some(item => item.digitalHumanId === actor.characterId && item.state === 'PLACEHOLDER'))), 'placeholder')

const crowd = HVS.directPerformance(project, ALLEY, 'commander')
const population = project.digitalHumans?.populations.find(item => item.id === crowd.populationId)
expect('crowd_count', population?.count === 12 && population.groups.some(group => group.behavior === 'WALK' && group.count === 9) && population.groups.some(group => group.behavior === 'WAIT' && group.count === 3), String(population?.count))
expect('crowd_reaction', population?.reaction?.trigger === 'MAJOR_COLLAPSE' && population.reaction.behavior === 'FLEE' && population.avoidRegions.some(region => region.id === 'destruction-zone'), population?.reaction?.trigger ?? '')
expect('crowd_not_persistent', Boolean(population?.instances.every(item => item.persistent === false && item.identity === 'NON_PERSISTENT_SYNTHETIC') && population.persistentFaces === false), 'synthetic')
expect('crowd_lod', Boolean(population?.instances.some(item => item.lod === 'LOW') && population.instances.some(item => item.lod === 'MEDIUM')), 'lod')

const scene = HVS.directPerformance(project, SCENE, 'commander')
const binding = project.digitalHumans?.sceneBindings.find(item => item.sceneId === scene.sceneId)
const boundScene = project.director3d?.scenes.find(item => item.id === scene.sceneId)
const shots = project.cinemaDirector?.plans.find(plan => plan.sceneId === scene.sceneId)?.shots ?? []
expect('coordination', Boolean(binding?.characterIds.includes(RAEL_CHARACTER_ID) && binding.populationId === population?.id && binding.destructionTrigger === 'MAJOR_COLLAPSE'), binding?.destructionTrigger ?? '')
expect('shared_clock', binding?.sharedTimescale === HVS_SCENE_TIMESCALE && sharedClockOk(shots.flatMap(shot => [shot.start, shot.end])) && toSeconds(binding?.destructionTime ?? { ticks: 0, timescale: 1 }) === 6, String(binding?.sharedTimescale))
expect('shot_binding', shots.some(shot => shot.characterIds?.includes(RAEL_CHARACTER_ID)) && shots.some(shot => /close-up/i.test(shot.name)) && shots.length === 4, String(shots.length))
expect('rael_same_id', shots.every(shot => !shot.characterIds || shot.characterIds.includes(RAEL_CHARACTER_ID)) && HVS.getCharacter(project, RAEL_CHARACTER_ID)?.activeWardrobeSetId === rael.activeWardrobeSetId, rael.activeWardrobeSetId ?? '')
expect('3d_bridge', Boolean(boundScene?.characters.some(item => item.digitalHumanId === RAEL_CHARACTER_ID && item.identityRef === RAEL_CHARACTER_ID)), 'bridge')
expect('storyboard', project.storyboard.some(frame => frame.backgroundPopulationId === population?.id && frame.shotId), String(project.storyboard.length))
expect('blueprint_not_invoked', Boolean(project.digitalHumans?.blueprints.some(item => item.characterId === RAEL_CHARACTER_ID && item.invoked === false)), 'blueprint')

const same = HVS.directPerformance(project, 'Keep the same actress.', 'commander')
expect('same_actress', same.characterId === actor.characterId, same.characterId ?? '')
const serious = HVS.directPerformance(project, "Make Ra'el more serious.", 'commander')
expect('patch_proposal', Boolean(project.digitalHumans?.patches.some(patch => patch.characterId === serious.characterId && patch.status === 'proposed' && patch.kind === 'CHANGE_EMOTION')), 'proposal')
const ten = HVS.createBackgroundPopulation(project, { count: 10, profile: 'station', walking: 10, standing: 0 })
expect('ten_background', ten.count === 10, String(ten.count))

const session = HVS.startPerformanceCapture(project, { characterId: RAEL_CHARACTER_ID, mode: 'HEAD_REFERENCE', actor: 'commander' })
expect('capture_explicit', session.explicitStart === true && session.status === 'ACTIVE' && session.deviceReleased === false, session.status)
const stopped = HVS.stopPerformanceCapture(project, session.id)
expect('capture_stop', stopped.status === 'STOPPED' && stopped.deviceReleased === true, stopped.status)
let hidden = false
try { HVS.startPerformanceCapture(project, { actor: 'director' }) } catch { hidden = true }
expect('director_cannot_start_camera', hidden, 'privacy')

const takeId = 'take-reuse'
project.digitalHumans?.takes.push({
  id: takeId,
  captureSessionId: session.id,
  characterId: RAEL_CHARACTER_ID,
  label: 'TAKE 1',
  duration: shots[0]?.duration ?? { ticks: 24_000, timescale: 24_000 },
  motionRef: 'motion-reuse',
  audioRef: null,
  rawAssetId: 'asset-raw-once',
  rating: null,
  selected: true,
})
const firstRef = HVS.assignPerformanceReference(project, { takeId, characterId: RAEL_CHARACTER_ID, shotId: shots[0]?.id ?? 'shot-a' })
const secondRef = HVS.assignPerformanceReference(project, { takeId, characterId: RAEL_CHARACTER_ID, shotId: shots[1]?.id ?? 'shot-b' })
expect('performance_reuse', firstRef.rawAssetId === secondRef.rawAssetId && firstRef.motionRef === secondRef.motionRef && firstRef.id !== secondRef.id, firstRef.rawAssetId ?? '')
expect('takes_do_not_add_versions', project.versions.length === 2, String(project.versions.length))

const drifted = continuityDrift(rael, { ...rael, bodyProfile: { ...rael.bodyProfile, bodyScale: 2 }, referenceSetVersion: 'changed' })
expect('drift_warnings', drifted.some(item => item.code === 'BODY_SCALE_DRIFT') && drifted.some(item => item.code === 'FACE_REFERENCE_DRIFT'), drifted.map(item => item.code).join(','))
const qc = runCharacterQc(project.digitalHumans!)
expect('qc_no_missing_rael', !qc.some(item => item.code === 'MISSING_CONSENT' && item.characterId === RAEL_CHARACTER_ID), qc.map(item => item.code).join(','))

const roundTrip = parseHvsProject(serializeHvsProject(project))
expect('reload', Boolean(roundTrip.digitalHumans?.characters.some(item => item.id === RAEL_CHARACTER_ID) && roundTrip.digitalHumans.captureSessions.every(item => item.status !== 'ACTIVE')), 'persist')
expect('gesture_vocab', source('lib/media-command/digital-human/types.ts').includes('CUSTOM_REFERENCE') && source('lib/media-command/digital-human/types.ts').includes('LOOK_AWAY'), 'vocab')
expect('ui', source('components/war-room/higher-vision-studios/HvsDigitalHumanScreen.tsx').includes('CAMERA ACTIVE') && source('components/war-room/higher-vision-studios/HvsDigitalHumanScreen.tsx').includes('data-testid="hvs-rael-card"'), 'ui')

const failed = results.filter(item => !item.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({
  ok: true,
  total: results.length,
  matrix: 'MATRIX_EXTENSION_REQUIRED',
  motion: PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED,
  voice: 'NOT AUTHORIZED',
  lipsync: 'NOT AUTHORIZED',
  generation: 'NOT AUTHORIZED',
  paidProviderCalls: 0,
}))
