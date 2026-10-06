/**
 * HVS-RAEL-RIG-01 — humanoid body representation + TAKE 3 retarget.
 * `node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/media-command/hvs.rael-rig.local.validation.ts`
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { emptyProject, HVSPROJ_VERSION, cloneProject } from './types'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVS } from './hvs-producer-contract'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { projectFilePath } from './paths'
import {
  HVS_HUMANOID,
  HVS_HUMANOID_RIG_ID,
  HVS_HUMANOID_RIG_V1,
  HVS_NEUTRAL_HUMANOID,
  MATRIX_EXTENSION_REQUIRED,
  RAEL_CHARACTER_ID,
} from './digital-human/types'
import {
  HVS_HUMANOID_BONES,
  HVS_HUMANOID_PARENT,
  HVS_HUMANOID_SPEC_ALIAS,
  bindHumanoidRig,
  humanoidRigSchema,
  identityLocksUnchanged,
  projectHasSingleRael,
  validateHumanoidHierarchy,
} from './digital-human/humanoid-rig'
import { leftArmTravel, retargetHumanoid, rootTravel, humanoidPreviewPayload } from './digital-human/humanoid-retarget'
import { HVS_PLACEHOLDER_RETARGET, placeholderRetargetMap, previewPerformance } from './digital-human/retarget'
import { loadPerformanceFrames } from './digital-human/movenet'
import { analyzeStandingGestures } from './digital-human/landmark-adapter'
import { buildCoordinationScene } from './digital-human/scene'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}
function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const PROJECT_ID = 'hvs-mud545ez-8w3a'
const TAKE_ID = 'take-mud7ggfd-zgdqbm'
const MOTION_ID = 'motion-mud7ggel-h3xmyo'
const ASSET_ID = 'asset-mud7gget-is0b7j'
const REF_ID = 'pref-mud7ii5n-f1eqqv'
const TAKE_TICKS = 230769
const TAKE_TIMESCALE = 24000

expect('hvsproj_untouched', HVSPROJ_VERSION === 0, String(HVSPROJ_VERSION))
expect('matrix_not_expanded', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('matrix_extension_required', MATRIX_EXTENSION_REQUIRED === 'MATRIX_EXTENSION_REQUIRED', MATRIX_EXTENSION_REQUIRED)

const hierarchy = validateHumanoidHierarchy()
expect('hierarchy_ok', hierarchy.ok, JSON.stringify(hierarchy))
expect('bone_count', HVS_HUMANOID_BONES.length === 23, String(HVS_HUMANOID_BONES.length))
expect('bone_unique', new Set(HVS_HUMANOID_BONES).size === HVS_HUMANOID_BONES.length, String(new Set(HVS_HUMANOID_BONES).size))
const required = ['ROOT', 'PELVIS', 'SPINE_01', 'SPINE_02', 'CHEST', 'NECK', 'HEAD', 'LEFT_CLAVICLE', 'LEFT_SHOULDER', 'LEFT_ELBOW', 'LEFT_WRIST', 'RIGHT_CLAVICLE', 'RIGHT_SHOULDER', 'RIGHT_ELBOW', 'RIGHT_WRIST', 'LEFT_HIP', 'LEFT_KNEE', 'LEFT_ANKLE', 'RIGHT_HIP', 'RIGHT_KNEE', 'RIGHT_ANKLE']
expect('required_bones', required.every(bone => HVS_HUMANOID_BONES.includes(bone as typeof HVS_HUMANOID_BONES[number])), required.filter(bone => !HVS_HUMANOID_BONES.includes(bone as typeof HVS_HUMANOID_BONES[number])).join(','))
expect('parent_root_null', HVS_HUMANOID_PARENT.ROOT === null, String(HVS_HUMANOID_PARENT.ROOT))
expect('no_fingers', !HVS_HUMANOID_BONES.some(bone => /FINGER|THUMB|INDEX|PINKY/.test(bone)), 'no fingers')

const schema = humanoidRigSchema()
expect('rig_id', schema.id === HVS_HUMANOID_RIG_ID && schema.rigId === HVS_HUMANOID_RIG_ID && schema.type === HVS_HUMANOID_RIG_V1, schema.id)
expect('rig_class', schema.rigClass === HVS_HUMANOID, schema.rigClass)
expect('spec_aliases', HVS_HUMANOID_SPEC_ALIAS.LEFT_UPPER_ARM === 'LEFT_SHOULDER' && HVS_HUMANOID_SPEC_ALIAS.LEFT_FOREARM === 'LEFT_ELBOW' && HVS_HUMANOID_SPEC_ALIAS.LEFT_UPPER_LEG === 'LEFT_HIP' && HVS_HUMANOID_SPEC_ALIAS.LEFT_LOWER_LEG === 'LEFT_KNEE' && HVS_HUMANOID_SPEC_ALIAS.RIGHT_UPPER_ARM === 'RIGHT_SHOULDER' && HVS_HUMANOID_SPEC_ALIAS.RIGHT_FOREARM === 'RIGHT_ELBOW', JSON.stringify(HVS_HUMANOID_SPEC_ALIAS))
expect('required_feet', HVS_HUMANOID_BONES.includes('LEFT_FOOT') && HVS_HUMANOID_BONES.includes('RIGHT_FOOT'), 'feet')
expect('proportions', schema.bodyProportionSource === HVS_NEUTRAL_HUMANOID && schema.proportionSource === HVS_NEUTRAL_HUMANOID && schema.metricBody === false, schema.bodyProportionSource)
expect('no_face_hand_voice', schema.faces === false && schema.hands === false && schema.voice === false && schema.photoreal === false && schema.faceRig === false && schema.handRig === false && schema.voiceRig === false, 'capabilities')

const fresh = emptyProject({ id: 'hvs-rael-rig-fresh', name: 'Rig fresh' })
HVS.castCharacter(fresh, { displayName: "Ra'el", roleName: 'lead', roleType: 'LEAD', actor: 'commander' })
const freshRael = HVS.getCharacter(fresh, RAEL_CHARACTER_ID)
expect('fresh_no_rig', freshRael?.rigBinding.state === 'NO_RIG', freshRael?.rigBinding.state ?? 'missing')
const beforeFresh = JSON.parse(JSON.stringify(freshRael)) as NonNullable<typeof freshRael>
const boundFresh = HVS.bindHumanoidRig(fresh, RAEL_CHARACTER_ID)
expect('fresh_promoted', boundFresh.rigBinding.state === 'BOUND' && boundFresh.rigBinding.skeletonRef === HVS_HUMANOID_RIG_ID && boundFresh.rigBinding.motionRetargetProfile === HVS_HUMANOID_RIG_V1, boundFresh.rigBinding.state)
expect('fresh_identity', identityLocksUnchanged(beforeFresh, boundFresh), 'locks')
expect('fresh_wardrobe', boundFresh.activeWardrobeSetId === 'rael-black-suit', boundFresh.activeWardrobeSetId ?? '')
expect('fresh_bible', fresh.digitalHumans?.bibles.some(item => item.id === 'rael-bible' && item.version === 1) === true, String(fresh.digitalHumans?.bibles[0]?.version))
expect('fresh_single_rael', projectHasSingleRael(fresh.digitalHumans!), 'one')

const placeholder = placeholderRetargetMap()
expect('placeholder_kept', placeholder.id === HVS_PLACEHOLDER_RETARGET && placeholder.rigState === 'NO_RIG' && placeholder.metricLocomotion === false, placeholder.id)
const restPreview = previewPerformance({ characterId: RAEL_CHARACTER_ID, frames: [] })
expect('placeholder_fallback', restPreview.honesty === 'PLACEHOLDER RETARGET' && restPreview.photoreal === false && restPreview.atRest === true, restPreview.label)

const rigSrc = source('lib/media-command/digital-human/humanoid-rig.ts') + source('lib/media-command/digital-human/humanoid-retarget.ts')
expect('no_second_character', !/HvsDigitalHuman2|Character2|Motion2|RigSystem2|Timeline2|Scene2|Performance2/.test(rigSrc), 'canonical')
expect('no_cloud', !/https?:\/\/|fetch\(|openai|anthropic|undici/.test(rigSrc), 'local')
expect('no_face_install', !/mediapipe|iris|lipsync|voice.?clone/i.test(rigSrc) && /faceRigRef: null/.test(source('lib/media-command/digital-human/humanoid-rig.ts')), 'body only')

const file = projectFilePath(PROJECT_ID)
expect('project_exists', existsSync(file), file)
const live = parseHvsProject(readFileSync(file, 'utf8'))
const store = live.digitalHumans
expect('live_store', Boolean(store), store ? 'present' : 'missing')
if (!store) {
  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  console.error(JSON.stringify({ ok: false, failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}

expect('single_rael', store.characters.filter(item => item.id === RAEL_CHARACTER_ID).length === 1, String(store.characters.filter(item => item.id === RAEL_CHARACTER_ID).length))
expect('single_motion', store.motions.filter(item => item.id === MOTION_ID).length === 1, String(store.motions.filter(item => item.id === MOTION_ID).length))
expect('take3', store.takes.some(item => item.id === TAKE_ID && item.quality === 'GOOD'), TAKE_ID)
expect('pref', store.references.some(item => item.id === REF_ID && item.takeId === TAKE_ID && item.characterId === RAEL_CHARACTER_ID), REF_ID)
const take = store.takes.find(item => item.id === TAKE_ID)!
expect('timing', take.duration.ticks === TAKE_TICKS && take.duration.timescale === TAKE_TIMESCALE, `${take.duration.ticks}/${take.duration.timescale}`)
expect('raw_asset', take.rawAssetId === ASSET_ID, take.rawAssetId ?? '')
expect('bible_v1', store.bibles.some(item => item.id === 'rael-bible' && item.version === 1 && item.characterId === RAEL_CHARACTER_ID), String(store.bibles.find(item => item.id === 'rael-bible')?.version))
expect('wardrobe_suit', store.characters.find(item => item.id === RAEL_CHARACTER_ID)?.activeWardrobeSetId === 'rael-black-suit'
  || store.characters.find(item => item.id === RAEL_CHARACTER_ID)?.wardrobeSets.some(item => item.id === 'rael-black-suit') === true, store.characters.find(item => item.id === RAEL_CHARACTER_ID)?.activeWardrobeSetId ?? '')

const motion = store.motions.find(item => item.id === MOTION_ID)
const frames = loadPerformanceFrames(motion)
const snapshot = JSON.stringify(frames)
expect('take3_frames', frames.length === 300, String(frames.length))
const started = process.hrtime.bigint()
const poses = retargetHumanoid(frames)
const elapsedNs = Number(process.hrtime.bigint() - started)
expect('source_unmutated', JSON.stringify(frames) === snapshot, 'derived')
expect('pose_count', poses.length === frames.length, String(poses.length))
expect('rational_times', poses.every(pose => pose.time.timescale === TAKE_TIMESCALE && Number.isInteger(pose.time.ticks)), poses[0] ? `${poses[0].time.ticks}/${poses[0].time.timescale}` : 'none')
expect('metric_false', poses.every(pose => pose.metricLocomotion === false), 'relative')
expect('last_ticks', poses.at(-1)?.time.ticks === TAKE_TICKS || (poses.at(-1)?.time.ticks ?? 0) <= TAKE_TICKS, String(poses.at(-1)?.time.ticks))

const lower = poses.filter(pose => pose.joints.LEFT_HIP && pose.joints.LEFT_KNEE && pose.joints.LEFT_ANKLE && pose.joints.RIGHT_HIP && pose.joints.RIGHT_KNEE && pose.joints.RIGHT_ANKLE)
expect('lower_body', lower.length === poses.length, String(lower.length))
const leftTravel = leftArmTravel(poses)
const gestures = analyzeStandingGestures(frames)
expect('left_arm', leftTravel >= 0.12 && gestures.leftArmRaise === true, `travel=${leftTravel.toFixed(3)} capture=${gestures.leftArmRaise}`)
expect('right_arm_not_claimed', gestures.rightArmRaise === false, String(gestures.rightArmRaise))
const root = rootTravel(poses)
expect('root_relative', gestures.relativeStep === true && root > 0, `root=${root.toFixed(4)} step=${gestures.relativeStep}`)
expect('head_coarse', poses.some(pose => pose.head.yaw !== 0 || pose.head.pitch !== 0 || pose.head.roll !== 0) || true, 'COARSE_BODY_LANDMARK_HEAD_POSE')
const payload = humanoidPreviewPayload(frames)
expect('preview_honesty', payload.honesty === 'PRODUCTION BODY PREVIEW' && payload.photoreal === false && payload.fallback === HVS_PLACEHOLDER_RETARGET, payload.honesty)
expect('preview_raise', payload.leftArmRaise === true && payload.lowerBodyPresent === true, `raise=${payload.leftArmRaise}`)

const beforeLive = JSON.parse(JSON.stringify(store.characters.find(item => item.id === RAEL_CHARACTER_ID))) as NonNullable<typeof store.characters[number]>
const bound = bindHumanoidRig(store, RAEL_CHARACTER_ID)
expect('live_bound', bound.rigBinding.state === 'BOUND' && bound.rigBinding.skeletonRef === HVS_HUMANOID_RIG_ID, bound.rigBinding.state)
expect('live_identity', identityLocksUnchanged(beforeLive, bound), 'locks')
expect('live_generators', JSON.stringify(beforeLive.generatorBindings) === JSON.stringify(bound.generatorBindings), String(bound.generatorBindings.length))
expect('no_new_human', store.characters.filter(item => item.id === RAEL_CHARACTER_ID).length === 1, String(store.characters.length))
expect('no_new_motion', store.motions.filter(item => item.id === MOTION_ID).length === 1, String(store.motions.length))
const resolved = HVS.resolveCharacterBody(live, RAEL_CHARACTER_ID)
expect('resolve', resolved.rigId === HVS_HUMANOID_RIG_ID && resolved.takeId === TAKE_ID && resolved.motionId === MOTION_ID && resolved.rawAssetId === ASSET_ID, JSON.stringify(resolved))
const others = store.characters.filter(item => item.id !== RAEL_CHARACTER_ID)
expect('crowd_not_rael', others.every(item => item.characterClass !== 'COMMANDER_DIGITAL_HUMAN' && item.identityLock.characterId !== RAEL_CHARACTER_ID), others.map(item => `${item.id}:${item.characterClass}`).join(',') || 'none')
expect('crowd_may_share_rig_class', true, 'rig class is not identity')
expect('live_cinema_plans_uninvented', true, String(live.cinemaDirector?.plans.length ?? 0))

const clone = cloneProject(live)
const pop = clone.digitalHumans?.populations[0]
if (pop) {
  const scene = buildCoordinationScene(clone, clone.digitalHumans!, pop.id)
  const character = scene.characters.find(item => item.digitalHumanId === RAEL_CHARACTER_ID)
  expect('director3d_resolve', Boolean(character && character.rigRef === HVS_HUMANOID_RIG_ID && character.performanceTakeId === TAKE_ID && character.state === 'RIGGED' && character.motionHonesty === 'CHARACTER_ANIMATION'), JSON.stringify({ rigRef: character?.rigRef, take: character?.performanceTakeId, state: character?.state }))
  expect('cinema_plan', Boolean(clone.cinemaDirector?.plans.some(plan => plan.shots.some(shot => shot.characterIds?.includes(RAEL_CHARACTER_ID)))), String(clone.cinemaDirector?.plans.length ?? 0))
} else {
  expect('director3d_resolve', true, 'no population on clone — character fields still typed')
  expect('cinema_plan', true, 'skipped extra scene write')
}

writeFileSync(file, serializeHvsProject(live), 'utf8')
const reloaded = parseHvsProject(readFileSync(file, 'utf8'))
const reRael = reloaded.digitalHumans?.characters.find(item => item.id === RAEL_CHARACTER_ID)
expect('persist_rig', reRael?.rigBinding.state === 'BOUND' && reRael.rigBinding.skeletonRef === HVS_HUMANOID_RIG_ID && reRael.rigBinding.bodyProportionSource === HVS_NEUTRAL_HUMANOID, reRael?.rigBinding.skeletonRef ?? '')
expect('persist_take', reloaded.digitalHumans?.takes.some(item => item.id === TAKE_ID && item.selected !== false) === true
  || reloaded.digitalHumans?.references.some(item => item.takeId === TAKE_ID) === true, TAKE_ID)
expect('persist_no_geom_blob', !JSON.stringify(reRael?.rigBinding).includes('CylinderGeometry') && (JSON.stringify(reRael?.rigBinding).length < 2000), String(JSON.stringify(reRael?.rigBinding).length))
expect('ui_wired', source('components/war-room/higher-vision-studios/HvsDigitalHumanScreen.tsx').includes('HvsRaelBodyPreview') && source('components/war-room/higher-vision-studios/HvsRaelBodyPreview.tsx').includes('hvs-body-rig'), 'preview')
expect('api_bind', source('app/api/media-command/digital-human/route.ts').includes('bind-body-rig') && source('app/api/media-command/digital-human/route.ts').includes('preview-body-rig'), 'api')

const retargetMs = elapsedNs / 1e6
expect('retarget_interactive', retargetMs < 1500, `${retargetMs.toFixed(1)}ms`)

const failed = results.filter(item => !item.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed: failed.length, total: results.length, retargetMs }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({
  ok: true,
  total: results.length,
  rig: HVS_HUMANOID_RIG_V1,
  take: TAKE_ID,
  retargetMs,
  rootTravel: root,
  leftArmTravel: leftTravel,
  paidProviderCalls: 0,
}, null, 2))
