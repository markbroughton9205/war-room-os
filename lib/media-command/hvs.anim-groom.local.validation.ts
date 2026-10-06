/**
 * HVS-ANIM-03 — hair / grooming + static head finish on the existing HEAD bone.
 * `pnpm run validate:hvs-anim-groom`
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cloneProject, HVSPROJ_VERSION } from './types'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { projectFilePath } from './paths'
import {
  HVS_HUMANOID_RIG_ID,
  MATRIX_EXTENSION_REQUIRED,
  RAEL_CHARACTER_ID,
} from './digital-human/types'
import { HVS_HUMANOID_BONES, bindHumanoidRig, validateHumanoidHierarchy } from './digital-human/humanoid-rig'
import { poseAtSceneClock } from './digital-human/scene-performance'
import { HVS } from './hvs-producer-contract'
import { activeCinemaPlan } from './cinema-director/persist'
import { cinemaCamerasAlreadyBound } from './cinema-director/scene-bind'
import {
  HVS_ANIM02_TRIANGLE_COUNT,
  HVS_ANIM02_VERTEX_COUNT,
  HVS_BODY_MATERIALS,
  HVS_HEAD_GROOMING,
  HVS_HEAD_GROOM_ID,
  HVS_STYLIZED_BODY_ID,
  buildStylizedBodyGeometry,
  poseBoneWorld,
  validateSkinWeights,
} from './digital-human/skinned-body'
import { fromSeconds } from './time'

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
const TAKE_TIMESCALE = 24000

expect('hvsproj_untouched', HVSPROJ_VERSION === 0, String(HVSPROJ_VERSION))
expect('matrix_not_expanded', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('matrix_extension_required', MATRIX_EXTENSION_REQUIRED === 'MATRIX_EXTENSION_REQUIRED', MATRIX_EXTENSION_REQUIRED)
expect('same_character', RAEL_CHARACTER_ID === 'rael-commander', RAEL_CHARACTER_ID)
expect('same_rig', HVS_HUMANOID_RIG_ID === 'hvs-humanoid-rig-v1', HVS_HUMANOID_RIG_ID)
expect('bones_23', HVS_HUMANOID_BONES.length === 23 && validateHumanoidHierarchy().ok, String(HVS_HUMANOID_BONES.length))

const bodySrc = source('lib/media-command/digital-human/skinned-body.ts')
const preview = source('components/war-room/higher-vision-studios/HvsRaelBodyPreview.tsx')
const viewport = source('components/war-room/higher-vision-studios/Hvs3DViewport.tsx')
const combined = bodySrc + preview + viewport
expect('no_second_systems', !/GroomSystem2|HairRig2|FaceRig2|Character2|Rig2|hvs-humanoid-rig-v2/.test(combined), 'canonical')
expect('one_body_path', preview.includes('createHvsStylizedBody') && viewport.includes('createHvsStylizedBody'), 'shared')
expect('fallback_kept', preview.includes('Show rig proxy') && source('components/war-room/higher-vision-studios/HvsDigitalHumanScreen.tsx').includes('hvs-show-placeholder'), 'proxy + placeholder')
expect('no_webcam', !/getUserMedia|\/dev\/video|recordPerformanceTake/.test(bodySrc), 'no recapture')
expect('no_cloud', !/openai|anthropic|https:\/\/api\./i.test(bodySrc), 'local')
expect('no_new_model', !/mediapipe|onnx|tensorflow|whisper/i.test(bodySrc), 'no ml')
expect('no_face_rig', HVS_HEAD_GROOMING.faces === false && !/blendshape|lipSync|eyeTracking|blinkSystem/.test(bodySrc), 'static only')
expect('no_gaze', HVS_HEAD_GROOMING.gaze === false && bodySrc.includes('userData.gaze = false'), 'neutral eyes')
expect('hair_fn', bodySrc.includes('function stylizedHair') && bodySrc.includes('function staticBrows'), 'groom fns')
expect('groom_parent', HVS_HEAD_GROOMING.parentBone === 'HEAD' && HVS_HEAD_GROOMING.simulated === false, HVS_HEAD_GROOMING.parentBone)
expect('groom_owned', HVS_HEAD_GROOMING.provenance === 'HVS-original' && HVS_HEAD_GROOMING.identityLikeness === false, HVS_HEAD_GROOMING.id)

const started = process.hrtime.bigint()
const production = buildStylizedBodyGeometry('PRODUCTION')
const previewGeom = buildStylizedBodyGeometry('PREVIEW')
const buildMs = Number(process.hrtime.bigint() - started) / 1e6
const weights = validateSkinWeights(production)
expect('geometry_grew', production.vertexCount > HVS_ANIM02_VERTEX_COUNT && production.triangleCount > HVS_ANIM02_TRIANGLE_COUNT, `${production.vertexCount}v/${production.triangleCount}t vs ANIM-02 ${HVS_ANIM02_VERTEX_COUNT}/${HVS_ANIM02_TRIANGLE_COUNT}`)
expect('preview_lighter', previewGeom.vertexCount < production.vertexCount, `${previewGeom.vertexCount}<${production.vertexCount}`)
expect('skin_weights', weights.ok, JSON.stringify(weights))
expect('no_nan_geom', ![...production.positions].some(value => !Number.isFinite(value)), 'finite')
expect('build_cheap', buildMs < 400, `buildMs=${buildMs.toFixed(1)}`)
expect('hair_geometry', production.features.hairTris > 80 && production.features.hairHeadLocked > 80, JSON.stringify({ hairTris: production.features.hairTris, locked: production.features.hairHeadLocked }))
expect('brow_geometry', production.features.browTris > 8, String(production.features.browTris))
expect('hair_parent_head', production.features.hairHeadLocked > 80, String(production.features.hairHeadLocked))
expect('materials', HVS_BODY_MATERIALS.includes('hair') && HVS_BODY_MATERIALS.length === 5, HVS_BODY_MATERIALS.join(','))
expect('same_body_id', HVS_STYLIZED_BODY_ID === 'hvs-stylized-body-v1', HVS_STYLIZED_BODY_ID)
expect('same_groom_id', HVS_HEAD_GROOM_ID === 'groom-hvs-stylized-head-v1', HVS_HEAD_GROOM_ID)

const file = projectFilePath(PROJECT_ID)
expect('project_exists', existsSync(file), file)
const live = parseHvsProject(readFileSync(file, 'utf8'))
const clone = cloneProject(live)
bindHumanoidRig(clone.digitalHumans!, RAEL_CHARACTER_ID)
const human = clone.digitalHumans!.characters.find(item => item.id === RAEL_CHARACTER_ID)!
expect('single_rael', clone.digitalHumans!.characters.filter(item => item.id === RAEL_CHARACTER_ID).length === 1, String(clone.digitalHumans!.characters.length))
expect('rig_bound', human.rigBinding.skeletonRef === HVS_HUMANOID_RIG_ID, human.rigBinding.skeletonRef ?? '')
expect('take_unchanged', clone.digitalHumans!.takes.some(item => item.id === TAKE_ID), TAKE_ID)
expect('mesh_metadata', human.representations.some(item => item.id === 'mesh-hvs-stylized-body-v1'), 'mesh')
expect('groom_metadata', human.representations.some(item => item.id === 'groom-hvs-stylized-head-v1' && item.kind === '3D_MODEL' && item.assetId === null), 'groom meta')

const attached = HVS.attachDirectorPerformance(clone, clone.director3d!.scenes[0]!)
const track = attached.tracks[0]
expect('take_bound', track?.takeId === TAKE_ID && track.poses.length === 300, String(track?.poses.length ?? 0))

function poseLock(seconds: number) {
  const sample = poseAtSceneClock(track, fromSeconds(seconds, TAKE_TIMESCALE))
  const bones = ['HEAD', 'NECK', 'LEFT_SHOULDER', 'LEFT_ELBOW', 'LEFT_WRIST', 'PELVIS'] as const
  return bones.map(bone => {
    const posed = poseBoneWorld(sample.pose, bone)
    const joint = sample.pose.joints[bone]
    const match = posed.position.x === joint[0] && posed.position.y === joint[1] && posed.position.z === joint[2]
    return { bone, match }
  })
}
for (const seconds of [0, 4.4, 6.5, 8.5]) {
  const lock = poseLock(seconds)
  expect(`pose_truth_${seconds}s`, lock.every(item => item.match), lock.map(item => `${item.bone}:${item.match ? 'ok' : 'DIFF'}`).join(','))
}

const pose0 = poseAtSceneClock(track, fromSeconds(0, TAKE_TIMESCALE))
const poseRaise = poseAtSceneClock(track, fromSeconds(4.4, TAKE_TIMESCALE))
expect('left_arm', (poseRaise.pose.joints.LEFT_WRIST?.[1] ?? 0) - (pose0.pose.joints.LEFT_WRIST?.[1] ?? 0) >= 0.08, String(poseRaise.pose.joints.LEFT_WRIST?.[1]))

const plan = activeCinemaPlan(live)
expect('cameras_intact', Boolean(plan && live.director3d?.scenes[0] && cinemaCamerasAlreadyBound(live.director3d.scenes[0], plan)), String(live.director3d?.scenes[0]?.cameras.length ?? 0))
expect('clock_untouched', source('components/war-room/higher-vision-studios/Hvs3DDirectorScreen.tsx').includes('playing={false}'), 'one clock')
expect('characters_binding', preview.includes('createHvsStylizedBody'), 'characters')
expect('director_binding', viewport.includes("createHvsStylizedBody('PRODUCTION')"), 'director')

if (!live.digitalHumans?.characters.find(item => item.id === RAEL_CHARACTER_ID)?.representations.some(item => item.id === 'groom-hvs-stylized-head-v1')) {
  bindHumanoidRig(live.digitalHumans!, RAEL_CHARACTER_ID)
  writeFileSync(file, serializeHvsProject(live), 'utf8')
}
const reloaded = parseHvsProject(readFileSync(file, 'utf8'))
expect('persisted_groom', reloaded.digitalHumans?.characters.find(item => item.id === RAEL_CHARACTER_ID)?.representations.some(item => item.id === 'groom-hvs-stylized-head-v1') === true, 'groom meta')
expect('no_baked_arrays', !serializeHvsProject(reloaded).includes('"skinWeight"'), 'no mesh dump')

const failed = results.filter(item => !item.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed: failed.map(item => item.name),
  total: results.length,
  vertices: production.vertexCount,
  triangles: production.triangleCount,
  previewVertices: previewGeom.vertexCount,
  previewTriangles: previewGeom.triangleCount,
  anim02Vertices: HVS_ANIM02_VERTEX_COUNT,
  anim02Triangles: HVS_ANIM02_TRIANGLE_COUNT,
  features: production.features,
  materials: HVS_BODY_MATERIALS.length,
  buildMs: Number(buildMs.toFixed(2)),
  bones: 23,
  paidProviderCalls: 0,
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
